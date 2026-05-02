const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderAuthPage({ mode, error, email, csrfToken }) {
  const isSignup = mode === 'signup';
  const title = isSignup ? 'Create your FanHook account' : 'Sign in to FanHook';
  const headline = isSignup ? 'Create your account' : 'Welcome back';
  const sub = isSignup
    ? 'Spin up a sink in seconds. No credit card required.'
    : 'Sign in to manage your sinks, routes, and event log.';
  const submitLabel = isSignup ? 'Create account' : 'Sign in';
  const altHref = isSignup ? '/login' : '/signup';
  const altText = isSignup ? 'Already have an account?' : "Don't have an account?";
  const altLabel = isSignup ? 'Sign in' : 'Create one';
  const action = isSignup ? '/signup' : '/login';

  const themeInit = `<script>(function(){try{var t=localStorage.getItem('fh-theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>`;

  const errorBlock = error
    ? `<div role="alert" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);color:var(--red);padding:0.75rem 1rem;border-radius:14px;font-size:0.9rem;font-weight:600;margin-bottom:1rem;">${esc(error)}</div>`
    : '';

  const passwordHint = isSignup
    ? `<p style="font-size:0.78rem;color:var(--text-muted);margin:0.4rem 0 0;">At least ${MIN_PASSWORD_LEN} characters.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/style.css" />
  ${themeInit}
</head>
<body>
<nav class="topnav">
  <a href="/" class="fh-logo"><div class="fh-logo-mark">F</div><span class="fh-logo-text">FanHook</span></a>
  <div class="topnav-actions">
    <a href="/docs" class="topnav-link">Documentation</a>
    <a href="${esc(altHref)}" class="pill btn-ghost">${esc(altLabel)}</a>
  </div>
</nav>

<main class="landing-main" style="padding-top:3rem;">
  <div style="width:100%;max-width:440px;margin:0 auto;">
    <div class="row-card" style="padding:2rem;">
      <div style="text-align:center;margin-bottom:1.75rem;">
        <h1 style="font-family:var(--font-heading);font-weight:700;font-size:1.85rem;color:var(--text-primary);margin:0 0 0.5rem;">${esc(headline)}</h1>
        <p style="color:var(--text-muted);font-size:0.95rem;margin:0;">${esc(sub)}</p>
      </div>

      ${errorBlock}

      <form method="POST" action="${esc(action)}" autocomplete="on" novalidate>
        <input type="hidden" name="_csrf" value="${esc(csrfToken || '')}" />
        <div class="field" style="min-width:0;margin-bottom:1rem;">
          <label for="email" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.5rem;">Email</label>
          <input id="email" name="email" type="email" required autocomplete="email"
                 value="${esc(email || '')}"
                 placeholder="you@example.com"
                 style="width:100%;" />
        </div>

        <div class="field" style="min-width:0;margin-bottom:1.5rem;">
          <label for="password" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.5rem;">Password</label>
          <input id="password" name="password" type="password" required
                 autocomplete="${isSignup ? 'new-password' : 'current-password'}"
                 minlength="${isSignup ? MIN_PASSWORD_LEN : 1}"
                 placeholder="${isSignup ? 'Choose a strong password' : 'Your password'}"
                 style="width:100%;" />
          ${passwordHint}
        </div>

        <button type="submit" class="pill btn-primary" style="width:100%;display:flex;justify-content:center;font-size:1rem;padding:0.85rem 1rem;">
          ${esc(submitLabel)}
        </button>
      </form>

      <p style="text-align:center;font-size:0.9rem;color:var(--text-muted);margin:1.5rem 0 0;">
        ${esc(altText)}
        <a href="${esc(altHref)}" style="color:var(--brand-blue, #4F46E5);font-weight:700;text-decoration:none;margin-left:0.35rem;">${esc(altLabel)}</a>
      </p>
    </div>

    <p style="text-align:center;font-size:0.78rem;color:var(--text-muted);margin:1.25rem 0 0;">
      By continuing you agree to FanHook's terms of service.
    </p>
  </div>
</main>
</body></html>`;
}

