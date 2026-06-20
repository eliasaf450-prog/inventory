import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initSchema, seedAdmin, seedItemTypesForCompany } from './src/db.js';
import { hashPassword, verifyPassword, newToken } from './src/auth.js';
import { SIZE_SCHEMES, DEFAULT_ITEM_TYPES, sizeOptions, isValidScheme } from './src/sizes.js';
import { parseSpreadsheet } from './src/xlsx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 14;

initSchema();
seedAdmin();

/* ------------------------------------------------------------------ */
/* עזרי תגובה ובקשה                                                    */
/* ------------------------------------------------------------------ */
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function fail(res, status, message) {
  json(res, status, { error: message });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 25e6) reject(new Error('גוף הבקשה גדול מדי'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON לא תקין'));
      }
    });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* אימות וסשנים                                                        */
/* ------------------------------------------------------------------ */
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const sess = db
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .get(sid);
  if (!sess) return null;
  const user = db.prepare('SELECT id, email, username, role, status FROM users WHERE id = ?').get(sess.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}
function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

/* ------------------------------------------------------------------ */
/* רישום ה-API                                                         */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, handler, opts = {}) {
  // pattern כמו '/api/products/:id' -> regex עם פרמטרים בשם
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, re, keys, handler, auth: opts.auth, admin: opts.admin });
}

