// lib/eod-freshness.js — is the EOD day finished, or still filling up?
//
// ⚠⚠ WHY THIS EXISTS. Josh's EOD showed 3 calls for a day he took 6 on. The 3
// was CORRECT: two of the missing calls had not synced yet (his last sync was
// 22:34 and the ET day runs to 04:00Z), and the third exists only in Zoom, which
// that account is not connected to.
//
// So nothing was broken and the page was still misleading — because "3" and
// "3 so far" render identically, and only one of them is true. A count that
// omits without saying it omits is the failure this product keeps hitting.
//
// ⚠ THE FIX IS THE WORDING, NOT THE NUMBER. Inflating the count would put calls
// on the page that the data cannot support.
//
// Pure and total. No I/O, never throws.

'use strict';

/**
 * date        'YYYY-MM-DD' — the ET day being shown
 * lastSyncAt  ISO string, or null if the connection has never synced
 * dayEndsIso  ISO string — the UTC instant the ET day ends (from etDayBoundsUtc)
 * connected   false when there is no recording source at all
 * now         Date (injectable for tests)
 *
 * returns { connected, complete, synced_through }
 *   complete = every call that could belong to this day has had a chance to
 *   arrive, i.e. a sync ran AFTER the day ended.
 */
function syncFreshness(opts) {
  var o = opts || {};
  var connected = o.connected !== false;
  var last = typeof o.lastSyncAt === 'string' ? o.lastSyncAt : null;

  /* ⚠ NEVER SYNCED IS NOT SYNCED-AND-EMPTY. A connection with no sync cannot
     claim the day is complete, and must not invent a "synced through" time —
     the same absent-vs-known-absent rule that governs the null writes. */
  if (!connected || !last) {
    return { connected: connected, complete: false, synced_through: null };
  }

  var lastMs = Date.parse(last);
  var endMs = Date.parse(o.dayEndsIso);
  if (isNaN(lastMs) || isNaN(endMs)) {
    return { connected: connected, complete: false, synced_through: null };
  }

  /* ⚠ COMPLETE MEANS "A SYNC RAN AFTER THE DAY ENDED", not "the sync is recent".
     A historical day synced days later is fully complete, and warning on it
     would be noise — which is how a real warning gets ignored. */
  return {
    connected: connected,
    complete: lastMs >= endMs,
    synced_through: last,
  };
}

module.exports = { syncFreshness: syncFreshness };
