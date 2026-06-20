/* ================================================================
   מערכת ניהול מלאי ביגוד – צד לקוח (SPA, ללא תלויות)
   ================================================================ */

/* ---------- עזרי API ---------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'שגיאה');
  return data;
}

/* ---------- עזרים כלליים ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (str) => String(str ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = 'info') {
  const root = $('#toast-root');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function modal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  root.querySelector('.modal-bg').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-bg')) closeModal();
  });
}
function closeModal() { $('#modal-root').innerHTML = ''; }
window.closeModal = closeModal;

const GENDER_HE = { men: 'גברים', women: 'נשים', '': '—', null: '—' };
function productLabel(p) {
  const parts = [p.item_type_name];
  if (p.gender) parts.push(GENDER_HE[p.gender]);
  if (p.size) parts.push('מידה ' + p.size);
  if (p.manufacturer) parts.push(p.manufacturer);
  return parts.join(' · ');
}
function statusTag(status) {
  const map = {
    pending: ['ממתין לאישור', 'amber'],
    approved: ['אושר – ממתין ללקיחה', 'blue'],
    collected: ['נלקח', 'green'],
    rejected: ['נדחה', 'red'],
    cancelled: ['בוטל', 'gray'],
    pending_approval: ['ממתין לאישור', 'amber'],
    sent: ['נשלח למחסן', 'blue'],
    partially_received: ['התקבל חלקית', 'amber'],
    received: ['התקבל במלואו', 'green'],
  };
  const [txt, cls] = map[status] || [status, 'gray'];
  return `<span class="tag ${cls}">${h(txt)}</span>`;
}

/* ---------- מצב גלובלי ---------- */
const state = {
  user: null,
  view: 'dashboard',
  schemes: null,
  alerts: {},
  cart: [], // [{product_id, label, quantity, stock}]
};

/* ================================================================
   מסך התחברות / הרשמה
   ================================================================ */
function renderAuth(tab = 'login') {
  $('#app').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1>🧥 ניהול מלאי ביגוד</h1>
        <div class="sub">מערכת ניהול מלאי, הזמנות וחוסרים</div>
        <div class="tabs">
          <button data-tab="login" class="${tab === 'login' ? 'active' : ''}">התחברות</button>
          <button data-tab="register" class="${tab === 'register' ? 'active' : ''}">הרשמה</button>
        </div>
        <div id="auth-form"></div>
      </div>
    </div>`;
  document.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => renderAuth(b.dataset.tab)));
  $('#auth-form').innerHTML = tab === 'login' ? loginForm() : registerForm();
  if (tab === 'login') {
    $('#login-btn').addEventListener('click', doLogin);
    $('#auth-form').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  } else {
    $('#register-btn').addEventListener('click', doRegister);
  }
}
function loginForm() {
  return `
    <label>שם משתמש או אימייל</label>
    <input id="lg-user" autocomplete="username" />
    <label>סיסמה</label>
    <input id="lg-pass" type="password" autocomplete="current-password" />
    <div style="height:18px"></div>
    <button id="login-btn" class="btn primary" style="width:100%">התחברות</button>
    <div class="hint">משתמש ברירת מחדל למנהל: <b>admin</b> / <b>admin123</b></div>`;
}
function registerForm() {
  return `
    <label>אימייל</label>
    <input id="rg-email" type="email" />
    <label>שם משתמש</label>
    <input id="rg-user" />
    <label>סיסמה</label>
    <input id="rg-pass" type="password" />
    <div style="height:18px"></div>
    <button id="register-btn" class="btn primary" style="width:100%">הרשמה</button>
    <div class="hint">לאחר ההרשמה החשבון ימתין לאישור מנהל המערכת.</div>`;
}
async function doLogin() {
  try {
    const username = $('#lg-user').value.trim();
    const password = $('#lg-pass').value;
    state.user = await api('/auth/login', { method: 'POST', body: { username, password } });
    await boot();
  } catch (e) { toast(e.message, 'error'); }
}
async function doRegister() {
  try {
    const body = {
      email: $('#rg-email').value.trim(),
      username: $('#rg-user').value.trim(),
      password: $('#rg-pass').value,
    };
    const r = await api('/auth/register', { method: 'POST', body });
    toast(r.message || 'נרשמת בהצלחה', 'success');
    renderAuth('login');
  } catch (e) { toast(e.message, 'error'); }
}

/* ================================================================
   מעטפת ראשית + ניווט
   ================================================================ */
const NAV = [
  { id: 'dashboard', label: 'לוח בקרה', icon: '📊', roles: ['admin', 'user'] },
  { id: 'browse', label: 'בקשת ביגוד', icon: '🛒', roles: ['admin', 'user'] },
  { id: 'requisitions', label: 'ההזמנות שלי', icon: '📋', roles: ['user'] },
  { id: 'requisitions', label: 'אישור הזמנות', icon: '📋', roles: ['admin'], adminLabel: true },
  { id: 'inventory', label: 'ניהול מלאי', icon: '📦', roles: ['admin'] },
  { id: 'directory', label: 'אתרים ועובדים', icon: '🏢', roles: ['admin'] },
  { id: 'shortages', label: 'חוסרים להשלמה', icon: '⚠️', roles: ['admin', 'user'] },
  { id: 'reorder', label: 'הזמנות רכש', icon: '🚚', roles: ['admin'] },
  { id: 'users', label: 'ניהול משתמשים', icon: '👥', roles: ['admin'] },
];

function renderShell() {
  const isAdmin = state.user.role === 'admin';
  const items = NAV.filter((n) => n.roles.includes(state.user.role));
  const navHtml = items.map((n) => {
    const badge = navBadge(n.id);
    return `<button class="nav-item ${state.view === n.id ? 'active' : ''}" data-view="${n.id}">
      <span>${n.icon}</span><span>${h(n.label)}</span>${badge}</button>`;
  }).join('');
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">🧥 מלאי ביגוד</div>
        ${navHtml}
        <div class="user-box">
          <div>${h(state.user.username)} ${isAdmin ? '<span class="tag blue">מנהל</span>' : ''}</div>
          <button class="nav-item" id="logout-btn" style="margin-top:8px">🚪 התנתקות</button>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#logout-btn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.user = null; state.cart = [];
    renderAuth('login');
  });
  renderView();
}

function navBadge(viewId) {
  const a = state.alerts;
  let n = 0;
  if (viewId === 'requisitions') n = state.user.role === 'admin' ? a.pendingRequisitions : a.myTasks;
  if (viewId === 'reorder') n = (a.pendingPurchaseOrders || 0) + (a.overdueOrders ? a.overdueOrders.length : 0);
  if (viewId === 'shortages') n = a.lowStock ? a.lowStock.length : 0;
  if (viewId === 'users') n = state.pendingUsers || 0;
  return n ? `<span class="badge">${n}</span>` : '';
}

function navigate(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  renderView();
}

async function refreshAlerts() {
  try { state.alerts = await api('/alerts'); } catch { /* ignore */ }
  if (state.user.role === 'admin') {
    try { state.pendingUsers = (await api('/users')).filter((u) => u.status === 'pending').length; } catch {}
  }
  // עדכון תגי הניווט
  document.querySelectorAll('[data-view]').forEach((b) => {
    const old = b.querySelector('.badge');
    if (old) old.remove();
    const badge = navBadge(b.dataset.view);
    if (badge) b.insertAdjacentHTML('beforeend', badge);
  });
}

function renderView() {
  const views = {
    dashboard: viewDashboard, browse: viewBrowse, requisitions: viewRequisitions,
    inventory: viewInventory, directory: viewDirectory, shortages: viewShortages,
    reorder: viewReorder, users: viewUsers,
  };
  (views[state.view] || viewDashboard)();
}

/* ================================================================
   לוח בקרה
   ================================================================ */
async function viewDashboard() {
  const main = $('#main');
  main.innerHTML = `<h1 class="page-title">לוח בקרה</h1><p class="page-sub">סקירה כללית והתראות</p><div id="dash"></div>`;
  const [d, alerts] = await Promise.all([api('/dashboard'), api('/alerts')]);
  state.alerts = alerts;
  const stat = (num, lbl, cls = '') => `<div class="card stat ${cls}"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
  let html = `<div class="cards">
    ${stat(d.companies, 'חברות ניהול')}
    ${stat(d.products, 'סוגי מוצרים')}
    ${stat(d.totalUnits, 'יחידות במלאי', 'ok')}
    ${stat(d.lowStock, 'מתחת למינימום', d.lowStock ? 'danger' : 'ok')}
    ${stat(d.openShortages, 'חוסרים פתוחים', d.openShortages ? 'warn' : 'ok')}
    ${stat(d.openPurchaseOrders, 'הזמנות רכש פתוחות', 'warn')}
    ${state.user.role === 'admin' ? stat(d.pendingUsers, 'משתמשים ממתינים', d.pendingUsers ? 'warn' : '') : ''}
  </div>`;

  // התראות
  html += `<div class="section" style="margin-top:28px"><h3>התראות</h3>`;
  const blocks = [];
  if (alerts.pendingRequisitions && state.user.role === 'admin')
    blocks.push(alertRow('🔔', `${alerts.pendingRequisitions} בקשות ביגוד ממתינות לאישורך`, 'requisitions'));
  if (alerts.myTasks)
    blocks.push(alertRow('✅', `${alerts.myTasks} בקשות אושרו וממתינות לאישור לקיחה`, 'requisitions'));
  if (alerts.lowStock && alerts.lowStock.length)
    blocks.push(alertRow('⚠️', `${alerts.lowStock.length} מוצרים הגיעו למינימום – מומלץ לבצע הזמנה`, 'reorder'));
  if (alerts.pendingPurchaseOrders && state.user.role === 'admin')
    blocks.push(alertRow('📝', `${alerts.pendingPurchaseOrders} הזמנות רכש ממתינות לאישור ביצוע`, 'reorder'));
  if (alerts.overdueOrders && alerts.overdueOrders.length)
    blocks.push(alertRow('⏰', `${alerts.overdueOrders.length} הזמנות רכש שיצאו ועבר זמן ההתראה – יש לבדוק סטטוס`, 'reorder'));
  html += blocks.length ? blocks.join('') : `<div class="empty">אין התראות פעילות 🎉</div>`;
  html += `</div>`;
  $('#dash').innerHTML = html;
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.goto)));
}
function alertRow(icon, text, goto) {
  return `<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
    <span style="font-size:22px">${icon}</span><span style="flex:1">${h(text)}</span>
    <button class="btn sm primary" data-goto="${goto}">מעבר</button></div>`;
}