const api = {
  /* ---------------------- אימות ---------------------- */
  async register(ctx) {
    const { email, username, password } = ctx.body;
    if (!email || !username || !password) return fail(ctx.res, 400, 'נא למלא אימייל, שם משתמש וסיסמה');
    const exists = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (exists) return fail(ctx.res, 409, 'אימייל או שם משתמש כבר קיימים');
    // הרשמה יוצרת חשבון ממתין לאישור מנהל (המנהל מספק/מאשר סיסמה)
    db.prepare(
      `INSERT INTO users (email, username, password_hash, role, status) VALUES (?, ?, ?, 'user', 'pending')`
    ).run(email, username, hashPassword(password));
    json(ctx.res, 201, { ok: true, message: 'נרשמת בהצלחה. החשבון ממתין לאישור מנהל.' });
  },

  async login(ctx) {
    const { username, password } = ctx.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return fail(ctx.res, 401, 'שם משתמש או סיסמה שגויים');
    }
    if (user.status === 'pending') return fail(ctx.res, 403, 'החשבון ממתין לאישור מנהל');
    if (user.status === 'disabled') return fail(ctx.res, 403, 'החשבון מושבת');
    const token = newToken();
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))").run(
      token,
      user.id,
      `+${SESSION_DAYS} days`
    );
    setSessionCookie(ctx.res, token);
    json(ctx.res, 200, { id: user.id, username: user.username, email: user.email, role: user.role });
  },

  async logout(ctx) {
    const sid = parseCookies(ctx.req).sid;
    if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
    res_clear(ctx.res);
    json(ctx.res, 200, { ok: true });
  },

  async me(ctx) {
    json(ctx.res, 200, ctx.user);
  },

  /* ---------------------- ניהול משתמשים (מנהל) ---------------------- */
  async listUsers(ctx) {
    const users = db
      .prepare('SELECT id, email, username, role, status, created_at FROM users ORDER BY created_at DESC')
      .all();
    json(ctx.res, 200, users);
  },
  async createUser(ctx) {
    const { email, username, password, role } = ctx.body;
    if (!email || !username || !password) return fail(ctx.res, 400, 'חסרים שדות');
    const exists = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (exists) return fail(ctx.res, 409, 'אימייל או שם משתמש כבר קיימים');
    const info = db
      .prepare(`INSERT INTO users (email, username, password_hash, role, status) VALUES (?, ?, ?, ?, 'active')`)
      .run(email, username, hashPassword(password), role === 'admin' ? 'admin' : 'user');
    json(ctx.res, 201, { id: info.lastInsertRowid });
  },
  async setUserPassword(ctx) {
    const { password } = ctx.body;
    if (!password) return fail(ctx.res, 400, 'נא להזין סיסמה');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  async setUserStatus(ctx) {
    const { status } = ctx.body; // active | pending | disabled
    if (!['active', 'pending', 'disabled'].includes(status)) return fail(ctx.res, 400, 'סטטוס לא תקין');
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  async setUserRole(ctx) {
    const { role } = ctx.body;
    if (!['admin', 'user'].includes(role)) return fail(ctx.res, 400, 'תפקיד לא תקין');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  async deleteUser(ctx) {
    if (Number(ctx.params.id) === ctx.user.id) return fail(ctx.res, 400, 'לא ניתן למחוק את עצמך');
    db.prepare('DELETE FROM users WHERE id = ?').run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },

  /* ---------------------- סכמות מידות ---------------------- */
  async sizeSchemes(ctx) {
    json(ctx.res, 200, { schemes: SIZE_SCHEMES, defaultItemTypes: DEFAULT_ITEM_TYPES });
  },

  /* ---------------------- חברות ניהול ---------------------- */
  async listCompanies(ctx) {
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM item_types t WHERE t.company_id = c.id) AS item_type_count
         FROM companies c ORDER BY c.name`
      )
      .all();
    json(ctx.res, 200, rows);
  },
  async createCompany(ctx) {
    const { name } = ctx.body;
    if (!name) return fail(ctx.res, 400, 'נא להזין שם חברה');
    const exists = db.prepare('SELECT id FROM companies WHERE name = ?').get(name);
    if (exists) return fail(ctx.res, 409, 'חברה בשם זה כבר קיימת');
    const info = db.prepare('INSERT INTO companies (name) VALUES (?)').run(name);
    seedItemTypesForCompany(info.lastInsertRowid); // יצירת סוגי הפריטים הסטנדרטיים
    json(ctx.res, 201, { id: info.lastInsertRowid });
  },
  async deleteCompany(ctx) {
    db.prepare('DELETE FROM companies WHERE id = ?').run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },

  /* ---------------------- סוגי פריטים ---------------------- */
  async listItemTypes(ctx) {
    const companyId = ctx.query.get('company_id');
    let rows;
    if (companyId) {
      rows = db.prepare('SELECT * FROM item_types WHERE company_id = ? ORDER BY name').all(companyId);
    } else {
      rows = db.prepare('SELECT * FROM item_types ORDER BY name').all();
    }
    json(ctx.res, 200, rows);
  },
  async createItemType(ctx) {
    const { company_id, name, size_scheme } = ctx.body;
    if (!company_id || !name || !size_scheme) return fail(ctx.res, 400, 'חסרים שדות');
    if (!isValidScheme(size_scheme)) return fail(ctx.res, 400, 'סכמת מידות לא תקינה');
    const exists = db.prepare('SELECT id FROM item_types WHERE company_id = ? AND name = ?').get(company_id, name);
    if (exists) return fail(ctx.res, 409, 'סוג פריט בשם זה כבר קיים בחברה זו');
    const info = db
      .prepare('INSERT INTO item_types (company_id, name, size_scheme) VALUES (?, ?, ?)')
      .run(company_id, name, size_scheme);
    json(ctx.res, 201, { id: info.lastInsertRowid });
  },
  async deleteItemType(ctx) {
    db.prepare('DELETE FROM item_types WHERE id = ?').run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },

  /* ---------------------- מוצרים (מק"טים עם מידה) ---------------------- */
  async listProducts(ctx) {
    const itemTypeId = ctx.query.get('item_type_id');
    const companyId = ctx.query.get('company_id');
    let sql = `
      SELECT p.*, t.name AS item_type_name, t.size_scheme, t.company_id, c.name AS company_name
      FROM products p
      JOIN item_types t ON t.id = p.item_type_id
      JOIN companies c ON c.id = t.company_id`;
    const where = [];
    const args = [];
    if (itemTypeId) { where.push('p.item_type_id = ?'); args.push(itemTypeId); }
    if (companyId) { where.push('t.company_id = ?'); args.push(companyId); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY c.name, t.name, p.gender, p.size';
    json(ctx.res, 200, db.prepare(sql).all(...args));
  },
  async createProduct(ctx) {
    const b = ctx.body;
    if (!b.item_type_id) return fail(ctx.res, 400, 'חסר סוג פריט');
    const t = db.prepare('SELECT * FROM item_types WHERE id = ?').get(b.item_type_id);
    if (!t) return fail(ctx.res, 404, 'סוג פריט לא קיים');
    const gender = b.gender || null;
    const size = b.size != null ? String(b.size) : '';
    const manufacturer = b.manufacturer || null;
    const exists = db
      .prepare(
        'SELECT id FROM products WHERE item_type_id = ? AND IFNULL(gender,\'\') = IFNULL(?,\'\') AND size = ? AND IFNULL(manufacturer,\'\') = IFNULL(?,\'\')'
      )
      .get(b.item_type_id, gender, size, manufacturer);
    if (exists) return fail(ctx.res, 409, 'מוצר זהה כבר קיים (אותו סוג/מין/מידה/יצרן)');
    const info = db
      .prepare(
        `INSERT INTO products (item_type_id, gender, size, manufacturer, sku, quantity, target_quantity, min_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        b.item_type_id,
        gender,
        size,
        manufacturer,
        b.sku || null,
        Number(b.quantity) || 0,
        Number(b.target_quantity) || 0,
        Number(b.min_quantity) || 0
      );
    json(ctx.res, 201, { id: info.lastInsertRowid });
  },
  async updateProduct(ctx) {
    const b = ctx.body;
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!p) return fail(ctx.res, 404, 'מוצר לא קיים');
    const fields = ['quantity', 'target_quantity', 'min_quantity', 'sku', 'manufacturer', 'size', 'gender'];
    const sets = [];
    const args = [];
    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f} = ?`);
        args.push(['quantity', 'target_quantity', 'min_quantity'].includes(f) ? Number(b[f]) || 0 : b[f]);
      }
    }
    if (!sets.length) return json(ctx.res, 200, { ok: true });
    args.push(ctx.params.id);
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    json(ctx.res, 200, { ok: true });
  },
  async adjustProduct(ctx) {
    const delta = Number(ctx.body.delta);
    if (!Number.isFinite(delta)) return fail(ctx.res, 400, 'ערך שינוי לא תקין');
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!p) return fail(ctx.res, 404, 'מוצר לא קיים');
    const next = Math.max(0, p.quantity + delta);
    db.prepare('UPDATE products SET quantity = ? WHERE id = ?').run(next, ctx.params.id);
    json(ctx.res, 200, { quantity: next });
  },
  async deleteProduct(ctx) {
    db.prepare('DELETE FROM products WHERE id = ?').run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },

  /* ---------------------- בקשות/הזמנות משתמשים ---------------------- */
  async createRequisition(ctx) {
    const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
    if (!items.length) return fail(ctx.res, 400, 'יש לבחור לפחות פריט אחד');
    const reqId = transaction(() => {
      const info = db
        .prepare("INSERT INTO requisitions (user_id, status, note, site_id, employee_id) VALUES (?, 'pending', ?, ?, ?)")
        .run(ctx.user.id, ctx.body.note || null, ctx.body.site_id || null, ctx.body.employee_id || null);
      const id = info.lastInsertRowid;
      const stmt = db.prepare('INSERT INTO requisition_items (requisition_id, product_id, quantity) VALUES (?, ?, ?)');
      for (const it of items) {
        const q = Number(it.quantity) || 0;
        if (q > 0 && it.product_id) stmt.run(id, it.product_id, q);
      }
      return id;
    });
    json(ctx.res, 201, { id: reqId });
  },
  async listRequisitions(ctx) {
    const base = `SELECT r.*, u.username, s.name AS site_name, e.name AS employee_name
      FROM requisitions r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN sites s ON s.id = r.site_id
      LEFT JOIN employees e ON e.id = r.employee_id`;
    let rows;
    if (ctx.user.role === 'admin') {
      rows = db.prepare(base + ' ORDER BY r.created_at DESC').all();
    } else {
      rows = db.prepare(base + ' WHERE r.user_id = ? ORDER BY r.created_at DESC').all(ctx.user.id);
    }
    for (const r of rows) r.items = requisitionItems(r.id);
    json(ctx.res, 200, rows);
  },
  async approveRequisition(ctx) {
    const r = db.prepare('SELECT * FROM requisitions WHERE id = ?').get(ctx.params.id);
    if (!r) return fail(ctx.res, 404, 'בקשה לא קיימת');
    if (r.status !== 'pending') return fail(ctx.res, 400, 'הבקשה אינה ממתינה לאישור');
    db.prepare("UPDATE requisitions SET status = 'approved', approved_at = datetime('now'), approved_by = ? WHERE id = ?")
      .run(ctx.user.id, ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  async rejectRequisition(ctx) {
    const r = db.prepare('SELECT * FROM requisitions WHERE id = ?').get(ctx.params.id);
    if (!r) return fail(ctx.res, 404, 'בקשה לא קיימת');
    if (r.status !== 'pending') return fail(ctx.res, 400, 'הבקשה אינה ממתינה לאישור');
    db.prepare("UPDATE requisitions SET status = 'rejected', rejected_reason = ? WHERE id = ?")
      .run(ctx.body.reason || null, ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  // המשתמש מאשר לקיחת הביגוד בפועל -> הורדה מהמלאי + רישום חוסר להשלמה
  async collectRequisition(ctx) {
    const r = db.prepare('SELECT * FROM requisitions WHERE id = ?').get(ctx.params.id);
    if (!r) return fail(ctx.res, 404, 'בקשה לא קיימת');
    if (r.user_id !== ctx.user.id && ctx.user.role !== 'admin')
      return fail(ctx.res, 403, 'רק מבצע הבקשה יכול לאשר לקיחה');
    if (r.status !== 'approved') return fail(ctx.res, 400, 'יש לאשר את הבקשה לפני לקיחה');
    const items = requisitionItems(r.id);
    transaction(() => {
      for (const it of items) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
        if (!p) continue;
        const next = Math.max(0, p.quantity - it.quantity);
        db.prepare('UPDATE products SET quantity = ? WHERE id = ?').run(next, p.id);
        // רישום חוסר להשלמה בגובה הכמות שנלקחה
        db.prepare('INSERT INTO shortages (product_id, quantity, source) VALUES (?, ?, ?)')
          .run(p.id, it.quantity, `requisition:${r.id}`);
      }
      db.prepare("UPDATE requisitions SET status = 'collected', collected_at = datetime('now') WHERE id = ?")
        .run(r.id);
    });
    json(ctx.res, 200, { ok: true });
  },

  /* ---------------------- חוסרים ---------------------- */
  async listShortages(ctx) {
    const rows = db
      .prepare(
        `SELECT s.*, p.size, p.gender, p.manufacturer, t.name AS item_type_name, c.name AS company_name
         FROM shortages s
         JOIN products p ON p.id = s.product_id
         JOIN item_types t ON t.id = p.item_type_id
         JOIN companies c ON c.id = t.company_id
         WHERE s.resolved = 0
         ORDER BY s.created_at DESC`
      )
      .all();
    json(ctx.res, 200, rows);
  },

  /* ---------------------- אתרים ---------------------- */
  async listSites(ctx) {
    const rows = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM employees e WHERE e.site_id = s.id) AS employee_count
         FROM sites s ORDER BY s.name`
      )
      .all();
    json(ctx.res, 200, rows);
  },
  async createSite(ctx) {
    const { name, code } = ctx.body;
    if (!name) return fail(ctx.res, 400, 'נא להזין שם אתר');
    const exists = db.prepare('SELECT id FROM sites WHERE name = ?').get(name);
    if (exists) return fail(ctx.res, 409, 'אתר בשם זה כבר קיים');
    const info = db.prepare('INSERT INTO sites (name, code) VALUES (?, ?)').run(name, code || null);
    json(ctx.res, 201, { id: info.lastInsertRowid });
  },
  async deleteSite(ctx) {
    db.prepare('DELETE FROM sites WHERE id = ?').run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  // טעינה מרובה של אתרים (מאקסל/CSV או ידנית)
  async bulkSites(ctx) {
    const rows = Array.isArray(ctx.body.sites) ? ctx.body.sites : [];
    let added = 0, skipped = 0;
    transaction(() => {
      const stmt = db.prepare('INSERT OR IGNORE INTO sites (name, code) VALUES (?, ?)');
      for (const r of rows) {
        const name = String(r.name || '').trim();
        if (!name) { skipped++; continue; }
        const info = stmt.run(name, r.code ? String(r.code).trim() : null);
        if (info.changes) added++; else skipped++;
      }
    });
    json(ctx.res, 200, { added, skipped });
  },

  /* ---------------------- עובדים ---------------------- */
  async listEmployees(ctx) {
    const siteId = ctx.query.get('site_id');
    let sql = `SELECT e.*, s.name AS site_name FROM employees e LEFT JOIN sites s ON s.id = e.site_id`;
    const args = [];
    if (siteId) { sql += ' WHERE e.site_id = ?'; args.push(siteId); }
    sql += ' ORDER BY e.name';
    json(ctx.res, 200, db.prepare(sql).all(...args));
  },
  async createEmployee(ctx) {
    const { name, employee_no, site_id } = ctx.body;
    if (!name) return fail(ctx.res, 400, 'נא להזין שם עובד');
    const info = db
      .prepare('INSERT INTO employees (name, employee_no, site_id) VALUES (?, ?, ?)')
      .run(name, employee_no || null, site_id || null);
    json(ctx.res, 201, { id: info.lastInsertRowid });
  },
  async deleteEmployee(ctx) {
    db.prepare('DELETE FROM employees WHERE id = ?').run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  // טעינה מרובה של עובדים; ניתן ליצור אתרים חדשים אוטומטית לפי שם האתר
  async bulkEmployees(ctx) {
    const rows = Array.isArray(ctx.body.employees) ? ctx.body.employees : [];
    const createSites = ctx.body.create_sites !== false;
    let added = 0, skipped = 0, sitesCreated = 0;
    transaction(() => {
      const findSite = db.prepare('SELECT id FROM sites WHERE name = ?');
      const addSite = db.prepare('INSERT OR IGNORE INTO sites (name) VALUES (?)');
      const addEmp = db.prepare('INSERT OR IGNORE INTO employees (name, employee_no, site_id) VALUES (?, ?, ?)');
      for (const r of rows) {
        const name = String(r.name || '').trim();
        if (!name) { skipped++; continue; }
        let siteId = null;
        const siteName = String(r.site_name || '').trim();
        if (siteName) {
          let s = findSite.get(siteName);
          if (!s && createSites) { addSite.run(siteName); sitesCreated++; s = findSite.get(siteName); }
          if (s) siteId = s.id;
        }
        const info = addEmp.run(name, r.employee_no ? String(r.employee_no).trim() : null, siteId);
        if (info.changes) added++; else skipped++;
      }
    });
    json(ctx.res, 200, { added, skipped, sitesCreated });
  },

  /* ---------------------- ניתוח קובץ אקסל/CSV ---------------------- */
  async importParse(ctx) {
    const { filename, data } = ctx.body;
    if (!data) return fail(ctx.res, 400, 'לא התקבל קובץ');
    try {
      const buf = Buffer.from(data, 'base64');
      const rows = parseSpreadsheet(buf, filename || '');
      json(ctx.res, 200, { rows: rows.slice(0, 5000), total: rows.length });
    } catch (e) {
      fail(ctx.res, 400, 'שגיאה בקריאת הקובץ: ' + e.message);
    }
  },

  /* ---------------------- הצעות להזמנה (מתחת למינימום) ---------------------- */
  async reorderSuggestions(ctx) {
    const rows = db
      .prepare(
        `SELECT p.*, t.name AS item_type_name, t.size_scheme, c.name AS company_name,
                (p.target_quantity - p.quantity) AS suggested
         FROM products p
         JOIN item_types t ON t.id = p.item_type_id
         JOIN companies c ON c.id = t.company_id
         WHERE p.min_quantity > 0 AND p.quantity <= p.min_quantity
         ORDER BY c.name, t.name, p.size`
      )
      .all();
    for (const r of rows) r.suggested = Math.max(r.suggested, r.min_quantity - r.quantity, 1);
    json(ctx.res, 200, rows);
  },

  /* ---------------------- הזמנות רכש למחסן הראשי ---------------------- */
  async createPurchaseOrder(ctx) {
    const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
    if (!items.length) return fail(ctx.res, 400, 'יש לבחור פריטים להזמנה');
    const reminder = Number(ctx.body.reminder_days) || 7;
    const poId = transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO purchase_orders (status, note, reminder_days, created_by) VALUES ('pending_approval', ?, ?, ?)"
        )
        .run(ctx.body.note || null, reminder, ctx.user.id);
      const id = info.lastInsertRowid;
      const stmt = db.prepare(
        'INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered) VALUES (?, ?, ?)'
      );
      for (const it of items) {
        const q = Number(it.quantity_ordered ?? it.quantity) || 0;
        if (q > 0 && it.product_id) stmt.run(id, it.product_id, q);
      }
      return id;
    });
    json(ctx.res, 201, { id: poId });
  },
  async listPurchaseOrders(ctx) {
    const rows = db.prepare('SELECT * FROM purchase_orders ORDER BY created_at DESC').all();
    for (const po of rows) {
      po.items = purchaseOrderItems(po.id);
      po.overdue = isOverdue(po);
      po.days_since_sent = po.sent_at ? daysSince(po.sent_at) : null;
    }
    json(ctx.res, 200, rows);
  },
  async approvePurchaseOrder(ctx) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(ctx.params.id);
    if (!po) return fail(ctx.res, 404, 'הזמנה לא קיימת');
    if (po.status !== 'pending_approval') return fail(ctx.res, 400, 'ההזמנה אינה ממתינה לאישור');
    db.prepare("UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?")
      .run(ctx.user.id, ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  // אישור ביצוע/שליחת הפלט למחסן הראשי -> רישום מועד יציאה והתחלת ספירה
  async sendPurchaseOrder(ctx) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(ctx.params.id);
    if (!po) return fail(ctx.res, 404, 'הזמנה לא קיימת');
    if (po.status !== 'approved') return fail(ctx.res, 400, 'יש לאשר את ההזמנה לפני שליחה');
    db.prepare("UPDATE purchase_orders SET status = 'sent', sent_at = datetime('now'), last_checked_at = datetime('now') WHERE id = ?")
      .run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  async checkPurchaseOrder(ctx) {
    // איפוס שעון ההתראה לאחר בדיקת סטטוס
    db.prepare("UPDATE purchase_orders SET last_checked_at = datetime('now') WHERE id = ?").run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },
  // קבלת הזמנה: מספר PO + כמויות שהתקבלו -> עדכון מלאי, פתרון חוסרים, זיהוי חסרים
  async receivePurchaseOrder(ctx) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(ctx.params.id);
    if (!po) return fail(ctx.res, 404, 'הזמנה לא קיימת');
    if (!['sent', 'approved', 'partially_received'].includes(po.status))
      return fail(ctx.res, 400, 'לא ניתן לקבל הזמנה במצב הנוכחי');
    const received = ctx.body.items || []; // [{product_id, quantity_received}]
    const map = new Map(received.map((r) => [Number(r.product_id), Number(r.quantity_received) || 0]));
    const items = purchaseOrderItems(po.id);
    transaction(() => {
      let allFull = true;
      for (const it of items) {
        const got = map.has(it.product_id) ? map.get(it.product_id) : it.quantity_ordered;
        const total = it.quantity_received + got;
        db.prepare('UPDATE purchase_order_items SET quantity_received = ? WHERE id = ?').run(total, it.id);
        if (got > 0) {
          db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(got, it.product_id);
          resolveShortages(it.product_id, got); // השלמת חוסרים
        }
        if (total < it.quantity_ordered) allFull = false;
      }
      db.prepare(
        `UPDATE purchase_orders SET status = ?, po_number = ?, received_at = datetime('now') WHERE id = ?`
      ).run(allFull ? 'received' : 'partially_received', ctx.body.po_number || po.po_number || null, po.id);
    });
    // החזרת סיכום חוסרים בהזמנה
    const after = purchaseOrderItems(po.id).map((it) => ({
      ...it,
      missing: Math.max(0, it.quantity_ordered - it.quantity_received),
    }));
    json(ctx.res, 200, { ok: true, items: after });
  },
  async cancelPurchaseOrder(ctx) {
    db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(ctx.params.id);
    json(ctx.res, 200, { ok: true });
  },

  /* ---------------------- התראות ולוח בקרה ---------------------- */
  async alerts(ctx) {
    const lowStock = db
      .prepare(
        `SELECT p.*, t.name AS item_type_name, c.name AS company_name
         FROM products p JOIN item_types t ON t.id = p.item_type_id JOIN companies c ON c.id = t.company_id
         WHERE p.min_quantity > 0 AND p.quantity <= p.min_quantity`
      )
      .all();
    const sentOrders = db.prepare("SELECT * FROM purchase_orders WHERE status = 'sent'").all();
    const overdueOrders = sentOrders.filter(isOverdue).map((po) => ({ ...po, days_since_sent: daysSince(po.sent_at) }));
    const pendingReq = db.prepare("SELECT COUNT(*) AS c FROM requisitions WHERE status = 'pending'").get().c;
    const pendingPO = db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE status = 'pending_approval'").get().c;
    const myTasks =
      ctx.user.role === 'admin'
        ? db.prepare("SELECT COUNT(*) AS c FROM requisitions WHERE status = 'approved'").get().c
        : db.prepare("SELECT COUNT(*) AS c FROM requisitions WHERE status = 'approved' AND user_id = ?").get(ctx.user.id).c;
    json(ctx.res, 200, {
      lowStock,
      overdueOrders,
      pendingRequisitions: pendingReq,
      pendingPurchaseOrders: pendingPO,
      myTasks,
    });
  },
  async dashboard(ctx) {
    const counts = {
      companies: db.prepare('SELECT COUNT(*) AS c FROM companies').get().c,
      products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      totalUnits: db.prepare('SELECT IFNULL(SUM(quantity),0) AS c FROM products').get().c,
      users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      pendingUsers: db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'pending'").get().c,
      openShortages: db.prepare('SELECT COUNT(*) AS c FROM shortages WHERE resolved = 0').get().c,
      lowStock: db.prepare('SELECT COUNT(*) AS c FROM products WHERE min_quantity > 0 AND quantity <= min_quantity').get().c,
      openPurchaseOrders: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE status NOT IN ('received','cancelled')").get().c,
    };
    json(ctx.res, 200, counts);
  },
};

