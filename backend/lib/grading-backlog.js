/* Grading backlog — HOW MANY OF A USER'S CALLS ARE GRADED, AND HOW MANY ARE WAITING.
 *
 * ⚠⚠ THIS EXISTS BECAUSE THE ANSWER WAS ONLY REACHABLE THROUGH A FATHOM ROUTE.
 * The counts are a property of the USER'S CALLS — `fathom_calls` holds Zoom rows
 * too — but they were computed inside GET /fathom/status, which early-returns
 * `{connected:false}` when there is no fathom_connections row. So a ZOOM-ONLY
 * user got no counts at all, `gradeBacklogWorkCount()` read 0, and the grading
 * control did not render ANYWHERE on their dashboard. Measured on the live
 * account that reported it: 123 calls, 19 graded, 102 waiting, and no button.
 *
 * ⚠ The Calls page still printed "102 not graded yet" beside that missing
 * control, because the COUNT query is source-agnostic and the CONTROL's gate was
 * not. Naming a problem and offering nothing to do about it is the defect this
 * module removes — see the standing ruling in CLAUDE.md.
 *
 * WHAT EACH NUMBER MEANS, and they are not interchangeable:
 *   total    every call that counts toward anything (marked + duplicate excluded)
 *   graded   sync_status='processed' — an analysis ran to completion
 *   waiting  sync_status='pending'  — queued, NOT yet attempted
 *   work     what the grading button would actually dispatch: waiting + outdated
 *
 * ⚠ `graded` uses sync_status rather than a join to call_analyses, deliberately:
 * a head-count is one cheap query and this runs on every dashboard boot. The
 * cost is that a row mid-analysis ('processing') counts as graded — measured at
 * 6 of 1370 platform-wide, only ever during an active drain, and self-correcting
 * within a minute. It can be a few seconds EARLY; it can never claim work is
 * finished while `waiting` is non-zero, which is the property the card depends on.
 */

// Calls graded under an older prompt version — the "outdated" half of `work`.
// ⚠ MOVED HERE FROM routes/fathom.js: it answers a backlog question, not a
// route question, and two callers now need it. routes/fathom.js imports it.
async function outdatedCallIds(admin, userId, currentVersion) {
  var out = [];
  var PAGE = 1000;
  var offset = 0;
  while (true) {
    var q = await admin
      .from('call_analyses')
      .select('fathom_call_id, prompt_version')
      .eq('user_id', userId)
      .eq('status', 'done')
      .order('analyzed_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (q.error) throw new Error('call_analyses: ' + q.error.message);
    var rows = q.data || [];
    /* ⚠⚠ MARKED CALLS ARE EXCLUDED FROM THE OUTDATED COUNT — DECIDED, NOT
       OVERLOOKED. This count drives a BULK re-grade that spends two Claude calls
       per row. Re-grading a call excluded from every metric buys nothing.
       ⚠ THE TEST IS CONSISTENCY: if a marked call should never be re-analysed,
       it must not be COUNTED as pending re-analysis either — otherwise the
       button offers work it should not do, and the number never reaches zero.
       ⚠ This does NOT touch re-analysis ON TOGGLE, a targeted re-run triggered
       by the mark/un-mark itself. Different path, different purpose. */
    var markedOut = {};
    var ids0 = rows.map(function (r) { return r.fathom_call_id; }).filter(Boolean);
    for (var mi = 0; mi < ids0.length; mi += 100) {
      var mq = await admin.from('fathom_calls').select('id')
        .in('id', ids0.slice(mi, mi + 100))
        .eq('not_a_sales_call', true);
      (mq.data || []).forEach(function (c) { markedOut[c.id] = true; });
    }
    for (var i = 0; i < rows.length; i++) {
      if (markedOut[rows[i].fathom_call_id]) continue;
      if (rows[i].prompt_version !== currentVersion) out.push(rows[i].fathom_call_id);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Three head-counts on fathom_calls plus the outdated sweep. Source-agnostic by
// construction — nothing here filters on `source`.
async function gradingBacklog(admin, userId, currentVersion) {
  function base() {
    return admin.from('fathom_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null);
  }
  var totalP   = base();
  var gradedP  = base().eq('sync_status', 'processed');
  var waitingP = base().eq('sync_status', 'pending');

  var total = await totalP, graded = await gradedP, waiting = await waitingP;

  // ⚠ NON-FATAL, AND THE DIRECTION MATTERS. On error the count degrades to 0,
  // which HIDES work rather than inventing it — the same choice the status route
  // already made. A card that under-reports is wrong; one that offers a button
  // for calls that do not exist sends someone to spend money on nothing.
  var outdated = 0;
  try {
    if (currentVersion) outdated = (await outdatedCallIds(admin, userId, currentVersion)).length;
  } catch (err) {
    console.error('[grading-backlog] outdated count failed for user ' + userId + ': ' + err.message);
  }

  var t = (typeof total.count   === 'number') ? total.count   : 0;
  var g = (typeof graded.count  === 'number') ? graded.count  : 0;
  var w = (typeof waiting.count === 'number') ? waiting.count : 0;

  return {
    total: t,
    graded: g,
    waiting: w,
    outdated: outdated,
    // What the grading button would dispatch. Kept SEPARATE from `waiting`
    // because they answer different questions: `waiting` decides whether the
    // setup card may disappear, `work` decides whether a control renders.
    work: w + outdated,
  };
}

module.exports = { gradingBacklog: gradingBacklog, outdatedCallIds: outdatedCallIds };