/* ================================================================
   בקשת ביגוד (קטלוג למשתמש) – ניווט חברה → סוג → מוצרים → עגלה
   ================================================================ */
const browseState = { company: null, itemType: null, cache: { companies: null, types: {}, products: {} } };

// טעינה עם מטמון – פנייה אחת לשרת לכל רמה, ואז ניווט מיידי קדימה ואחורה
async function getCompanies() {
  if (!browseState.cache.companies) browseState.cache.companies = await api('/companies');
  return browseState.cache.companies;
}
async function getTypes(companyId) {
  if (!browseState.cache.types[companyId]) browseState.cache.types[companyId] = await api('/item-types?company_id=' + companyId);
  return browseState.cache.types[companyId];
}
async function getProducts(typeId) {
  if (!browseState.cache.products[typeId]) browseState.cache.products[typeId] = await api('/products?item_type_id=' + typeId);
  return browseState.cache.products[typeId];
}
async function viewBrowse() {
  const main = $('#main');
  // מתחילים מהרמה הראשונה ומאפסים מטמון כדי לקבל נתונים עדכניים בכל כניסה למסך
  browseState.cache = { companies: null, types: {}, products: {} };
  main.innerHTML = `<h1 class="page-title">בקשת ביגוד</h1>
    <p class="page-sub">בחרו חברת ניהול, סוג פריט ומידות, וצרו בקשה</p>
    <div id="browse-body"></div>`;
  drawBrowse();
}
async function drawBrowse() {
  const body = $('#browse-body');
  // פירורי לחם
  let crumbs = `<div class="breadcrumb"><button data-bc="root">חברות ניהול</button>`;
  if (browseState.company) crumbs += ` ‹ <button data-bc="company">${h(browseState.company.name)}</button>`;
  if (browseState.itemType) crumbs += ` ‹ <span>${h(browseState.itemType.name)}</span>`;
  crumbs += `</div>`;

  // מציגים מיד שלד עם חיווי טעינה כדי שהמסך לא ייראה תקוע
  body.innerHTML = crumbs + `<div class="loading"><span class="spinner"></span> טוען…</div>`;

  let content = '';
  try {
  if (!browseState.company) {
    const companies = await getCompanies();
    content = companies.length
      ? `<div class="cards">${companies.map((c) =>
          `<button class="card" data-company='${h(JSON.stringify(c))}' style="cursor:pointer;text-align:right">
            <div style="font-size:18px;font-weight:700">🏢 ${h(c.name)}</div>
            <div class="muted" style="margin-top:6px">${c.item_type_count} סוגי פריטים</div></button>`).join('')}</div>`
      : `<div class="empty">אין חברות ניהול עדיין. מנהל המערכת יכול להוסיף ב"ניהול מלאי".</div>`;
    // טעינה מקדימה ברקע של תת-הקטגוריות לכל חברה – כך הלחיצה הבאה מיידית
    companies.forEach((c) => getTypes(c.id).catch(() => {}));
  } else if (!browseState.itemType) {
    const types = await getTypes(browseState.company.id);
    content = types.length ? `<div class="cards">${types.map((t) =>
      `<button class="card" data-type='${h(JSON.stringify(t))}' style="cursor:pointer;text-align:right">
        <div style="font-size:17px;font-weight:700">${h(t.name)}</div></button>`).join('')}</div>`
      : `<div class="empty">אין סוגי פריטים תחת חברה זו עדיין.</div>`;
    // טעינה מקדימה ברקע של המוצרים לכל סוג פריט
    types.forEach((t) => getProducts(t.id).catch(() => {}));
  } else {
    const products = await getProducts(browseState.itemType.id);
    content = products.length ? `<div class="table-wrap"><table>
      <thead><tr><th>פריט</th><th>זמין במלאי</th><th>כמות לבקשה</th><th></th></tr></thead><tbody>
      ${products.map((p) => {
        const avail = p.quantity > 0;
        return `<tr>
          <td>${h(productLabel(p))}</td>
          <td>${avail ? `<span class="qty-ok">${p.quantity} במלאי</span>` : `<span class="qty-low">אזל</span>`}</td>
          <td><input type="number" min="1" value="1" class="inline-num" id="bq-${p.id}" ${avail ? '' : ''}></td>
          <td><button class="btn sm primary" data-add='${h(JSON.stringify({ id: p.id, label: productLabel(p), stock: p.quantity }))}'>הוסף לבקשה</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="empty">אין מוצרים תחת סוג זה עדיין.</div>`;
  }
  } catch (e) {
    content = `<div class="empty">שגיאה בטעינה: ${h(e.message)}</div>`;
  }

  body.innerHTML = crumbs + content + cartBar();
  // אירועים
  body.querySelectorAll('[data-bc]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.bc === 'root') { browseState.company = null; browseState.itemType = null; }
    if (b.dataset.bc === 'company') browseState.itemType = null;
    drawBrowse();
  }));
  body.querySelectorAll('[data-company]').forEach((b) => b.addEventListener('click', () => {
    browseState.company = JSON.parse(b.dataset.company); drawBrowse();
  }));
  body.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    browseState.itemType = JSON.parse(b.dataset.type); drawBrowse();
  }));
  body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const info = JSON.parse(b.dataset.add);
    const qty = Number($('#bq-' + info.id).value) || 1;
    addToCart(info.id, info.label, qty, info.stock);
  }));
  bindCartBar();
}
function addToCart(productId, label, qty, stock) {
  const existing = state.cart.find((c) => c.product_id === productId);
  if (existing) existing.quantity += qty;
  else state.cart.push({ product_id: productId, label, quantity: qty, stock });
  toast('נוסף לבקשה: ' + label, 'success');
  drawBrowse();
}
function cartBar() {
  if (!state.cart.length) return '';
  const count = state.cart.reduce((s, c) => s + c.quantity, 0);
  return `<div class="cart-bar">
    <b>🛒 בבקשה: ${count} פריטים (${state.cart.length} שורות)</b>
    <div class="spacer" style="flex:1"></div>
    <button class="btn sm" id="cart-view">צפייה</button>
    <button class="btn sm primary" id="cart-submit">שליחת בקשה לאישור</button>
  </div>`;
}
function bindCartBar() {
  const v = $('#cart-view'); const s = $('#cart-submit');
  if (v) v.addEventListener('click', showCartModal);
  if (s) s.addEventListener('click', showCartModal);
}
async function showCartModal() {
  const [sites, emps] = await Promise.all([api('/sites'), api('/employees')]);
  modal(`<h2>פריטים בבקשה</h2>
    <div class="table-wrap"><table><thead><tr><th>פריט</th><th>כמות</th><th></th></tr></thead><tbody>
    ${state.cart.map((c, i) => `<tr><td>${h(c.label)}</td><td>${c.quantity}</td>
      <td><button class="btn sm red" data-rm="${i}">הסר</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="field-row">
      <div><label>עבור אתר (אופציונלי)</label><select id="cart-site"><option value="">— ללא —</option>
        ${sites.map((s) => `<option value="${s.id}">${h(s.name)}</option>`).join('')}</select></div>
      <div><label>עבור עובד (אופציונלי)</label><select id="cart-emp"><option value="">— ללא —</option>
        ${emps.map((e) => `<option value="${e.id}">${h(e.name)}${e.site_name ? ' · ' + h(e.site_name) : ''}</option>`).join('')}</select></div>
    </div>
    <label>הערה (אופציונלי)</label><textarea id="cart-note" rows="2"></textarea>
    <div class="modal-actions">
      <button class="btn primary" id="cart-do-submit">שליחה לאישור</button>
      <button class="btn" onclick="closeModal()">סגירה</button>
    </div>`);
  document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    state.cart.splice(Number(b.dataset.rm), 1); closeModal(); if (state.cart.length) showCartModal(); drawBrowse();
  }));
  $('#cart-do-submit').addEventListener('click', () => submitCart({
    note: $('#cart-note').value, site_id: $('#cart-site').value || null, employee_id: $('#cart-emp').value || null,
  }));
}
async function submitCart(extra) {
  if (!state.cart.length) return toast('הבקשה ריקה', 'error');
  const meta = extra && typeof extra === 'object' ? extra : {};
  try {
    await api('/requisitions', { method: 'POST', body: {
      items: state.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
      note: meta.note || null, site_id: meta.site_id || null, employee_id: meta.employee_id || null,
    } });
    state.cart = [];
    closeModal();
    toast('הבקשה נשלחה לאישור המנהל', 'success');
    await refreshAlerts();
    navigate('requisitions');
  } catch (e) { toast(e.message, 'error'); }
}

