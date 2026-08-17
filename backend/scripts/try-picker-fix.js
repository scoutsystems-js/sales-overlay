/**
 * Try the date-picker fix WITHOUT deploying it.
 *
 * Serves the PATCHED dashboard.html from this branch, and proxies everything
 * else — the API, the login page, the JS — straight to the live site. So the app
 * behaves exactly as it does in production, with one file swapped.
 *
 * Run:   node backend/scripts/try-picker-fix.js
 * Open:  http://localhost:8788
 *
 * Log in as normal. The session is stored against localhost, so it does not
 * touch the real site's session.
 *
 * Nothing is deployed and nothing is written. Ctrl-C to stop.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8788;
const UPSTREAM = 'www.scoutsystems.io';
const DASHBOARD = path.join(__dirname, '..', 'web', 'dashboard.html');

if (!fs.existsSync(DASHBOARD)) {
  console.error('Cannot find ' + DASHBOARD + ' — run this from the repo root.');
  process.exit(1);
}

const server = http.createServer(function (req, res) {
  const url = req.url || '/';
  const pathOnly = url.split('?')[0];

  // The one file under test. Served from disk so the branch's fix is what runs.
  if (pathOnly === '/' || pathOnly === '/dashboard') {
    const html = fs.readFileSync(DASHBOARD, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  // Everything else goes to the live site, headers and body intact, so auth and
  // the API behave exactly as they do in production.
  const headers = Object.assign({}, req.headers, { host: UPSTREAM });
  delete headers['accept-encoding'];              // keep the response readable
  const upstream = https.request(
    { hostname: UPSTREAM, port: 443, path: url, method: req.method, headers: headers },
    function (up) {
      const out = Object.assign({}, up.headers);
      delete out['content-encoding'];
      delete out['content-length'];
      // Rewrite any redirect back to localhost so login round-trips stay local.
      if (out.location) out.location = String(out.location).replace('https://' + UPSTREAM, 'http://localhost:' + PORT);
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    }
  );
  upstream.on('error', function (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('upstream error: ' + e.message);
  });
  req.pipe(upstream);
});

server.listen(PORT, function () {
  console.log('');
  console.log('  Date-picker fix running at:  http://localhost:' + PORT);
  console.log('');
  console.log('  1. Open that URL and log in as normal.');
  console.log('  2. Go to the Team page (or the coaching dashboard).');
  console.log('  3. Click the date label, pick a start date, then an end date.');
  console.log('  4. Does the label change and the URL gain ?from=…&to=… ?');
  console.log('');
  console.log('  Nothing is deployed. Ctrl-C to stop.');
  console.log('');
});
