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

  CREATE TABLE IF NOT EXISTS notification_dedup (
    notification_id TEXT PRIMARY KEY,
    tenant_id       TEXT,
    type            TEXT,
    delivered_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_log_phone ON message_log(phone);
`);

logger.info(`Database ready: ${DB_PATH}`);

module.exports = db;
