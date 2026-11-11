// src/db/index.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const DB_PATH = process.env.DB_PATH || './data/gateway.db';

// Pastikan folder data ada
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Aktifkan WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS message_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
    content     TEXT,
    media_type  TEXT DEFAULT 'text',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_log_phone ON message_log(phone);
`);

// Dedup dikunci pada (tenant_id, notification_id): ID notifikasi grup hanya unik
// per tenant (mis. semua tenant dapat "2026-11-11_attendance_missing_clockin_summary"
// di hari yang sama). tenant_id kosong disimpan sebagai '' agar PK tetap berlaku.
const DEDUP_SCHEMA = `
  CREATE TABLE notification_dedup (
    tenant_id       TEXT NOT NULL DEFAULT '',
    notification_id TEXT NOT NULL,
    type            TEXT,
    delivered_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (tenant_id, notification_id)
  );
`;

function migrateDedupTable() {
  const cols = db.prepare(`PRAGMA table_info(notification_dedup)`).all();
  if (cols.length === 0) {
    db.exec(DEDUP_SCHEMA);
    return;
  }
  const pkCols = cols.filter(c => c.pk > 0).map(c => c.name);
  if (pkCols.includes('tenant_id')) return; // sudah skema baru

  // Skema lama (PK = notification_id saja) → pindahkan ke PK komposit.
  db.transaction(() => {
    db.exec(`ALTER TABLE notification_dedup RENAME TO notification_dedup_old`);
    db.exec(DEDUP_SCHEMA);
    db.exec(`
      INSERT OR IGNORE INTO notification_dedup (tenant_id, notification_id, type, delivered_at)
      SELECT COALESCE(tenant_id, ''), notification_id, type, delivered_at FROM notification_dedup_old
    `);
    db.exec(`DROP TABLE notification_dedup_old`);
  })();
  logger.info('Database: notification_dedup dimigrasi ke PK (tenant_id, notification_id)');
}

migrateDedupTable();

logger.info(`Database ready: ${DB_PATH}`);

module.exports = db;
