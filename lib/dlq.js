/**
 * lib/dlq.js
 *
 * Shared DLQ write helper used by both the NATS delivery worker
 * (workers/delivery.js) and the durable outbox sweeper (lib/outbox.js).
 *
 * Writes the failed event to the SQLite dlq_entries table (always available,
 * used by the redrive endpoint for raw-body storage) and best-effort publishes
 * to the NATS DLQ JetStream stream (primary store for the list endpoint).
 */

const natsLib = require('./nats');

/**
 * @param {object} db - better-sqlite3 Database instance
 * @param {string} eventId
 * @param {string} sinkId
 * @param {string|null} provider
 * @param {string} rawBodyB64
 * @param {object} headers
 * @param {number} attemptCount
 * @param {string|null} failureReason
 */
async function writeToDLQ(db, eventId, sinkId, provider, rawBodyB64, headers, attemptCount, failureReason) {
  const failedAt = new Date().toISOString();

  // Write to SQLite for raw-body storage (used by redrive endpoint)
  db.prepare(`
    INSERT OR IGNORE INTO dlq_entries
      (event_id, sink_id, raw_body_b64, headers, provider, failed_at, attempt_count, failure_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    sinkId,
    rawBodyB64 || '',
    JSON.stringify(headers || {}),
    provider || null,
    failedAt,
    attemptCount,
    failureReason || null
  );

  // Publish to NATS DLQ stream (primary store for list endpoint).
  // Store the returned stream sequence in SQLite so the redrive endpoint can
  // delete this specific message from the stream later.
  try {
    const pubAck = await natsLib.publishToDLQ(sinkId, {
      event_id: eventId,
      sink_id: sinkId,
      payload: rawBodyB64 || '',
      headers: headers || {},
      failed_at: failedAt,
      attempt_count: attemptCount,
      failure_reason: failureReason || null,
    });
    if (pubAck && pubAck.seq) {
      db.prepare('UPDATE dlq_entries SET nats_seq = ? WHERE event_id = ?').run(pubAck.seq, eventId);
    }
  } catch (_) {
    // NATS DLQ publish failure is non-fatal — redrive still works via SQLite
  }

  console.warn(`[dlq] Event ${eventId} written to DLQ (${attemptCount} attempts, reason: ${failureReason})`);
}

module.exports = { writeToDLQ };
