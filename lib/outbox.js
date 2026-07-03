/**
 * lib/outbox.js
 *
 * DB-backed durable outbox for webhook delivery when NATS is unavailable.
 *
 * Flow:
 *   - Ingest inserts an outbox row in the SAME transaction as the event row.
 *   - If the subsequent NATS JetStream publish succeeds, the row is removed
 *     (JetStream owns delivery). If it fails, the row stays and the sweeper
 *     delivers it durably — surviving process crashes and restarts.
 *   - The sweeper mirrors the NATS retry schedule: up to MAX_DELIVER outer
 *     attempts (each running lib/fanout's in-process retry schedule), spaced
 *     by FANHOOK_OUTBOX_RETRY_DELAY_MS. Exhausted events go to the DLQ with
 *     the same semantics as the NATS worker path.
 *   - The sweeper also performs continuous crash recovery: events stuck in
 *     'pending' beyond FANHOOK_PENDING_GRACE_MS with no outbox row are
 *     re-enqueued automatically (covers crashes on any legacy path).
 *
 * Env vars:
 *   FANHOOK_OUTBOX_SWEEP_MS         sweep interval (default 1000)
 *   FANHOOK_OUTBOX_RETRY_DELAY_MS   delay between outer attempts (default 30000)
 *   FANHOOK_PENDING_GRACE_MS        stale-pending recovery window (default 30 min)
 */

const { fanout } = require('./fanout');
const natsLib = require('./nats');
const { writeToDLQ } = require('./dlq');

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const SWEEP_MS = envInt('FANHOOK_OUTBOX_SWEEP_MS', 1000);
const RETRY_DELAY_MS = envInt('FANHOOK_OUTBOX_RETRY_DELAY_MS', 30_000);
const PENDING_GRACE_MS = envInt('FANHOOK_PENDING_GRACE_MS', 30 * 60_000);
const MAX_ATTEMPTS = natsLib.MAX_DELIVER; // mirror the NATS consumer's max_deliver
const BATCH_SIZE = 25;
const RECOVERY_BATCH_SIZE = 100;

