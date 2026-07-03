const express = require('express');
const path = require('path');
const db = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Inline SVG icons (lucide-style) ----------
const ICON = {
  webhook:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/></svg>',
  route:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
  bar:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  bell:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  user:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  menu:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
  sun:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  github:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.2.9 2.4v3.6c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>',
  arrowR:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  zap:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  shield:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
  message:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  code:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  copy:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  checkC:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  pause:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>',
  trash:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  filter:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  plus:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>',
  refresh:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  clock:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
};

const FH_LOGO = `<a href="/" class="fh-logo"><div class="fh-logo-mark">F</div><span class="fh-logo-text">FanHook</span></a>`;

const THEME_INIT = `<script>(function(){try{var t=localStorage.getItem('fh-theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>`;

const HEAD = (title) => `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css" />
  ${THEME_INIT}
</head>
<body>`;

const THEME_TOGGLE = `<button id="theme-toggle" class="icon-btn" aria-label="Toggle dark mode" onclick="toggleTheme()">${ICON.moon}</button>`;

const THEME_SCRIPT = `<script>
function toggleTheme(){
  var root=document.documentElement;
  var cur=root.getAttribute('data-theme')==='dark'?'light':'dark';
  root.setAttribute('data-theme',cur);
  try{localStorage.setItem('fh-theme',cur);}catch(e){}
  var btn=document.getElementById('theme-toggle');
  if(btn) btn.innerHTML = cur==='dark' ? \`${ICON.sun}\` : \`${ICON.moon}\`;
}
(function(){
  var btn=document.getElementById('theme-toggle');
  if(btn && document.documentElement.getAttribute('data-theme')==='dark'){
    btn.innerHTML = \`${ICON.sun}\`;
  }
})();
</script>`;

const FOOTER = `<footer class="footer">
  <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;margin-bottom:0.6rem;font-size:0.85rem;">
    <a href="/providers/stripe" style="color:inherit;opacity:0.75;">Stripe</a>
    <a href="/providers/github" style="color:inherit;opacity:0.75;">GitHub</a>
    <a href="/providers/shopify" style="color:inherit;opacity:0.75;">Shopify</a>
    <a href="/providers/linear" style="color:inherit;opacity:0.75;">Linear</a>
    <a href="/providers/pagerduty" style="color:inherit;opacity:0.75;">PagerDuty</a>
    <a href="/providers/clerk" style="color:inherit;opacity:0.75;">Clerk</a>
    <a href="/docs" style="color:inherit;opacity:0.75;">Docs</a>
  </div>
  FanHook &mdash; Built for indie developers &amp; small teams
</footer>`;

// ---------- Health & OpenAPI ----------
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'openapi.json'));
});

