/* ACCOUNT HEALTH SNAPSHOT — generated on demand, attached to a support ticket.
 *
 * ⚠⚠ IT IS NOT A DASHBOARD AND MUST NOT BECOME ONE. It answers ONE question:
 * "this person says X is broken — what is actually true for them?" The ticket
 * list is the only surface a human sees.
 *
 * ⚠⚠ IT LEADS WITH WHAT THE USER CAN SEE, NOT WITH SYSTEM STATE — that ordering
 * is the whole design. Both tickets this week were reported as broken syncs and
 * NEITHER was one:
 *   · Josh    — recording locally, so Zoom exposed nothing. Working sync, no data.
 *   · Godwin  — 121 calls fetched, 121 inserted, 20 graded by the first-sync cap,
 *               and NOTHING ON HIS SCREEN about the other 101.
 * A snapshot reporting system state alone would have answered Godwin with
 * "everything is fine", which is what a human had already told him. The gap
 * between what is true and what he could SEE was the entire ticket.
 *
 * ⚠ COST. One call runs a bounded set of queries — 3 fixed (profile, both
 * connection tables) plus 5 head-counts and one small select per provider. No
 * model calls, no transcript reads, nothing unbounded: the counts are
 * `head: true`, so no rows cross the wire. Support tools get run at the worst
 * moment, so this must stay cheap and must never page a whole table.
 */

// What a person can see about their own backlog, in the words the page uses.
// ⚠ DERIVED FROM THE SAME NUMBERS THE PAGE READS, never re-counted a second way
// — a snapshot that disagrees with the screen is worse than no snapshot.
function visibleState(o) {
  var out = [];
  if (!o.connected) {
    out.push('No recording source connected — the dashboard asks them to connect one.');
    return out;
  }
  out.push('Connected: ' + o.providers.join(' + ') + '.');

  if (o.total === 0) {
    out.push('No calls have synced yet, so every panel is empty and correctly says so.');
    return out;
  }
  out.push(o.graded + ' of ' + o.total + ' calls are graded.');

  if (o.waiting > 0) {
    /* ⚠ THE GODWIN CASE, NAMED EXPLICITLY. Grading is capped when calls first
       arrive, so a large import legitimately leaves most calls ungraded — and
       until 2026-08-26 the setup card removed itself after ONE graded call and
       said "your recent calls are graded". */
    /* ⚠ Grading is OWNER-ONLY since 2026-09-02: the count is shown to everyone,
       the control only to an owner. */
    out.push(o.waiting + ' are waiting. They see this on the Calls page and in '
      + 'Account -> Connections; grading is handled by an admin (owner-only since 2026-09-02).');
    if (o.first_sync_capped) {
      out.push('⚠ Their FIRST sync brought in ' + o.last_sync.inserted + ' calls and graded '
        + o.last_sync.analyzed + ' — the cap. The rest have always needed a manual run.');
    }
  } else {
    out.push('Nothing is waiting to be graded.');
  }

  if (o.failed_retryable > 0) out.push(o.failed_retryable + ' failed and can be retried.');
  if (o.failed_permanent > 0) {
    out.push(o.failed_permanent + ' cannot be graded at all (no transcript). '
      + 'Retrying will not help and the page says so.');
  }
  return out;
}

// The one-line verdict a support person reads first.
// ⚠ THREE OUTCOMES, AND THE MIDDLE ONE IS THE POINT: "working, but they cannot
// see it" is a real answer and the commonest one so far. Collapsing it into
// "working" is how Godwin got told nothing was wrong twice.
function verdict(o) {
  if (!o.connected) return 'ACTION NEEDED — no recording source is connected.';
  if (o.connected && o.last_sync.status === 'error') {
    return 'BROKEN — the last sync failed: ' + (o.last_sync.error || 'reason not recorded');
  }
  if (o.total === 0) {
    return o.last_sync.fetched === 0
      ? 'WORKING, NOTHING TO READ — the sync ran and the provider returned no recordings. '
        + 'Check their recording settings, not Scout.'
      : 'WORKING — synced, nothing stored yet.';
  }
  if (o.waiting > 0) {
    return 'WORKING, BUT INCOMPLETE ON SCREEN — ' + o.graded + ' of ' + o.total
      + ' graded, ' + o.waiting + ' waiting on a manual run.';
  }
  return 'HEALTHY — everything synced is graded.';
}


/* Gather the facts. ⚠ Everything here is a HEAD COUNT or a single small row —
   nothing pages a table, because a support tool is run when things are already
   going badly. */
