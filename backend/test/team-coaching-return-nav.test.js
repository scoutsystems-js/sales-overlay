'use strict';
/* BLOCK 010 (SCOUT-SHARED-CONTEXT.md) — REVIEW FULL CALL AND BACK. A manager on Team → Coaching picks a rep, opens
   the example's Review Full Call, and presses the browser's back button. Before this block the selected rep was LOST
   on the way back: the click pivots the dashboard to the rep (which resets every rep-scoped field, the selection
   included), the hash never carried the selection, and the return's view-change reset nulled it again — so the page
   re-selected its default rep and the manager had to find theirs again. Executed on the REAL page functions
   (openCallReview, setUser, syncHashFromState, applyHashToState, onRouteChange, resetTeamData, selectCoachingRep)
   over a history stack shaped like a browser's; render and the loaders are recorded stubs. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const live = stripComments(fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'));
function varBlock(name) { const lines = live.split('\n'); const s = lines.findIndex(l => l.startsWith('  var ' + name + ' = ')); assert.ok(s >= 0, 'var ' + name); if (!/[\[{]\s*$/.test(lines[s])) return lines[s]; let e = s; while (!/^  [\]}];\s*$/.test(lines[e])) e++; return lines.slice(s, e + 1).join('\n'); }
const FNS = ['openCallReview', 'setUser', 'resetRepScopedState', 'syncHashFromState', 'viewToHashPath', 'rangeHashSuffix', 'teamRangeHashSuffix', 'coachingRepHashSuffix', 'coachingRangeHashSuffix', 'hasManagerContext', 'isSelf', 'pivoted', 'applyHashToState', 'onRouteChange', 'resetTeamData', 'teamRange', 'teamRangePage', 'parseRangeFromHash', 'isTeamView', 'rangeToIso', 'ymd', 'selectCoachingRep'];
const VARS = ['state', 'PIVOT_KEEP', 'TEAM_LANE_SCOPE', 'TEAM_RANGE_PAGE', 'TEAM_PAGES', 'TEAM_SUBVIEWS'];
function harness() {
  return new Function('script', VARS.map(varBlock).join('\n') + '\nvar INITIAL_STATE = JSON.parse(JSON.stringify(state));\n' + FNS.map(n => fnBody(live, n)).join('\n') + `
    var viewEpoch = 0, teamEpoch = 0, calls = [];
    var hist = ['http://x/dashboard#team-coaching?from=2026-08-12&to=2026-09-11'];
    var window = { get location() { var u = new URL(hist[hist.length - 1]); return { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash }; },
      history: { pushState: function (a, b, url) { hist.push(new URL(url, hist[hist.length - 1]).href); }, replaceState: function (a, b, url) { hist[hist.length - 1] = new URL(url, hist[hist.length - 1]).href; } },
      scrollTo: function () {}, addEventListener: function () {} };
    var document = { getElementById: function () { return null; } };
    function render() { calls.push('render ' + state.view); } function loadCallReview(id) { calls.push('loadCallReview ' + id + ' as ' + state.viewingUserId); }
    function reloadAll() { calls.push('reloadAll ' + state.viewingUserId); } function loadRepFilter() {}
    function ensureTeamDefaultRange() { if (!state.teamRanges[teamRangePage()]) state.teamRanges[teamRangePage()] = { from: '2026-09-04', to: '2026-09-11' }; }
    function armLaneWait() {} function clearLaneWait() {} function renderOverview() {}
    state.me = { user_id: 'mgr', role: 'manager' }; state.viewingUserId = 'mgr'; state.view = 'team-coaching';
    state.teamRanges = { coaching: { from: '2026-08-12', to: '2026-09-11' } }; state.teamRangeInit = { coaching: true };
    state.teamCoachable = { reps: [{ user_id: 'repA' }, { user_id: 'repB' }] };
    function back() { hist.pop(); onRouteChange(); }
    function snap() { return { view: state.view, viewing: state.viewingUserId, call: state.selectedCallId, rep: state.coachingSelectedRep, range: state.teamRanges.coaching, url: hist[hist.length - 1], depth: hist.length, data: state.teamCoachable ? 'present' : 'null' }; }
    return script({ state: state, back: back, snap: snap, calls: calls, hist: hist, selectCoachingRep: selectCoachingRep, openCallReview: openCallReview, onRouteChange: onRouteChange });
  `);
}
test('Review Full Call opens the exact call as its owner on a NEW history entry, and back restores the same rep and window on Team → Coaching', () => {
  const r = harness()(h => {
    h.selectCoachingRep('repB');
    const picked = h.snap();
    h.openCallReview('callB7', 'repB');
    const opened = h.snap();
    h.back();
    return { picked, opened, returned: h.snap(), calls: h.calls };
  });
  assert.equal(r.picked.rep, 'repB'); assert.match(r.picked.url, /#team-coaching\?from=2026-08-12&to=2026-09-11&rep=repB$/, 'selecting a rep writes it into the page\'s own URL, without a new history entry');
  assert.equal(r.picked.depth, 1);
  assert.equal(r.opened.view, 'call-review'); assert.equal(r.opened.call, 'callB7'); assert.equal(r.opened.viewing, 'repB', 'the review loads as the call\'s owner');
  assert.equal(r.opened.depth, 2, 'the call is a new history entry, so back works'); assert.match(r.opened.url, /\?user=repB#call\/callB7$/);
  assert.ok(r.calls.includes('loadCallReview callB7 as repB'));
  assert.equal(r.returned.view, 'team-coaching');
  assert.equal(r.returned.rep, 'repB', 'the rep the manager was coaching is still selected after back');
  assert.equal(r.returned.range.from.slice(0, 10), '2026-08-12'); assert.equal(r.returned.range.to.slice(0, 10), '2026-09-11');
  assert.equal(r.returned.data, 'null', 'the period data refetches on return (H754), the selection does not reset');
});
test('two reps in a row: each Review Full Call opens its own call as its own owner; the second selection never carries the first', () => {
  const r = harness()(h => {
    h.selectCoachingRep('repA'); h.openCallReview('callA1', 'repA'); const a = h.snap(); h.back();
    const backA = h.snap();
    h.selectCoachingRep('repB'); h.openCallReview('callB7', 'repB'); const b = h.snap(); h.back();
    return { a, backA, b, backB: h.snap() };
  });
  assert.deepEqual([r.a.call, r.a.viewing], ['callA1', 'repA']); assert.equal(r.backA.rep, 'repA');
  assert.deepEqual([r.b.call, r.b.viewing], ['callB7', 'repB']); assert.equal(r.backB.rep, 'repB');
  assert.match(r.backB.url, /rep=repB$/);
});
test('a pasted or refreshed Team → Coaching URL that names a rep selects that rep; one without a rep leaves the default', () => {
  const r = harness()(h => {
    h.hist[0] = 'http://x/dashboard#team-coaching?from=2026-08-12&to=2026-09-11&rep=repB'; h.state.coachingSelectedRep = null; h.onRouteChange();
    const named = h.snap();
    h.hist[0] = 'http://x/dashboard#team-coaching?from=2026-08-12&to=2026-09-11'; h.state.coachingSelectedRep = null; h.onRouteChange();
    return { named, plain: h.snap() };
  });
  assert.equal(r.named.rep, 'repB'); assert.equal(r.plain.rep, null);
});
