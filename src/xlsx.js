// מנתח גיליונות (xlsx / csv) ללא תלויות חיצוניות.
// xlsx הוא קובץ ZIP המכיל XML. אנו מחלצים את הרשומות הנדרשות בעזרת zlib המובנה.
import zlib from 'node:zlib';

/* ---------- קריאת ZIP מינימלית ---------- */
function readZipEntries(buf) {
  // איתור End Of Central Directory (חתימה PK\x05\x06)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('קובץ xlsx לא תקין (לא נמצא ZIP)');
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16); // תחילת ה-Central Directory

  const entries = {};
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries[name] = { method, compSize, localOff };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  // כותרת מקומית – חישוב היסט תחילת הנתונים
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('כותרת ZIP מקומית לא תקינה');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return Buffer.from(data); // ללא דחיסה
  if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error('שיטת דחיסה לא נתמכת ב-xlsx');
}

/* ---------- פענוח XML בסיסי ---------- */
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&amp;/g, '&');
}

// טבלת המחרוזות המשותפות (sharedStrings.xml)
function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1];
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(inner))) text += t[1];
    out.push(decodeXmlEntities(text));
  }
  return out;
}

function colLetterToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let idx = 0;
  for (const ch of m[1]) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[3] || '';
      const body = cm[2] || '';
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const colIdx = refM ? colLetterToIndex(refM[1]) : cells.length;
      const typeM = /t="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : 'n';
      let value = '';
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) value = shared[Number(v[1])] || '';
      } else if (type === 'inlineStr') {
        const t = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body);
        if (t) value = decodeXmlEntities(t[1]);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) value = decodeXmlEntities(v[1]);
      }
      cells[colIdx] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

function parseXlsx(buf) {
  const entries = readZipEntries(buf);
  const shared = entries['xl/sharedStrings.xml']
    ? parseSharedStrings(extractEntry(buf, entries['xl/sharedStrings.xml']).toString('utf8'))
    : [];
  // בחירת הגיליון הראשון
  let sheetName = 'xl/worksheets/sheet1.xml';
  if (!entries[sheetName]) {
    const candidate = Object.keys(entries).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
    if (candidate) sheetName = candidate;
  }
  if (!entries[sheetName]) throw new Error('לא נמצא גיליון בקובץ');
  const sheetXml = extractEntry(buf, entries[sheetName]).toString('utf8');
  return parseSheet(sheetXml, shared);
}

/* ---------- CSV ---------- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // הסרת BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* התעלמות */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- נקודת כניסה ---------- */
export function parseSpreadsheet(buffer, filename = '') {
  const isXlsx = /\.xlsx$/i.test(filename) || (buffer[0] === 0x50 && buffer[1] === 0x4b); // 'PK'
  let rows = isXlsx ? parseXlsx(buffer) : parseCsv(buffer.toString('utf8'));
  // ניקוי שורות ריקות לגמרי
  rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  return rows;
}
