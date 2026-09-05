/**
 * THE REP-CARD SORT (H730): one of the card's four numbers, either direction; measured reps first;
 * average call time sorts by DISTANCE FROM THE BAND, not by size. And NAMES WHERE NAMES BELONG: the
 * coaching heads show the prospect's name, never the raw meeting title, and "Unknown prospect" when none.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));

function sorter(state) {
  const src = fnBody(LIVE, 'sortReps') + '\n' + fnBody(LIVE, 'repSortMetric') + '\n' + LIVE.match(/var REP_SORT_METRICS = \[[\s\S]*?\n  \];/)[0] + '\n return sortReps;';
  return new Function('state', src)(state);
}
const REPS = [
  { display_name: 'A', prospect_close_total: 10, prospect_close_rate: 10, obj_handle_rate: 40, avg_call_time: 60, avg_score: 70 },
  { display_name: 'B', prospect_close_total: 10, prospect_close_rate: 30, obj_handle_rate: 10, avg_call_time: 40, avg_score: 50 },
  { display_name: 'C', prospect_close_total: 10, prospect_close_rate: 20, obj_handle_rate: 25, avg_call_time: 25, avg_score: 60 },
  { display_name: 'Z', prospect_close_total: 0,  prospect_close_rate: null, obj_handle_rate: null, avg_call_time: null, avg_score: null },
];

test('closing, worst first (the default): measured reps ascending, the unmeasured rep last; flipped: best first', () => {
  const state = { teamOverview: { bands: { avg_call_time: { good: [35, 45] } } }, repSortKey: 'close', repSortDir: 'worst' };
  const sortReps = sorter(state);
  assert.deepStrictEqual(sortReps(REPS).map((r) => r.display_name), ['A', 'C', 'B', 'Z']);
  state.repSortDir = 'best';
  assert.deepStrictEqual(sortReps(REPS).map((r) => r.display_name), ['B', 'C', 'A', 'Z'], 'the direction comes from STATE when the section passes none — the live flip defect');
  assert.deepStrictEqual(sortReps(REPS, null, 'worst').map((r) => r.display_name), ['A', 'C', 'B', 'Z'], 'an explicit argument still wins');
});

test('⚠⚠ H736 (Justin, 2026-09-05): CALL TIME IS NEVER A SORT KEY — a stale "time" key falls back to closing, and the control never offers it; the default is closing BEST first', () => {
  /* CONVERTED: this asserted the band-distance sort for call time (H730). The ruling withdrew call time from the
     sort entirely — it stays on the card, never a rank, never a judgement. */
  const state = { teamOverview: { bands: { avg_call_time: { good: [35, 45] } } }, repSortKey: 'time', repSortDir: 'best' };
  assert.deepStrictEqual(sorter(state)(REPS).map((r) => r.display_name), ['B', 'C', 'A', 'Z'], 'a stale time key sorts by the first metric, closing');
  assert.ok(!/key: 'time'/.test(LIVE), 'no time entry in the sort metrics');
  assert.ok(/repSortKey: 'close', repSortDir: 'best'/.test(LIVE), 'closing, best first, is the default');
});

test('objections and grade sort by their number; the control offers exactly the three and a direction; the section uses it', () => {
  const state = { teamOverview: { bands: {} }, repSortKey: 'grade', repSortDir: 'worst' };
  assert.deepStrictEqual(sorter(state)(REPS).map((r) => r.display_name), ['B', 'C', 'A', 'Z']);
  state.repSortKey = 'obj';
  assert.deepStrictEqual(sorter(state)(REPS).map((r) => r.display_name), ['B', 'C', 'A', 'Z']);
  const metrics = LIVE.slice(LIVE.indexOf('var REP_SORT_METRICS = ['), LIVE.indexOf('];', LIVE.indexOf('var REP_SORT_METRICS = [')));
  assert.deepStrictEqual([...metrics.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]), ['close', 'obj', 'grade'], 'exactly the three, in this order — call time is out (H736)');
  assert.ok(/repSortControlHtml\(\)/.test(fnBody(LIVE, 'repCardsHtml')), 'the Reps section carries the control');
  assert.ok(/var reps = sortReps\(o\.per_rep \|\| \[\]\);/.test(fnBody(LIVE, 'repCardsHtml')), 'and sorts through it');
  assert.ok(!/35|45/.test(fnBody(LIVE, 'sortReps')), 'no band literal — the band comes from the wire');
});

test('⚠ names where names belong: the coaching heads show the prospect name, never the raw title, and "Unknown prospect" when there is none', () => {
  const esc = (s) => String(s == null ? '' : s);
  const pairFn = new Function('escapeHtml', 'formatTimestampDisplay', fnBody(LIVE, 'missedPairHtml') + '\n return missedPairHtml;')(esc, (s) => String(s));
  const pair = { signal: { timestamp_seconds: 1, quote: 'q' }, dq: { timestamp_seconds: 400, quote: 'd' }, gap_seconds: 399 };
  const named = pairFn(pair, { prospect_name: 'Tanya Howard', title: "Godwin Ona's Personal Meeting Room", call_date: '2026-09-02', callId: 'c1' });
  assert.ok(/Tanya Howard/.test(named) && !/Personal Meeting Room/.test(named));
  const unnamed = pairFn(pair, { prospect_name: null, title: "Godwin Ona's Personal Meeting Room", call_date: '2026-09-02', callId: 'c1' });
  assert.ok(/Unknown prospect/.test(unnamed) && !/Personal Meeting Room/.test(unnamed), 'silence beats a wrong name');
  const itemFn = new Function('escapeHtml', 'formatTimestampDisplay', 'missedPairHtml', fnBody(LIVE, 'coachableItemHtml') + '\n return coachableItemHtml;')(esc, (s) => String(s), pairFn);
  const item = itemFn({ kind: 'objection_unhandled', label: 'Objection left unhandled', call_id: 'c2', user_id: 'A', title: "Godwin Ona's Personal Meeting Room", prospect_name: null, call_date: '2026-09-01', moment: { timestamp_seconds: 10, speaker: 'PROSPECT', quote: 'q' }, consequence: 'The call did not close.' });
  assert.ok(/Unknown prospect/.test(item) && !/Personal Meeting Room/.test(item));
  const gather = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'coachable-team.js'), 'utf8'));   // H734: the route reads the one gather
  assert.ok(/select\('fathom_call_id, outcome, prospect_name'\)/.test(gather), 'the coachable gather SELECTS the name');
  assert.ok(/loadCoachableTeam\(admin, ids, range\.from, range\.to\)/.test(stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8'))), 'and the route calls it');
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coachable-moments.js'), 'utf8');
  assert.ok(/prospect_name: call\.prospect_name \|\| null/.test(lib), 'and the item carries it');
});
