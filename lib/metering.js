/**
 * Usage metering helpers.
 *
 * FanHook counts events per calendar month, per sink. Usage is tracked in the
 * pre-aggregated `monthly_usage` counter table (one row per sink per calendar
 * month) instead of COUNT(*)-ing the events table on every request — this
 * keeps ingest latency flat as the events table grows.
 *
 * Invariant: every code path that inserts a row into `events` must call
 * incrementMonthlyUsage() in the same transaction so the counter never drifts.
 * A one-time-per-month backfill in db.js seeds counters from the events table.
 *
 * The limits below mirror the pricing table in product-spec.json.
 */

const TIER_LIMITS = {
  free: { events_per_month: 1_000, sinks: 1, routes: 3 },
  starter: { events_per_month: 50_000, sinks: 5, routes: 10 },
};

/**
 * Calendar-month key in local time, e.g. "2026-07". Local time matches the
 * previous COUNT(*)-based behavior (first-of-month boundary was local).
 */
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * How many events a sink has received so far this calendar month.
 * O(1) read from the counter table.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sinkId
 * @returns {number}
 */
function getMonthlyEventCount(db, sinkId) {
  const row = db
    .prepare('SELECT event_count FROM monthly_usage WHERE sink_id = ? AND month = ?')
    .get(sinkId, currentMonthKey());
  return row ? row.event_count : 0;
}

/**
 * Atomically bump the current-month counter for a sink. Call inside the same
 * transaction as the corresponding INSERT INTO events.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sinkId
 * @param {number} [n=1]
 */
function incrementMonthlyUsage(db, sinkId, n = 1) {
  db.prepare(`
    INSERT INTO monthly_usage (sink_id, month, event_count)
    VALUES (?, ?, ?)
    ON CONFLICT(sink_id, month) DO UPDATE SET event_count = event_count + excluded.event_count
  `).run(sinkId, currentMonthKey(), n);
}

/**
 * Return the per-month event limit for a tier, defaulting to free limits
 * for unknown values.
 *
 * @param {string} tier
 * @returns {number}
 */
function getEventLimit(tier) {
  return (TIER_LIMITS[tier] ?? TIER_LIMITS.free).events_per_month;
}

module.exports = {
  TIER_LIMITS,
  currentMonthKey,
  getMonthlyEventCount,
  incrementMonthlyUsage,
  getEventLimit,
};
