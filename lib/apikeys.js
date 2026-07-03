/**
 * lib/apikeys.js
 *
 * API key hashing helpers. Keys are stored in sinks.api_key as
 * `sha256$<hex digest>` — the plaintext key is shown exactly once at creation
 * time and never persisted. All lookups hash the presented token and compare
 * against the stored digest (the existing idx_sinks_api_key index still
 * applies).
 *
 * IMPORTANT: this module must stay dependency-free of db.js — db.js requires
 * it during the startup key-hash migration.
 */

const crypto = require('crypto');

const HASH_PREFIX = 'sha256$';

function hashApiKey(plaintext) {
  const digest = crypto.createHash('sha256').update(String(plaintext), 'utf8').digest('hex');
  return `${HASH_PREFIX}${digest}`;
}

function isHashedApiKey(value) {
  return typeof value === 'string'
    && value.startsWith(HASH_PREFIX)
    && /^[a-f0-9]{64}$/.test(value.slice(HASH_PREFIX.length));
}

/**
 * Look up a sink by a presented plaintext API key.
 * Returns the sink row or undefined.
 *
 * A presented token that *is* itself a stored hash (`sha256$...`) is rejected:
 * the digest is not a credential, otherwise a DB leak would still grant access.
 */
function findSinkByApiKey(db, token) {
  if (!token || typeof token !== 'string') return undefined;
  if (isHashedApiKey(token)) return undefined;
  return db.prepare('SELECT * FROM sinks WHERE api_key = ?').get(hashApiKey(token));
}

module.exports = { hashApiKey, isHashedApiKey, findSinkByApiKey, HASH_PREFIX };
