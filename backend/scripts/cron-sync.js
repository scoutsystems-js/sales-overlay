// Railway cron entrypoint for the Fathom auto-sync (Phase 1.5).
//
// Configure in Railway as a SEPARATE service off the same repo (so it doesn't
// disturb the always-on web service):
//   Start command:  node backend/scripts/cron-sync.js
//   Cron schedule:  0 */2 * * *          (every 2 hours)
//   Variables:      CRON_SECRET, BACKEND_URL   (shared from the web service)
//
// It POSTs the internal /fathom/sync-all endpoint with the shared secret; that
// endpoint iterates every connected user and syncs+analyzes new calls. Node 20+
// has a global fetch, so there are no dependencies to install.
//
// Alternative trigger (no second Railway service): any external scheduler
// (GitHub Actions `schedule:` workflow, cron-job.org) can hit the same endpoint:
//   curl -fsS -X POST "$BACKEND_URL/fathom/sync-all" -H "X-Cron-Secret: $CRON_SECRET"

var BACKEND_URL = process.env.BACKEND_URL || 'https://sales-overlay-production.up.railway.app';
var SECRET = process.env.CRON_SECRET;

(async function () {
  if (!SECRET) {
    console.error('[cron-sync] CRON_SECRET not set — aborting');
    process.exit(1);
  }
  var url = BACKEND_URL.replace(/\/+$/, '') + '/fathom/sync-all';
  try {
    var res = await fetch(url, { method: 'POST', headers: { 'X-Cron-Secret': SECRET } });
    var body = await res.text();
    console.log('[cron-sync] ' + res.status + ' ' + body.slice(0, 800));
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.error('[cron-sync] request failed: ' + (e && e.message || e));
    process.exit(1);
  }
})();
