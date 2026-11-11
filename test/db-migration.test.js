// Tes migrasi notification_dedup: PK lama (notification_id) → (tenant_id, notification_id).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

test('legacy dedup table is migrated, rows preserved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sender-'));
  const file = path.join(dir, 'legacy.db');
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE notification_dedup (
      notification_id TEXT PRIMARY KEY, tenant_id TEXT, type TEXT,
      delivered_at TEXT DEFAULT (datetime('now')));
    INSERT INTO notification_dedup (notification_id, tenant_id, type) VALUES ('n1', 'acme', 'a'), ('n2', NULL, 'b');
  `);
  legacy.close();

  process.env.DB_PATH = file;
  process.env.LOG_LEVEL = 'error';
  const db = require('../src/db');
  const pk = db.prepare('PRAGMA table_info(notification_dedup)').all().filter(c => c.pk).map(c => c.name);
  assert.deepEqual(pk.sort(), ['notification_id', 'tenant_id']);
  const rows = db.prepare('SELECT tenant_id, notification_id FROM notification_dedup ORDER BY notification_id').all();
  assert.deepEqual(rows, [{ tenant_id: 'acme', notification_id: 'n1' }, { tenant_id: '', notification_id: 'n2' }]);
  db.prepare(`INSERT INTO notification_dedup (tenant_id, notification_id) VALUES ('other', 'n1')`).run();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
