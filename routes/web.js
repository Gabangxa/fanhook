const express = require('express');
const path = require('path');

const router = express.Router();

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FanHook API Docs</title>
  <style>
    body { background: #0f172a; color: #e2e8f0; font-family: sans-serif; margin: 0; padding: 0; }
    .container { max-width: 900px; margin: auto; padding: 2rem; }
    h1 { color: #6366f1; }
    h2 { color: #94a3b8; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #1e293b; }
    th { color: #6366f1; font-weight: 600; }
    .method { font-family: monospace; font-weight: bold; }
    .method-post { color: #4ade80; }
    .method-get { color: #60a5fa; }
    .method-delete { color: #f87171; }
    code { font-family: monospace; background: #1e293b; padding: 0.2rem 0.4rem; border-radius: 4px; color: #a5f3fc; }
    a { color: #6366f1; }
    .nav { background: #1e293b; padding: 1rem 2rem; display: flex; align-items: center; gap: 2rem; }
    .nav a { color: #e2e8f0; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <nav class="nav">
    <strong style="color:#6366f1">FanHook</strong>
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/docs">API Docs</a>
    <a href="/openapi.json">OpenAPI JSON</a>
  </nav>
  <div class="container">
    <h1>API Reference</h1>
    <p>All API endpoints are under <code>/api</code>. Ingest endpoints are under <code>/ingest</code>.</p>
    <p>Authentication: pass your API key as <code>Authorization: Bearer &lt;api_key&gt;</code>.</p>

    <h2>Sinks</h2>
    <table>
      <thead>
        <tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="method method-post">POST</span></td>
          <td><code>/api/sinks</code></td>
          <td>Bearer</td>
          <td>Create a new sink. Body: <code>{"name":"...", "provider":"stripe|github|generic"}</code></td>
        </tr>
        <tr>
          <td><span class="method method-get">GET</span></td>
          <td><code>/api/sinks</code></td>
          <td>Bearer</td>
          <td>List all sinks for the authenticated API key.</td>
        </tr>
        <tr>
          <td><span class="method method-get">GET</span></td>
          <td><code>/api/sinks/:sinkId/events</code></td>
          <td>Bearer</td>
          <td>Retrieve last 50 events for a sink, including delivery attempts.</td>
        </tr>
      </tbody>
    </table>

    <h2>Routes</h2>
    <table>
      <thead>
        <tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="method method-post">POST</span></td>
          <td><code>/api/sinks/:sinkId/routes</code></td>
          <td>Bearer</td>
          <td>Add a destination URL route to a sink. Body: <code>{"url":"https://..."}</code></td>
        </tr>
        <tr>
          <td><span class="method method-delete">DELETE</span></td>
          <td><code>/api/sinks/:sinkId/routes/:routeId</code></td>
          <td>Bearer</td>
          <td>Remove a route from a sink. Returns 204 No Content.</td>
        </tr>
      </tbody>
    </table>

    <h2>Ingest</h2>
    <table>
      <thead>
        <tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="method method-post">POST</span></td>
          <td><code>/ingest/:sinkId</code></td>
          <td>None (signature verified)</td>
          <td>Receive a webhook from Stripe, GitHub, or any provider. FanHook verifies the signature and fans out to all configured routes.</td>
        </tr>
      </tbody>
    </table>

    <h2>Response Codes</h2>
    <table>
      <thead>
        <tr><th>Code</th><th>Meaning</th></tr>
      </thead>
      <tbody>
        <tr><td>200</td><td>OK — request processed</td></tr>
        <tr><td>201</td><td>Created — resource created</td></tr>
        <tr><td>204</td><td>No Content — deletion successful</td></tr>
        <tr><td>400</td><td>Bad Request — missing or invalid fields</td></tr>
        <tr><td>401</td><td>Unauthorized — invalid or missing API key / signature</td></tr>
        <tr><td>403</td><td>Forbidden — sink does not belong to API key</td></tr>
        <tr><td>404</td><td>Not Found — resource does not exist</td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// GET / — Landing page
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FanHook — Webhook Fanout</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <nav class="nav">
    <strong style="color:#6366f1">FanHook</strong>
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/docs">API Docs</a>
  </nav>

  <div class="container">
    <!-- Hero -->
    <div class="hero" style="margin: 4rem 0 3rem;">
      <h1>FanHook</h1>
      <p>One webhook in. Many destinations out.</p>
    </div>

    <!-- Features -->
    <div class="features" style="margin-bottom: 3rem;">
      <h2 style="color:#94a3b8;">Why FanHook?</h2>
      <ul>
        <li>Fanout routing — forward one webhook to unlimited downstream URLs</li>
        <li>Stripe &amp; GitHub signature verification built-in</li>
        <li>Auto-retries with exponential backoff (3 attempts per route)</li>
        <li>Event log with per-attempt delivery status</li>
      </ul>
    </div>

    <!-- Pricing -->
    <div style="margin-bottom: 3rem;">
      <h2 style="color:#94a3b8;">Pricing</h2>
      <div class="pricing">
        <div class="plan">
          <h3>Free</h3>
          <div class="price">$0<span style="font-size:1rem;font-weight:normal;">/mo</span></div>
          <ul style="padding-left:1rem;color:#94a3b8;">
            <li>100 events/day</li>
            <li>1 sink</li>
          </ul>
        </div>
        <div class="plan">
          <h3>Starter</h3>
          <div class="price">$9<span style="font-size:1rem;font-weight:normal;">/mo</span></div>
          <ul style="padding-left:1rem;color:#94a3b8;">
            <li>10k events/day</li>
            <li>5 sinks</li>
          </ul>
        </div>
        <div class="plan">
          <h3>Pro</h3>
          <div class="price">$29<span style="font-size:1rem;font-weight:normal;">/mo</span></div>
          <ul style="padding-left:1rem;color:#94a3b8;">
            <li>100k events/day</li>
            <li>20 sinks</li>
          </ul>
        </div>
        <div class="plan">
          <h3>Scale</h3>
          <div class="price">$79<span style="font-size:1rem;font-weight:normal;">/mo</span></div>
          <ul style="padding-left:1rem;color:#94a3b8;">
            <li>Unlimited events</li>
            <li>Unlimited sinks</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Try It -->
    <div style="margin-bottom: 3rem;">
      <h2 style="color:#94a3b8;">Try It</h2>
      <p style="color:#94a3b8;">Send a test webhook to the demo sink:</p>
      <pre>curl -X POST https://your-app.replit.app/ingest/demo_sink_1 \\
  -H "Content-Type: application/json" \\
  -d '{"type":"payment_intent.succeeded","id":"evt_test_123"}'</pre>

      <h3 style="color:#94a3b8;margin-top:2rem;">Create a new sink</h3>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:1rem;">
        <div>
          <label style="display:block;margin-bottom:0.25rem;color:#94a3b8;">Sink name</label>
          <input type="text" id="sink-name" placeholder="my-stripe-sink" />
        </div>
        <div>
          <label style="display:block;margin-bottom:0.25rem;color:#94a3b8;">Provider</label>
          <select id="sink-provider">
            <option value="stripe">stripe</option>
            <option value="github">github</option>
            <option value="generic">generic</option>
          </select>
        </div>
        <button onclick="createSink()">Create Sink</button>
      </div>
      <pre id="create-sink-result" style="display:none;"></pre>
    </div>
  </div>

  <footer style="text-align:center;padding:2rem;color:#475569;border-top:1px solid #1e293b;">
    FanHook v0.1 — Built for developers
  </footer>

  <script>
    async function createSink() {
      const name = document.getElementById('sink-name').value.trim();
      const provider = document.getElementById('sink-provider').value;
      const resultEl = document.getElementById('create-sink-result');

      if (!name) {
        resultEl.textContent = 'Error: sink name is required';
        resultEl.style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/sinks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer demo_key_abc123'
          },
          body: JSON.stringify({ name, provider })
        });
        const data = await res.json();
        resultEl.textContent = JSON.stringify(data, null, 2);
        resultEl.style.display = 'block';
      } catch (err) {
        resultEl.textContent = 'Error: ' + err.message;
        resultEl.style.display = 'block';
      }
    }
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// GET /dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FanHook Dashboard</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <nav class="nav">
    <strong style="color:#6366f1">FanHook</strong>
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/docs">API Docs</a>
  </nav>

  <div class="container">
    <h1 style="color:#6366f1;margin-top:2rem;">Dashboard</h1>

    <!-- Sinks section -->
    <section style="margin-bottom:3rem;">
      <h2 style="color:#94a3b8;">Sinks</h2>
      <div id="sinks-loading" style="color:#475569;">Loading...</div>
      <table id="sinks-table" style="display:none;">
        <thead>
          <tr><th>ID</th><th>Name</th><th>Provider</th><th>Created</th></tr>
        </thead>
        <tbody id="sinks-body"></tbody>
      </table>
    </section>

    <!-- Routes section -->
    <section style="margin-bottom:3rem;">
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
          <label style="display:block;margin-bottom:0.25rem;color:#94a3b8;">New route URL</label>
          <input type="url" id="new-route-url" placeholder="https://example.com/webhook" style="min-width:280px;" />
        </div>
        <button onclick="addRoute()">Add Route</button>
      </div>
      <p id="route-msg" style="color:#4ade80;display:none;"></p>
    </section>

    <!-- Events section -->
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
    FanHook v0.1 — Built for developers
  </footer>

  <script>
    const API_KEY = 'demo_key_abc123';
    const SINK_ID = 'demo_sink_1';
    const headers = { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' };

    function statusBadge(status) {
      const cls = status === 'delivered' ? 'badge-delivered'
                : status === 'failed' ? 'badge-failed'
                : 'badge-pending';
      return '<span class="' + cls + '">' + status + '</span>';
    }

    async function loadSinks() {
      try {
        const res = await fetch('/api/sinks', { headers });
        const sinks = await res.json();
        const tbody = document.getElementById('sinks-body');
        tbody.innerHTML = sinks.map(s =>
          '<tr><td><code>' + s.id + '</code></td><td>' + s.name + '</td><td>' + s.provider + '</td><td>' + s.created_at + '</td></tr>'
        ).join('');
        document.getElementById('sinks-loading').style.display = 'none';
        document.getElementById('sinks-table').style.display = 'table';
      } catch (e) {
        document.getElementById('sinks-loading').textContent = 'Failed to load sinks.';
      }
    }

    async function loadRoutes() {
      try {
        const res = await fetch('/api/sinks/' + SINK_ID + '/events', { headers });
        // Routes are loaded separately
      } catch {}

      try {
        // Fetch routes via a direct approach — list via events endpoint isn't ideal;
        // use the sinks response which includes route info if extended, else we fetch events
        // and note routes; for dashboard simplicity, maintain a local routes store
        const res = await fetch('/api/sinks/' + SINK_ID + '/events', { headers });
        // We'll load routes via the events and a dedicated internal approach
      } catch {}

      // Since there's no GET /routes endpoint, we embed route management via dashboard fetch trick
      // We'll use the OpenAPI spec knowledge: routes are managed but not listed via a GET.
      // For dashboard we'll show the "add route" form and provide delete by ID.
      // Routes listing would require a dedicated endpoint — show a notice instead.
      document.getElementById('routes-loading').style.display = 'none';
      document.getElementById('routes-table').style.display = 'table';
      document.getElementById('routes-body').innerHTML =
        '<tr><td colspan="4" style="color:#475569;">Use the form below to add routes. ' +
        'Route IDs are returned on creation — keep them to delete later.</td></tr>';
    }

    async function addRoute() {
      const url = document.getElementById('new-route-url').value.trim();
      const msgEl = document.getElementById('route-msg');
      if (!url) { msgEl.textContent = 'URL is required'; msgEl.style.display = 'block'; return; }

      try {
        const res = await fetch('/api/sinks/' + SINK_ID + '/routes', {
          method: 'POST',
          headers,
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (res.ok) {
          msgEl.textContent = 'Route added! ID: ' + data.id;
          msgEl.style.display = 'block';
          msgEl.style.color = '#4ade80';
          document.getElementById('new-route-url').value = '';
          // Append to table
          const tr = document.createElement('tr');
          tr.id = 'route-' + data.id;
          tr.innerHTML = '<td><code>' + data.id + '</code></td><td>' + data.url + '</td><td>' + data.created_at + '</td>' +
            '<td><button onclick="deleteRoute(\\'' + data.id + '\\')">Delete</button></td>';
          document.getElementById('routes-body').appendChild(tr);
        } else {
          msgEl.textContent = 'Error: ' + (data.error || 'Unknown');
          msgEl.style.display = 'block';
          msgEl.style.color = '#f87171';
        }
      } catch (e) {
        msgEl.textContent = 'Error: ' + e.message;
        msgEl.style.display = 'block';
      }
    }

    async function deleteRoute(routeId) {
      try {
        const res = await fetch('/api/sinks/' + SINK_ID + '/routes/' + routeId, {
          method: 'DELETE',
          headers
        });
        if (res.status === 204) {
          const el = document.getElementById('route-' + routeId);
          if (el) el.remove();
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
          '<td><code>' + e.id + '</code></td>' +
          '<td>' + statusBadge(e.status) + '</td>' +
          '<td>' + e.received_at + '</td>' +
          '<td>' + (e.delivery_attempts ? e.delivery_attempts.length : 0) + '</td>' +
          '</tr>'
        ).join('');
        document.getElementById('events-loading').style.display = 'none';
        document.getElementById('events-table').style.display = 'table';
      } catch (e) {
        document.getElementById('events-loading').textContent = 'Failed to load events.';
      }
    }

    // Initialize
    loadSinks();
    loadRoutes();
    loadEvents();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