function send(res, status, html) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
}

// ---------------- Sign up ----------------
router.get('/signup', (req, res) => {
  if (auth.getSessionUser(req)) return res.redirect('/dashboard');
  const csrfToken = auth.ensureCsrfToken(req, res);
  send(res, 200, renderAuthPage({ mode: 'signup', csrfToken }));
});

router.post('/signup', auth.requireCsrf, (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const csrfToken = auth.ensureCsrfToken(req, res);

  if (!EMAIL_RE.test(email)) {
    return send(res, 400, renderAuthPage({
      mode: 'signup', email, csrfToken,
      error: 'Please enter a valid email address.',
    }));
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return send(res, 400, renderAuthPage({
      mode: 'signup', email, csrfToken,
      error: `Password must be at least ${MIN_PASSWORD_LEN} characters.`,
    }));
  }

  const userId = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = auth.hashPassword(password);

  // Insert user + first sink atomically. The UNIQUE(email) constraint will
  // surface duplicates as a SqliteError that we map back to 409.
  const create = db.transaction(() => {
    db.prepare(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).run(userId, email, passwordHash, now);

    const sinkId = uuidv4();
    const apiKey = uuidv4();
    db.prepare(`
      INSERT INTO sinks (id, name, provider, api_key, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sinkId, 'My first sink', 'generic', apiKey, now, userId);
  });

  try {
    create();
  } catch (err) {
    const msg = String(err && err.message || '');
    if (
      err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed: users\.email/i.test(msg))
    ) {
      return send(res, 409, renderAuthPage({
        mode: 'signup', email, csrfToken,
        error: 'An account with that email already exists. Try signing in instead.',
      }));
    }
    console.error('[auth/signup] failed:', msg);
    return send(res, 500, renderAuthPage({
      mode: 'signup', email, csrfToken,
      error: 'Something went wrong creating your account. Please try again.',
    }));
  }

  const sid = auth.createSession(userId);
  auth.setSessionCookie(res, sid, req);
  res.redirect('/dashboard');
});

// ---------------- Sign in ----------------
router.get('/login', (req, res) => {
  if (auth.getSessionUser(req)) return res.redirect('/dashboard');
  const csrfToken = auth.ensureCsrfToken(req, res);
  send(res, 200, renderAuthPage({ mode: 'login', csrfToken }));
});

router.post('/login', auth.requireCsrf, (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const csrfToken = auth.ensureCsrfToken(req, res);

  if (!EMAIL_RE.test(email) || !password) {
    return send(res, 400, renderAuthPage({
      mode: 'login', email, csrfToken,
      error: 'Please enter your email and password.',
    }));
  }

  const user = db.prepare(
    'SELECT id, password_hash FROM users WHERE email = ?'
  ).get(email);

  // Always run scrypt even on miss to reduce timing leakage.
  const dummyHash = 'scrypt$' + '00'.repeat(16) + '$' + '00'.repeat(64);
  const ok = user
    ? auth.verifyPassword(password, user.password_hash)
    : (auth.verifyPassword(password, dummyHash), false);

  if (!user || !ok) {
    return send(res, 401, renderAuthPage({
      mode: 'login', email, csrfToken,
      error: 'Email or password is incorrect.',
    }));
  }

  const sid = auth.createSession(user.id);
  auth.setSessionCookie(res, sid, req);
  res.redirect('/dashboard');
});

// ---------------- Sign out ----------------
// POST-only with CSRF token to prevent forced logout (e.g. via <img src=/logout>).
router.post('/logout', auth.requireCsrf, (req, res) => {
  const sid = auth.getSessionId(req);
  auth.destroySession(sid);
  auth.clearSessionCookie(res);
  res.redirect('/');
});

module.exports = router;