async function buildSnapshot(admin, userId, deps) {
  deps = deps || {};
  var classifyFailure = deps.classifyFailure || function () { return 'retryable'; };

  var prof = await admin.from('user_profiles')
    .select('first_name, last_name, role, managed_by, active, team_name').eq('user_id', userId).maybeSingle();
  var fc = await admin.from('fathom_connections')
    .select('fathom_email, connected_at, last_sync_at, last_sync_status, last_sync_error, last_sync_fetched, last_sync_inserted, last_sync_analyzed, sync_window')
    .eq('user_id', userId).maybeSingle();
  var zc = await admin.from('call_connections')
    .select('external_account_email, connected_at, expires_at, last_sync_at, last_sync_status, last_sync_error, last_sync_fetched, last_sync_inserted, last_sync_analyzed')
    .eq('user_id', userId).eq('provider', 'zoom').maybeSingle();

  function base() {
    return admin.from('fathom_calls').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('not_a_sales_call', 'is', true).is('duplicate_of', null);
  }
  var total   = (await base()).count || 0;
  var graded  = (await base().eq('sync_status', 'processed')).count || 0;
  var waiting = (await base().eq('sync_status', 'pending')).count || 0;
  var marked  = (await admin.from('fathom_calls').select('id', { count: 'exact', head: true })
                   .eq('user_id', userId).eq('not_a_sales_call', true)).count || 0;

  /* ⚠ FAILED CALLS SPLIT IN TWO. "Can be retried" is an action; "will never
     work" is a fact. Folding them together leaves a number that never reaches
     zero, and a number that never reaches zero stops being read. */
  var failedRows = await admin.from('fathom_calls').select('id, call_date')
    .eq('user_id', userId).eq('sync_status', 'error')
    .not('not_a_sales_call', 'is', true).is('duplicate_of', null);
  var failed = (failedRows.data || []);
  var reasons = {};
  if (failed.length) {
    var fa = await admin.from('call_analyses').select('fathom_call_id, overall_summary, highlight_error')
      .in('fathom_call_id', failed.map(function (r) { return r.id; })).eq('status', 'error');
    (fa.data || []).forEach(function (a) { reasons[a.fathom_call_id] = a.overall_summary; });
  }
  var permanent = 0;
  failed.forEach(function (r) { if (classifyFailure(reasons[r.id], r.call_date) === 'permanent') permanent++; });

  /* ⚠ THE NEW COLUMN, SURFACED. A highlight failure is non-fatal, so a call can
     be graded and still carry nothing to coach from — invisible before this. */
  var hlErr = (await admin.from('call_analyses').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).not('highlight_error', 'is', null)).count || 0;

  /* ⚠⚠ UNEMBEDDED COACHING MOMENTS. An embedding failure degrades CORRECTLY —
     the row is still written and still keyword-searchable — which is precisely
     why 386 of them accumulated over two days with nobody noticing. A correct
     silent degrade needs a place it becomes visible, and this is it. */
  var unembedded = (await admin.from('knowledge_base').select('id', { count: 'exact', head: true })
    .eq('uploaded_by', userId).eq('metadata->>category', 'call_moment').is('embedding', null)).count || 0;

  var providers = [];
  if (fc.data) providers.push('Fathom');
  if (zc.data) providers.push('Zoom');
  var conn = zc.data || fc.data || null;

  var o = {
    user: {
      name: [(prof.data || {}).first_name, (prof.data || {}).last_name].filter(Boolean).join(' ') || null,
      role: (prof.data || {}).role || null,
      active: (prof.data || {}).active !== false,
      has_manager: !!(prof.data || {}).managed_by,
    },
    connected: providers.length > 0,
    providers: providers,
    connections: {
      fathom: fc.data ? { identity: fc.data.fathom_email, connected_at: fc.data.connected_at, window: fc.data.sync_window } : null,
      zoom:   zc.data ? { identity: zc.data.external_account_email, connected_at: zc.data.connected_at, token_expires: zc.data.expires_at } : null,
    },
    last_sync: {
      at:       conn ? conn.last_sync_at : null,
      status:   conn ? conn.last_sync_status : null,
      error:    conn ? conn.last_sync_error : null,
      /* ⚠ NULL means no sync has completed since these columns shipped — NOT
         "found nothing". 0 is "found nothing". They are different answers. */
      fetched:  conn ? conn.last_sync_fetched : null,
      inserted: conn ? conn.last_sync_inserted : null,
      analyzed: conn ? conn.last_sync_analyzed : null,
    },
    total: total, graded: graded, waiting: waiting, not_a_sales_call: marked,
    failed_retryable: failed.length - permanent,
    failed_permanent: permanent,
    calls_with_no_highlights: hlErr,
    unembedded_moments: unembedded,
    // A first sync whose grading was capped is the commonest "nothing happened".
    first_sync_capped: !!(conn && conn.last_sync_inserted > 0
      && conn.last_sync_analyzed != null && conn.last_sync_analyzed < conn.last_sync_inserted),
  };
  o.verdict = verdict(o);
  o.what_they_see = visibleState(o);
  return o;
}

module.exports = { visibleState: visibleState, verdict: verdict, buildSnapshot: buildSnapshot };
