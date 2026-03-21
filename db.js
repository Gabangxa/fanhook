const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fanhook.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sinks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'generic',
    api_key TEXT NOT NULL,
    webhook_secret TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    sink_id TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (sink_id) REFERENCES sinks(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    sink_id TEXT NOT NULL,
    provider TEXT,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS delivery_attempts (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    attempted_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(id)
  );
`);

// Migration: add webhook_secret column to existing databases
try {
  db.exec('ALTER TABLE sinks ADD COLUMN webhook_secret TEXT');
} catch (_) {
  // Column already exists — safe to ignore
}

// Seed demo data if not already present
const existingSink = db.prepare('SELECT id FROM sinks WHERE id = ?').get('demo_sink_1');

if (!existingSink) {
  const now = new Date().toISOString();

  // Insert demo sink
  db.prepare(`
    INSERT INTO sinks (id, name, provider, api_key, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('demo_sink_1', 'demo-stripe-sink', 'stripe', 'demo_key_abc123', now);

  // Insert demo routes
  db.prepare(`
    INSERT INTO routes (id, sink_id, url, created_at)
    VALUES (?, ?, ?, ?)
  `).run('demo_route_1', 'demo_sink_1', 'https://httpbin.org/post', now);

  db.prepare(`
    INSERT INTO routes (id, sink_id, url, created_at)
    VALUES (?, ?, ?, ?)
  `).run('demo_route_2', 'demo_sink_1', 'https://httpbin.org/post', now);

  // Insert demo events
  const eventStatuses = [
    { id: 'demo_event_1', status: 'delivered' },
    { id: 'demo_event_2', status: 'delivered' },
    { id: 'demo_event_3', status: 'failed' },
    { id: 'demo_event_4', status: 'pending' },
    { id: 'demo_event_5', status: 'delivered' },
  ];

  const insertEvent = db.prepare(`
    INSERT INTO events (id, sink_id, provider, payload, received_at, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const evt of eventStatuses) {
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      id: `evt_${evt.id}`,
    });
    insertEvent.run(evt.id, 'demo_sink_1', 'stripe', payload, now, evt.status);
  }

  // Insert delivery attempts
  const insertAttempt = db.prepare(`
    INSERT INTO delivery_attempts (id, event_id, route_id, attempt_number, status, http_status, attempted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Delivered events: one success attempt each
  for (const evtId of ['demo_event_1', 'demo_event_2', 'demo_event_5']) {
    insertAttempt.run(
      `attempt_${evtId}_1`,
      evtId,
      'demo_route_1',
      1,
      'success',
      200,
      now
    );
  }

  // Failed event: three failed attempts
  for (let i = 1; i <= 3; i++) {
    insertAttempt.run(
      `attempt_demo_event_3_${i}`,
      'demo_event_3',
      'demo_route_1',
      i,
      'failed',
      503,
      now
    );
  }
}

module.exports = db;
