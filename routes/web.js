const express = require('express');
const path = require('path');

const router = express.Router();

const NAV = `
<nav class="nav">
  <a href="/" class="nav-brand">FanHook</a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/docs">API Docs</a>
  </div>
</nav>`;

const HEAD = (title) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>`;

const FOOTER = `<footer class="footer">FanHook — Built for indie developers &amp; small teams</footer>`;

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'openapi.json'));
});

router.get('/docs', (req, res) => {
  const html = `${HEAD('FanHook API Docs')}
${NAV}
<div class="docs-layout">

  <aside class="docs-sidebar">
    <div class="docs-sidebar-title">Navigation</div>
    <a href="#sinks" class="docs-sidebar-link">Sinks</a>
    <a href="#routes" class="docs-sidebar-link">Routes</a>
    <a href="#billing" class="docs-sidebar-link">Billing</a>
    <a href="#ingest" class="docs-sidebar-link">Ingest</a>
    <a href="#response-codes" class="docs-sidebar-link">Response Codes</a>
  </aside>

  <main class="docs-main">

    <div class="fade-in" style="margin-top:0.5rem;">
      <div class="section-label">Reference</div>
      <h1 class="section-title">API Documentation</h1>
      <p style="color:var(--text-secondary);max-width:560px;margin-bottom:2.5rem;">
        Management endpoints live under <code>/api</code> (Bearer auth). Ingest endpoints live under <code>/ingest</code> (signature-verified).
      </p>
    </div>

    <details id="sinks" class="docs-details fade-in fade-in-d1" open>
      <summary class="endpoint-group-title">
        <span class="docs-chevron">&#9656;</span> Sinks
      </summary>
      <div class="endpoint-card">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/api/sinks <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Create a new sink. Body: <code>{"name":"...","provider":"stripe|github|generic"}</code></div>
        </div>
      </div>
      <div class="endpoint-card">
        <div><span class="method method-get">GET</span></div>
        <div>
          <div class="endpoint-path">/api/sinks <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">List sinks for the authenticated API key.</div>
        </div>
      </div>
      <div class="endpoint-card">
        <div><span class="method method-get">GET</span></div>
        <div>
          <div class="endpoint-path">/api/sinks/:id/events <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Last 50 events with delivery attempts.</div>
        </div>
      </div>
    </details>

    <details id="routes" class="docs-details fade-in fade-in-d2" open>
      <summary class="endpoint-group-title">
        <span class="docs-chevron">&#9656;</span> Routes
      </summary>
      <div class="endpoint-card">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/api/sinks/:id/routes <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Add a destination URL. Body: <code>{"url":"https://..."}</code></div>
        </div>
      </div>
      <div class="endpoint-card">
        <div><span class="method method-delete">DELETE</span></div>
        <div>
          <div class="endpoint-path">/api/sinks/:id/routes/:routeId <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Remove a route. Returns 204.</div>
        </div>
      </div>
    </details>

    <details id="billing" class="docs-details fade-in fade-in-d3" open>
      <summary class="endpoint-group-title">
        <span class="docs-chevron">&#9656;</span> Billing
      </summary>
      <div class="endpoint-card">
        <div><span class="method method-get">GET</span></div>
        <div>
          <div class="endpoint-path">/api/billing/status <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Current tier, events used this month, and limit.</div>
        </div>
      </div>
      <div class="endpoint-card">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/api/billing/checkout <span class="endpoint-auth">Bearer</span></div>
          <div class="endpoint-desc">Create a Stripe Checkout session to upgrade to Starter ($9/mo). Returns <code>{"url":"..."}</code>.</div>
        </div>
      </div>
    </details>

    <details id="ingest" class="docs-details fade-in fade-in-d4" open>
      <summary class="endpoint-group-title">
        <span class="docs-chevron">&#9656;</span> Ingest
      </summary>
      <div class="endpoint-card">
        <div><span class="method method-post">POST</span></div>
        <div>
          <div class="endpoint-path">/ingest/:sinkId <span class="endpoint-auth">Signature</span></div>
          <div class="endpoint-desc">Receive a webhook. FanHook verifies the provider signature and fans out to all routes. Returns <code>429</code> when monthly limit is reached.</div>
        </div>
      </div>
    </details>

    <details id="response-codes" class="docs-details fade-in fade-in-d4" open>
      <summary class="endpoint-group-title">
        <span class="docs-chevron">&#9656;</span> Response Codes
      </summary>
      <div class="response-codes">
        <div class="response-code"><span class="code-num code-2xx">200</span> <span style="color:var(--text-secondary)">OK</span></div>
        <div class="response-code"><span class="code-num code-2xx">201</span> <span style="color:var(--text-secondary)">Created</span></div>
        <div class="response-code"><span class="code-num code-2xx">204</span> <span style="color:var(--text-secondary)">No Content</span></div>
        <div class="response-code"><span class="code-num code-4xx">400</span> <span style="color:var(--text-secondary)">Bad Request</span></div>
        <div class="response-code"><span class="code-num code-4xx">401</span> <span style="color:var(--text-secondary)">Unauthorized</span></div>
        <div class="response-code"><span class="code-num code-4xx">403</span> <span style="color:var(--text-secondary)">Forbidden</span></div>
        <div class="response-code"><span class="code-num code-4xx">404</span> <span style="color:var(--text-secondary)">Not Found</span></div>
        <div class="response-code"><span class="code-num code-4xx">429</span> <span style="color:var(--text-secondary)">Rate Limited</span></div>
      </div>
    </details>

  </main>
