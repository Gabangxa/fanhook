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
<div class="container">

  <div class="fade-in" style="margin-top:2.5rem;">
    <div class="section-label">Reference</div>
    <h1 class="section-title">API Documentation</h1>
    <p style="color:var(--text-secondary);max-width:560px;margin-bottom:2.5rem;">
      Management endpoints live under <code>/api</code> (Bearer auth). Ingest endpoints live under <code>/ingest</code> (signature-verified).
    </p>
  </div>

  <div class="endpoint-group fade-in fade-in-d1">
    <div class="endpoint-group-title">
      <span style="font-size:1.1rem;">&#9679;</span> Sinks
    </div>

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
  </div>

  <div class="endpoint-group fade-in fade-in-d2">
    <div class="endpoint-group-title">
      <span style="font-size:1.1rem;">&#9679;</span> Routes
    </div>

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
  </div>

  <div class="endpoint-group fade-in fade-in-d3">
    <div class="endpoint-group-title">
      <span style="font-size:1.1rem;">&#9679;</span> Billing
    </div>

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
  </div>

  <div class="endpoint-group fade-in fade-in-d4">
    <div class="endpoint-group-title">
      <span style="font-size:1.1rem;">&#9679;</span> Ingest
    </div>

    <div class="endpoint-card">
      <div><span class="method method-post">POST</span></div>
      <div>
        <div class="endpoint-path">/ingest/:sinkId <span class="endpoint-auth">Signature</span></div>
        <div class="endpoint-desc">Receive a webhook. FanHook verifies the provider signature and fans out to all routes. Returns <code>429</code> when monthly limit is reached.</div>
      </div>
    </div>
  </div>

  <div class="fade-in fade-in-d4" style="margin-top:1rem;">
    <div class="endpoint-group-title">
      <span style="font-size:1.1rem;">&#9679;</span> Response Codes
    </div>
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
  </div>

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
      tbody.innerHTML = events.map(e =>
        '<tr>' +
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

  loadBilling();
  loadSinks();
  loadRoutes();
  loadEvents();
</script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
