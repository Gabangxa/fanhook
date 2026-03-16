const { v4: uuidv4 } = require('uuid');

// CJS-compatible dynamic import for node-fetch (ESM-only package v3+)
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const RETRY_DELAYS_MS = [0, 30_000, 120_000]; // attempt 1: immediate, 2: 30s, 3: 120s

/**
 * Attempt delivery of a webhook event to a single route with retries.
 *
 * @param {object} db - better-sqlite3 Database instance
 * @param {string} eventId
 * @param {object} route - { id, url }
 * @param {Buffer|string} rawBody
 * @param {object} headers - original request headers
 * @returns {Promise<boolean>} - true if any attempt succeeded
 */
async function deliverToRoute(db, eventId, route, rawBody, headers) {
  const contentType = headers['content-type'] || 'application/json';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const attemptedAt = new Date().toISOString();
    let httpStatus = null;
    let success = false;

    try {
      const response = await fetch(route.url, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: rawBody,
      });

      httpStatus = response.status;
      success = response.ok; // 2xx
    } catch (err) {
      // Network error — treat as failed attempt
      httpStatus = null;
      success = false;
    }

    db.prepare(`
      INSERT INTO delivery_attempts (id, event_id, route_id, attempt_number, status, http_status, attempted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      eventId,
      route.id,
      attempt,
      success ? 'success' : 'failed',
      httpStatus,
      attemptedAt
    );

    if (success) {
      return true;
    }
  }

  return false;
}

/**
 * Fan out a webhook event to all configured routes with automatic retries.
 * Updates event status to 'delivered' if any route succeeds, 'failed' if all fail.
 *
 * @param {object} db - better-sqlite3 Database instance
 * @param {string} eventId
 * @param {Array<{id: string, url: string}>} routes
 * @param {Buffer|string} rawBody
 * @param {object} headers - original request headers
 */
async function fanout(db, eventId, routes, rawBody, headers) {
  try {
    const results = await Promise.all(
      routes.map((route) => deliverToRoute(db, eventId, route, rawBody, headers))
    );

    const anySuccess = results.some(Boolean);
    const finalStatus = anySuccess ? 'delivered' : 'failed';

    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(finalStatus, eventId);
  } catch (err) {
    // Ensure event is never left in ambiguous state
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
  }
}

module.exports = { fanout };
