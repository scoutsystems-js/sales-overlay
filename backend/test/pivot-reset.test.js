/**
 * A REP PIVOT MUST NOT LEAVE ONE PERSON'S DATA UNDER ANOTHER PERSON'S NAME.
 *
 * ⚠⚠ THE DEFECT: `setUser` cleared TWO lanes and `reloadAll` two more, while
 * EIGHTEEN of the 22 rep-scoped lanes survived. A rep with ZERO calls rendered
 * "Discovery 43/100 across 150 graded calls" with quotes from two prospects he
 * had never spoken to — and nothing on screen said anything was wrong.
 *
 * ⚠ THE FIX IS OPT-IN SURVIVAL. A key added to `state` tomorrow is RESET by
 * default. The asymmetry is the argument: forgetting KEEP costs a refetch,
 * forgetting CLEAR shows the wrong person's coaching.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Execute the REAL state literal, PIVOT_KEEP and resetRepScopedState together.
function harness() {
  const i = HTML.indexOf('  var state = {');
  const j = HTML.indexOf('\n  function resetRepScopedState() {', i);
  const k = HTML.indexOf('\n  }', j) + 4;
  const src = HTML.slice(i, k);
  assert.ok(src.length > 2000 && src.length < 20000, 'slice must cover state + reset: ' + src.length);
  return new Function(src + '\n return { state: state, reset: resetRepScopedState, keep: PIVOT_KEEP, initial: INITIAL_STATE };')();
}

// Every lane whose contents belong to the VIEWED user. Derived from the fetches
// that switch on isSelf()/viewingUserId, plus the view state they drive.
const REP_SCOPED = [
  'analytics2', 'needsWork', 'perfSynthesis', 'sectionData', 'sectionRank',
  'callLibrary', 'callLibraryCounts', 'callLibraryOffset', 'callLibraryHasMore',
  'objectionsIntel', 'objectionsSynthesis', 'repGraph', 'overviewRecent',
  'callReview', 'selectedCallId', 'selectedSection', 'expandedGradeCards',
  'sectionExpanded', 'eodData', 'mergeCandidates', 'account',
];

test('⚠⚠ EVERY rep-scoped lane is cleared — this is the reported bug', () => {
  const h = harness();
  // Load the page up as though rep A had been viewed.
  REP_SCOPED.forEach((k) => { h.state[k] = 'REP_A_DATA'; });
  h.reset();
  const survived = REP_SCOPED.filter((k) => h.state[k] === 'REP_A_DATA');
  assert.deepStrictEqual(survived, [],
    'rep-scoped data survived the pivot: ' + survived.join(', '));
});

test('and each is restored to its DECLARED initial value, not just null', () => {
  const h = harness();
  h.state.mergeCandidates = ['x'];        // declared []
  h.state.expandedGradeCards = { a: 1 };  // declared {}
  h.state.callLibraryOffset = 40;         // declared 0
  h.reset();
  assert.deepStrictEqual(h.state.mergeCandidates, [], 'an array lane must stay an array');
  assert.deepStrictEqual(h.state.expandedGradeCards, {}, 'a map lane must stay a map');
  assert.strictEqual(h.state.callLibraryOffset, 0, 'a numeric lane must return to 0');
});

test('⚠ session, team and UI chrome SURVIVE — a pivot must not log you out or lose the window', () => {
  const h = harness();
  h.state.me = { user_id: 'me' };
  h.state.dateRange = { from: 'A', to: 'B', days: 30 };
  h.state.teamOverview = 'TEAM';
  h.state.teamSelected = 'mgr';
  h.state.viewingUserId = 'rep-b';
  h.state.view = 'call-library';
  h.reset();
  assert.deepStrictEqual(h.state.me, { user_id: 'me' });
  assert.deepStrictEqual(h.state.dateRange, { from: 'A', to: 'B', days: 30 });
  assert.strictEqual(h.state.teamOverview, 'TEAM', 'a rep pivot does not change the selected team');
  assert.strictEqual(h.state.viewingUserId, 'rep-b', 'the pivot target must not be wiped');
  assert.strictEqual(h.state.view, 'call-library', 'the Calls-page pivot stays on Calls');
});

test('⚠⚠ SURVIVAL IS OPT-IN — a NEW lane is reset by default', () => {
  const h = harness();
  // Simulate a lane somebody adds next month and forgets to think about.
  h.state.brandNewRepLane = 'REP_A_DATA';
  h.initial.brandNewRepLane = null;
  h.reset();
  assert.strictEqual(h.state.brandNewRepLane, null,
    'a lane not named in PIVOT_KEEP must reset without anyone remembering to add it');
});

test('⚠⚠ BOTH PIVOT DOORS CALL IT — patching one is a fix that is half unreachable', () => {
  // setUser (team/admin row) and setCallLibraryUser (the Calls rep picker).
  ['function setUser(', 'function setCallLibraryUser('].forEach(function (fn) {
    const at = LIVE.indexOf(fn);
    assert.ok(at !== -1, 'stale anchor: ' + fn);
    const src = LIVE.slice(at, LIVE.indexOf('\n  }', at));
    assert.ok(/resetRepScopedState\(\)/.test(src), fn + ' must reset rep-scoped state');
  });
  // And nothing hand-clears lanes beside it — that is the pattern being retired.
  const at = LIVE.indexOf('function setUser(');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(!/state\.needsWork\s*=\s*null/.test(src), 'hand-clearing individual lanes is the old defect');
});

test('the KEEP list names no rep-scoped lane — a typo there reopens the bug', () => {
  const h = harness();
  const wrong = REP_SCOPED.filter((k) => h.keep[k]);
  assert.deepStrictEqual(wrong, [], 'rep-scoped lanes must never be in PIVOT_KEEP: ' + wrong.join(', '));
});

/* ⚠⚠ THE TESTS ABOVE DRIVE `resetRepScopedState` DIRECTLY, which proves the
   helper works and says NOTHING about whether the pivot calls it. Restoring the
   original defect fails only ONE of them. These two execute the REAL pivot
   functions instead — the only shape that reproduces what Justin saw. */
