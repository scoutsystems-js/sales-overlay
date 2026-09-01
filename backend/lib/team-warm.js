'use strict';
/**
 * ⚠⚠ WARM THE TEAM RECOMMENDATIONS LANE — approved 2026-09-01 after measuring.
 *
 *   COLD (cache miss, one model call)   25,855 ms
 *   WARM (cache hit)                     1,505 – 4,418 ms
 *
 * It is ONE synthesis now (removing Objection Handling Focus removed its model
 * call, not just its markup), and the slow case is a COLD CACHE — so the first
 * manager to open Scout each morning paid the whole 26 seconds and everyone
 * after paid nothing. This is a WARMING problem, not a rendering one.
 *
 * ⚠ THE WARM FLOOR IS DELIBERATELY LEFT ALONE. Three awaited loads run before
 * `cacheGet` because the key is a fingerprint OF THE DATA, so the data must be
 * read before the key can exist. Cutting that means changing what the key is
 * computed from — an invalidation-risk design change, not a tweak.
 *
 * ⚠⚠ THE ENTIRE RISK IN THIS FILE IS THE KEY. A warm-up keyed differently from
 * the read is INDISTINGUISHABLE FROM NO WARM-UP AT ALL: the cron burns a model
 * call, writes a row nobody hits, and the first manager still waits 26 seconds
 * with nothing to show anyone why. So the window here is not "about 30 days" —
 * it is byte-for-byte the string the client sends. See `defaultTeamWindow`.
 */
const { computeTeamRecommendations } = require('./team-synthesis');
const { nameMapFor } = require('./team-name-map');

/**
 * ⚠⚠ THIS MUST MIRROR `ensureTeamDefaultRange` + `rangeToIso` IN dashboard.html,
 * EXACTLY. Both halves matter:
 *
 *   from = (today - 29 days) + 'T00:00:00.000Z'
 *   to   =  today            + 'T23:59:59.999Z'
 *
 * ⚠ AND THE FACT THAT MAKES THIS WORKABLE AT ALL: the client's window is
 * DAY-ANCHORED, not click-time-anchored. If it were `new Date()` at click time,
 * the cron and the page would compute different windows every single load — the
 * data query uses the EXACT from/to, so a window that differs by hours can
 * include a call the other excludes, producing a different hash and a guaranteed
 * miss. Because both ends snap to a day, the cron reproduces the string.
 *
 * ⚠ KNOWN AND ACCEPTED: a cron run just before UTC midnight warms the OLD day,
 * and a manager loading just after gets a miss. Self-healing on the next run,
 * and not worth a special case.
 *
 * ⚠ A MISS BECAUSE A CALL WAS ANALYSED IN BETWEEN IS CORRECT, NOT A FAILURE —
 * the data genuinely changed and the synthesis should be rebuilt.
 */
function defaultTeamWindow(now) {
  var t = (now instanceof Date) ? now.getTime() : Date.now();
  var today = new Date(t).toISOString().slice(0, 10);
  var monthAgo = new Date(t - 29 * 86400000).toISOString().slice(0, 10);
  return { from: monthAgo + 'T00:00:00.000Z', to: today + 'T23:59:59.999Z' };
}

/**
 * Warm one manager's recommendations for the window their page will ask for.
 * Returns 'warmed' | 'cached' | 'empty' | 'unavailable'.
 */
async function warmOneManager(admin, keyId, memberIds, emailMap, now) {
  var win = defaultTeamWindow(now);
  var nameMap = await nameMapFor(admin, memberIds, emailMap || {});
  var out = await computeTeamRecommendations(admin, keyId, memberIds, win.from, win.to, emailMap || {}, nameMap);
  if (!out) return 'unavailable';
  if (out.cached) return 'cached';
  if (out.available === false) return 'unavailable';
  if (!(out.working || []).length && !(out.improve || []).length) return 'empty';
  return 'warmed';
}

/**
 * Warm every manager. Per-manager error isolation, same as the digest pass.
 *
 * ⚠⚠ AND THE SUMMARY MUST NOT READ AS NORMAL WHEN NOTHING WAS WARMED. The
 * digest pass is error-isolated with one console line, and THAT ISOLATION IS
 * EXACTLY WHAT HID TWO DAYS OF MISSING DIGESTS. A silent failure here means the
 * first manager pays full price and nobody knows why — so a total failure says
 * so in words, and a programmer error gets its stack while an operational one
 * does not.
 */
async function warmTeamRecommendations(admin, opts) {
  var now = (opts && opts.now) || undefined;
  var managers = (opts && opts.managers) || null;   // {keyId: memberIds[]}
  var emailMap = (opts && opts.emailMap) || {};
  var summary = { managers: 0, warmed: 0, cached: 0, empty: 0, unavailable: 0, errors: 0 };
  var ids = managers ? Object.keys(managers) : [];
  summary.managers = ids.length;
  for (var i = 0; i < ids.length; i++) {
    var keyId = ids[i];
    try {
      var r = await warmOneManager(admin, keyId, managers[keyId], emailMap, now);
      summary[r] = (summary[r] || 0) + 1;
    } catch (err) {
      summary.errors++;
      var bug = (err instanceof ReferenceError) || (err instanceof TypeError);
      console.error('[team-warm] ' + (bug ? 'BUG' : 'failed') + ' for ' + keyId + ': ' + (err.message || 'unknown'));
      if (bug) console.error((err.stack || '').split('\n').slice(0, 4).join('\n'));
    }
  }
  if (summary.managers > 0 && summary.warmed === 0 && summary.cached === 0) {
    console.error('[team-warm] NOTHING WARMED for ' + summary.managers
      + ' manager(s) — the first manager of the day will pay the full cold cost. '
      + JSON.stringify(summary));
  } else {
    console.log('[team-warm] ' + JSON.stringify(summary));
  }
  return summary;
}

module.exports = {
  warmTeamRecommendations: warmTeamRecommendations,
  _defaultTeamWindow: defaultTeamWindow,
  _warmOneManager: warmOneManager,
};