function safeParseHeaders(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Insert an outbox row for an event. Safe to call inside a transaction.
 *
 * Two-phase handoff: pass `delayMs` (e.g. PENDING_GRACE_MS) to insert the row
 * as "not yet due" while a NATS publish is attempted. Exactly one owner then
 * exists at any time:
 *   - NATS publish succeeds → caller removes the row (JetStream owns it).
 *   - NATS publish fails    → caller calls arm() to make the row due now.
 *   - Process crashes before either → the row becomes due after delayMs and
 *     the sweeper delivers it. Durable with no sweeper/NATS double-delivery
 *     window during the handoff.
 */
function enqueue(db, { eventId, sinkId, rawBodyB64, headers, delayMs = 0 }) {
  db.prepare(`
    INSERT OR IGNORE INTO outbox (event_id, sink_id, raw_body_b64, headers, attempt_count, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(
    eventId,
    sinkId,
    rawBodyB64 || '',
    JSON.stringify(headers || {}),
    Date.now() + delayMs,
    new Date().toISOString()
  );
}

/** Make an outbox row due immediately (NATS publish failed — outbox owns it). */
function arm(db, eventId) {
  db.prepare('UPDATE outbox SET next_attempt_at = ? WHERE event_id = ?').run(Date.now(), eventId);
}

/** Remove an event's outbox row (delivery handed off to NATS, or finished). */
function remove(db, eventId) {
  db.prepare('DELETE FROM outbox WHERE event_id = ?').run(eventId);
}

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------
const inFlight = new Set(); // event IDs currently being processed (this process)
let dbRef = null;
let timer = null;
let running = false;
let stopped = true;
let pendingNotify = false;

/**
 * Re-enqueue events stuck in 'pending' beyond the grace window that have no
 * outbox row (e.g. process crashed mid-delivery on a legacy path, or a NATS
 * message was lost). Demo seed events are excluded so the demo dashboard
 * fixtures stay stable.
 */
function recoverStalePending(db) {
  const cutoff = new Date(Date.now() - PENDING_GRACE_MS).toISOString();
  const rows = db.prepare(`
    SELECT e.id, e.sink_id, e.payload FROM events e
    WHERE e.status = 'pending'
      AND e.received_at < ?
      AND e.id NOT LIKE 'demo_event_%'
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.event_id = e.id)
    LIMIT ${RECOVERY_BATCH_SIZE}
  `).all(cutoff);

  for (const r of rows) {
    enqueue(db, {
      eventId: r.id,
      sinkId: r.sink_id,
      rawBodyB64: Buffer.from(r.payload || '{}', 'utf8').toString('base64'),
      headers: { 'content-type': 'application/json' },
    });
    console.log(`[outbox] Recovered stale pending event ${r.id} (sink ${r.sink_id})`);
  }
  return rows.length;
}

async function processRow(db, row) {
  const eventId = row.event_id;
  const attemptNumber = row.attempt_count + 1;
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event || event.status === 'delivered') {
      remove(db, eventId);
      return;
    }

    const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(row.sink_id);
    const headers = safeParseHeaders(row.headers);

    if (routes.length === 0) {
      db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
      remove(db, eventId);
      await writeToDLQ(db, eventId, row.sink_id, event.provider, row.raw_body_b64, headers, attemptNumber, 'no_routes');
      natsLib.publishStatusEvent(row.sink_id, { event_id: eventId, sink_id: row.sink_id, status: 'failed' }).catch(() => {});
      return;
    }

    const rawBody = Buffer.from(row.raw_body_b64 || '', 'base64');
    console.log(`[outbox] Delivering event ${eventId} (attempt ${attemptNumber}/${MAX_ATTEMPTS})`);
    const result = await fanout(db, eventId, routes, rawBody, headers);

    if (result.anySuccess) {
      remove(db, eventId);
      natsLib.publishStatusEvent(row.sink_id, { event_id: eventId, sink_id: row.sink_id, status: 'delivered' }).catch(() => {});
    } else if (attemptNumber >= MAX_ATTEMPTS) {
      db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
      remove(db, eventId);
      await writeToDLQ(db, eventId, row.sink_id, event.provider, row.raw_body_b64, headers, attemptNumber, 'max_deliver_exceeded');
      console.warn(`[outbox] Event ${eventId} exhausted ${MAX_ATTEMPTS} outbox attempts — written to DLQ`);
      natsLib.publishStatusEvent(row.sink_id, { event_id: eventId, sink_id: row.sink_id, status: 'failed' }).catch(() => {});
    } else {
      // Transient failure — reset to pending (fanout marked it failed) and
      // schedule the next outer attempt, mirroring the NATS nak/redeliver flow.
      db.prepare('UPDATE events SET status = ? WHERE id = ?').run('pending', eventId);
      db.prepare('UPDATE outbox SET attempt_count = ?, next_attempt_at = ? WHERE event_id = ?')
        .run(attemptNumber, Date.now() + RETRY_DELAY_MS, eventId);
    }
  } catch (err) {
    console.error(`[outbox] Error processing event ${eventId}: ${err.message}`);
    try {
      if (attemptNumber >= MAX_ATTEMPTS) {
        db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
        remove(db, eventId);
        await writeToDLQ(db, eventId, row.sink_id, null, row.raw_body_b64, safeParseHeaders(row.headers), attemptNumber, `outbox_error: ${err.message}`);
      } else {
        db.prepare('UPDATE outbox SET attempt_count = ?, next_attempt_at = ? WHERE event_id = ?')
          .run(attemptNumber, Date.now() + RETRY_DELAY_MS, eventId);
      }
    } catch (_) {}
  } finally {
    inFlight.delete(eventId);
  }
}

async function sweep(db) {
  recoverStalePending(db);

  const due = db.prepare(`
    SELECT * FROM outbox WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ${BATCH_SIZE}
  `).all(Date.now());

  const claimed = due.filter((r) => !inFlight.has(r.event_id));
  if (claimed.length === 0) return;
  for (const r of claimed) inFlight.add(r.event_id);

  await Promise.all(claimed.map((r) => processRow(db, r)));
}

function scheduleNext(delay) {
  if (stopped) return;
  timer = setTimeout(runOnce, delay);
  if (timer.unref) timer.unref();
}

async function runOnce() {
  if (running || stopped) return;
  running = true;
  pendingNotify = false;
  try {
    await sweep(dbRef);
  } catch (err) {
    console.error(`[outbox] Sweep error: ${err.message}`);
  }
  running = false;
  scheduleNext(pendingNotify ? 0 : SWEEP_MS);
}

/** Start the background sweeper loop (call once from the server process). */
function startSweeper(db) {
  dbRef = db;
  if (!stopped) return;
  stopped = false;
  console.log(`[outbox] Sweeper started (interval ${SWEEP_MS}ms, retry delay ${RETRY_DELAY_MS}ms, pending grace ${PENDING_GRACE_MS}ms)`);
  scheduleNext(0);
}

/** Wake the sweeper immediately (e.g. right after enqueueing a fallback row). */
function notify() {
  if (stopped || !dbRef) return;
  if (running) {
    pendingNotify = true;
    return;
  }
  clearTimeout(timer);
  scheduleNext(0);
}

function stopSweeper() {
  stopped = true;
  clearTimeout(timer);
}

module.exports = {
  enqueue,
  arm,
  remove,
  startSweeper,
  stopSweeper,
  notify,
  recoverStalePending,
  MAX_ATTEMPTS,
  PENDING_GRACE_MS,
};