function runPivot(fnName, extraGlobals) {
  const i = HTML.indexOf('  var state = {');
  const j = HTML.indexOf('\n  function resetRepScopedState() {', i);
  const k = HTML.indexOf('\n  }', j) + 4;
  const stateSrc = HTML.slice(i, k);

  const at = HTML.indexOf('  function ' + fnName + '(');
  assert.ok(at !== -1, 'stale anchor: ' + fnName);
  const end = HTML.indexOf('\n  }', at) + 4;
  const fnSrc = HTML.slice(at, end);
  assert.ok(fnSrc.length > 200 && fnSrc.length < 3000, fnName + ' slice: ' + fnSrc.length);

  // Everything the pivot touches that is not state: navigation and the reload.
  const stubs = `
    var __reloaded = 0, __rendered = 0;
    var window = { location: { href: 'https://x/dashboard?user=rep-a' }, history: { replaceState: function(){} } };
    var URL = function (h) { this.searchParams = { set: function(){}, delete: function(){} };
                             this.toString = function(){ return h; }; };
    var history = { replaceState: function(){} };
    function reloadAll(){ __reloaded++; }
    function renderCallLibrary(){ __rendered++; }
  ` + (extraGlobals || '');

  const f = new Function(stubs + stateSrc + fnSrc +
    '\n return { state: state, run: ' + fnName + ', reloaded: function(){ return __reloaded; }, rendered: function(){ return __rendered; } };');
  return f();
}

test('⚠⚠ RUNNING THE REAL setUser CLEARS THE PREVIOUS REP — end to end', () => {
  const h = runPivot('setUser');
  h.state.me = { user_id: 'me' };
  h.state.viewingUserId = 'rep-a';
  REP_SCOPED.forEach((k) => { h.state[k] = 'REP_A_DATA'; });

  h.run('rep-b');   // the actual pivot the manager triggers

  assert.strictEqual(h.state.viewingUserId, 'rep-b', 'the pivot must take effect');
  assert.ok(h.reloaded() >= 1, 'and must reload');
  const survived = REP_SCOPED.filter((k) => h.state[k] === 'REP_A_DATA');
  assert.deepStrictEqual(survived, [],
    "rep A's data survived a pivot to rep B: " + survived.join(', '));
});

test('⚠⚠ AND THE CALLS-PAGE PICKER TOO — the second door, same end-to-end test', () => {
  const h = runPivot('setCallLibraryUser');
  h.state.me = { user_id: 'me' };
  h.state.viewingUserId = 'rep-a';
  h.state.view = 'call-library';
  REP_SCOPED.forEach((k) => { h.state[k] = 'REP_A_DATA'; });

  h.run('rep-b');

  assert.strictEqual(h.state.viewingUserId, 'rep-b');
  assert.strictEqual(h.state.view, 'call-library', 'this door must not navigate away');
  const survived = REP_SCOPED.filter((k) => h.state[k] === 'REP_A_DATA');
  assert.deepStrictEqual(survived, [],
    "rep A's coaching survived a rep change on the Calls page: " + survived.join(', '));
});