// ---------- Landing page ----------
router.get('/', (req, res) => {
  const user = auth.getSessionUser(req);
  const csrfToken = user ? auth.ensureCsrfToken(req, res) : null;
  const navAuth = user
    ? `<span class="topnav-link" title="${escAttr(user.email)}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escAttr(user.email)}</span>
       <a href="/dashboard" class="pill btn-primary">Open Dashboard</a>
       <form method="POST" action="/logout" style="display:inline;margin:0;">
         <input type="hidden" name="_csrf" value="${escAttr(csrfToken)}" />
         <button type="submit" class="pill btn-ghost" style="cursor:pointer;border:0;">Sign Out</button>
       </form>`
    : `<a href="/login" class="topnav-link">Sign In</a>
       <a href="/signup" class="pill btn-primary">Get Started Free</a>`;

  const html = `${HEAD('FanHook — Webhook fanout made delightful.')}
<nav class="topnav">
  ${FH_LOGO}
  <div class="topnav-actions">
    ${THEME_TOGGLE}
    <a href="/docs" class="topnav-link">Documentation</a>
    ${navAuth}
  </div>
</nav>

<main class="landing-main">
  <div class="live-pill">
    <span class="live-dot"></span>
    <span>v0.1 is now live</span>
  </div>

  <h1 class="hero-title">
    Webhook fanout <br />
    <span class="grad">made delightful.</span>
  </h1>
  <p class="hero-sub">
    Ingest once, verify securely, and broadcast to multiple destinations effortlessly. The relay API your team will actually love using.
  </p>

  <div class="hero-ctas">
    <a href="/dashboard" class="pill btn-primary">
      Launch Dashboard
      ${ICON.arrowR}
    </a>
    <a href="https://github.com/" target="_blank" rel="noopener" class="pill btn-ghost">
      ${ICON.github}
      View Source
    </a>
  </div>

  <div class="flow">
    <div class="flow-node">
      <div class="flow-node-mark">${ICON.webhook}</div>
      <div class="flow-node-label">Source Event</div>
    </div>

    <div class="flow-link">
      <div class="flow-link-chip">${ICON.zap}<span>FanHook</span></div>
    </div>

    <div class="flow-dest">
      <div class="flow-dest-row">
        <div class="flow-dest-icon pink">${ICON.message}</div>
        <div class="flow-dest-label">Slack Alerts</div>
      </div>
      <div class="flow-dest-row">
        <div class="flow-dest-icon blue">${ICON.database}</div>
        <div class="flow-dest-label">Internal DB</div>
      </div>
      <div class="flow-dest-row">
        <div class="flow-dest-icon amber">${ICON.code}</div>
        <div class="flow-dest-label">Serverless Func</div>
      </div>
    </div>
  </div>

  <div class="features">
    <div class="feature">
      <div class="feature-icon indigo">${ICON.zap}</div>
      <h3>Lightning Fast</h3>
      <p>Instant delivery with zero latency.</p>
    </div>
    <div class="feature">
      <div class="feature-icon sky">${ICON.shield}</div>
      <h3>Secure by Default</h3>
      <p>Automatic verification and trusted payloads only.</p>
    </div>
    <div class="feature">
      <div class="feature-icon rose">${ICON.activity}</div>
      <h3>Granular Logs</h3>
      <p>Real-time visibility and automatic retries.</p>
    </div>
  </div>

  <section id="pricing" class="pricing">
    <div class="plan">
      <h3>Free</h3>
      <div class="price">$0<span>/mo</span></div>
      <ul>
        <li>1 sink</li>
        <li>1,000 events/month</li>
        <li>3 fanout routes per sink</li>
        <li>3 retry attempts</li>
        <li>Stripe &amp; GitHub verification</li>
        <li>Event log (last 50)</li>
      </ul>
      <a href="/dashboard" class="pill btn-ghost" style="display:flex;margin-top:1.5rem;width:100%;">Get started free</a>
    </div>
    <div class="plan plan-featured">
      <div class="plan-badge">Most popular</div>
      <h3>Starter</h3>
      <div class="price">$9<span>/mo</span></div>
      <ul>
        <li>5 sinks</li>
        <li>50,000 events/month</li>
        <li>Everything in Free</li>
        <li>Event log (last 200)</li>
        <li>Email alerts on retry exhaustion</li>
      </ul>
      <a href="/dashboard#upgrade" class="pill btn-indigo" style="display:flex;margin-top:1.5rem;width:100%;">Upgrade to Starter</a>
    </div>
  </section>
</main>

${FOOTER}
${THEME_SCRIPT}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------- Billing success ----------
router.get('/billing/success', (req, res) => {
  const html = `${HEAD('FanHook — Upgrade Successful')}
<nav class="topnav">${FH_LOGO}<div class="topnav-actions">${THEME_TOGGLE}</div></nav>
<div class="landing-main" style="padding-top:4rem;">
  <div class="sink-status-icon" style="width:84px;height:84px;margin-bottom:1.5rem;">${ICON.checkC}</div>
  <h1 class="hero-title" style="font-size:clamp(2rem,4vw,3rem);"><span class="grad">You're on Starter!</span></h1>
  <p class="hero-sub">Your plan has been upgraded. You now have 50,000 events/month and 5 sinks. It may take a few seconds for the dashboard to reflect the change.</p>
  <a href="/dashboard" class="pill btn-primary">Go to Dashboard ${ICON.arrowR}</a>
</div>
${FOOTER}
${THEME_SCRIPT}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------- Docs ----------
router.get('/docs', (req, res) => {
  const html = `${HEAD('FanHook — API Docs')}
<nav class="topnav">
  ${FH_LOGO}
  <div class="topnav-actions">
    ${THEME_TOGGLE}
    <a href="/dashboard" class="pill btn-ghost">Open Dashboard</a>
  </div>
</nav>

<div class="docs-shell">
  <aside class="docs-side">
    <div class="docs-side-title">Reference</div>
    <a href="#sinks">Sinks</a>
    <a href="#routes">Routes</a>
    <a href="#billing">Billing</a>
    <a href="#ingest">Ingest</a>
    <a href="#response-codes">Response Codes</a>
  </aside>

  <main>
    <h1 style="font-family:var(--font-heading);font-weight:700;font-size:2.5rem;margin-bottom:0.5rem;">API Documentation</h1>
    <p class="text-secondary" style="max-width:560px;margin-bottom:2.5rem;">
      Management endpoints live under <code>/api</code> (Bearer auth). Ingest endpoints live under <code>/ingest</code> (signature-verified).
    </p>

    <section id="sinks" class="docs-section">
      <h2>Sinks</h2>
      <div class="endpoint">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/api/sinks <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Create a new sink. Body: <code>{"name":"...","provider":"stripe|github|shopify|linear|pagerduty|clerk|generic"}</code>. All non-generic providers require <code>webhook_secret</code>. See per-provider setup at <a href="/providers/shopify">/providers/shopify</a>, <a href="/providers/linear">/providers/linear</a>, <a href="/providers/pagerduty">/providers/pagerduty</a>, <a href="/providers/clerk">/providers/clerk</a>.</div>
        </div>
      </div>
      <div class="endpoint">
        <div><span class="method method-get">GET</span></div>
        <div>
          <div class="endpoint-path">/api/sinks <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">List sinks for the authenticated API key.</div>
        </div>
      </div>
      <div class="endpoint">
        <div><span class="method method-get">GET</span></div>
        <div>
          <div class="endpoint-path">/api/sinks/:id/events <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Last 50 events with delivery attempts.</div>
        </div>
      </div>
    </section>

    <section id="routes" class="docs-section">
      <h2>Routes</h2>
      <div class="endpoint">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/api/sinks/:id/routes <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Add a destination URL. Body: <code>{"url":"https://..."}</code></div>
        </div>
      </div>
      <div class="endpoint">
        <div><span class="method method-delete">DELETE</span></div>
        <div>
          <div class="endpoint-path">/api/sinks/:id/routes/:routeId <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Remove a route. Returns 204.</div>
        </div>
      </div>
    </section>

    <section id="billing" class="docs-section">
      <h2>Billing</h2>
      <div class="endpoint">
        <div><span class="method method-get">GET</span></div>
        <div>
          <div class="endpoint-path">/api/billing/status <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Current tier, events used this month, and limit.</div>
        </div>
      </div>
      <div class="endpoint">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/api/billing/checkout <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Create a Stripe Checkout session to upgrade to Starter ($9/mo). Returns <code>{"url":"..."}</code>.</div>
        </div>
      </div>
    </section>

    <section id="ingest" class="docs-section">
      <h2>Ingest</h2>
      <div class="endpoint">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/ingest/:sinkId <span class="endpoint-auth">Signature</span></div>
          <div class="endpoint-desc">Receive a webhook. FanHook verifies the provider signature and fans out to all routes. Returns <code>429</code> when monthly limit is reached.</div>
        </div>
      </div>
    </section>

    <section id="response-codes" class="docs-section">
      <h2>Response Codes</h2>
      <div class="endpoint"><div><span class="method method-get">200</span></div><div class="endpoint-desc">OK</div></div>
      <div class="endpoint"><div><span class="method method-post">201</span></div><div class="endpoint-desc">Created</div></div>
      <div class="endpoint"><div><span class="method method-post">204</span></div><div class="endpoint-desc">No Content</div></div>
      <div class="endpoint"><div><span class="method method-delete">400</span></div><div class="endpoint-desc">Bad Request</div></div>
      <div class="endpoint"><div><span class="method method-delete">401</span></div><div class="endpoint-desc">Unauthorized</div></div>
      <div class="endpoint"><div><span class="method method-delete">429</span></div><div class="endpoint-desc">Rate Limited</div></div>
    </section>
  </main>
</div>

${FOOTER}
${THEME_SCRIPT}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------- Per-provider landing pages (SEO) ----------
const PROVIDER_PAGES = {
  stripe: {
    name: 'Stripe',
    headline: 'FanHook for Stripe Webhooks',
    description: 'Verify Stripe webhook signatures and fan out payment events to Slack, your database, and any other endpoint — without writing the boilerplate.',
    intro1: 'Stripe ships your most business-critical events — successful charges, failed subscriptions, disputes — over webhooks. FanHook verifies every Stripe-Signature header against your endpoint secret, stores the event, and forwards it to every destination you configure.',
    intro2: 'Bring up a Stripe sink in seconds, paste your <code>whsec_...</code> secret, and point Stripe at the FanHook ingest URL. We handle retries, deduplication, and a tamper-proof audit log so you can stop babysitting raw webhook handlers.',
    secretLabel: 'Endpoint signing secret (whsec_...)',
    setupSteps: [
      'Create a Stripe sink in your FanHook dashboard and paste the endpoint signing secret from the Stripe dashboard.',
      'In Stripe → Developers → Webhooks, add a new endpoint pointing at the ingest URL below.',
      'Add fanout routes (Slack, your API, your data warehouse) and FanHook will broadcast every verified event.',
    ],
    keywords: 'stripe webhook fanout, stripe webhook proxy, stripe webhook signature verification',
  },
  github: {
    name: 'GitHub',
    headline: 'FanHook for GitHub Webhooks',
    description: 'Verify GitHub X-Hub-Signature-256 webhooks and fan out repo events to your CI, chat, and audit log in one hop.',
    intro1: 'GitHub fires webhooks for every push, pull request, deploy, and security alert. FanHook checks the <code>X-Hub-Signature-256</code> HMAC against your shared secret, persists the event, and reliably delivers it to as many internal services as you need.',
    intro2: 'Stop writing the same signature-verification snippet in every microservice. Configure one GitHub sink, point your repo or organization webhook at FanHook, and add destinations as your team grows.',
    secretLabel: 'GitHub webhook secret',
    setupSteps: [
      'Create a GitHub sink in your FanHook dashboard with the same secret you plan to put in GitHub.',
      'In your repo or org settings → Webhooks, add a new webhook with the ingest URL below and content type <code>application/json</code>.',
      'Add fanout routes for the destinations you want every event mirrored to.',
    ],
    keywords: 'github webhook proxy, github webhook fanout, x-hub-signature-256',
  },
  shopify: {
    name: 'Shopify',
    headline: 'FanHook for Shopify Webhooks',
    description: 'Verify Shopify X-Shopify-Hmac-Sha256 webhooks once and fan out order, customer, and inventory events to every internal system.',
    intro1: 'Shopify webhooks power order fulfillment, inventory sync, and customer lifecycle automation — but every consumer needs to verify the same base64 HMAC and tolerate Shopify\'s aggressive retry policy. FanHook does it once and lets the rest of your stack subscribe to a clean, verified event stream.',
    intro2: 'Drop your Shopify webhook signing secret into FanHook, point your storefront at one ingest URL, and broadcast verified order and product events to your warehouse, your finance tools, and your customer-success Slack channel — all from a single dashboard.',
    secretLabel: 'Shopify webhook signing secret',
    setupSteps: [
      'Create a Shopify sink in your FanHook dashboard and paste the webhook signing secret from your Shopify admin (Settings → Notifications → Webhooks).',
      'In Shopify, register a new webhook (e.g. <code>orders/create</code>) with the ingest URL below and JSON format.',
      'Add fanout routes for every system that needs the event — fulfillment, accounting, internal dashboards.',
    ],
    keywords: 'shopify webhook fanout, shopify webhook proxy, x-shopify-hmac-sha256',
  },
  linear: {
    name: 'Linear',
    headline: 'FanHook for Linear Webhooks',
    description: 'Verify Linear-Signature HMAC webhooks and fan out issue, project, and comment events to chat, CI, and analytics.',
    intro1: 'Linear webhooks are the cleanest way to mirror engineering activity into the rest of your stack — release notes, on-call rotations, custom dashboards. FanHook verifies the <code>Linear-Signature</code> HMAC, stores every event, and broadcasts it to as many destinations as you wire up.',
    intro2: 'Skip the per-service Linear integration sprawl. One sink, one ingest URL, and unlimited fanout to Slack, Notion, your data warehouse, or your own homegrown automation.',
    secretLabel: 'Linear webhook signing secret',
    setupSteps: [
      'Create a Linear sink in your FanHook dashboard and paste the signing secret shown when you set up the Linear webhook.',
      'In Linear → Settings → API → Webhooks, create a webhook pointed at the ingest URL below.',
      'Add fanout routes for every downstream destination — Slack, GitHub Actions, internal services.',
    ],
    keywords: 'linear webhook proxy, linear webhook fanout, linear-signature verification',
  },
  pagerduty: {
    name: 'PagerDuty',
    headline: 'FanHook for PagerDuty Webhooks',
    description: 'Verify PagerDuty v3 X-PagerDuty-Signature webhooks and fan out incident events to chat, status pages, and post-mortem tooling.',
    intro1: 'PagerDuty is the source of truth for incidents — but the v3 webhook format with rotating <code>X-PagerDuty-Signature</code> headers is annoying to verify in every consumer. FanHook handles signature rotation natively (multiple <code>v1=</code> candidates accepted) and forwards verified incident events to anywhere you need them.',
    intro2: 'Get incidents into Slack, into a status page updater, into your data warehouse, and into your own retrospective tooling — all from one signed feed instead of N copies of the same verification logic.',
    secretLabel: 'PagerDuty webhook secret',
    setupSteps: [
      'Create a PagerDuty sink in your FanHook dashboard and paste the secret PagerDuty showed when you registered the webhook subscription.',
      'In PagerDuty → Integrations → Generic Webhooks (v3), add a subscription pointed at the ingest URL below.',
      'Add fanout routes for incident chat channels, status pages, and any downstream automation.',
    ],
    keywords: 'pagerduty webhook proxy, pagerduty v3 webhook fanout, x-pagerduty-signature',
  },
  clerk: {
    name: 'Clerk',
    headline: 'FanHook for Clerk Webhooks',
    description: 'Verify Clerk\'s Svix-style webhooks (svix-id / svix-timestamp / svix-signature) and fan out user lifecycle events to every system that needs them.',
    intro1: 'Clerk emits webhooks via Svix for every signup, login, organization change, and session event — and your CRM, billing system, onboarding emailer, and analytics warehouse all want them. FanHook verifies the full Svix payload (id + timestamp + body, base64 HMAC) once and broadcasts the event everywhere.',
    intro2: 'Paste your Clerk <code>whsec_...</code> signing secret into a FanHook sink, point Clerk at the ingest URL, and stop maintaining six copies of the same Svix verifier across your codebase.',
    secretLabel: 'Clerk webhook signing secret (whsec_...)',
    setupSteps: [
      'Create a Clerk sink in your FanHook dashboard and paste the signing secret from your Clerk dashboard\'s Webhooks page.',
      'In Clerk → Webhooks, register a new endpoint pointed at the ingest URL below and select the user/org events you care about.',
      'Add fanout routes for your CRM, billing system, onboarding service, and analytics pipeline.',
    ],
    keywords: 'clerk webhook proxy, clerk webhook fanout, svix signature verification, svix-signature',
  },
};

router.get('/providers/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const page = PROVIDER_PAGES[slug];
  if (!page) {
    res.status(404).setHeader('Content-Type', 'text/html');
    return res.send(`${HEAD('FanHook — Provider not found')}<nav class="topnav">${FH_LOGO}</nav><main class="landing-main"><h1 class="hero-title">Provider not found</h1><p class="hero-sub">We don't have a landing page for <code>${escAttr(slug)}</code>. <a href="/">Back to home</a>.</p></main>${FOOTER}${THEME_SCRIPT}</body></html>`);
  }
  const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || 'fanhook.app').toString().split(',')[0].trim();
  const rawProto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
  // Defensive: only allow conservative URL-safe chars before rendering into HTML.
  const exampleHost = /^[A-Za-z0-9.\-:]+$/.test(rawHost) ? rawHost : 'fanhook.app';
  const exampleProto = /^https?$/.test(rawProto) ? rawProto : 'https';
  const ingestUrl = `${escAttr(exampleProto)}://${escAttr(exampleHost)}/ingest/&lt;your-sink-id&gt;`;
  const stepsHtml = page.setupSteps.map((s, i) =>
    `<div class="row-card" style="display:flex;gap:1rem;align-items:flex-start;">
       <div style="flex:0 0 2rem;height:2rem;border-radius:9999px;background:rgba(99,102,241,0.15);color:#6366f1;display:flex;align-items:center;justify-content:center;font-weight:700;">${i + 1}</div>
       <div style="flex:1;">${s}</div>
     </div>`
  ).join('');
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escAttr(page.headline)} — FanHook</title>
  <meta name="description" content="${escAttr(page.description)}" />
  <meta name="keywords" content="${escAttr(page.keywords)}" />
  <link rel="canonical" href="/providers/${escAttr(slug)}" />
  <link rel="stylesheet" href="/style.css" />
  ${THEME_INIT}
</head>
<body>
<nav class="topnav">
  ${FH_LOGO}
  <div class="topnav-actions">
    ${THEME_TOGGLE}
    <a href="/docs" class="topnav-link">Documentation</a>
    <a href="/login" class="topnav-link">Sign In</a>
    <a href="/signup" class="pill btn-primary">Get Started Free</a>
  </div>
</nav>

<main class="landing-main">
  <div class="live-pill"><span class="live-dot"></span><span>${escAttr(page.name)} ready</span></div>
  <h1 class="hero-title">${escAttr(page.headline)}</h1>
  <p class="hero-sub">${escAttr(page.description)}</p>

  <div class="hero-ctas">
    <a href="/signup" class="pill btn-primary">Start free with ${escAttr(page.name)} ${ICON.arrowR}</a>
    <a href="/docs" class="pill btn-ghost">${ICON.code} Read the docs</a>
  </div>

  <section style="max-width:760px;margin:3rem auto 0;text-align:left;">
    <p style="line-height:1.7;margin-bottom:1.25rem;">${page.intro1}</p>
    <p style="line-height:1.7;">${page.intro2}</p>
  </section>

  <section style="max-width:760px;margin:3rem auto 0;text-align:left;">
    <h2 style="font-family:var(--font-heading);font-weight:700;font-size:1.5rem;margin-bottom:1rem;">How it works</h2>
    <div style="display:flex;flex-direction:column;gap:0.75rem;">${stepsHtml}</div>
  </section>

  <section style="max-width:760px;margin:3rem auto 0;text-align:left;">
    <h2 style="font-family:var(--font-heading);font-weight:700;font-size:1.5rem;margin-bottom:1rem;">Ingest URL</h2>
    <div class="row-card" style="font-family:var(--font-mono);word-break:break-all;">POST ${ingestUrl}</div>
    <p class="text-secondary" style="margin-top:0.75rem;font-size:0.9rem;">Required header: <code>${escAttr(page.secretLabel)}</code> configured on your ${escAttr(page.name)} webhook. FanHook verifies the signature, stores the event, and fans out to every route you've configured.</p>
  </section>

  <section style="max-width:760px;margin:3rem auto 0;text-align:center;">
    <a href="/signup" class="pill btn-primary" style="display:inline-flex;">Create your ${escAttr(page.name)} sink ${ICON.arrowR}</a>
  </section>
</main>

${FOOTER}
${THEME_SCRIPT}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------- Session-authed sink endpoints (per-user, used by the dashboard) ----------
// Unlike /api/sinks (api-key-scoped, single-sink view), these expose the
// authenticated user's full sink set and allow creating additional sinks tied
// to the user.
router.get('/dashboard/api/sinks', auth.requireUser, (req, res) => {
  const sinks = db
    .prepare('SELECT * FROM sinks WHERE user_id = ? ORDER BY created_at ASC')
    .all(req.user.id);
  return res.json(sinks);
});

router.post('/dashboard/api/sinks', auth.requireUser, express.json(), auth.requireCsrf, (req, res) => {
  const { name, provider = 'generic', webhook_secret } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const VALID_PROVIDERS = ['stripe', 'github', 'shopify', 'linear', 'pagerduty', 'clerk', 'generic'];
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }
  const SECRET_REQUIRED = new Set(['stripe', 'github', 'shopify', 'linear', 'pagerduty', 'clerk']);
  if (SECRET_REQUIRED.has(provider) && !webhook_secret) {
    return res.status(400).json({ error: `webhook_secret is required for provider '${provider}'` });
  }
  const { v4: uuidv4 } = require('uuid');
  const { hashApiKey } = require('../lib/apikeys');
  const id = uuidv4();
  const apiKey = uuidv4();
  const now = new Date().toISOString();
  // Only the hash is persisted; the plaintext key is returned exactly once.
  db.prepare(`
    INSERT INTO sinks (id, name, provider, api_key, webhook_secret, created_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, String(name).trim(), provider, hashApiKey(apiKey), webhook_secret || null, now, req.user.id);
  const sink = db.prepare('SELECT * FROM sinks WHERE id = ?').get(id);
  return res.status(201).json({ ...sink, api_key: apiKey });
});

// ---------- Dashboard ----------
router.get('/dashboard', auth.requireUser, (req, res) => {
  // Look up the user's primary sink (auto-created at signup). Defensive
  // fallback in case it was deleted: create a fresh one on the fly.
  let sink = db.prepare(
    'SELECT * FROM sinks WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(req.user.id);

  if (!sink) {
    const { v4: uuidv4 } = require('uuid');
    const { hashApiKey } = require('../lib/apikeys');
    const sinkId = uuidv4();
    const apiKey = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO sinks (id, name, provider, api_key, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sinkId, 'My first sink', 'generic', hashApiKey(apiKey), now, req.user.id);
    sink = db.prepare('SELECT * FROM sinks WHERE id = ?').get(sinkId);
  }

  const userInitial = (req.user.email || '?').charAt(0).toUpperCase();
  const userEmailJs = auth.safeJsonForScript(req.user.email);
  const sinkIdJs = auth.safeJsonForScript(sink.id);
  const csrfToken = auth.ensureCsrfToken(req, res);

  const html = `${HEAD('FanHook — Dashboard')}
<div class="app-shell">
  <div id="sidebar-overlay" class="sidebar-overlay" onclick="closeSidebar()"></div>

  <aside id="sidebar" class="sidebar">
    <div class="sidebar-header">
      ${FH_LOGO}
      <button class="sidebar-close" onclick="closeSidebar()" aria-label="Close menu">${ICON.menu}</button>
    </div>
    <nav class="sidebar-nav">
      <button class="side-nav-link nav-sinks active" data-view="sinks" onclick="setView('sinks')">${ICON.webhook}<span>Sinks</span></button>
      <button class="side-nav-link nav-routes" data-view="routes" onclick="setView('routes')">${ICON.route}<span>Routes</span></button>
      <button class="side-nav-link nav-logs" data-view="logs" onclick="setView('logs')">${ICON.bar}<span>Logs</span></button>
    </nav>
    <div class="sidebar-footer">
      <button id="upgrade-side-btn" onclick="startCheckout(event)" class="pill btn-primary" style="width:100%;">Upgrade Pro</button>
    </div>
  </aside>

  <div class="app-main">
    <header class="app-header">
      <div style="display:flex;align-items:center;gap:1rem;">
        <button class="sidebar-toggle" onclick="openSidebar()" aria-label="Open menu">${ICON.menu}</button>
        <h1 id="app-title" class="app-header-title">Manage Sinks</h1>
      </div>
      <div class="app-header-actions">
        <span id="billing-badge" class="tier-pill" style="display:none;"></span>
        ${THEME_TOGGLE}
        <button class="bell-btn" aria-label="Notifications">${ICON.bell}<span class="bell-dot"></span></button>
        <div class="user-menu" style="position:relative;">
          <button id="user-menu-btn" class="avatar" aria-label="Account menu" onclick="toggleUserMenu(event)" style="cursor:pointer;border:none;padding:0;">
            <div style="font-family:var(--font-heading);font-weight:700;font-size:0.95rem;color:var(--text-primary);">${escAttr(userInitial)}</div>
          </button>
          <div id="user-menu-pop" style="display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:220px;background:var(--bg, #fff);border:1px solid var(--border, rgba(0,0,0,0.08));border-radius:14px;box-shadow:var(--shadow-md, 0 10px 30px rgba(0,0,0,0.12));padding:0.5rem;z-index:50;">
            <div style="padding:0.65rem 0.75rem 0.5rem;border-bottom:1px solid var(--border, rgba(0,0,0,0.08));margin-bottom:0.35rem;">
              <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);">Signed in as</div>
              <div style="font-family:var(--font-heading);font-weight:600;color:var(--text-primary);font-size:0.9rem;word-break:break-all;margin-top:0.2rem;">${escAttr(req.user.email)}</div>
            </div>
            <form method="POST" action="/logout" style="margin:0;">
              <input type="hidden" name="_csrf" value="${escAttr(csrfToken)}" />
              <button type="submit" style="display:block;width:100%;text-align:left;padding:0.55rem 0.75rem;border-radius:10px;font-size:0.9rem;font-weight:600;color:var(--text-primary);background:transparent;border:0;cursor:pointer;font-family:inherit;">Sign out</button>
            </form>
          </div>
        </div>
      </div>
    </header>

    <main class="app-content">

      <!-- Sinks View -->
      <section id="view-sinks" class="view-shell">
        <div class="view-header">
          <div>
            <h2>Incoming Webhooks</h2>
            <p class="sub">Create sinks to receive events from external platforms.</p>
          </div>
          <button class="pill btn-yellow" onclick="openCreateSink()">${ICON.plus} Create Sink</button>
        </div>
        <div id="sinks-loading" class="text-muted" style="padding:1rem;">Loading sinks&hellip;</div>
        <div id="sinks-list"></div>
      </section>

      <!-- Routes View -->
      <section id="view-routes" class="view-shell" style="display:none;">
        <div class="view-header">
          <div>
            <h2>Fanout Routes</h2>
            <p class="sub">Define where your incoming webhooks should be relayed to.</p>
          </div>
          <button class="pill btn-pink" onclick="document.getElementById('new-route-url').focus()">${ICON.plus} Add Route</button>
        </div>

        <div id="routes-loading" class="text-muted" style="padding:1rem;">Loading routes&hellip;</div>
        <div id="routes-list"></div>

        <div class="add-route-form">
          <div class="field">
            <label>New route URL</label>
            <input type="url" id="new-route-url" placeholder="https://example.com/webhook" />
          </div>
          <button class="pill btn-pink" onclick="addRoute()">${ICON.plus} Add Route</button>
        </div>
        <p id="route-msg" style="display:none;font-size:0.9rem;margin:0.75rem 1rem 0;"></p>

        <div id="onboarding" class="onboarding" style="display:none;margin-top:2rem;">
          <h2>&#128640; Getting started</h2>
          <ol>
            <li><span id="step1" style="color:var(--green);font-weight:700;">Sink created</span> &mdash; your ingest URL is on the Sinks tab.</li>
            <li id="step2-item">Add at least one <strong>route</strong> (a destination URL) above.</li>
            <li>Point Stripe or GitHub at your ingest URL: <code id="ingest-url-hint"></code></li>
            <li>Send a test webhook and check the Logs tab.</li>
          </ol>
        </div>
      </section>

      <!-- Logs View -->
      <section id="view-logs" class="view-shell" style="display:none;">
        <div class="view-header">
          <div>
            <h2>Activity Logs</h2>
            <p class="sub">Real-time webhook ingestion and fanout delivery logs.</p>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <select id="sink-selector" style="display:none;font-size:0.85rem;padding:0.4rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text-primary);cursor:pointer;" onchange="selectSink(this.value)"></select>
            <button class="pill btn-ghost" onclick="loadEvents()">${ICON.filter} Filter Logs</button>
          </div>
        </div>

        <div id="stats-section" class="stats-grid" style="display:none;">
          <div class="stat-card"><div class="stat-label">Tier</div><div class="stat-value" id="stat-tier">&mdash;</div></div>
          <div class="stat-card"><div class="stat-label">Events Used</div><div class="stat-value" id="stat-events">&mdash;</div></div>
          <div class="stat-card"><div class="stat-label">Monthly Limit</div><div class="stat-value" id="stat-limit">&mdash;</div></div>
          <div class="stat-card"><div class="stat-label">Usage</div><div class="stat-value" id="stat-pct">&mdash;</div></div>
        </div>

        <div id="usage-section" class="usage-card" style="display:none;">
          <div class="usage-card-header">
            <div>
              <div class="stat-label">Events this month</div>
              <div id="usage-text" style="font-family:var(--font-heading);font-weight:700;font-size:1.25rem;color:var(--text-primary);margin-top:0.25rem;"></div>
            </div>
            <div id="upgrade-cta" style="display:none;">
              <a id="upgrade-btn" href="#upgrade" onclick="startCheckout(event)" class="pill btn-indigo" style="font-size:0.9rem;">
                Upgrade to Starter &mdash; $9/mo
              </a>
            </div>
          </div>
          <div class="usage-bar-track">
            <div id="usage-bar" class="usage-bar-fill" style="width:0%;"></div>
          </div>
          <p id="usage-limit-msg" style="display:none;color:var(--red);margin:0.75rem 0 0;font-size:0.85rem;font-weight:600;">
            Monthly limit reached. Upgrade to Starter to continue receiving events.
          </p>
        </div>

        <div id="events-loading" class="text-muted" style="padding:1rem;">Loading events&hellip;</div>
        <div class="logs-table-wrap" id="events-table" style="display:none;">
          <table class="logs-table">
            <thead>
              <tr>
                <th style="width:90px;text-align:center;">Status</th>
                <th>Event ID</th>
                <th style="text-align:center;">Attempts</th>
                <th style="text-align:right;">Received</th>
              </tr>
            </thead>
            <tbody id="events-body"></tbody>
          </table>
        </div>

        <div id="dlq-section" class="dlq-section" style="display:none;">
          <div class="view-header" style="border-bottom:none;padding-bottom:0;">
            <div>
              <h2>Dead Letter Queue <span id="dlq-count-badge" class="dlq-badge" style="display:none;"></span></h2>
              <p class="sub">Events that exhausted all delivery attempts. Fix the downstream issue, then click <strong>Redrive</strong> to retry.</p>
            </div>
          </div>
          <div class="logs-table-wrap">
            <table class="logs-table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Provider</th>
                  <th>Failed At</th>
                  <th style="text-align:center;">Attempts</th>
                  <th style="text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody id="dlq-body"></tbody>
            </table>
          </div>
          <p id="dlq-msg" style="display:none;font-size:0.9rem;margin:0.75rem 1rem 0;"></p>
        </div>
      </section>
    </main>
  </div>
</div>

${THEME_SCRIPT}
<script>
  // ---- SVG icons reused in JS-rendered rows ----
  var SVG = {
    check:    \`${ICON.check}\`,
    x:        \`${ICON.x}\`,
    refresh:  \`${ICON.refresh}\`,
    clock:    \`${ICON.clock}\`,
    copy:     \`${ICON.copy}\`,
    trash:    \`${ICON.trash}\`,
    settings: \`${ICON.settings}\`,
    checkC:   \`${ICON.checkC}\`,
    pause:    \`${ICON.pause}\`,
    arrowR:   \`${ICON.arrowR}\`,
    activity: \`${ICON.activity}\`
  };

  var TITLE_MAP = { sinks: 'Manage Sinks', routes: 'Routing Rules', logs: 'Activity Logs' };

  function setView(view) {
    ['sinks','routes','logs'].forEach(function(v){
      var el = document.getElementById('view-'+v);
      if (el) el.style.display = (v===view) ? '' : 'none';
      var btn = document.querySelector('.side-nav-link[data-view="'+v+'"]');
      if (btn) btn.classList.toggle('active', v===view);
    });
    var t = document.getElementById('app-title');
    if (t) t.textContent = TITLE_MAP[view] || 'Dashboard';
    closeSidebar();
  }

  function openSidebar(){
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  }
  function closeSidebar(){
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }

  function copyText(text, btn){
    try {
      navigator.clipboard.writeText(text);
      var orig = btn.innerHTML;
      btn.innerHTML = SVG.check;
      setTimeout(function(){ btn.innerHTML = orig; }, 1200);
    } catch(e) {}
  }

  // Hash-based deep linking (e.g. #upgrade scrolls to logs view)
  if (window.location.hash === '#upgrade') {
    setTimeout(function(){ setView('logs'); }, 100);
  }

  let SINK_ID = ${sinkIdJs};
  let selectedSinkId = SINK_ID;
  const USER_EMAIL = ${userEmailJs};
  const CSRF_TOKEN = ${auth.safeJsonForScript(csrfToken)};
  // API calls authenticate via the session cookie (sent automatically on
  // same-origin fetches); mutating requests also carry the CSRF token.
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN };
  let currentSinks = [];
  let activeSseConnections = [];

  function toggleUserMenu(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var pop = document.getElementById('user-menu-pop');
    if (!pop) return;
    pop.style.display = pop.style.display === 'block' ? 'none' : 'block';
  }
  document.addEventListener('click', function(e){
    var pop = document.getElementById('user-menu-pop');
    var btn = document.getElementById('user-menu-btn');
    if (!pop || !btn) return;
    if (pop.contains(e.target) || btn.contains(e.target)) return;
    pop.style.display = 'none';
  });

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  let currentRouteCount = 0;
  // Stores the latest attempt details per event for the click-to-expand detail row.
  // Populated by loadEvents() on initial load and updated live by handleStatusUpdate().
  const attemptCache = {};

  function statusBadge(status) {
    if (status === 'delivered') return '<span class="badge-delivered" title="delivered">' + SVG.check + '</span>';
    if (status === 'failed')    return '<span class="badge-failed" title="failed">'    + SVG.x     + '</span>';
    return '<span class="badge-pending" title="pending">' + SVG.refresh + '</span>';
  }

  function tierBadge(tier) {
    var cls = tier === 'starter' ? 'tier-pill starter' : 'tier-pill free';
    return '<span class="' + cls + '">' + esc(tier) + '</span>';
  }

  async function loadBilling() {
    try {
      const res = await fetch('/api/billing/status', { headers });
      if (!res.ok) return;
      const data = await res.json();

      const badge = document.getElementById('billing-badge');
      badge.className = 'tier-pill ' + (data.tier === 'starter' ? 'starter' : 'free');
      badge.textContent = data.tier.toUpperCase();
      badge.style.display = 'inline-flex';

      document.getElementById('stats-section').style.display = 'grid';
      document.getElementById('stat-tier').textContent = data.tier.charAt(0).toUpperCase() + data.tier.slice(1);
      document.getElementById('stat-events').textContent = data.events_this_month.toLocaleString();
      document.getElementById('stat-limit').textContent = data.events_limit.toLocaleString();
      document.getElementById('stat-pct').textContent = data.usage_pct + '%';

      document.getElementById('usage-section').style.display = 'block';
      document.getElementById('usage-text').textContent =
        data.events_this_month.toLocaleString() + ' / ' + data.events_limit.toLocaleString();

      const bar = document.getElementById('usage-bar');
      bar.style.width = data.usage_pct + '%';
      if (data.usage_pct >= 90) {
        bar.style.background = 'linear-gradient(90deg, #EF4444, #F87171)';
      }
      if (data.usage_pct >= 100) {
        document.getElementById('usage-limit-msg').style.display = 'block';
      }
      if (data.tier === 'free') {
        document.getElementById('upgrade-cta').style.display = 'block';
      } else {
        var sideBtn = document.getElementById('upgrade-side-btn');
        if (sideBtn) sideBtn.style.display = 'none';
      }
    } catch (_) {}
  }

  async function startCheckout(e) {
    if (e && e.preventDefault) e.preventDefault();
    const btn = document.getElementById('upgrade-btn') || document.getElementById('upgrade-side-btn');
    if (btn) { btn.textContent = 'Redirecting\\u2026'; btn.style.opacity = '.6'; }
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (btn) {
        btn.textContent = data.error || 'Error \\u2014 try again';
        btn.style.opacity = '1';
      }
    } catch (err) {
      if (btn) { btn.textContent = 'Error \\u2014 try again'; btn.style.opacity = '1'; }
    }
  }

  function sinkCardHtml(s) {
    var ingestUrl = window.location.origin + '/ingest/' + s.id;
    var isActive = (s.tier === 'starter' || s.tier === 'free' || !s.tier);
    return '<div class="row-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">' +
        '<div class="sink-status-icon">' + SVG.checkC + '</div>' +
        '<div class="route-actions"><button class="icon-action danger" title="Delete sink (disabled in demo)" disabled>' + SVG.trash + '</button></div>' +
      '</div>' +
      '<div style="margin-top:1.25rem;">' +
        '<h3 style="font-family:var(--font-heading);font-weight:700;font-size:1.5rem;color:var(--text-primary);">' + esc(s.name) + '</h3>' +
        '<p style="color:var(--text-muted);font-weight:600;font-size:0.85rem;margin-top:0.25rem;">' +
          'Created ' + esc(s.created_at) + ' &middot; Provider: <strong style="color:var(--text-secondary);">' + esc(s.provider) + '</strong> ' + tierBadge(s.tier || 'free') +
        '</p>' +
      '</div>' +
      '<div style="margin-top:1.25rem;">' +
        '<label style="display:block;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.5rem;margin-left:0.75rem;">Ingest endpoint URL</label>' +
        '<div class="endpoint-row">' +
          '<input id="ingest-input-' + esc(s.id) + '" readonly value="' + esc(ingestUrl) + '" />' +
          '<button class="copy-btn" title="Copy" onclick="copyText(\\'' + esc(ingestUrl) + '\\', this)">' + SVG.copy + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  async function loadSinks() {
    try {
      // Use session-scoped endpoint so we see ALL sinks for this user, not
      // just the one bound to a single api_key.
      const res = await fetch('/dashboard/api/sinks');
      const sinks = await res.json();
      currentSinks = Array.isArray(sinks) ? sinks : [];
      if (currentSinks.length > 0) {
        SINK_ID = currentSinks[0].id;
        selectedSinkId = currentSinks[0].id;
      }
      const list = document.getElementById('sinks-list');
      list.innerHTML = currentSinks.map(sinkCardHtml).join('');
      document.getElementById('sinks-loading').style.display = 'none';

      // Populate the sink selector dropdown in the Logs view
      var selector = document.getElementById('sink-selector');
      if (selector) {
        selector.innerHTML = currentSinks.map(function(s) {
          return '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>';
        }).join('');
        selector.value = selectedSinkId;
        selector.style.display = currentSinks.length > 1 ? '' : 'none';
      }

      connectSSE();
    } catch (e) {
      document.getElementById('sinks-loading').textContent = 'Failed to load sinks.';
      connectSSE();
    }
  }

  function selectSink(sinkId) {
    selectedSinkId = sinkId;
    loadEvents();
    loadDLQ();
  }

  function routeRowHtml(r) {
    return '<div id="route-' + esc(r.id) + '" class="row-card" style="flex-direction:row;align-items:center;justify-content:space-between;gap:1.5rem;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:240px;">' +
        '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">' +
          '<span class="tag tag-method">POST</span>' +
          '<span class="tag tag-active">active</span>' +
        '</div>' +
        '<div class="route-name">' + esc(r.url.replace(/^https?:\\/\\//,'').split('/')[0]) + '</div>' +
        '<div class="route-url">' + esc(r.url) + '</div>' +
        '<div class="text-muted" style="font-size:0.75rem;margin-top:0.4rem;font-family:var(--font-mono);">' + esc(r.id) + '</div>' +
      '</div>' +
      '<div class="route-actions">' +
        '<button class="icon-action" title="Configure (disabled in demo)" disabled>' + SVG.settings + '</button>' +
        '<button class="icon-action danger" title="Delete route" onclick="deleteRoute(\\'' + esc(r.id) + '\\')">' + SVG.trash + '</button>' +
      '</div>' +
    '</div>';
  }

  async function loadRoutes() {
    try {
      const res = await fetch('/api/sinks/' + SINK_ID + '/routes', { headers });
      let routes = [];
      if (res.ok) {
        const data = await res.json();
        routes = Array.isArray(data) ? data : (data.routes || []);
      }
      currentRouteCount = routes.length;
      const list = document.getElementById('routes-list');
      if (routes.length === 0) {
        list.innerHTML = '<div class="row-card text-muted" style="padding:1.5rem 1rem;">No routes yet. Add your first destination below.</div>';
      } else {
        list.innerHTML = routes.map(routeRowHtml).join('');
      }
      document.getElementById('routes-loading').style.display = 'none';
      document.getElementById('ingest-url-hint').textContent =
        window.location.origin + '/ingest/' + SINK_ID;
    } catch (e) {
      // Endpoint may not list routes — fall back to placeholder
      document.getElementById('routes-loading').style.display = 'none';
      document.getElementById('routes-list').innerHTML =
        '<div class="row-card text-muted" style="padding:1.5rem 1rem;">Use the form below to add routes. Route IDs are returned on creation.</div>';
      document.getElementById('ingest-url-hint').textContent =
        window.location.origin + '/ingest/' + SINK_ID;
    }
  }

  async function openCreateSink() {
    const name = window.prompt('Sink name:', 'My new sink');
    if (!name || !name.trim()) return;
    const provider = (window.prompt('Provider (generic | stripe | github | shopify | linear | pagerduty | clerk):', 'generic') || 'generic').trim();
    const body = { name: name.trim(), provider };
    if (['stripe','github','shopify','linear','pagerduty','clerk'].indexOf(provider) !== -1) {
      const secret = window.prompt('Webhook secret (required for ' + provider + '):', '');
      if (!secret) { alert('Webhook secret is required for ' + provider); return; }
      body.webhook_secret = secret;
    }
    try {
      const res = await fetch('/dashboard/api/sinks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF_TOKEN },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { alert('Error: ' + (data.error || 'Unknown')); return; }
      // Refresh list and surface the new key
      await loadSinks();
      alert('Sink created!\\nName: ' + data.name + '\\nAPI key: ' + data.api_key);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function addRoute() {
    const url = document.getElementById('new-route-url').value.trim();
    const msgEl = document.getElementById('route-msg');
    if (!url) {
      msgEl.textContent = 'URL is required';
      msgEl.style.color = 'var(--red)';
      msgEl.style.display = 'block';
      return;
    }
    try {
      const res = await fetch('/api/sinks/' + SINK_ID + '/routes', {
        method: 'POST', headers, body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (res.ok) {
        msgEl.textContent = 'Route added! ID: ' + data.id;
        msgEl.style.color = 'var(--green)';
        msgEl.style.display = 'block';
        document.getElementById('new-route-url').value = '';
        currentRouteCount++;
        if (currentRouteCount >= 1) {
          const s2 = document.getElementById('step2-item');
          if (s2) s2.style.opacity = '.5';
        }
        const list = document.getElementById('routes-list');
        // Remove any "no routes" placeholder
        if (list.querySelector('.text-muted')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', routeRowHtml(data));
      } else {
        msgEl.textContent = 'Error: ' + (data.error || 'Unknown');
        msgEl.style.color = 'var(--red)';
        msgEl.style.display = 'block';
      }
    } catch (e) {
      msgEl.textContent = 'Error: ' + e.message;
      msgEl.style.color = 'var(--red)';
      msgEl.style.display = 'block';
    }
  }

  async function deleteRoute(routeId) {
    try {
      const res = await fetch('/api/sinks/' + SINK_ID + '/routes/' + routeId, {
        method: 'DELETE', headers
      });
      if (res.status === 204) {
        const el = document.getElementById('route-' + routeId);
        if (el) el.remove();
        currentRouteCount = Math.max(0, currentRouteCount - 1);
      }
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  function eventRowHtml(e) {
    var attempts = e.delivery_attempts ? e.delivery_attempts.length : 0;
    return '<tr id="event-row-' + esc(e.id) + '" class="event-row" title="Click to toggle attempt details" onclick="toggleDetail(\\'' + esc(e.id) + '\\',this)">' +
      '<td style="text-align:center;">' + statusBadge(e.status) + '</td>' +
      '<td class="id-cell"><code>' + esc(e.id) + '</code></td>' +
      '<td class="attempts-cell" style="text-align:center;">' + attempts + '</td>' +
      '<td style="text-align:right;"><span class="time-pill">' + SVG.clock + esc(e.received_at) + '</span></td>' +
      '</tr>';
  }

  async function loadEvents() {
    try {
      const res = await fetch('/api/sinks/' + selectedSinkId + '/events', { headers });
      const events = await res.json();
      const tbody = document.getElementById('events-body');
      // Pre-populate attemptCache so click-to-expand works immediately
      events.forEach(function (e) {
        if (e.delivery_attempts && e.delivery_attempts.length > 0) {
          attemptCache[e.id] = e.delivery_attempts.map(function (a) {
            return {
              route_id: a.route_id || null,
              http_status: a.http_status || null,
              attempt_number: a.attempt_number || 1,
              error_message: a.http_status && a.http_status >= 400
                ? 'HTTP ' + a.http_status
                : (a.status === 'failed' ? 'Delivery failed' : null),
            };
          });
        }
      });
      tbody.innerHTML = events.map(eventRowHtml).join('');
      document.getElementById('events-loading').style.display = 'none';
      document.getElementById('events-table').style.display = 'block';

      if (currentRouteCount === 0) {
        document.getElementById('onboarding').style.display = 'block';
      }
    } catch (e) {
      document.getElementById('events-loading').textContent = 'Failed to load events.';
    }
  }

  // ---- Live event updates via Server-Sent Events ----
  let ssePollingInterval = null;

  function connectSSE() {
    // Close any previously open connections before (re-)connecting
    activeSseConnections.forEach(function (es) {
      try { es.close(); } catch (_) {}
    });
    activeSseConnections = [];

    // Build the list of sinks to subscribe to. Fall back to the hardcoded
    // demo sink when loadSinks() hasn't resolved yet or returned nothing.
    var sinksToConnect = currentSinks.length > 0
      ? currentSinks
      : [{ id: SINK_ID }];

    sinksToConnect.forEach(function (sink) {
      // Session-cookie auth: browsers send cookies with same-origin
      // EventSource requests automatically, so no key is needed (and
      // query-string keys are rejected by the server).
      var es = new EventSource('/api/sinks/' + sink.id + '/stream');

      es.onmessage = function (event) {
        if (ssePollingInterval) {
          clearInterval(ssePollingInterval);
          ssePollingInterval = null;
        }
        try { handleStatusUpdate(JSON.parse(event.data)); } catch (_) {}
      };

      es.onerror = function () {
        if (!ssePollingInterval) {
          ssePollingInterval = setInterval(loadEvents, 10000);
        }
      };

      activeSseConnections.push(es);
    });
  }

  function handleStatusUpdate(data) {
    const tbody = document.getElementById('events-body');
    if (!tbody) return;

    // When a sink_id is present in the SSE payload, only apply DOM updates to the
    // currently-viewed sink's log table. Updates for background sinks are silently
    // discarded; the table will refresh when the user switches sinks.
    if (data.sink_id && data.sink_id !== selectedSinkId) return;

    if (data.attempts && data.attempts.length > 0) {
      attemptCache[data.event_id] = data.attempts;
    } else if (data.attempt_number != null) {
      attemptCache[data.event_id] = [{
        route_id: null,
        http_status: data.http_status,
        attempt_number: data.attempt_number,
        error_message: data.error_message,
      }];
    }

    const existingRow = document.getElementById('event-row-' + data.event_id);
    if (existingRow) {
      // Swap the status badge in place
      const badgeEl = existingRow.querySelector(
        '.badge-delivered, .badge-failed, .badge-pending'
      );
      if (badgeEl) badgeEl.outerHTML = statusBadge(data.status);

      // Update attempt count cell (3rd <td>)
      if (data.attempt_number != null) {
        const cell = existingRow.querySelector('.attempts-cell');
        if (cell) cell.textContent = data.attempt_number;
      }

      // If the detail row is currently open, refresh it too
      const detailRow = document.getElementById('detail-row-' + data.event_id);
      if (detailRow) {
        detailRow.querySelector('td').innerHTML = buildDetailHtml(data.event_id);
      }
    } else if (data.status === 'pending') {
      const tr = document.createElement('tr');
      tr.id = 'event-row-' + data.event_id;
      tr.className = 'event-row';
      tr.title = 'Click to toggle attempt details';
      tr.onclick = function () { toggleDetail(data.event_id, this); };
      tr.innerHTML =
        '<td style="text-align:center;">' + statusBadge(data.status) + '</td>' +
        '<td class="id-cell"><code>' + esc(data.event_id) + '</code></td>' +
        '<td class="attempts-cell" style="text-align:center;">0</td>' +
        '<td style="text-align:right;"><span class="time-pill">' + SVG.clock +
          esc(data.received_at || new Date().toISOString()) + '</span></td>';
      document.getElementById('events-loading').style.display = 'none';
      document.getElementById('events-table').style.display = 'block';
      if (tbody.firstChild) {
        tbody.insertBefore(tr, tbody.firstChild);
      } else {
        tbody.appendChild(tr);
      }
      incrementUsage();
    }
  }

  function buildDetailHtml(eventId) {
    const attempts = attemptCache[eventId];
    if (!attempts || attempts.length === 0) {
      return '<em class="text-muted" style="font-size:0.82rem;">No attempt details available yet.</em>';
    }
    return attempts.map(function (a) {
      const okStatus = a.http_status && a.http_status < 300;
      const httpLabel = a.http_status ? 'HTTP ' + a.http_status : 'No response';
      const httpClass = okStatus ? 'att-status ok' : (a.http_status ? 'att-status bad' : 'att-status');
      const errLabel  = a.error_message ? '<span class="att-err">&mdash; ' + esc(a.error_message) + '</span>' : '';
      const routeLabel = a.route_id ? '<span>Route: <code>' + esc(a.route_id) + '</code></span>' : '';
      return '<div class="attempt-line">' +
        '<span class="att-num">Attempt ' + a.attempt_number + '</span>' +
        '<span class="' + httpClass + '">' + httpLabel + '</span>' +
        errLabel +
        routeLabel +
        '</div>';
    }).join('');
  }

  function toggleDetail(eventId, row) {
    const existing = document.getElementById('detail-row-' + eventId);
    if (existing) {
      existing.remove();
      return;
    }
    const detailRow = document.createElement('tr');
    detailRow.id = 'detail-row-' + eventId;
    detailRow.className = 'event-detail-row';
    detailRow.innerHTML = '<td colspan="4">' + buildDetailHtml(eventId) + '</td>';
    if (row.nextSibling) {
      row.parentNode.insertBefore(detailRow, row.nextSibling);
    } else {
      row.parentNode.appendChild(detailRow);
    }
  }

  function incrementUsage() {
    const eventsEl = document.getElementById('stat-events');
    const limitEl  = document.getElementById('stat-limit');
    if (!eventsEl || eventsEl.textContent === '\u2014' || eventsEl.textContent === '—') return;
    const used  = (parseInt(eventsEl.textContent.replace(/,/g, ''), 10) || 0) + 1;
    const limit = parseInt((limitEl ? limitEl.textContent : '1000').replace(/,/g, ''), 10) || 1000;
    const pct   = Math.min(100, Math.round((used / limit) * 100));
    eventsEl.textContent = used.toLocaleString();
    const pctEl = document.getElementById('stat-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const bar = document.getElementById('usage-bar');
    if (bar) bar.style.width = pct + '%';
    const usageText = document.getElementById('usage-text');
    if (usageText) usageText.textContent = used.toLocaleString() + ' / ' + limit.toLocaleString();
  }
  // ---- end SSE ----

  async function loadDLQ() {
    try {
      const res = await fetch('/api/sinks/' + selectedSinkId + '/dlq', { headers });
      if (!res.ok) return;
      const entries = await res.json();
      if (!entries || entries.length === 0) return;

      const badge = document.getElementById('dlq-count-badge');
      badge.textContent = entries.length;
      badge.style.display = 'inline-flex';

      const tbody = document.getElementById('dlq-body');
      tbody.innerHTML = entries.map(e =>
        '<tr id="dlq-row-' + esc(e.event_id) + '">' +
        '<td class="id-cell"><code>' + esc(e.event_id) + '</code></td>' +
        '<td class="text-muted">' + esc(e.provider || 'generic') + '</td>' +
        '<td class="text-muted" style="font-size:0.82rem;">' + esc(e.failed_at) + '</td>' +
        '<td style="text-align:center;color:var(--red);font-weight:700;">' + esc(e.attempt_count) + '</td>' +
        '<td style="text-align:right;"><button id="redrive-btn-' + esc(e.event_id) + '" class="pill btn-ghost" style="font-size:0.8rem;padding:0.5rem 1rem;color:var(--red);" onclick="redrive(\\'' + esc(e.event_id) + '\\')">Redrive</button></td>' +
        '</tr>'
      ).join('');

      document.getElementById('dlq-section').style.display = 'block';
    } catch (_) {}
  }

  async function redrive(eventId) {
    const btn = document.getElementById('redrive-btn-' + eventId);
    if (btn) { btn.textContent = 'Redriving\u2026'; btn.disabled = true; btn.style.opacity = '.6'; }
    const msgEl = document.getElementById('dlq-msg');
    try {
      const res = await fetch(
        '/api/sinks/' + selectedSinkId + '/dlq/' + eventId + '/redrive',
        { method: 'POST', headers }
      );
      const data = await res.json();
      if (res.ok && data.redriven) {
        const row = document.getElementById('dlq-row-' + eventId);
        if (row) row.remove();
        const badge = document.getElementById('dlq-count-badge');
        const remaining = document.querySelectorAll('#dlq-body tr').length;
        if (remaining === 0) {
          document.getElementById('dlq-section').style.display = 'none';
        } else {
          badge.textContent = remaining;
        }
        msgEl.textContent = 'Redriven! New event ID: ' + data.new_event_id + '. Refreshing event log\u2026';
        msgEl.style.color = 'var(--green)';
        msgEl.style.display = 'block';
        setTimeout(() => { loadEvents(); }, 800);
      } else {
        if (btn) { btn.textContent = 'Redrive'; btn.disabled = false; btn.style.opacity = '1'; }
        msgEl.textContent = 'Error: ' + (data.error || 'Unknown error');
        msgEl.style.color = 'var(--red)';
        msgEl.style.display = 'block';
      }
    } catch (err) {
      if (btn) { btn.textContent = 'Redrive'; btn.disabled = false; btn.style.opacity = '1'; }
      msgEl.textContent = 'Error: ' + err.message;
      msgEl.style.color = 'var(--red)';
      msgEl.style.display = 'block';
    }
  }

  loadBilling();
  loadSinks();
  loadRoutes();
  loadEvents();
  loadDLQ();
</script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
