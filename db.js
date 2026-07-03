const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fanhook.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
// Multiple processes (server + delivery worker) write concurrently — wait for
// locks instead of failing immediately with SQLITE_BUSY.
db.pragma('busy_timeout = 5000');

// ---------------------------------------------------------------------------
// Schema migrations — safe to run on every startup
// ---------------------------------------------------------------------------

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sinks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'generic',
    api_key TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS dlq_entries (
    event_id TEXT PRIMARY KEY,
    sink_id TEXT NOT NULL,
    raw_body_b64 TEXT NOT NULL,
    headers TEXT NOT NULL,
    provider TEXT,
    failed_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 3,
    failure_reason TEXT,
    nats_seq INTEGER,
    redriven INTEGER NOT NULL DEFAULT 0,
    redriven_at TEXT,
    new_event_id TEXT
  );

  CREATE TABLE IF NOT EXISTS outbox (
    event_id TEXT PRIMARY KEY,
    sink_id TEXT NOT NULL,
    raw_body_b64 TEXT NOT NULL,
    headers TEXT NOT NULL DEFAULT '{}',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt_at ON outbox(next_attempt_at);
`);

// Idempotent migrations — safe to run on every startup
for (const col of [
  'ALTER TABLE sinks ADD COLUMN webhook_secret TEXT',
  "ALTER TABLE sinks ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'",
  'ALTER TABLE sinks ADD COLUMN stripe_customer_id TEXT',
  'ALTER TABLE sinks ADD COLUMN stripe_subscription_id TEXT',
  'ALTER TABLE dlq_entries ADD COLUMN failure_reason TEXT',
  'ALTER TABLE dlq_entries ADD COLUMN nats_seq INTEGER',
  'ALTER TABLE sinks ADD COLUMN user_id TEXT',
]) {
  try { db.exec(col); } catch (_) { /* column already exists */ }
}

// ---------------------------------------------------------------------------
// Data-path scaling: hot-path indexes + pre-aggregated monthly usage counters.
// Created after the ALTER migrations above so columns like sinks.user_id exist.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS monthly_usage (
    sink_id TEXT NOT NULL,
    month TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sink_id, month)
  );

  CREATE INDEX IF NOT EXISTS idx_sinks_api_key ON sinks(api_key);
  CREATE INDEX IF NOT EXISTS idx_sinks_user_id ON sinks(user_id);
  CREATE INDEX IF NOT EXISTS idx_routes_sink_id ON routes(sink_id);
  CREATE INDEX IF NOT EXISTS idx_events_sink_received ON events(sink_id, received_at);
  CREATE INDEX IF NOT EXISTS idx_delivery_attempts_event_id ON delivery_attempts(event_id);
  CREATE INDEX IF NOT EXISTS idx_dlq_entries_sink_redriven_at ON dlq_entries(sink_id, redriven_at);
`);

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

// ---------------------------------------------------------------------------
// API key hashing migration — idempotent, runs on every startup (after the
// demo seed above so a freshly seeded demo key is hashed too). Any sink whose
// api_key is still plaintext is rewritten as sha256$<hex>. Lookups go through
// lib/apikeys.findSinkByApiKey which hashes the presented token.
// ---------------------------------------------------------------------------
{
  const { hashApiKey, isHashedApiKey } = require('./lib/apikeys');
  const rows = db.prepare('SELECT id, api_key FROM sinks').all();
  const update = db.prepare('UPDATE sinks SET api_key = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) {
      if (!isHashedApiKey(row.api_key)) {
        update.run(hashApiKey(row.api_key), row.id);
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Monthly usage counter backfill — runs on every startup, but INSERT OR IGNORE
// makes it a one-time seed per (sink, month): once a counter row exists (from
// backfill or from ingest increments) it is never overwritten. This makes
// current-month usage accurate immediately after the migration, including for
// the demo sink seeded above.
// ---------------------------------------------------------------------------
{
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO monthly_usage (sink_id, month, event_count)
    SELECT sink_id, ?, COUNT(*) FROM events WHERE received_at >= ? GROUP BY sink_id
  `).run(monthKey, monthStart);
}

module.exports = db;
