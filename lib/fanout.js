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
 * @returns {Promise<{success: boolean, http_status: number|null, attempt_number: number, error_message: string|null}>}
 */
async function deliverToRoute(db, eventId, route, rawBody, headers) {
  const contentType = headers['content-type'] || 'application/json';
  let lastHttpStatus = null;
  let lastErrorMessage = null;
  let lastAttemptNumber = 0;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const attemptedAt = new Date().toISOString();
    let httpStatus = null;
    let success = false;
    let errorMessage = null;

    try {
      const response = await fetch(route.url, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: rawBody,
      });

      httpStatus = response.status;
      success = response.ok; // 2xx
      if (!success) {
        errorMessage = `HTTP ${httpStatus}`;
      }
    } catch (err) {
      // Network error — treat as failed attempt
      httpStatus = null;
      success = false;
      errorMessage = err.message || 'Network error';
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

    lastHttpStatus = httpStatus;
    lastErrorMessage = errorMessage;
    lastAttemptNumber = attempt;

    if (success) {
      return { success: true, http_status: httpStatus, attempt_number: attempt, error_message: null };
    }
  }

  return { success: false, http_status: lastHttpStatus, attempt_number: lastAttemptNumber, error_message: lastErrorMessage };
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
 * @returns {Promise<{anySuccess: boolean, attempts: Array<{route_id, http_status, attempt_number, error_message}>}>}
 */
async function fanout(db, eventId, routes, rawBody, headers) {
  try {
    const results = await Promise.all(
      routes.map((route) =>
        deliverToRoute(db, eventId, route, rawBody, headers).then((r) => ({
          route_id: route.id,
          ...r,
        }))
      )
    );

    const anySuccess = results.some((r) => r.success);
    const finalStatus = anySuccess ? 'delivered' : 'failed';

    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(finalStatus, eventId);

    return {
      anySuccess,
      attempts: results.map(({ route_id, http_status, attempt_number, error_message }) => ({
        route_id,
        http_status,
        attempt_number,
        error_message,
      })),
    };
  } catch (err) {
    // Ensure event is never left in ambiguous state
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
    return { anySuccess: false, attempts: [] };
  }
}

module.exports = { fanout };
