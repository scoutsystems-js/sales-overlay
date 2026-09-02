'use strict';
/* ⚠⚠ WARM AFTER THE DRAIN, NOT BEFORE IT.
   The recommendations warm-up used to run inside sync-all, straight after the
   analyses were DISPATCHED — fire-and-forget — so it warmed a fingerprint the
   analyses then changed (evidenced 2026-09-01: cron 16:29, 19 analyses landed
   during 16:xx, a page visit wrote a fresh cache row at 16:45 — a miss).
   ⚠ THE KEY IS CORRECT. THE TIMING IS WRONG. So each analyze loop calls this
   when its last call is done: if any claim is still LIVE, another loop is
   still running and will call it in turn; the last one to finish sees none
   and warms. A claim older than the claim window is stranded, not draining —
   counting it would mean the warm-up never runs again after one stuck row. */
var { membersByManager } = require('./team-membership');
var { emailMapFor } = require('./email-map');

async function warmWhenDrained(admin, deps) {
  deps = deps || {};
  var now = typeof deps.now === 'number' ? deps.now : Date.now();
  var staleMs = typeof deps.staleMs === 'number' ? deps.staleMs : require('./analysis-worker')._CLAIM_STALE_MS;
  var warm = deps.warm || require('./team-warm').warmTeamRecommendations;
  try {
    var cutoff = new Date(now - staleMs).toISOString();
    var live = await admin.from('call_analyses').select('id')
      .eq('status', 'processing').gte('analyzed_at', cutoff).limit(200);
    if (live.error) throw new Error('call_analyses: ' + live.error.message);
    var n = (live.data || []).length;
    if (n > 0) {
      console.log('[team-warm] deferred — ' + n + ' analysis claim(s) still live; the last loop to finish will warm');
      return { skipped: 'draining', live: n };
    }
    var profs = await admin.from('user_profiles').select('user_id, managed_by');
    if (profs.error) throw new Error('user_profiles: ' + profs.error.message);
    var managers = membersByManager(profs.data || []);
    if (Object.keys(managers).length === 0) {
      console.log('[team-warm] nothing to warm — no manager has reps');
      return { skipped: 'no_managers' };
    }
    var emailMap = {};
    try { emailMap = await emailMapFor(admin); }
    catch (e) { console.warn('[team-warm] emailMap failed (names degrade): ' + (e.message || 'unknown')); }
    var summary = await warm(admin, { managers: managers, emailMap: emailMap });
    return { summary: summary };
  } catch (err) {
    var bug = (err instanceof ReferenceError) || (err instanceof TypeError);
    console.error('[team-warm] after-drain ' + (bug ? 'BUG' : 'failed') + ': ' + (err.message || 'unknown'));
    if (bug) console.error((err.stack || '').split('\n').slice(0, 4).join('\n'));
    return { error: err.message || 'unknown' };
  }
}

module.exports = { warmWhenDrained: warmWhenDrained };
