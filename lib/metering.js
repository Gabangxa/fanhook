/**
 * Usage metering helpers.
 *
 * FanHook counts events per calendar month, per sink.
 * The limits below mirror the pricing table in product-spec.json.
 */

const TIER_LIMITS = {
  free: { events_per_month: 1_000, sinks: 1, routes: 3 },
  starter: { events_per_month: 50_000, sinks: 5, routes: 10 },
};

/**
 * Count how many events a sink has received so far this calendar month.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sinkId
 * @returns {number}
 */
function getMonthlyEventCount(db, sinkId) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const row = db
    .prepare(
      'SELECT COUNT(*) AS count FROM events WHERE sink_id = ? AND received_at >= ?'
    )
    .get(sinkId, firstOfMonth);

  return row ? row.count : 0;
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

module.exports = { TIER_LIMITS, getMonthlyEventCount, getEventLimit };
