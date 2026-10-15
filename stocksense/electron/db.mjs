import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let database;
let databasePath;

const now = () => new Date().toISOString();

export function initializeDatabase(path) {
  if (database) return database;
  databasePath = path;
  mkdirSync(dirname(path), { recursive: true });
  database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  migrate(database);
  removeLegacyFacadeData(database);
  return database;
}

export function getDatabase() {
  if (!database) {
    if (!databasePath) throw new Error('Database has not been initialized.');
    return initializeDatabase(databasePath);
  }
  return database;
}

export function getDatabasePath() {
  if (!databasePath) throw new Error('Database has not been initialized.');
  return databasePath;
}

export function closeDatabase() {
  if (database) {
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.close();
    database = undefined;
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'INR',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      theme_name TEXT NOT NULL DEFAULT 'teal',
      primary_color TEXT NOT NULL DEFAULT '#2f6f73',
      logo_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER REFERENCES businesses(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT,
      password_salt TEXT,
      provider TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'google')),
      provider_subject TEXT,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (business_id, name)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      sku TEXT,
      barcode TEXT,
      category_id INTEGER REFERENCES categories(id),
      unit TEXT NOT NULL DEFAULT 'unit',
      current_stock INTEGER NOT NULL DEFAULT 0,
      low_stock_limit INTEGER NOT NULL DEFAULT 5,
      minimum_sales_30_days INTEGER NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      latest_purchase_date TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (business_id, sku),
      UNIQUE (business_id, barcode)
    );

    CREATE TABLE IF NOT EXISTS product_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      price_type TEXT NOT NULL CHECK (price_type IN ('selling', 'cost')),
      old_value REAL,
      new_value REAL NOT NULL,
      margin_before REAL,
      margin_after REAL,
      effective_at TEXT NOT NULL,
      user_name TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      audit_log_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      type TEXT NOT NULL CHECK (type IN ('sale', 'restock', 'return', 'damage', 'adjustment', 'opening')),
      quantity INTEGER NOT NULL,
      list_price REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      stock_before INTEGER NOT NULL,
      stock_after INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      correlation_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      field_changes_json TEXT NOT NULL DEFAULT '{}',
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      device_id TEXT NOT NULL DEFAULT 'local-device',
      correlation_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      previous_hash TEXT NOT NULL DEFAULT '',
      entry_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anomaly_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      unique_key TEXT NOT NULL,
      anomaly_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      entity_name TEXT NOT NULL,
      expected_value REAL,
      actual_value REAL,
      deviation REAL,
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'valid', 'expected', 'false_positive', 'resolved')),
      rule_name TEXT NOT NULL,
      explanation TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      assigned_to TEXT NOT NULL DEFAULT '',
      resolution_note TEXT NOT NULL DEFAULT '',
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (business_id, unique_key)
    );

    CREATE TABLE IF NOT EXISTS nlp_query_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      user_name TEXT NOT NULL,
      intent TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      query_text TEXT,
      success INTEGER NOT NULL,
      source_count INTEGER NOT NULL,
      response_meta_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      report_type TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      file_name TEXT NOT NULL,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 1,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_transactions_business_date ON transactions(business_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_product ON transactions(product_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_audit_business_date ON audit_logs(business_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_anomaly_business_status ON anomaly_events(business_id, status, detected_at);
    CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_subject ON users(provider, provider_subject) WHERE provider_subject IS NOT NULL;
  `);

  ensureColumn(db, 'transactions', 'list_price', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'transactions', 'discount_percent', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'transactions', 'discount_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'products', 'minimum_sales_30_days', 'INTEGER NOT NULL DEFAULT 0');
  db.prepare("UPDATE transactions SET list_price = unit_price WHERE type = 'sale' AND list_price = 0").run();

  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, now());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, now());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, now());
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function removeLegacyFacadeData(db) {
  const demos = db.prepare(`
    SELECT id FROM businesses
    WHERE tax_id = 'GSTIN-DEMO-01' OR email LIKE '%@abctraders.example'
  `).all();
  if (!demos.length) return;
  db.transaction(() => {
    for (const row of demos) {
      const businessId = Number(row.id);
      for (const table of ['nlp_query_logs', 'report_exports', 'backup_records', 'anomaly_events', 'audit_logs', 'product_price_history', 'transactions', 'products', 'categories', 'users']) {
        db.prepare(`DELETE FROM ${table} WHERE business_id = ?`).run(businessId);
      }
      db.prepare('DELETE FROM businesses WHERE id = ?').run(businessId);
    }
    db.prepare("DELETE FROM app_settings WHERE key IN ('active_business_id', 'current_user')").run();
  })();
}

export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function margin(sellingPrice, costPrice) {
  if (!sellingPrice) return 0;
  return ((sellingPrice - costPrice) / sellingPrice) * 100;
}

export function getContext(db = getDatabase()) {
  const businessId = getSetting('active_business_id', null, db);
  const user = getSetting('current_user', null, db);
  if (!businessId || !user?.id) throw new Error('Please sign in and finish business setup before continuing.');
  return {
    businessId: Number(businessId),
    user,
  };
}

export function getSetting(key, fallback = null, db = getDatabase()) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}

export function setSetting(key, value, db = getDatabase()) {
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now());
}

export function deleteSetting(key, db = getDatabase()) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

export function writeAudit({
  db = getDatabase(),
  businessId,
  user = { name: 'Owner', role: 'owner' },
  action,
  entityType,
  entityId = null,
  before = {},
  after = {},
  fieldChanges = {},
  reason = '',
  source = 'manual',
  correlationId = randomUUID(),
  occurredAt = now(),
}) {
  const previous = db.prepare('SELECT entry_hash FROM audit_logs WHERE business_id = ? ORDER BY id DESC LIMIT 1').get(businessId);
  const previousHash = previous?.entry_hash ?? '';
  const auditUser = { name: user.name, role: user.role };
  const payload = JSON.stringify({
    businessId,
    user: auditUser,
    action,
    entityType,
    entityId,
    before,
    after,
    fieldChanges,
    reason,
    source,
    correlationId,
    occurredAt,
    previousHash,
  });
  const entryHash = createHash('sha256').update(payload).digest('hex');
  const result = db.prepare(`
    INSERT INTO audit_logs (
      business_id, user_name, user_role, action, entity_type, entity_id,
      field_changes_json, before_json, after_json, reason, source, correlation_id,
      occurred_at, previous_hash, entry_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    businessId,
    auditUser.name,
    auditUser.role,
    action,
    entityType,
    entityId,
    JSON.stringify(fieldChanges),
    JSON.stringify(before),
    JSON.stringify(after),
    reason,
    source,
    correlationId,
    occurredAt,
    previousHash,
    entryHash,
  );
  return { id: Number(result.lastInsertRowid), correlationId, entryHash };
}
