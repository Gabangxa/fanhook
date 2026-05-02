const crypto = require('crypto');
const db = require('../db');

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALTLEN = 16;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_COOKIE = 'fh_session';
const CSRF_COOKIE = 'fh_csrf';
const CSRF_TOKEN_HEX_LEN = 64; // 32 random bytes
const CSRF_TOKEN_RE = /^[a-f0-9]{64}$/;

// JSON.stringify alone is unsafe inside an HTML <script> block because the
// closing sequence `</script>` is not escaped. Escape the few characters that
// can break out of the script context (and Unicode line separators that break
// JS strings).
function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function appendCookie(res, cookie) {
  if (typeof res.append === 'function') {
    res.append('Set-Cookie', cookie);
    return;
  }
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', [existing, cookie]);
  }
}

function isSecureRequest(req) {
  if (!req) return false;
  if (req.secure === true) return true;
  const proto = (req.headers && req.headers['x-forwarded-proto']) || req.protocol;
  return String(proto || '').split(',')[0].trim() === 'https';
}

// Double-submit cookie CSRF token. Idempotent within a request:
// - if cookie present and well-formed, reuse it (so existing rendered forms
//   in other tabs keep working)
// - otherwise generate a new one and set it as a non-HttpOnly cookie so the
//   server can compare it to the form-submitted _csrf field.
function ensureCsrfToken(req, res) {
  const existing = parseCookies(req)[CSRF_COOKIE];
  if (existing && CSRF_TOKEN_RE.test(existing)) return existing;
  const token = crypto.randomBytes(32).toString('hex');
  const parts = [
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  appendCookie(res, parts.join('; '));
  return token;
}

function verifyCsrf(req) {
  const cookieToken = parseCookies(req)[CSRF_COOKIE];
  const bodyToken = req.body && req.body._csrf;
  if (
    !cookieToken || !bodyToken ||
    typeof bodyToken !== 'string' ||
    !CSRF_TOKEN_RE.test(cookieToken) ||
    cookieToken.length !== bodyToken.length
  ) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(bodyToken));
  } catch (_) { return false; }
}

function requireCsrf(req, res, next) {
  if (!verifyCsrf(req)) {
    return res.status(403).type('text/plain').send('Invalid or missing CSRF token. Please reload and try again.');
  }
  next();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALTLEN);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length);
  } catch (_) {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
    }
  });
  return out;
}

function createSession(userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(sid, userId, now + SESSION_TTL_MS, now);
  return sid;
}

function destroySession(sid) {
  if (!sid) return;
  try { db.prepare('DELETE FROM sessions WHERE id = ?').run(sid); } catch (_) {}
}

function pruneExpiredSessions() {
  try { db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()); } catch (_) {}
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?
  `).get(sid, Date.now());
  return row || null;
}

function setSessionCookie(res, sid, req) {
  const parts = [
    `${SESSION_COOKIE}=${sid}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

function clearSessionCookie(res) {
  appendCookie(
    res,
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function getSessionId(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

function requireUser(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    if (req.accepts && req.accepts(['html', 'json']) === 'json') {
      return res.status(401).json({ error: 'Not signed in' });
    }
    return res.redirect('/login');
  }
  req.user = user;
  next();
}

function attachUser(req, res, next) {
  req.user = getSessionUser(req);
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  parseCookies,
  createSession,
  destroySession,
  pruneExpiredSessions,
  getSessionUser,
  getSessionId,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
  attachUser,
  ensureCsrfToken,
  verifyCsrf,
  requireCsrf,
  safeJsonForScript,
  SESSION_COOKIE,
  CSRF_COOKIE,
  SESSION_TTL_MS,
};
