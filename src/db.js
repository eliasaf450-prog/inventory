import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { hashPassword } from './auth.js';
import { DEFAULT_ITEM_TYPES } from './sizes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'inventory.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role          TEXT NOT NULL DEFAULT 'user',   -- admin | user
    status        TEXT NOT NULL DEFAULT 'active',  -- active | pending | disabled
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS item_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    size_scheme TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, name)
  );

  CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type_id    INTEGER NOT NULL REFERENCES item_types(id) ON DELETE CASCADE,
    gender          TEXT,                 -- men | women | NULL
    size            TEXT NOT NULL DEFAULT '',
    manufacturer    TEXT,                 -- בעיקר לנעליים
    sku             TEXT,
    quantity        INTEGER NOT NULL DEFAULT 0,
    target_quantity INTEGER NOT NULL DEFAULT 0,
    min_quantity    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(item_type_id, gender, size, manufacturer)
  );

  -- בקשות/הזמנות של משתמשים (תהליך לקיחת ביגוד מהמלאי)
  CREATE TABLE IF NOT EXISTS requisitions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | collected | rejected | cancelled
    note         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at  TEXT,
    approved_by  INTEGER REFERENCES users(id),
    collected_at TEXT,
    rejected_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS requisition_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity       INTEGER NOT NULL
  );

  -- חוסרים להשלמה (נוצרים בעת לקיחת ביגוד בפועל)
  CREATE TABLE IF NOT EXISTS shortages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity    INTEGER NOT NULL,
    source      TEXT,                  -- requisition:<id> וכו'
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- הזמנות רכש למחסן הראשי (תהליך השלמת מלאי)
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    status       TEXT NOT NULL DEFAULT 'pending_approval',
                 -- pending_approval | approved | sent | partially_received | received | cancelled
    note         TEXT,
    reminder_days INTEGER NOT NULL DEFAULT 7,   -- תדירות התראת בדיקת סטטוס
    po_number    TEXT,                          -- מספר הזמנה PO
    created_by   INTEGER REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    approved_by  INTEGER REFERENCES users(id),
    approved_at  TEXT,
    sent_at      TEXT,
    received_at  TEXT,
    last_checked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_ordered  INTEGER NOT NULL,
    quantity_received INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_item_types_company ON item_types(company_id);
  CREATE INDEX IF NOT EXISTS idx_products_type ON products(item_type_id);
  CREATE INDEX IF NOT EXISTS idx_req_items_req ON requisition_items(requisition_id);
  CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
  `);
}

// יצירת משתמש מנהל ברירת מחדל בהרצה ראשונה
export function seedAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c === 0) {
    const username = process.env.ADMIN_USER || 'admin';
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare(
      `INSERT INTO users (email, username, password_hash, role, status)
       VALUES (?, ?, ?, 'admin', 'active')`
    ).run(email, username, hashPassword(password));
    console.log(`\n  ✓ נוצר משתמש מנהל ראשוני:  משתמש="${username}"  סיסמה="${password}"\n`);
  }
}

// יצירת סוגי הפריטים המוגדרים כברירת מחדל עבור חברת ניהול
export function seedItemTypesForCompany(companyId) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO item_types (company_id, name, size_scheme) VALUES (?, ?, ?)'
  );
  for (const t of DEFAULT_ITEM_TYPES) {
    stmt.run(companyId, t.name, t.size_scheme);
  }
}