/* ================================================================
   הזמנות / בקשות – אישור (מנהל), לקיחה (משתמש)
   ================================================================ */
async function viewRequisitions() {
  const main = $('#main');
  const isAdmin = state.user.role === 'admin';
  main.innerHTML = `<h1 class="page-title">${isAdmin ? 'אישור הזמנות' : 'ההזמנות שלי'}</h1>
    <p class="page-sub">${isAdmin ? 'אישור בקשות ומעקב אחר לקיחה בפועל' : 'מעקב סטטוס ואישור לקיחת הביגוד'}</p>
    <div id="req-body"></div>`;
  const reqs = await api('/requisitions');
  if (!reqs.length) { $('#req-body').innerHTML = `<div class="empty">אין הזמנות.</div>`; return; }
  $('#req-body').innerHTML = reqs.map((r) => reqCard(r, isAdmin)).join('');
  bindReqActions();
}
function reqCard(r, isAdmin) {
  const items = (r.items || []).map((i) =>
    `<tr><td>${h(productLabel(i))}</td><td>${i.quantity}</td><td class="${i.stock >= i.quantity ? 'qty-ok' : 'qty-low'}">${i.stock} במלאי</td></tr>`).join('');
  let actions = '';
  if (r.status === 'pending' && isAdmin)
    actions = `<button class="btn sm green" data-approve="${r.id}">אישור הזמנה</button>
               <button class="btn sm red" data-reject="${r.id}">דחייה</button>`;
  if (r.status === 'approved' && (r.user_id === state.user.id || isAdmin))
    actions = `<button class="btn sm primary" data-collect="${r.id}">אישור לקיחת הביגוד</button>`;
  return `<div class="card section" style="margin-bottom:16px">
    <div class="toolbar" style="margin-bottom:10px">
      <b>הזמנה #${r.id}</b> ${statusTag(r.status)}
      <span class="muted">מאת ${h(r.username)} · ${h(r.created_at)}</span>
      <div class="spacer"></div>${actions}
    </div>
    ${(r.site_name || r.employee_name) ? `<div class="muted" style="margin-bottom:6px">
      ${r.employee_name ? '👤 ' + h(r.employee_name) : ''}${r.site_name ? ' · 🏢 ' + h(r.site_name) : ''}</div>` : ''}
    ${r.note ? `<div class="muted" style="margin-bottom:8px">הערה: ${h(r.note)}</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>פריט</th><th>כמות</th><th>מלאי</th></tr></thead>
      <tbody>${items}</tbody></table></div>
    ${r.status === 'collected' ? `<div class="muted" style="margin-top:8px">✔ נלקח ב-${h(r.collected_at)} · המלאי עודכן ונרשמו חוסרים להשלמה</div>` : ''}
  </div>`;
}
function bindReqActions() {
  document.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/requisitions/${b.dataset.approve}/approve`, { method: 'POST' });
      toast('ההזמנה אושרה', 'success'); await refreshAlerts(); viewRequisitions(); }
    catch (e) { toast(e.message, 'error'); }
  }));
  document.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('סיבת דחייה (אופציונלי):') || '';
    try { await api(`/requisitions/${b.dataset.reject}/reject`, { method: 'POST', body: { reason } });
      toast('ההזמנה נדחתה'); await refreshAlerts(); viewRequisitions(); }
    catch (e) { toast(e.message, 'error'); }
  }));
  document.querySelectorAll('[data-collect]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('לאשר לקיחת הביגוד בפועל? פעולה זו תוריד את הכמויות מהמלאי.')) return;
    try { await api(`/requisitions/${b.dataset.collect}/collect`, { method: 'POST' });
      toast('הלקיחה אושרה והמלאי עודכן', 'success'); await refreshAlerts(); viewRequisitions(); }
    catch (e) { toast(e.message, 'error'); }
  }));
}