</div>
${FOOTER}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/', (req, res) => {
  const html = `${HEAD('FanHook — Affordable Webhook Fanout')}
${NAV}

<div class="container">

  <section class="hero fade-in">
    <h1>Webhook fanout that<br>doesn't cost $490/mo.</h1>
    <p>
      One webhook in. Many destinations out. Stripe &amp; GitHub signature verification,
      automatic retries, and a real-time event log — starting free.
    </p>
    <div class="hero-buttons">
      <a href="/dashboard" class="btn btn-primary">Open Dashboard</a>
      <a href="/docs" class="btn btn-secondary">API Docs</a>
    </div>
  </section>

  <section class="fade-in fade-in-d1" style="margin-bottom:4rem;">
    <div style="text-align:center;margin-bottom:2.5rem;">
      <div class="section-label">Workflow</div>
      <div class="section-title">How it works</div>
    </div>

    <div class="timeline">
      <div class="timeline-step">
        <div class="timeline-dot">1</div>
        <div class="timeline-content">
          <h3>Create a sink</h3>
          <p>POST to <code>/api/sinks</code> and get a unique ingest URL + API key in seconds.</p>
        </div>
      </div>
      <div class="timeline-step">
        <div class="timeline-dot">2</div>
        <div class="timeline-content">
          <h3>Point your provider</h3>
          <p>Set the ingest URL as your Stripe or GitHub webhook endpoint. Zero config changes needed.</p>
        </div>
      </div>
      <div class="timeline-step">
        <div class="timeline-dot">3</div>
        <div class="timeline-content">
          <h3>FanHook verifies &amp; fans out</h3>
          <p>Every incoming webhook is signature-verified, then forwarded in parallel to all your configured routes.</p>
        </div>
      </div>
      <div class="timeline-step">
        <div class="timeline-dot">4</div>
        <div class="timeline-content">
          <h3>Auto-retry on failure</h3>
          <p>Failed deliveries are retried up to 3 times with linear backoff. Inspect results in the event log.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="compare-section fade-in fade-in-d2">
    <div class="section-label" style="margin-bottom:0.75rem;">Comparison</div>
    <h2 class="section-title" style="font-size:1.5rem;margin-bottom:1.25rem;">Why not Svix or Hookdeck?</h2>
    <table>
      <thead>
        <tr>
          <th>Service</th>
          <th>Starting price</th>
          <th>Fanout included</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="color:var(--text-secondary);">Svix</td>
          <td style="color:var(--red);font-weight:600;">$490/mo</td>
          <td style="color:var(--text-muted);">Yes</td>
        </tr>
        <tr>
          <td style="color:var(--text-secondary);">Hookdeck</td>
          <td style="color:var(--yellow);font-weight:600;">$15/mo</td>
          <td style="color:var(--text-muted);">Limited</td>
        </tr>
        <tr class="compare-winner">
          <td style="color:var(--accent-bright);">FanHook &#10024;</td>
          <td style="color:var(--green);font-weight:700;">$0 → $9/mo</td>
          <td style="color:var(--green);">&#10003; Yes</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section id="pricing" class="fade-in fade-in-d3" style="margin-bottom:4rem;">
    <div style="text-align:center;margin-bottom:2.5rem;">
      <div class="section-label">Plans</div>
      <div class="section-title">Simple, transparent pricing</div>
    </div>

    <div class="pricing">
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
        <a href="/dashboard" class="btn btn-secondary" style="display:block;text-align:center;margin-top:1.5rem;width:100%;">Get started free</a>
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
        <a href="/dashboard#upgrade" class="btn btn-primary" style="display:block;text-align:center;margin-top:1.5rem;width:100%;">Upgrade to Starter</a>
      </div>
    </div>
  </section>

  <section class="fade-in fade-in-d4" style="margin-bottom:4rem;">
    <div class="section-label">Get started</div>
    <div class="section-title" style="font-size:1.5rem;">30-second quick start</div>
    <pre><span class="comment"># 1. Create a sink</span>
<span class="cmd">curl</span> <span class="flag">-X POST</span> https://your-app.replit.app/api/sinks \\
  <span class="flag">-H</span> <span class="string">"Authorization: Bearer &lt;your_api_key&gt;"</span> \\
  <span class="flag">-H</span> <span class="string">"Content-Type: application/json"</span> \\
  <span class="flag">-d</span> <span class="string">'{"name":"my-stripe-sink","provider":"stripe"}'</span>

<span class="comment"># 2. Add a destination route</span>
<span class="cmd">curl</span> <span class="flag">-X POST</span> https://your-app.replit.app/api/sinks/&lt;sink_id&gt;/routes \\
  <span class="flag">-H</span> <span class="string">"Authorization: Bearer &lt;your_api_key&gt;"</span> \\
  <span class="flag">-H</span> <span class="string">"Content-Type: application/json"</span> \\
  <span class="flag">-d</span> <span class="string">'{"url":"https://your-service.example.com/webhook"}'</span>

<span class="comment"># 3. Point Stripe at your ingest URL</span>
<span class="comment">#    https://your-app.replit.app/ingest/&lt;sink_id&gt;</span></pre>
  </section>

</div>

${FOOTER}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/billing/success', (req, res) => {
  const html = `${HEAD('FanHook — Upgrade Successful')}