/* ------------------------------------------------------------------ */
/* פונקציות עזר לוגיקה                                                 */
/* ------------------------------------------------------------------ */
function res_clear(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
// עטיפת טרנזקציה (node:sqlite אינו תומך ב-db.transaction)
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
function requisitionItems(reqId) {
  return db
    .prepare(
      `SELECT ri.*, p.size, p.gender, p.manufacturer, p.quantity AS stock,
              t.name AS item_type_name, c.name AS company_name
       FROM requisition_items ri
       JOIN products p ON p.id = ri.product_id
       JOIN item_types t ON t.id = p.item_type_id
       JOIN companies c ON c.id = t.company_id
       WHERE ri.requisition_id = ?`
    )
    .all(reqId);
}
function purchaseOrderItems(poId) {
  return db
    .prepare(
      `SELECT poi.*, p.size, p.gender, p.manufacturer, t.name AS item_type_name, c.name AS company_name
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       JOIN item_types t ON t.id = p.item_type_id
       JOIN companies c ON c.id = t.company_id
       WHERE poi.purchase_order_id = ?`
    )
    .all(poId);
}
function resolveShortages(productId, qty) {
  let remaining = qty;
  const open = db
    .prepare('SELECT * FROM shortages WHERE product_id = ? AND resolved = 0 ORDER BY created_at')
    .all(productId);
  for (const s of open) {
    if (remaining <= 0) break;
    if (s.quantity <= remaining) {
      db.prepare('UPDATE shortages SET resolved = 1 WHERE id = ?').run(s.id);
      remaining -= s.quantity;
    } else {
      db.prepare('UPDATE shortages SET quantity = quantity - ? WHERE id = ?').run(remaining, s.id);
      remaining = 0;
    }
  }
}
function daysSince(dateStr) {
  const then = new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  return Math.floor((Date.now() - then) / 86400000);
}
function isOverdue(po) {
  if (po.status !== 'sent' || !po.sent_at) return false;
  return daysSince(po.last_checked_at || po.sent_at) >= (po.reminder_days || 7);
}

/* ------------------------------------------------------------------ */
/* טבלת הניתובים                                                       */
/* ------------------------------------------------------------------ */
const AUTH = { auth: true };
const ADMIN = { auth: true, admin: true };

route('POST', '/api/auth/register', api.register);
route('POST', '/api/auth/login', api.login);
route('POST', '/api/auth/logout', api.logout);
route('GET', '/api/auth/me', api.me, AUTH);

route('GET', '/api/users', api.listUsers, ADMIN);
route('POST', '/api/users', api.createUser, ADMIN);
route('POST', '/api/users/:id/password', api.setUserPassword, ADMIN);
route('POST', '/api/users/:id/status', api.setUserStatus, ADMIN);
route('POST', '/api/users/:id/role', api.setUserRole, ADMIN);
route('DELETE', '/api/users/:id', api.deleteUser, ADMIN);

route('GET', '/api/size-schemes', api.sizeSchemes, AUTH);

route('GET', '/api/companies', api.listCompanies, AUTH);
route('POST', '/api/companies', api.createCompany, ADMIN);
route('DELETE', '/api/companies/:id', api.deleteCompany, ADMIN);

route('GET', '/api/item-types', api.listItemTypes, AUTH);
route('POST', '/api/item-types', api.createItemType, ADMIN);
route('DELETE', '/api/item-types/:id', api.deleteItemType, ADMIN);

route('GET', '/api/products', api.listProducts, AUTH);
route('POST', '/api/products', api.createProduct, ADMIN);
route('PATCH', '/api/products/:id', api.updateProduct, ADMIN);
route('POST', '/api/products/:id/adjust', api.adjustProduct, ADMIN);
route('DELETE', '/api/products/:id', api.deleteProduct, ADMIN);

route('POST', '/api/requisitions', api.createRequisition, AUTH);
route('GET', '/api/requisitions', api.listRequisitions, AUTH);
route('POST', '/api/requisitions/:id/approve', api.approveRequisition, ADMIN);
route('POST', '/api/requisitions/:id/reject', api.rejectRequisition, ADMIN);
route('POST', '/api/requisitions/:id/collect', api.collectRequisition, AUTH);

route('GET', '/api/sites', api.listSites, AUTH);
route('POST', '/api/sites', api.createSite, ADMIN);
route('DELETE', '/api/sites/:id', api.deleteSite, ADMIN);
route('POST', '/api/sites/bulk', api.bulkSites, ADMIN);

route('GET', '/api/employees', api.listEmployees, AUTH);
route('POST', '/api/employees', api.createEmployee, ADMIN);
route('DELETE', '/api/employees/:id', api.deleteEmployee, ADMIN);
route('POST', '/api/employees/bulk', api.bulkEmployees, ADMIN);

route('POST', '/api/import/parse', api.importParse, ADMIN);

route('GET', '/api/shortages', api.listShortages, AUTH);
route('GET', '/api/reorder-suggestions', api.reorderSuggestions, ADMIN);

route('POST', '/api/purchase-orders', api.createPurchaseOrder, ADMIN);
route('GET', '/api/purchase-orders', api.listPurchaseOrders, ADMIN);
route('POST', '/api/purchase-orders/:id/approve', api.approvePurchaseOrder, ADMIN);
route('POST', '/api/purchase-orders/:id/send', api.sendPurchaseOrder, ADMIN);
route('POST', '/api/purchase-orders/:id/check', api.checkPurchaseOrder, ADMIN);
route('POST', '/api/purchase-orders/:id/receive', api.receivePurchaseOrder, ADMIN);
route('POST', '/api/purchase-orders/:id/cancel', api.cancelPurchaseOrder, ADMIN);

route('GET', '/api/alerts', api.alerts, AUTH);
route('GET', '/api/dashboard', api.dashboard, AUTH);

/* ------------------------------------------------------------------ */
/* קבצים סטטיים                                                        */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return fail(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return fail(res, 404, 'not found');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ */
/* השרת                                                                */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res);

  const matched = routes.find((r) => r.method === req.method && r.re.test(pathname));
  if (!matched) return fail(res, 404, 'נתיב לא קיים');

  const user = currentUser(req);
  if (matched.auth && !user) return fail(res, 401, 'נדרשת התחברות');
  if (matched.admin && (!user || user.role !== 'admin')) return fail(res, 403, 'נדרשות הרשאות מנהל');

  const m = matched.re.exec(pathname);
  const params = {};
  matched.keys.forEach((k, i) => (params[k] = m[i + 1]));

  let body = {};
  if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
    try {
      body = await readBody(req);
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  try {
    await matched.handler({ req, res, params, body, user, query: url.searchParams });
  } catch (e) {
    console.error('שגיאת שרת:', e);
    if (!res.headersSent) fail(res, 500, 'שגיאת שרת פנימית');
  }
});

server.listen(PORT, () => {
  console.log(`\n  מערכת ניהול מלאי ביגוד פועלת:  http://localhost:${PORT}\n`);
});