/* ================================================================
   ניהול מלאי (מנהל) – חברות, סוגי פריטים, מוצרים
   ================================================================ */
const invState = { company: null };
async function viewInventory() {
  const main = $('#main');
  main.innerHTML = `<h1 class="page-title">ניהול מלאי</h1>
    <p class="page-sub">ניהול חברות ניהול, סוגי פריטים ומוצרים (כולל כמויות, יעד ומינימום)</p>
    <div class="toolbar">
      <select id="inv-company" style="max-width:280px"></select>
      <button class="btn primary" id="inv-add-company">➕ חברת ניהול</button>
      <div class="spacer"></div>
      <button class="btn" id="inv-add-type" disabled>➕ סוג פריט</button>
      <button class="btn primary" id="inv-add-product" disabled>➕ מוצר</button>
    </div>
    <div id="inv-body"></div>`;
  const companies = await api('/companies');
  const sel = $('#inv-company');
  sel.innerHTML = `<option value="">— בחרו חברת ניהול —</option>` +
    companies.map((c) => `<option value="${c.id}" ${invState.company == c.id ? 'selected' : ''}>${h(c.name)}</option>`).join('');
  sel.addEventListener('change', () => { invState.company = sel.value || null; drawInventory(); });
  $('#inv-add-company').addEventListener('click', addCompanyModal);
  $('#inv-add-type').addEventListener('click', addItemTypeModal);
  $('#inv-add-product').addEventListener('click', () => addProductModal());
  drawInventory();
}
async function drawInventory() {
  const body = $('#inv-body');
  $('#inv-add-type').disabled = !invState.company;
  $('#inv-add-product').disabled = !invState.company;
  if (!invState.company) {
    const companies = await api('/companies');
    body.innerHTML = companies.length
      ? `<div class="cards">${companies.map((c) => `<div class="card">
          <div style="font-weight:700;font-size:16px">🏢 ${h(c.name)}</div>
          <div class="muted" style="margin:6px 0">${c.item_type_count} סוגי פריטים</div>
          <button class="btn sm red" data-del-company="${c.id}">מחיקה</button></div>`).join('')}</div>`
      : `<div class="empty">התחילו בהוספת חברת ניהול. כל חברה מקבלת אוטומטית את 7 סוגי הפריטים הסטנדרטיים.</div>`;
    body.querySelectorAll('[data-del-company]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('למחוק את החברה וכל הפריטים שתחתיה?')) return;
      await api('/companies/' + b.dataset.delCompany, { method: 'DELETE' });
      toast('נמחק'); drawInventory(); viewInventory();
    }));
    return;
  }
  const [types, products] = await Promise.all([
    api('/item-types?company_id=' + invState.company),
    api('/products?company_id=' + invState.company),
  ]);
  const byType = {};
  products.forEach((p) => { (byType[p.item_type_id] = byType[p.item_type_id] || []).push(p); });
  body.innerHTML = types.map((t) => {
    const rows = (byType[t.id] || []).map((p) => {
      const low = p.min_quantity > 0 && p.quantity <= p.min_quantity;
      return `<tr>
        <td>${p.gender ? GENDER_HE[p.gender] : '—'}</td>
        <td>${h(p.size || '—')}</td>
        <td>${h(p.manufacturer || '—')}</td>
        <td class="${low ? 'qty-low' : 'qty-ok'}">${p.quantity}</td>
        <td>${p.target_quantity}</td>
        <td>${p.min_quantity}</td>
        <td class="btn-row">
          <button class="btn sm" data-adj="${p.id}" data-d="1">+1</button>
          <button class="btn sm" data-adj="${p.id}" data-d="-1">−1</button>
          <button class="btn sm" data-edit='${h(JSON.stringify(p))}'>עריכה</button>
          <button class="btn sm red" data-del-prod="${p.id}">🗑</button>
        </td></tr>`;
    }).join('');
    return `<div class="section">
      <div class="toolbar" style="margin-bottom:8px">
        <h3 style="margin:0">${h(t.name)}</h3>
        <span class="chip">${schemeLabel(t.size_scheme)}</span>
        <div class="spacer"></div>
        <button class="btn sm primary" data-add-prod='${h(JSON.stringify(t))}'>➕ מוצר</button>
        <button class="btn sm red" data-del-type="${t.id}">מחיקת סוג</button>
      </div>
      ${rows ? `<div class="table-wrap"><table>
        <thead><tr><th>מין</th><th>מידה</th><th>יצרן</th><th>במלאי</th><th>יעד</th><th>מינימום</th><th>פעולות</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<div class="empty">אין מוצרים. הוסיפו מוצר חדש.</div>`}
    </div>`;
  }).join('');

  body.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/products/${b.dataset.adj}/adjust`, { method: 'POST', body: { delta: Number(b.dataset.d) } });
    drawInventory();
  }));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editProductModal(JSON.parse(b.dataset.edit))));
  body.querySelectorAll('[data-del-prod]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('למחוק מוצר זה?')) return;
    await api('/products/' + b.dataset.delProd, { method: 'DELETE' }); toast('נמחק'); drawInventory();
  }));
  body.querySelectorAll('[data-del-type]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('למחוק את סוג הפריט וכל המוצרים שתחתיו?')) return;
    await api('/item-types/' + b.dataset.delType, { method: 'DELETE' }); toast('נמחק'); drawInventory();
  }));
  body.querySelectorAll('[data-add-prod]').forEach((b) => b.addEventListener('click', () => addProductModal(JSON.parse(b.dataset.addProd))));
}
function schemeLabel(scheme) {
  return (state.schemes && state.schemes.schemes[scheme] && state.schemes.schemes[scheme].label) || scheme;
}
function addCompanyModal() {
  modal(`<h2>חברת ניהול חדשה</h2>
    <label>שם החברה</label><input id="c-name" />
    <div class="muted" style="margin-top:8px">7 סוגי הפריטים הסטנדרטיים ייווצרו אוטומטית.</div>
    <div class="modal-actions"><button class="btn primary" id="c-save">שמירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#c-save').addEventListener('click', async () => {
    try { const r = await api('/companies', { method: 'POST', body: { name: $('#c-name').value.trim() } });
      invState.company = String(r.id); closeModal(); toast('נוסף', 'success'); viewInventory(); }
    catch (e) { toast(e.message, 'error'); }
  });
}
function addItemTypeModal() {
  const opts = Object.entries(state.schemes.schemes).map(([k, v]) => `<option value="${k}">${h(v.label)}</option>`).join('');
  modal(`<h2>סוג פריט חדש</h2>
    <label>שם הפריט (לדוגמה: כובעים, חגורות)</label><input id="t-name" />
    <label>מערכת מידות</label><select id="t-scheme">${opts}</select>
    <div class="muted" style="margin-top:8px">לבחירה: אותיות, מספרים, לפי מין, נעליים לפי יצרן, או ללא מידה.</div>
    <div class="modal-actions"><button class="btn primary" id="t-save">שמירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#t-save').addEventListener('click', async () => {
    try { await api('/item-types', { method: 'POST', body: {
      company_id: invState.company, name: $('#t-name').value.trim(), size_scheme: $('#t-scheme').value } });
      closeModal(); toast('נוסף', 'success'); drawInventory(); }
    catch (e) { toast(e.message, 'error'); }
  });
}
async function addProductModal(itemType) {
  const types = await api('/item-types?company_id=' + invState.company);
  const typeOpts = types.map((t) => `<option value="${t.id}" data-scheme="${t.size_scheme}" ${itemType && itemType.id === t.id ? 'selected' : ''}>${h(t.name)}</option>`).join('');
  modal(`<h2>הוספת מוצר</h2>
    <label>סוג פריט</label><select id="p-type">${typeOpts}</select>
    <div id="p-size-fields"></div>
    <div class="field-row">
      <div><label>כמות התחלתית</label><input id="p-qty" type="number" value="0" min="0"></div>
      <div><label>כמות יעד</label><input id="p-target" type="number" value="0" min="0"></div>
      <div><label>מינימום להתראה</label><input id="p-min" type="number" value="0" min="0"></div>
    </div>
    <div class="modal-actions"><button class="btn primary" id="p-save">שמירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  const typeSel = $('#p-type');
  const drawSizeFields = () => {
    const scheme = typeSel.selectedOptions[0].dataset.scheme;
    $('#p-size-fields').innerHTML = sizeFieldsHtml(scheme);
    bindGenderSize(scheme);
  };
  typeSel.addEventListener('change', drawSizeFields);
  drawSizeFields();
  $('#p-save').addEventListener('click', async () => {
    try {
      const body = {
        item_type_id: typeSel.value,
        gender: $('#p-gender') ? ($('#p-gender').value || null) : null,
        size: $('#p-size') ? $('#p-size').value : '',
        manufacturer: $('#p-manu') ? ($('#p-manu').value || null) : null,
        quantity: $('#p-qty').value, target_quantity: $('#p-target').value, min_quantity: $('#p-min').value,
      };
      await api('/products', { method: 'POST', body });
      closeModal(); toast('המוצר נוסף', 'success'); drawInventory();
    } catch (e) { toast(e.message, 'error'); }
  });
}
function sizeFieldsHtml(scheme) {
  const def = state.schemes.schemes[scheme];
  let html = '';
  if (def.gendered) {
    html += `<label>מין</label><select id="p-gender"><option value="men">גברים</option><option value="women">נשים</option></select>`;
  }
  if (def.manufacturer) {
    const manus = (def.manufacturers || []).map((m) => `<option>${h(m)}</option>`).join('');
    html += `<label>יצרן</label><input id="p-manu" list="manu-list" placeholder="לדוגמה: Blundstone">
      <datalist id="manu-list">${manus}</datalist>`;
  }
  if (scheme === 'none') {
    html += `<input id="p-size" type="hidden" value="">`;
  } else {
    html += `<label>מידה</label><select id="p-size"></select>`;
  }
  return html;
}
function bindGenderSize(scheme) {
  const def = state.schemes.schemes[scheme];
  const sizeSel = $('#p-size');
  if (!sizeSel || sizeSel.type === 'hidden') return;
  const fill = () => {
    const gender = $('#p-gender') ? $('#p-gender').value : null;
    const opts = def.gendered ? (def.options[gender] || []) : (def.options.all || []);
    sizeSel.innerHTML = opts.map((s) => {
      let label = s;
      if (def.numericMap && def.numericMap[s]) label = `${s}  (~${def.numericMap[s]})`;
      return `<option value="${h(s)}">${h(label)}</option>`;
    }).join('');
  };
  if ($('#p-gender')) $('#p-gender').addEventListener('change', fill);
  fill();
}
function editProductModal(p) {
  modal(`<h2>עריכת מוצר</h2>
    <div class="muted" style="margin-bottom:10px">${h(productLabel(p))}</div>
    <div class="field-row">
      <div><label>כמות במלאי</label><input id="e-qty" type="number" value="${p.quantity}" min="0"></div>
      <div><label>כמות יעד</label><input id="e-target" type="number" value="${p.target_quantity}" min="0"></div>
      <div><label>מינימום</label><input id="e-min" type="number" value="${p.min_quantity}" min="0"></div>
    </div>
    <div class="modal-actions"><button class="btn primary" id="e-save">שמירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#e-save').addEventListener('click', async () => {
    try { await api('/products/' + p.id, { method: 'PATCH', body: {
      quantity: $('#e-qty').value, target_quantity: $('#e-target').value, min_quantity: $('#e-min').value } });
      closeModal(); toast('עודכן', 'success'); drawInventory(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ================================================================
   אתרים ועובדים – כולל ייבוא מאקסל / CSV
   ================================================================ */
async function viewDirectory() {
  const main = $('#main');
  main.innerHTML = `<h1 class="page-title">אתרים ועובדים</h1>
    <p class="page-sub">ניהול אתרים ועובדים, כולל טעינה מקובץ אקסל (.xlsx) או CSV</p>
    <div class="section">
      <div class="toolbar">
        <h3 style="margin:0">🏢 אתרים</h3><div class="spacer"></div>
        <button class="btn" id="add-site">➕ אתר ידני</button>
        <button class="btn primary" id="imp-sites">📥 ייבוא אתרים מאקסל</button>
      </div>
      <div id="sites-body"></div>
    </div>
    <div class="section">
      <div class="toolbar">
        <h3 style="margin:0">👤 עובדים</h3><div class="spacer"></div>
        <button class="btn" id="add-emp">➕ עובד ידני</button>
        <button class="btn primary" id="imp-emps">📥 ייבוא עובדים מאקסל</button>
      </div>
      <div id="emps-body"></div>
    </div>`;
  $('#add-site').addEventListener('click', addSiteModal);
  $('#add-emp').addEventListener('click', addEmployeeModal);
  $('#imp-sites').addEventListener('click', () => importWizard('sites'));
  $('#imp-emps').addEventListener('click', () => importWizard('employees'));
  drawDirectory();
}
async function drawDirectory() {
  const [sites, emps] = await Promise.all([api('/sites'), api('/employees')]);
  $('#sites-body').innerHTML = sites.length ? `<div class="table-wrap"><table>
    <thead><tr><th>שם אתר</th><th>קוד</th><th>עובדים</th><th></th></tr></thead>
    <tbody>${sites.map((s) => `<tr><td>${h(s.name)}</td><td>${h(s.code || '—')}</td>
      <td>${s.employee_count}</td><td><button class="btn sm red" data-del-site="${s.id}">🗑</button></td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">אין אתרים. הוסיפו ידנית או ייבאו מאקסל.</div>`;
  $('#emps-body').innerHTML = emps.length ? `<div class="table-wrap"><table>
    <thead><tr><th>שם עובד</th><th>מספר עובד</th><th>אתר</th><th></th></tr></thead>
    <tbody>${emps.map((e) => `<tr><td>${h(e.name)}</td><td>${h(e.employee_no || '—')}</td>
      <td>${h(e.site_name || '—')}</td><td><button class="btn sm red" data-del-emp="${e.id}">🗑</button></td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">אין עובדים. הוסיפו ידנית או ייבאו מאקסל.</div>`;
  document.querySelectorAll('[data-del-site]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('למחוק אתר זה?')) return;
    await api('/sites/' + b.dataset.delSite, { method: 'DELETE' }); toast('נמחק'); drawDirectory();
  }));
  document.querySelectorAll('[data-del-emp]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('למחוק עובד זה?')) return;
    await api('/employees/' + b.dataset.delEmp, { method: 'DELETE' }); toast('נמחק'); drawDirectory();
  }));
}
function addSiteModal() {
  modal(`<h2>אתר חדש</h2><label>שם האתר</label><input id="s-name">
    <label>קוד (אופציונלי)</label><input id="s-code">
    <div class="modal-actions"><button class="btn primary" id="s-save">שמירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#s-save').addEventListener('click', async () => {
    try { await api('/sites', { method: 'POST', body: { name: $('#s-name').value.trim(), code: $('#s-code').value.trim() } });
      closeModal(); toast('נוסף', 'success'); drawDirectory(); } catch (e) { toast(e.message, 'error'); }
  });
}
async function addEmployeeModal() {
  const sites = await api('/sites');
  modal(`<h2>עובד חדש</h2><label>שם העובד</label><input id="emp-name">
    <label>מספר עובד (אופציונלי)</label><input id="emp-no">
    <label>אתר (אופציונלי)</label><select id="emp-site"><option value="">— ללא —</option>
      ${sites.map((s) => `<option value="${s.id}">${h(s.name)}</option>`).join('')}</select>
    <div class="modal-actions"><button class="btn primary" id="emp-save">שמירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#emp-save').addEventListener('click', async () => {
    try { await api('/employees', { method: 'POST', body: {
      name: $('#emp-name').value.trim(), employee_no: $('#emp-no').value.trim(), site_id: $('#emp-site').value || null } });
      closeModal(); toast('נוסף', 'success'); drawDirectory(); } catch (e) { toast(e.message, 'error'); }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
// אשף ייבוא: העלאה -> תצוגה מקדימה -> מיפוי עמודות -> ייבוא
function importWizard(kind) {
  const isSites = kind === 'sites';
  modal(`<h2>ייבוא ${isSites ? 'אתרים' : 'עובדים'} מקובץ</h2>
    <label>בחרו קובץ (.xlsx או .csv)</label>
    <input type="file" id="imp-file" accept=".xlsx,.csv">
    <div id="imp-preview"></div>`);
  $('#imp-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = await fileToBase64(file);
      const res = await api('/import/parse', { method: 'POST', body: { filename: file.name, data } });
      renderImportPreview(kind, res.rows, res.total);
    } catch (e) { toast(e.message, 'error'); }
  });
}
function renderImportPreview(kind, rows, total) {
  const isSites = kind === 'sites';
  if (!rows.length) { $('#imp-preview').innerHTML = `<div class="empty">לא נמצאו שורות בקובץ.</div>`; return; }
  const colCount = Math.max(...rows.map((r) => r.length));
  const colOptions = (includeNone) =>
    (includeNone ? `<option value="-1">— ללא —</option>` : '') +
    Array.from({ length: colCount }, (_, i) => `<option value="${i}">עמודה ${i + 1}${rows[0][i] ? ' (' + h(rows[0][i]) + ')' : ''}</option>`).join('');
  const preview = rows.slice(0, 8);
  let mapping = `<label><input type="checkbox" id="imp-header" checked style="width:auto"> השורה הראשונה היא כותרת (לא תיובא)</label>
    <div class="field-row" style="margin-top:10px">
      <div><label>עמודת ${isSites ? 'שם אתר' : 'שם עובד'} (חובה)</label><select id="map-name">${colOptions(false)}</select></div>`;
  if (isSites) {
    mapping += `<div><label>עמודת קוד</label><select id="map-code">${colOptions(true)}</select></div>`;
  } else {
    mapping += `<div><label>עמודת מספר עובד</label><select id="map-no">${colOptions(true)}</select></div>
      <div><label>עמודת אתר</label><select id="map-site">${colOptions(true)}</select></div>`;
  }
  mapping += `</div>`;
  if (!isSites) mapping += `<label><input type="checkbox" id="imp-create-sites" checked style="width:auto"> ליצור אתרים חדשים אוטומטית לפי שם האתר</label>`;
  $('#imp-preview').innerHTML = `
    <div class="muted" style="margin:12px 0 6px">נמצאו ${total} שורות. תצוגה מקדימה:</div>
    <div class="table-wrap"><table><tbody>
      ${preview.map((r) => `<tr>${Array.from({ length: colCount }, (_, i) => `<td>${h(r[i] || '')}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    ${mapping}
    <div class="modal-actions"><button class="btn primary" id="imp-go">ייבוא</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`;
  $('#imp-go').addEventListener('click', () => doImport(kind, rows));
}
async function doImport(kind, rows) {
  const isSites = kind === 'sites';
  const skipHeader = $('#imp-header').checked;
  const data = skipHeader ? rows.slice(1) : rows;
  const nameCol = Number($('#map-name').value);
  try {
    let res;
    if (isSites) {
      const codeCol = Number($('#map-code').value);
      const sites = data.map((r) => ({ name: r[nameCol], code: codeCol >= 0 ? r[codeCol] : null }));
      res = await api('/sites/bulk', { method: 'POST', body: { sites } });
      toast(`יובאו ${res.added} אתרים (${res.skipped} דולגו)`, 'success');
    } else {
      const noCol = Number($('#map-no').value);
      const siteCol = Number($('#map-site').value);
      const employees = data.map((r) => ({
        name: r[nameCol],
        employee_no: noCol >= 0 ? r[noCol] : null,
        site_name: siteCol >= 0 ? r[siteCol] : null,
      }));
      const create_sites = $('#imp-create-sites').checked;
      res = await api('/employees/bulk', { method: 'POST', body: { employees, create_sites } });
      toast(`יובאו ${res.added} עובדים (${res.sitesCreated} אתרים נוצרו, ${res.skipped} דולגו)`, 'success');
    }
    closeModal();
    drawDirectory();
  } catch (e) { toast(e.message, 'error'); }
}

/* ================================================================
   חוסרים להשלמה
   ================================================================ */
async function viewShortages() {
  const main = $('#main');
  main.innerHTML = `<h1 class="page-title">חוסרים להשלמה</h1>
    <p class="page-sub">פריטים שנלקחו מהמלאי וממתינים להשלמה, ומוצרים שהגיעו למינימום</p>
    <div id="sh-body"></div>`;
  const [shortages, low] = await Promise.all([
    api('/shortages'),
    state.user.role === 'admin' ? api('/reorder-suggestions') : Promise.resolve([]),
  ]);
  let html = '';
  html += `<div class="section"><h3>מתחת/בדיוק על המינימום (${low.length})</h3>`;
  html += low.length ? `<div class="table-wrap"><table>
    <thead><tr><th>חברה</th><th>פריט</th><th>במלאי</th><th>מינימום</th><th>יעד</th><th>מומלץ להזמין</th></tr></thead>
    <tbody>${low.map((p) => `<tr><td>${h(p.company_name)}</td><td>${h(productLabel(p))}</td>
      <td class="qty-low">${p.quantity}</td><td>${p.min_quantity}</td><td>${p.target_quantity}</td>
      <td><b>${p.suggested}</b></td></tr>`).join('')}</tbody></table></div>
    <div style="margin-top:10px"><button class="btn primary" id="go-reorder">מעבר ליצירת הזמנת רכש</button></div>`
    : `<div class="empty">אין מוצרים מתחת למינימום 🎉</div>`;
  html += `</div>`;

  html += `<div class="section"><h3>חוסרים שנרשמו מלקיחות (${shortages.length})</h3>`;
  html += shortages.length ? `<div class="table-wrap"><table>
    <thead><tr><th>חברה</th><th>פריט</th><th>כמות חסרה</th><th>מקור</th><th>תאריך</th></tr></thead>
    <tbody>${shortages.map((s) => `<tr><td>${h(s.company_name)}</td><td>${h(productLabel(s))}</td>
      <td class="qty-low">${s.quantity}</td><td>${h(s.source || '')}</td><td>${h(s.created_at)}</td></tr>`).join('')}
    </tbody></table></div>`
    : `<div class="empty">אין חוסרים פתוחים.</div>`;
  html += `</div>`;
  $('#sh-body').innerHTML = html;
  const g = $('#go-reorder'); if (g) g.addEventListener('click', () => navigate('reorder'));
}

/* ================================================================
   הזמנות רכש (מנהל) – יצירה, אישור, שליחה, קבלה
   ================================================================ */
async function viewReorder() {
  const main = $('#main');
  main.innerHTML = `<h1 class="page-title">הזמנות רכש למחסן הראשי</h1>
    <p class="page-sub">יצירת הזמנה לפי חוסרים, אישור ביצוע, מעקב זמנים וקבלת סחורה</p>
    <div class="toolbar"><button class="btn primary" id="new-po">➕ הזמנה חדשה לפי חוסרים</button></div>
    <div id="ro-body"></div>`;
  $('#new-po').addEventListener('click', newPurchaseOrderModal);
  const pos = await api('/purchase-orders');
  $('#ro-body').innerHTML = pos.length ? pos.map(poCard).join('') : `<div class="empty">אין הזמנות רכש עדיין.</div>`;
  bindPoActions();
}
function poCard(po) {
  const items = po.items.map((i) => {
    const missing = Math.max(0, i.quantity_ordered - i.quantity_received);
    return `<tr><td>${h(productLabel(i))}</td><td>${i.quantity_ordered}</td>
      <td>${i.quantity_received}</td><td class="${missing ? 'qty-low' : 'qty-ok'}">${missing}</td></tr>`;
  }).join('');
  let timing = '';
  if (po.sent_at) {
    timing = `<div class="muted" style="margin-top:6px">יצאה ב-${h(po.sent_at)} · עברו ${po.days_since_sent} ימים · התראה כל ${po.reminder_days} ימים`;
    if (po.overdue) timing += ` <span class="tag amber">⏰ עבר זמן הבדיקה</span>`;
    timing += `</div>`;
  }
  let actions = '';
  if (po.status === 'pending_approval') actions = `<button class="btn sm green" data-po-approve="${po.id}">אישור ביצוע</button>`;
  if (po.status === 'approved') actions = `<button class="btn sm primary" data-po-send="${po.id}">אישור יציאת הזמנה למחסן</button>`;
  if (po.status === 'sent' || po.status === 'partially_received') {
    actions = `<button class="btn sm green" data-po-receive='${h(JSON.stringify(po))}'>קבלת הזמנה</button>`;
    if (po.overdue) actions += `<button class="btn sm" data-po-check="${po.id}">בדקתי – אפס התראה</button>`;
  }
  if (!['received', 'cancelled'].includes(po.status))
    actions += ` <button class="btn sm red" data-po-cancel="${po.id}">ביטול</button>`;
  return `<div class="card section" style="margin-bottom:16px">
    <div class="toolbar" style="margin-bottom:8px">
      <b>הזמנת רכש #${po.id}</b> ${statusTag(po.status)}
      ${po.po_number ? `<span class="chip">PO: ${h(po.po_number)}</span>` : ''}
      <span class="muted">${h(po.created_at)}</span>
      <div class="spacer"></div>${actions}
    </div>
    ${po.note ? `<div class="muted" style="margin-bottom:6px">${h(po.note)}</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>פריט</th><th>הוזמן</th><th>התקבל</th><th>חסר</th></tr></thead>
      <tbody>${items}</tbody></table></div>${timing}
  </div>`;
}
function bindPoActions() {
  document.querySelectorAll('[data-po-approve]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/purchase-orders/${b.dataset.poApprove}/approve`, { method: 'POST' });
      toast('ההזמנה אושרה', 'success'); await refreshAlerts(); viewReorder(); } catch (e) { toast(e.message, 'error'); }
  }));
  document.querySelectorAll('[data-po-send]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('לאשר יציאת ההזמנה למחסן הראשי? יתחיל מעקב הזמן.')) return;
    try { await api(`/purchase-orders/${b.dataset.poSend}/send`, { method: 'POST' });
      toast('ההזמנה יצאה למחסן', 'success'); await refreshAlerts(); viewReorder(); } catch (e) { toast(e.message, 'error'); }
  }));
  document.querySelectorAll('[data-po-check]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/purchase-orders/${b.dataset.poCheck}/check`, { method: 'POST' });
    toast('התראה אופסה'); await refreshAlerts(); viewReorder();
  }));
  document.querySelectorAll('[data-po-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('לבטל את ההזמנה?')) return;
    await api(`/purchase-orders/${b.dataset.poCancel}/cancel`, { method: 'POST' });
    toast('בוטל'); viewReorder();
  }));
  document.querySelectorAll('[data-po-receive]').forEach((b) => b.addEventListener('click', () => receivePoModal(JSON.parse(b.dataset.poReceive))));
}
async function newPurchaseOrderModal() {
  const sug = await api('/reorder-suggestions');
  if (!sug.length) { toast('אין מוצרים מתחת למינימום כרגע'); return; }
  modal(`<h2>הזמנת רכש חדשה</h2>
    <div class="muted" style="margin-bottom:10px">בחרו פריטים וכמות. ברירת המחדל מחושבת לפי היעד והמינימום.</div>
    <div class="table-wrap"><table><thead><tr><th>בחירה</th><th>פריט</th><th>במלאי</th><th>להזמין</th></tr></thead>
      <tbody>${sug.map((p) => `<tr>
        <td><input type="checkbox" class="po-chk" data-id="${p.id}" checked></td>
        <td>${h(p.company_name)} · ${h(productLabel(p))}</td>
        <td class="qty-low">${p.quantity}</td>
        <td><input type="number" class="po-qty inline-num" data-id="${p.id}" value="${p.suggested}" min="1"></td>
      </tr>`).join('')}</tbody></table></div>
    <div class="field-row">
      <div><label>הערה</label><input id="po-note"></div>
      <div><label>התראת בדיקת סטטוס (ימים)</label>
        <select id="po-reminder"><option value="7">כל שבוע (7)</option><option value="14">כל שבועיים (14)</option>
        <option value="30">כל חודש (30)</option><option value="3">כל 3 ימים</option></select></div>
    </div>
    <div class="modal-actions"><button class="btn primary" id="po-create">יצירת הזמנה לאישור</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#po-create').addEventListener('click', async () => {
    const items = [];
    document.querySelectorAll('.po-chk').forEach((chk) => {
      if (chk.checked) {
        const qty = Number(document.querySelector(`.po-qty[data-id="${chk.dataset.id}"]`).value) || 0;
        if (qty > 0) items.push({ product_id: Number(chk.dataset.id), quantity_ordered: qty });
      }
    });
    if (!items.length) return toast('בחרו לפחות פריט אחד', 'error');
    try { await api('/purchase-orders', { method: 'POST', body: {
      items, note: $('#po-note').value, reminder_days: Number($('#po-reminder').value) } });
      closeModal(); toast('ההזמנה נוצרה וממתינה לאישור ביצוע', 'success'); await refreshAlerts(); viewReorder(); }
    catch (e) { toast(e.message, 'error'); }
  });
}
function receivePoModal(po) {
  modal(`<h2>קבלת הזמנת רכש #${po.id}</h2>
    <label>מספר הזמנה (PO)</label><input id="rc-po" value="${h(po.po_number || '')}" placeholder="לדוגמה: PO-12345">
    <div class="muted" style="margin:10px 0">הזינו את הכמויות שהתקבלו בפועל. המערכת תזהה אם חסר משהו.</div>
    <div class="table-wrap"><table><thead><tr><th>פריט</th><th>הוזמן</th><th>כבר התקבל</th><th>מתקבל כעת</th></tr></thead>
      <tbody>${po.items.map((i) => {
        const remaining = Math.max(0, i.quantity_ordered - i.quantity_received);
        return `<tr><td>${h(productLabel(i))}</td><td>${i.quantity_ordered}</td><td>${i.quantity_received}</td>
          <td><input type="number" class="rc-qty inline-num" data-id="${i.product_id}" value="${remaining}" min="0"></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="modal-actions"><button class="btn green" id="rc-save">אישור קבלה ועדכון מלאי</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#rc-save').addEventListener('click', async () => {
    const items = [];
    document.querySelectorAll('.rc-qty').forEach((inp) =>
      items.push({ product_id: Number(inp.dataset.id), quantity_received: Number(inp.value) || 0 }));
    try {
      const r = await api(`/purchase-orders/${po.id}/receive`, { method: 'POST', body: { po_number: $('#rc-po').value, items } });
      const missing = r.items.filter((i) => i.missing > 0);
      closeModal();
      if (missing.length) toast(`התקבל חלקית – חסרים ${missing.reduce((s, i) => s + i.missing, 0)} פריטים`, 'error');
      else toast('ההזמנה התקבלה במלואה והמלאי עודכן', 'success');
      await refreshAlerts(); viewReorder();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ================================================================
   ניהול משתמשים (מנהל)
   ================================================================ */
async function viewUsers() {
  const main = $('#main');
  main.innerHTML = `<h1 class="page-title">ניהול משתמשים</h1>
    <p class="page-sub">אישור הרשמות, יצירת משתמשים וקביעת סיסמאות</p>
    <div class="toolbar"><button class="btn primary" id="add-user">➕ משתמש חדש</button></div>
    <div id="users-body"></div>`;
  $('#add-user').addEventListener('click', addUserModal);
  const users = await api('/users');
  state.pendingUsers = users.filter((u) => u.status === 'pending').length;
  $('#users-body').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>שם משתמש</th><th>אימייל</th><th>תפקיד</th><th>סטטוס</th><th>פעולות</th></tr></thead>
    <tbody>${users.map(userRow).join('')}</tbody></table></div>`;
  bindUserActions();
}
function userRow(u) {
  const statusTagMap = { active: ['פעיל', 'green'], pending: ['ממתין לאישור', 'amber'], disabled: ['מושבת', 'gray'] };
  const [stxt, scls] = statusTagMap[u.status];
  let actions = '';
  if (u.status === 'pending') actions += `<button class="btn sm green" data-activate="${u.id}">אישור והפעלה</button>`;
  else if (u.status === 'active') actions += `<button class="btn sm" data-disable="${u.id}">השבתה</button>`;
  else actions += `<button class="btn sm green" data-activate="${u.id}">הפעלה</button>`;
  actions += ` <button class="btn sm" data-pass="${u.id}">סיסמה</button>`;
  actions += ` <button class="btn sm" data-role='${h(JSON.stringify(u))}'>${u.role === 'admin' ? 'הסר מנהל' : 'הפוך למנהל'}</button>`;
  actions += ` <button class="btn sm red" data-del-user="${u.id}">🗑</button>`;
  return `<tr><td>${h(u.username)}</td><td>${h(u.email)}</td>
    <td>${u.role === 'admin' ? '<span class="tag blue">מנהל</span>' : 'משתמש'}</td>
    <td><span class="tag ${scls}">${stxt}</span></td>
    <td class="btn-row">${actions}</td></tr>`;
}
function bindUserActions() {
  const reload = async () => { await refreshAlerts(); viewUsers(); };
  document.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/users/${b.dataset.activate}/status`, { method: 'POST', body: { status: 'active' } }); toast('הופעל', 'success'); reload();
  }));
  document.querySelectorAll('[data-disable]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/users/${b.dataset.disable}/status`, { method: 'POST', body: { status: 'disabled' } }); toast('הושבת'); reload();
  }));
  document.querySelectorAll('[data-del-user]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('למחוק משתמש זה?')) return;
    try { await api('/users/' + b.dataset.delUser, { method: 'DELETE' }); toast('נמחק'); reload(); } catch (e) { toast(e.message, 'error'); }
  }));
  document.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => {
    const u = JSON.parse(b.dataset.role);
    await api(`/users/${u.id}/role`, { method: 'POST', body: { role: u.role === 'admin' ? 'user' : 'admin' } });
    toast('התפקיד עודכן'); reload();
  }));
  document.querySelectorAll('[data-pass]').forEach((b) => b.addEventListener('click', () => {
    const pass = prompt('סיסמה חדשה למשתמש:');
    if (pass) api(`/users/${b.dataset.pass}/password`, { method: 'POST', body: { password: pass } })
      .then(() => toast('הסיסמה עודכנה', 'success')).catch((e) => toast(e.message, 'error'));
  }));
}
function addUserModal() {
  modal(`<h2>משתמש חדש</h2>
    <label>אימייל</label><input id="u-email" type="email">
    <label>שם משתמש</label><input id="u-user">
    <label>סיסמה</label><input id="u-pass" type="password">
    <label>תפקיד</label><select id="u-role"><option value="user">משתמש</option><option value="admin">מנהל</option></select>
    <div class="modal-actions"><button class="btn primary" id="u-save">יצירה</button>
    <button class="btn" onclick="closeModal()">ביטול</button></div>`);
  $('#u-save').addEventListener('click', async () => {
    try { await api('/users', { method: 'POST', body: {
      email: $('#u-email').value.trim(), username: $('#u-user').value.trim(),
      password: $('#u-pass').value, role: $('#u-role').value } });
      closeModal(); toast('המשתמש נוצר', 'success'); viewUsers(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ================================================================
   אתחול
   ================================================================ */
async function boot() {
  state.schemes = await api('/size-schemes');
  await refreshAlerts();
  renderShell();
}
(async function init() {
  try {
    state.user = await api('/auth/me');
    await boot();
  } catch {
    renderAuth('login');
  }
})();