${NAV}
<div class="container" style="text-align:center;padding:6rem 1rem;">
  <div style="width:64px;height:64px;border-radius:50%;background:rgba(74,222,128,0.1);border:2px solid var(--green);display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;font-size:1.5rem;">&#10003;</div>
  <h1 style="font-size:2rem;font-weight:800;background:linear-gradient(135deg,var(--green),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:0.5rem;">You're on Starter!</h1>
  <p style="color:var(--text-secondary);font-size:1.1rem;max-width:480px;margin:1rem auto 2rem;">
    Your plan has been upgraded. You now have 50,000 events/month and 5 sinks.
    It may take a few seconds for the dashboard to reflect the change.
  </p>
  <a href="/dashboard" class="btn btn-primary">Go to Dashboard</a>
</div>
${FOOTER}
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/dashboard', (req, res) => {
  const html = `${HEAD('FanHook Dashboard')}
${NAV}

<div class="container">
  <div class="fade-in" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-top:2rem;margin-bottom:1.5rem;">
    <div>
      <div class="section-label">Control Panel</div>
      <h1 class="section-title" style="margin-bottom:0;">Dashboard</h1>
    </div>
    <div id="billing-badge" style="display:none;padding:0.35rem 1rem;border-radius:999px;font-size:0.8rem;font-weight:700;letter-spacing:0.04em;"></div>
  </div>

  <div id="stats-section" class="stats-grid fade-in" style="display:none;">
    <div class="stat-card">
      <div class="stat-label">Tier</div>
      <div class="stat-value" id="stat-tier">—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Events Used</div>
      <div class="stat-value" id="stat-events">—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Monthly Limit</div>
      <div class="stat-value" id="stat-limit">—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Usage</div>
      <div class="stat-value" id="stat-pct">—</div>
    </div>
  </div>

  <div id="onboarding" class="onboarding-card" style="display:none;">
    <h2>&#128640; Getting started</h2>
    <ol>
      <li><span id="step1" style="color:var(--green);font-weight:600;">Sink created</span> — your ingest URL is ready below.</li>
      <li id="step2-item">Add at least one <strong style="color:var(--text-primary);">route</strong> (a destination URL) in the Routes section.</li>
      <li>Point Stripe or GitHub at your ingest URL: <code id="ingest-url-hint" style="font-size:.82rem;"></code></li>
      <li>Send a test webhook and check the event log below.</li>
    </ol>
  </div>

  <div id="usage-section" style="display:none;margin-bottom:1.5rem;">
    <div class="glass-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:0.75rem;">
        <div>
          <span style="color:var(--text-muted);font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Events this month</span>
          <div id="usage-text" style="color:var(--text-primary);font-size:1.1rem;font-weight:700;margin-top:0.15rem;"></div>
        </div>
        <div id="upgrade-cta" style="display:none;">
          <a id="upgrade-btn" href="#upgrade" onclick="startCheckout(event)" class="btn btn-primary" style="font-size:0.85rem;padding:0.5rem 1.2rem;">
            Upgrade to Starter — $9/mo
          </a>
        </div>
      </div>
      <div class="usage-bar-track">
        <div id="usage-bar" class="usage-bar-fill" style="width:0%;"></div>
      </div>
      <p id="usage-limit-msg" style="display:none;color:var(--red);margin:0.75rem 0 0;font-size:0.85rem;font-weight:500;">
        Monthly limit reached. Upgrade to Starter to continue receiving events.
      </p>
    </div>
  </div>

  <section class="fade-in fade-in-d1" style="margin-bottom:2rem;">
    <div class="dash-section-header">
      <div class="dash-section-icon" style="background:rgba(99,102,241,0.1);color:var(--accent);">&#9881;</div>
      <h2>Sinks</h2>
    </div>
    <div id="sinks-loading" style="color:var(--text-muted);padding:1rem;">Loading...</div>
    <div class="table-wrap" id="sinks-table" style="display:none;">
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Provider</th><th>Tier</th><th>Ingest URL</th><th>Created</th></tr>
        </thead>
        <tbody id="sinks-body"></tbody>
      </table>
    </div>
  </section>

  <section class="fade-in fade-in-d2" style="margin-bottom:2rem;">
    <div class="dash-section-header">
      <div class="dash-section-icon" style="background:rgba(34,211,238,0.1);color:var(--cyan);">&#8594;</div>
      <h2>Routes <span style="font-weight:400;color:var(--text-muted);font-size:0.85rem;">for demo_sink_1</span></h2>
    </div>
    <div id="routes-loading" style="color:var(--text-muted);padding:1rem;">Loading...</div>
    <div class="table-wrap" id="routes-table" style="display:none;">
      <table>
        <thead>
          <tr><th>ID</th><th>URL</th><th>Created</th><th>Action</th></tr>
        </thead>
        <tbody id="routes-body"></tbody>
      </table>
    </div>

    <div style="display:flex;gap:1rem;align-items:flex-end;margin-top:1rem;flex-wrap:wrap;">
      <div style="flex:1;min-width:280px;">
        <label style="display:block;margin-bottom:0.3rem;color:var(--text-muted);font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">New route URL</label>
        <input type="url" id="new-route-url" placeholder="https://example.com/webhook" style="width:100%;" />
      </div>
      <button onclick="addRoute()">Add Route</button>
    </div>
    <p id="route-msg" style="display:none;font-size:0.9rem;margin-top:0.5rem;"></p>
  </section>

  <section class="fade-in fade-in-d3" style="margin-bottom:3rem;">
    <div class="dash-section-header">
      <div class="dash-section-icon" style="background:rgba(74,222,128,0.1);color:var(--green);">&#9889;</div>
      <h2>Recent Events <span style="font-weight:400;color:var(--text-muted);font-size:0.85rem;">demo_sink_1</span></h2>
    </div>
    <div id="events-loading" style="color:var(--text-muted);padding:1rem;">Loading...</div>
    <div class="table-wrap" id="events-table" style="display:none;">
      <table>
        <thead>
          <tr><th>Event ID</th><th>Status</th><th>Received At</th><th>Attempts</th></tr>
        </thead>
        <tbody id="events-body"></tbody>
      </table>
    </div>
  </section>

  <section class="fade-in fade-in-d4" id="dlq-section" style="margin-bottom:3rem;display:none;">
    <div class="dash-section-header">
      <div class="dash-section-icon" style="background:rgba(239,68,68,0.1);color:var(--red);">&#9760;</div>
      <h2>Dead Letter Queue <span id="dlq-count-badge" style="display:none;margin-left:0.5rem;padding:0.1rem 0.55rem;border-radius:999px;font-size:0.75rem;font-weight:700;background:rgba(239,68,68,0.15);color:var(--red);border:1px solid rgba(239,68,68,0.25);"></span></h2>
    </div>
    <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem;">
      Events that exhausted all delivery attempts. Fix the downstream issue, then click <strong style="color:var(--text-primary);">Redrive</strong> to retry with a fresh delivery cycle.
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Event ID</th><th>Provider</th><th>Failed At</th><th>Attempts</th><th>Action</th></tr>
        </thead>
        <tbody id="dlq-body"></tbody>
      </table>
    </div>
    <p id="dlq-msg" style="display:none;font-size:0.9rem;margin-top:0.5rem;"></p>
  </section>
</div>

${FOOTER}

<script>
  const API_KEY = 'demo_key_abc123';
  const SINK_ID = 'demo_sink_1';
  const headers = { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' };

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
    const cls = status === 'delivered' ? 'badge-delivered'
              : status === 'failed' ? 'badge-failed'
              : 'badge-pending';
    return '<span class="' + cls + '">' + esc(status) + '</span>';
  }

  function tierBadge(tier) {
    const isStarter = tier === 'starter';
    return '<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.15rem 0.6rem;border-radius:999px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;' +
      (isStarter ? 'background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.2);' : 'background:rgba(100,116,139,0.1);color:#94a3b8;border:1px solid rgba(100,116,139,0.15);') +
      '">' + esc(tier) + '</span>';
  }

  async function loadBilling() {
    try {
      const res = await fetch('/api/billing/status', { headers });
      if (!res.ok) return;
      const data = await res.json();

      const badge = document.getElementById('billing-badge');
      badge.textContent = data.tier.toUpperCase();
      badge.style.background = data.tier === 'starter' ? 'rgba(74,222,128,0.1)' : 'rgba(100,116,139,0.1)';
      badge.style.color = data.tier === 'starter' ? '#4ade80' : '#94a3b8';
      badge.style.border = '1px solid ' + (data.tier === 'starter' ? 'rgba(74,222,128,0.2)' : 'rgba(100,116,139,0.15)');
      badge.style.display = 'inline-block';

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
        bar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
      }
      if (data.usage_pct >= 100) {
        document.getElementById('usage-limit-msg').style.display = 'block';
      }
      if (data.tier === 'free') {
        document.getElementById('upgrade-cta').style.display = 'block';
      }
    } catch (_) {}
  }

  async function startCheckout(e) {
    e.preventDefault();
    const btn = document.getElementById('upgrade-btn');
    btn.textContent = 'Redirecting\\u2026';
    btn.style.opacity = '.6';
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        btn.textContent = data.error || 'Error \\u2014 try again';
        btn.style.opacity = '1';
      }
    } catch (err) {
      btn.textContent = 'Error \\u2014 try again';
      btn.style.opacity = '1';
    }
  }

  async function loadSinks() {
    try {
      const res = await fetch('/api/sinks', { headers });
      const sinks = await res.json();
      const tbody = document.getElementById('sinks-body');
      tbody.innerHTML = sinks.map(s =>
        '<tr>' +
        '<td><code style="font-size:.8rem;">' + esc(s.id) + '</code></td>' +
        '<td style="color:var(--text-primary);font-weight:500;">' + esc(s.name) + '</td>' +
        '<td>' + esc(s.provider) + '</td>' +
        '<td>' + tierBadge(s.tier || 'free') + '</td>' +
        '<td><code style="font-size:.8rem;">/ingest/' + esc(s.id) + '</code></td>' +
        '<td style="font-size:.8rem;color:var(--text-muted);">' + esc(s.created_at) + '</td>' +
        '</tr>'
      ).join('');
      document.getElementById('sinks-loading').style.display = 'none';
      document.getElementById('sinks-table').style.display = 'block';
    } catch (e) {
      document.getElementById('sinks-loading').textContent = 'Failed to load sinks.';
    }
  }

  async function loadRoutes() {
    document.getElementById('routes-loading').style.display = 'none';
    document.getElementById('routes-table').style.display = 'block';
    document.getElementById('routes-body').innerHTML =
      '<tr><td colspan="4" style="color:var(--text-muted);">Use the form below to add routes. ' +
      'Route IDs are returned on creation.</td></tr>';
    document.getElementById('ingest-url-hint').textContent =
      window.location.origin + '/ingest/' + SINK_ID;
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
        const tr = document.createElement('tr');
        tr.id = 'route-' + esc(data.id);
        tr.innerHTML =
          '<td><code style="font-size:.8rem;">' + esc(data.id) + '</code></td>' +
          '<td style="color:var(--text-primary);">' + esc(data.url) + '</td>' +
          '<td style="font-size:.8rem;color:var(--text-muted);">' + esc(data.created_at) + '</td>' +
          '<td><button onclick="deleteRoute(\\'' + esc(data.id) + '\\')">Delete</button></td>';
        const placeholder = document.querySelector('#routes-body tr td[colspan]');
        if (placeholder) placeholder.closest('tr').remove();
        document.getElementById('routes-body').appendChild(tr);
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

  async function loadEvents() {
    try {
      const res = await fetch('/api/sinks/' + SINK_ID + '/events', { headers });
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
      tbody.innerHTML = events.map(e =>
        '<tr id="event-row-' + esc(e.id) + '" style="cursor:pointer;" title="Click to toggle attempt details" onclick="toggleDetail(\'' + esc(e.id) + '\',this)">' +
        '<td><code style="font-size:.8rem;">' + esc(e.id) + '</code></td>' +
        '<td>' + statusBadge(e.status) + '</td>' +
        '<td style="font-size:.8rem;color:var(--text-muted);">' + esc(e.received_at) + '</td>' +
        '<td style="color:var(--text-primary);font-weight:600;">' + (e.delivery_attempts ? e.delivery_attempts.length : 0) + '</td>' +
        '</tr>'
      ).join('');
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
  // Opens an EventSource to /api/sinks/:id/stream (auth via ?key= since
  // EventSource cannot set custom headers). On each incoming message the event
  // log is updated in place (status badge swap) or prepended (new pending row).
  // The server keeps the SSE connection open and retries NATS on a backoff
  // schedule, so the stream self-heals without a page refresh.
  // On a hard connection error the client degrades to 10-second polling; the
  // fallback is cancelled automatically on the first live data message.

  let ssePollingInterval = null;

  function connectSSE() {
    const es = new EventSource(
      '/api/sinks/' + SINK_ID + '/stream?key=' + API_KEY
    );

    es.onmessage = function (event) {
      // Cancel any polling fallback the moment live data arrives
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
  }

  function handleStatusUpdate(data) {
    // data: { event_id, sink_id, status, received_at?,
    //         attempt_number?, http_status?, error_message?, attempts? }
    const tbody = document.getElementById('events-body');
    if (!tbody) return;

    // Cache attempt details for the expand-on-click detail row
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

      // Update attempt count cell (last <td>)
      if (data.attempt_number != null) {
        const cells = existingRow.querySelectorAll('td');
        const attemptsCell = cells[cells.length - 1];
        if (attemptsCell) {
          attemptsCell.textContent = data.attempt_number;
        }
      }

      // If the detail row is currently open, refresh it too
      const detailRow = document.getElementById('detail-row-' + data.event_id);
      if (detailRow) {
        detailRow.querySelector('td').innerHTML = buildDetailHtml(data.event_id);
      }
    } else if (data.status === 'pending') {
      // New event — prepend a row and increment the usage counter
      const tr = document.createElement('tr');
      tr.id = 'event-row-' + data.event_id;
      tr.style.cursor = 'pointer';
      tr.title = 'Click to toggle attempt details';
      tr.onclick = function () { toggleDetail(data.event_id, this); };
      tr.innerHTML =
        '<td><code style="font-size:.8rem;">' + esc(data.event_id) + '</code></td>' +
        '<td>' + statusBadge(data.status) + '</td>' +
        '<td style="font-size:.8rem;color:var(--text-muted);">' +
          esc(data.received_at || new Date().toISOString()) + '</td>' +
        '<td style="color:var(--text-primary);font-weight:600;">0</td>';
      // Ensure the table is visible before inserting
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
      return '<em style="color:var(--text-muted);font-size:0.82rem;">No attempt details available yet.</em>';
    }
    return attempts.map(function (a) {
      const statusColor = a.http_status && a.http_status < 300 ? 'var(--green)'
                        : a.http_status ? 'var(--red)'
                        : 'var(--text-muted)';
      const httpLabel = a.http_status ? 'HTTP ' + a.http_status : 'No response';
      const errLabel  = a.error_message ? ' &mdash; ' + esc(a.error_message) : '';
      const routeLabel = a.route_id ? '<code style="font-size:0.75rem;color:var(--text-muted);">' + esc(a.route_id) + '</code>' : '';
      return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.25rem 0;font-size:0.82rem;">' +
        '<span style="font-weight:700;color:var(--text-muted);">Attempt ' + a.attempt_number + '</span>' +
        '<span style="font-weight:600;color:' + statusColor + ';">' + httpLabel + '</span>' +
        '<span style="color:var(--red);">' + errLabel + '</span>' +
        (routeLabel ? '<span>Route: ' + routeLabel + '</span>' : '') +
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
    detailRow.innerHTML =
      '<td colspan="4" style="background:rgba(15,23,42,0.6);padding:0.6rem 1rem;border-top:none;">' +
      buildDetailHtml(eventId) +
      '</td>';
    if (row.nextSibling) {
      row.parentNode.insertBefore(detailRow, row.nextSibling);
    } else {
      row.parentNode.appendChild(detailRow);
    }
  }

  function incrementUsage() {
    const eventsEl = document.getElementById('stat-events');
    const limitEl  = document.getElementById('stat-limit');
    if (!eventsEl || eventsEl.textContent === '\u2014') return;
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
      const res = await fetch('/api/sinks/' + SINK_ID + '/dlq', { headers });
      if (!res.ok) return;
      const entries = await res.json();
      if (!entries || entries.length === 0) return;

      const badge = document.getElementById('dlq-count-badge');
      badge.textContent = entries.length;
      badge.style.display = 'inline';

      const tbody = document.getElementById('dlq-body');
      tbody.innerHTML = entries.map(e =>
        '<tr id="dlq-row-' + esc(e.event_id) + '">' +
        '<td><code style="font-size:.8rem;">' + esc(e.event_id) + '</code></td>' +
        '<td style="color:var(--text-muted);">' + esc(e.provider || 'generic') + '</td>' +
        '<td style="font-size:.8rem;color:var(--text-muted);">' + esc(e.failed_at) + '</td>' +
        '<td style="color:var(--red);font-weight:600;">' + esc(e.attempt_count) + '</td>' +
        '<td><button id="redrive-btn-' + esc(e.event_id) + '" onclick="redrive(\'' + esc(e.event_id) + '\')" style="background:rgba(239,68,68,0.1);color:var(--red);border:1px solid rgba(239,68,68,0.25);">Redrive</button></td>' +
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
        '/api/sinks/' + SINK_ID + '/dlq/' + eventId + '/redrive',
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
  connectSSE();
</script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
