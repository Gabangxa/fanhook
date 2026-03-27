const express = require('express');
const path = require('path');

const router = express.Router();

// ---------------------------------------------------------------------------
// Shared nav / head helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GET /openapi.json
// ---------------------------------------------------------------------------
router.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'openapi.json'));
});

// ---------------------------------------------------------------------------
// GET /docs
// ---------------------------------------------------------------------------
router.get('/docs', (req, res) => {
  const html = `${HEAD('FanHook API Docs')}
${NAV}
<div class="container">
  <h1 style="color:#6366f1;margin-top:2rem;">API Reference</h1>
  <p>All management endpoints live under <code>/api</code> (Bearer auth required). Ingest endpoints live under <code>/ingest</code> (no auth — signature-verified instead).</p>

  <h2 style="color:#94a3b8;border-bottom:1px solid #1e293b;padding-bottom:.5rem;">Sinks</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="method method-post">POST</span></td><td><code>/api/sinks</code></td><td>Bearer</td><td>Create a new sink. Body: <code>{"name":"...","provider":"stripe|github|generic"}</code></td></tr>
      <tr><td><span class="method method-get">GET</span></td><td><code>/api/sinks</code></td><td>Bearer</td><td>List sinks for the authenticated API key.</td></tr>
      <tr><td><span class="method method-get">GET</span></td><td><code>/api/sinks/:id/events</code></td><td>Bearer</td><td>Last 50 events with delivery attempts.</td></tr>
    </tbody>
  </table>

  <h2 style="color:#94a3b8;border-bottom:1px solid #1e293b;padding-bottom:.5rem;">Routes</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="method method-post">POST</span></td><td><code>/api/sinks/:id/routes</code></td><td>Bearer</td><td>Add a destination URL. Body: <code>{"url":"https://..."}</code></td></tr>
      <tr><td><span class="method method-delete">DELETE</span></td><td><code>/api/sinks/:id/routes/:routeId</code></td><td>Bearer</td><td>Remove a route. Returns 204.</td></tr>
    </tbody>
  </table>

  <h2 style="color:#94a3b8;border-bottom:1px solid #1e293b;padding-bottom:.5rem;">Billing</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="method method-get">GET</span></td><td><code>/api/billing/status</code></td><td>Bearer</td><td>Current tier, events used this month, and limit.</td></tr>
      <tr><td><span class="method method-post">POST</span></td><td><code>/api/billing/checkout</code></td><td>Bearer</td><td>Create a Stripe Checkout session to upgrade to Starter ($9/mo). Returns <code>{"url":"..."}</code>.</td></tr>
    </tbody>
  </table>

  <h2 style="color:#94a3b8;border-bottom:1px solid #1e293b;padding-bottom:.5rem;">Ingest</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="method method-post">POST</span></td><td><code>/ingest/:sinkId</code></td><td>Signature</td><td>Receive a webhook. FanHook verifies the provider signature and fans out to all routes. Returns <code>429</code> when monthly limit is reached.</td></tr>
    </tbody>
  </table>

  <h2 style="color:#94a3b8;border-bottom:1px solid #1e293b;padding-bottom:.5rem;">Response Codes</h2>
  <table>
    <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td>200</td><td>OK</td></tr>
      <tr><td>201</td><td>Created</td></tr>
      <tr><td>204</td><td>No Content (deletion)</td></tr>
      <tr><td>400</td><td>Bad Request — missing or invalid fields</td></tr>
      <tr><td>401</td><td>Unauthorized — invalid API key or signature</td></tr>
      <tr><td>403</td><td>Forbidden — sink does not belong to this API key</td></tr>
      <tr><td>404</td><td>Not Found</td></tr>
      <tr><td>429</td><td>Too Many Requests — monthly event limit reached</td></tr>
    </tbody>
  </table>
</div>
<footer style="text-align:center;padding:2rem;color:#475569;border-top:1px solid #1e293b;">FanHook — Built for developers</footer>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// GET / — Landing page
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const html = `${HEAD('FanHook — Affordable Webhook Fanout')}
${NAV}

<div class="container">

  <!-- Hero -->
  <section class="hero" style="margin:4rem 0 3rem;">
    <h1>Webhook fanout that doesn't cost $490/mo.</h1>
    <p style="font-size:1.2rem;color:#94a3b8;max-width:600px;margin:1rem auto 2rem;">
      One webhook in. Many destinations out. Stripe &amp; GitHub signature verification,
      automatic retries, and a real-time event log — starting free.
    </p>
    <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
      <a href="/dashboard" class="btn">Open Dashboard</a>
      <a href="/docs" class="btn btn-secondary">API Docs</a>
    </div>
  </section>

  <!-- How it works -->
  <section style="margin-bottom:3.5rem;">
    <h2 style="color:#94a3b8;text-align:center;margin-bottom:2rem;">How it works</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.5rem;">
      <div class="how-step">
        <div class="step-num">1</div>
        <h3>Create a sink</h3>
        <p>POST to <code>/api/sinks</code> and get a unique ingest URL + API key in seconds.</p>
      </div>
      <div class="how-step">
        <div class="step-num">2</div>
        <h3>Point your provider</h3>
        <p>Set the ingest URL as your Stripe or GitHub webhook endpoint. No config changes needed.</p>
      </div>
      <div class="how-step">
        <div class="step-num">3</div>
        <h3>FanHook verifies &amp; fans out</h3>
        <p>Every incoming webhook is signature-verified, then forwarded to all your configured routes.</p>
      </div>
      <div class="how-step">
        <div class="step-num">4</div>
        <h3>Auto-retry on failure</h3>
        <p>Failed deliveries are retried up to 3 times with linear backoff. Inspect results in the event log.</p>
      </div>
    </div>
  </section>

  <!-- vs competitors callout -->
  <section style="background:#1e293b;border-radius:8px;padding:1.5rem 2rem;margin-bottom:3.5rem;">
    <h2 style="color:#6366f1;margin-top:0;">Why not just use Svix or Hookdeck?</h2>
    <table>
      <thead>
        <tr><th>Service</th><th>Starting price</th><th>Fanout on lowest tier</th></tr>
      </thead>
      <tbody>
        <tr><td>Svix</td><td style="color:#f87171;">$490/mo</td><td>Yes</td></tr>
        <tr><td>Hookdeck</td><td style="color:#fbbf24;">$15/mo</td><td>Limited</td></tr>
        <tr><td><strong style="color:#6366f1;">FanHook</strong></td><td style="color:#4ade80;"><strong>$0 → $9/mo</strong></td><td><strong>Yes</strong></td></tr>
      </tbody>
    </table>
  </section>

  <!-- Pricing -->
  <section id="pricing" style="margin-bottom:3.5rem;">
    <h2 style="color:#94a3b8;text-align:center;margin-bottom:2rem;">Pricing</h2>
    <div class="pricing">
      <div class="plan">
        <h3>Free</h3>
        <div class="price">$0<span style="font-size:1rem;font-weight:normal;">/mo</span></div>
        <ul style="padding-left:1.2rem;color:#94a3b8;line-height:1.8;">
          <li>1 sink</li>
          <li>1,000 events/month</li>
          <li>3 fanout routes per sink</li>
          <li>3 retry attempts</li>
          <li>Stripe &amp; GitHub sig verification</li>
          <li>Event log (last 50)</li>
        </ul>
        <a href="/dashboard" class="btn" style="display:block;text-align:center;margin-top:1.5rem;">Get started free</a>
      </div>
      <div class="plan plan-featured">
        <div style="font-size:.75rem;font-weight:700;letter-spacing:.05em;color:#6366f1;text-transform:uppercase;margin-bottom:.5rem;">Most popular</div>
        <h3>Starter</h3>
        <div class="price">$9<span style="font-size:1rem;font-weight:normal;">/mo</span></div>
        <ul style="padding-left:1.2rem;color:#94a3b8;line-height:1.8;">
          <li>5 sinks</li>
          <li>50,000 events/month</li>
          <li>All Free features</li>
          <li>Event log (last 200)</li>
          <li>Email alerts on retry exhaustion</li>
        </ul>
        <a href="/dashboard#upgrade" class="btn" style="display:block;text-align:center;margin-top:1.5rem;background:#6366f1;">Upgrade to Starter</a>
      </div>
    </div>
  </section>

  <!-- Quick start snippet -->
  <section style="margin-bottom:3.5rem;">
    <h2 style="color:#94a3b8;">30-second quick start</h2>
    <pre style="font-size:.85rem;"># 1. Create a sink
curl -X POST https://your-app.replit.app/api/sinks \\
  -H "Authorization: Bearer &lt;your_api_key&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"my-stripe-sink","provider":"stripe"}'

# 2. Add a destination route
curl -X POST https://your-app.replit.app/api/sinks/&lt;sink_id&gt;/routes \\
  -H "Authorization: Bearer &lt;your_api_key&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://your-service.example.com/webhook"}'

# 3. Point Stripe at your ingest URL
#    https://your-app.replit.app/ingest/&lt;sink_id&gt;</pre>
  </section>

</div>

<footer style="text-align:center;padding:2rem;color:#475569;border-top:1px solid #1e293b;">
  FanHook — Built for indie developers &amp; small teams
</footer>
<style>
  .btn { display:inline-block; padding:.6rem 1.4rem; background:#334155; color:#e2e8f0; border-radius:6px; text-decoration:none; font-weight:600; cursor:pointer; border:none; font-size:.95rem; }
  .btn:hover { background:#475569; }
  .btn-secondary { background:transparent; border:1px solid #475569; }
  .btn-secondary:hover { background:#1e293b; }
  .how-step { background:#1e293b; border-radius:8px; padding:1.25rem 1.5rem; }
  .how-step h3 { color:#e2e8f0; margin:.5rem 0; }
  .how-step p { color:#94a3b8; margin:0; font-size:.9rem; }
  .step-num { font-size:1.5rem; font-weight:800; color:#6366f1; }
  .plan-featured { border:2px solid #6366f1; }
</style>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// GET /billing/success — post-checkout confirmation page
// ---------------------------------------------------------------------------
router.get('/billing/success', (req, res) => {
  const html = `${HEAD('FanHook — Upgrade Successful')}
${NAV}
<div class="container" style="text-align:center;padding:5rem 1rem;">
  <div style="font-size:3rem;margin-bottom:1rem;">🎉</div>
  <h1 style="color:#4ade80;">You're on Starter!</h1>
  <p style="color:#94a3b8;font-size:1.1rem;max-width:480px;margin:1rem auto 2rem;">
    Your plan has been upgraded. You now have 50,000 events/month and 5 sinks.
    It may take a few seconds for the dashboard to reflect the change.
  </p>
  <a href="/dashboard" style="display:inline-block;padding:.7rem 1.8rem;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Go to Dashboard</a>
</div>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// GET /dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const html = `${HEAD('FanHook Dashboard')}
${NAV}

<div class="container">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-top:2rem;">
    <h1 style="color:#6366f1;margin:0;">Dashboard</h1>
    <!-- Billing badge — populated by JS -->
    <div id="billing-badge" style="display:none;padding:.4rem 1rem;border-radius:999px;font-size:.85rem;font-weight:600;"></div>
  </div>

  <!-- ------------------------------------------------------------------ -->
  <!-- Onboarding wizard (shown when sink has no routes yet)               -->
  <!-- ------------------------------------------------------------------ -->
  <div id="onboarding" style="display:none;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1.5rem 2rem;margin:1.5rem 0;">
    <h2 style="color:#6366f1;margin-top:0;">Getting started</h2>
    <ol style="color:#94a3b8;line-height:2;margin:0;padding-left:1.2rem;">
      <li><span id="step1" style="color:#4ade80;font-weight:600;">Sink created</span> — your ingest URL is ready below.</li>
      <li id="step2-item">Add at least one <strong style="color:#e2e8f0;">route</strong> (a destination URL) in the Routes section.</li>
      <li>Point Stripe or GitHub at your ingest URL: <code id="ingest-url-hint" style="font-size:.85rem;"></code></li>
      <li>Send a test webhook and check the event log below.</li>
    </ol>
  </div>

  <!-- ------------------------------------------------------------------ -->
  <!-- Usage bar + upgrade CTA                                             -->
  <!-- ------------------------------------------------------------------ -->
  <div id="usage-section" style="display:none;background:#1e293b;border-radius:8px;padding:1.25rem 1.5rem;margin:1.5rem 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:.75rem;">
      <div>
        <span style="color:#94a3b8;font-size:.9rem;">Events this month: </span>
        <strong id="usage-text" style="color:#e2e8f0;"></strong>
      </div>
      <div id="upgrade-cta" style="display:none;">
        <a id="upgrade-btn" href="#upgrade" onclick="startCheckout(event)"
           style="padding:.5rem 1.2rem;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:.9rem;">
          Upgrade to Starter — $9/mo
        </a>
      </div>
    </div>
    <div style="background:#0f172a;border-radius:4px;height:8px;overflow:hidden;">
      <div id="usage-bar" style="height:100%;background:#6366f1;transition:width .3s;width:0%;"></div>
    </div>
    <p id="usage-limit-msg" style="display:none;color:#f87171;margin:.75rem 0 0;font-size:.9rem;">
      Monthly limit reached. Upgrade to Starter to continue receiving events.
    </p>
  </div>

  <!-- ------------------------------------------------------------------ -->
  <!-- Sinks                                                               -->
  <!-- ------------------------------------------------------------------ -->
  <section style="margin-bottom:2.5rem;">
    <h2 style="color:#94a3b8;">Sinks</h2>
    <div id="sinks-loading" style="color:#475569;">Loading...</div>
    <table id="sinks-table" style="display:none;">
      <thead>
        <tr><th>ID</th><th>Name</th><th>Provider</th><th>Tier</th><th>Ingest URL</th><th>Created</th></tr>
      </thead>
      <tbody id="sinks-body"></tbody>
    </table>
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- Routes                                                              -->
  <!-- ------------------------------------------------------------------ -->
  <section style="margin-bottom:2.5rem;">
    <h2 style="color:#94a3b8;">Routes for demo_sink_1</h2>
    <div id="routes-loading" style="color:#475569;">Loading...</div>
    <table id="routes-table" style="display:none;">
      <thead>
        <tr><th>ID</th><th>URL</th><th>Created</th><th>Action</th></tr>
      </thead>
      <tbody id="routes-body"></tbody>
    </table>

    <div style="display:flex;gap:1rem;align-items:flex-end;margin-top:1rem;flex-wrap:wrap;">
      <div>
        <label style="display:block;margin-bottom:.25rem;color:#94a3b8;">New route URL</label>
        <input type="url" id="new-route-url" placeholder="https://example.com/webhook" style="min-width:280px;" />
      </div>
      <button onclick="addRoute()">Add Route</button>
    </div>
    <p id="route-msg" style="display:none;"></p>
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- Event log                                                           -->
  <!-- ------------------------------------------------------------------ -->
  <section style="margin-bottom:3rem;">
    <h2 style="color:#94a3b8;">Recent Events — demo_sink_1</h2>
    <div id="events-loading" style="color:#475569;">Loading...</div>
    <table id="events-table" style="display:none;">
      <thead>
        <tr><th>Event ID</th><th>Status</th><th>Received At</th><th>Attempts</th></tr>
      </thead>
      <tbody id="events-body"></tbody>
    </table>
  </section>
</div>

<footer style="text-align:center;padding:2rem;color:#475569;border-top:1px solid #1e293b;">
  FanHook — Built for developers
</footer>

<script>
  const API_KEY = 'demo_key_abc123';
  const SINK_ID = 'demo_sink_1';
  const headers = { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' };

  // XSS-safe HTML escaping for user-supplied strings inserted via innerHTML
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
    return '<span class="' + cls + '">' + status + '</span>';
  }

  function tierBadge(tier) {
    const color = tier === 'starter' ? '#4ade80' : '#94a3b8';
    return '<span style="color:' + color + ';font-weight:600;text-transform:uppercase;font-size:.75rem;">' + tier + '</span>';
  }

  // -----------------------------------------------------------------------
  // Billing / usage
  // -----------------------------------------------------------------------
  async function loadBilling() {
    try {
      const res = await fetch('/api/billing/status', { headers });
      if (!res.ok) return;
      const data = await res.json();

      const badge = document.getElementById('billing-badge');
      badge.textContent = data.tier.toUpperCase();
      badge.style.background = data.tier === 'starter' ? '#14532d' : '#1e293b';
      badge.style.color = data.tier === 'starter' ? '#4ade80' : '#94a3b8';
      badge.style.border = '1px solid ' + (data.tier === 'starter' ? '#16a34a' : '#334155');
      badge.style.display = 'inline-block';

      const usageSection = document.getElementById('usage-section');
      usageSection.style.display = 'block';

      document.getElementById('usage-text').textContent =
        data.events_this_month.toLocaleString() + ' / ' + data.events_limit.toLocaleString();

      const bar = document.getElementById('usage-bar');
      bar.style.width = data.usage_pct + '%';
      bar.style.background = data.usage_pct >= 90 ? '#ef4444' : '#6366f1';

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
    btn.textContent = 'Redirecting…';
    btn.style.opacity = '.6';
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        btn.textContent = data.error || 'Error — try again';
        btn.style.opacity = '1';
      }
    } catch (err) {
      btn.textContent = 'Error — try again';
      btn.style.opacity = '1';
    }
  }

  // -----------------------------------------------------------------------
  // Sinks
  // -----------------------------------------------------------------------
  async function loadSinks() {
    try {
      const res = await fetch('/api/sinks', { headers });
      const sinks = await res.json();
      const tbody = document.getElementById('sinks-body');
      tbody.innerHTML = sinks.map(s =>
        '<tr>' +
        '<td><code style="font-size:.8rem;">' + esc(s.id) + '</code></td>' +
        '<td>' + esc(s.name) + '</td>' +
        '<td>' + esc(s.provider) + '</td>' +
        '<td>' + tierBadge(s.tier || 'free') + '</td>' +
        '<td><code style="font-size:.8rem;">/ingest/' + esc(s.id) + '</code></td>' +
        '<td style="font-size:.8rem;">' + esc(s.created_at) + '</td>' +
        '</tr>'
      ).join('');
      document.getElementById('sinks-loading').style.display = 'none';
      document.getElementById('sinks-table').style.display = 'table';
    } catch (e) {
      document.getElementById('sinks-loading').textContent = 'Failed to load sinks.';
    }
  }

  // -----------------------------------------------------------------------
  // Routes
  // -----------------------------------------------------------------------
  async function loadRoutes() {
    document.getElementById('routes-loading').style.display = 'none';
    document.getElementById('routes-table').style.display = 'table';
    document.getElementById('routes-body').innerHTML =
      '<tr><td colspan="4" style="color:#475569;">Use the form below to add routes. ' +
      'Route IDs are returned on creation — keep them to delete later.</td></tr>';

    // Hint for onboarding
    document.getElementById('ingest-url-hint').textContent =
      window.location.origin + '/ingest/' + SINK_ID;
  }

  async function addRoute() {
    const url = document.getElementById('new-route-url').value.trim();
    const msgEl = document.getElementById('route-msg');
    if (!url) {
      msgEl.textContent = 'URL is required';
      msgEl.style.color = '#f87171';
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
        msgEl.style.color = '#4ade80';
        msgEl.style.display = 'block';
        document.getElementById('new-route-url').value = '';
        currentRouteCount++;
        // Hide onboarding step 2 if we now have a route
        if (currentRouteCount >= 1) {
          const s2 = document.getElementById('step2-item');
          if (s2) s2.style.opacity = '.5';
        }
        const tr = document.createElement('tr');
        tr.id = 'route-' + esc(data.id);
        tr.innerHTML =
          '<td><code style="font-size:.8rem;">' + esc(data.id) + '</code></td>' +
          '<td>' + esc(data.url) + '</td>' +
          '<td style="font-size:.8rem;">' + esc(data.created_at) + '</td>' +
          '<td><button onclick="deleteRoute(\\'' + esc(data.id) + '\\')">Delete</button></td>';
        // Remove placeholder row if present
        const placeholder = document.querySelector('#routes-body tr td[colspan]');
        if (placeholder) placeholder.closest('tr').remove();
        document.getElementById('routes-body').appendChild(tr);
      } else {
        msgEl.textContent = 'Error: ' + (data.error || 'Unknown');
        msgEl.style.color = '#f87171';
        msgEl.style.display = 'block';
      }
    } catch (e) {
      msgEl.textContent = 'Error: ' + e.message;
      msgEl.style.color = '#f87171';
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

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------
  async function loadEvents() {
    try {
      const res = await fetch('/api/sinks/' + SINK_ID + '/events', { headers });
      const events = await res.json();
      const tbody = document.getElementById('events-body');
      tbody.innerHTML = events.map(e =>
        '<tr>' +
        '<td><code style="font-size:.8rem;">' + esc(e.id) + '</code></td>' +
        '<td>' + statusBadge(esc(e.status)) + '</td>' +
        '<td style="font-size:.8rem;">' + esc(e.received_at) + '</td>' +
        '<td>' + (e.delivery_attempts ? e.delivery_attempts.length : 0) + '</td>' +
        '</tr>'
      ).join('');
      document.getElementById('events-loading').style.display = 'none';
      document.getElementById('events-table').style.display = 'table';

      // Show onboarding wizard if sink has 0 routes (heuristic: no route IDs in events)
      // We always show it for a first-time feel until routes are added
      if (currentRouteCount === 0) {
        document.getElementById('onboarding').style.display = 'block';
      }
    } catch (e) {
      document.getElementById('events-loading').textContent = 'Failed to load events.';
    }
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
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
