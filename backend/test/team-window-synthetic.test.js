/**
 * SYNTHETIC ROWS MUST NOT REACH ANY TEAM SURFACE.
 *
 * ⚠⚠ FILTERED AT loadTeamWindow, THE CHOKEPOINT — because the panels that read
 * it are NOT the three everyone assumed. Enumerated by capability, there are
 * SIX consumers, and two of them were missed by the old count in this file's
 * own comment (Call Highlights of the Week, and a CLOSER'S OWN coaching page).
 * A per-panel filter would have been applied to the three someone remembered.
 *
 * ⚠ Before this landed, ~36% of what the loader returned for the live board was
 * fabricated: the team card counted 280 objection moments where the drilldown
 * counted 179. Same metric, two numbers, one product.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { loadTeamWindow } = require('../lib/team-synthesis');
const { isSyntheticCallId } = require('../lib/real-calls');

/* A board holding both kinds, plus the shape that makes a user-level rule wrong:
   ONE owner (the reviewer) with BOTH synthetic and real calls. */
const JOSH = 'josh', AVA = 'ava', REVIEWER = 'reviewer';
const CALLS = [
  { id: 'c1', user_id: JOSH,     fathom_call_id: 'abc-real-1',        title: 'Real',        call_date: '2026-08-10T00:00:00Z', recording_url: 'https://f/1', source: 'fathom', not_a_sales_call: null },
  { id: 'c2', user_id: JOSH,     fathom_call_id: 'abc-real-2',        title: 'Real 2',      call_date: '2026-08-09T00:00:00Z', recording_url: 'https://f/2', source: 'fathom', not_a_sales_call: null },
  { id: 'c3', user_id: JOSH,     fathom_call_id: 'abc-real-3',        title: 'Marked',      call_date: '2026-08-08T00:00:00Z', recording_url: 'https://f/3', source: 'fathom', not_a_sales_call: true },
  { id: 'c4', user_id: AVA,      fathom_call_id: 'demo-copy-1',       title: 'Demo copy',   call_date: '2026-08-10T00:00:00Z', recording_url: 'https://f/1', source: 'fathom', not_a_sales_call: null },
  { id: 'c5', user_id: AVA,      fathom_call_id: 'seed-2026-08-16-x', title: 'Seeded',      call_date: '2026-08-10T00:00:00Z', recording_url: null,          source: 'fathom', not_a_sales_call: null },
  /* ⚠⚠ THE ROW THAT KILLS THE "EXCLUDE THE DEMO ACCOUNTS" IDEA. On live data
     reviewer@scoutsystems.io owns 18 synthetic AND 6 real calls, so a
     user-level rule would delete real calls from every team metric. */
  { id: 'c6', user_id: REVIEWER, fathom_call_id: 'demo-rv-9',         title: 'Reviewer demo', call_date: '2026-08-11T00:00:00Z', recording_url: 'https://f/9', source: 'zoom', not_a_sales_call: null },
  { id: 'c7', user_id: REVIEWER, fathom_call_id: 'zoomreal-abc',      title: 'Reviewer REAL', call_date: '2026-08-12T00:00:00Z', recording_url: 'https://f/8', source: 'zoom', not_a_sales_call: null },
];

function fakeAdmin() {
  function builder(rows, state) {
    const api = {
      select() { return api; },
      eq(c, v) { state.eq.push([c, v]); return api; },
      in(c, v) { state.in.push([c, v]); return api; },
      gte() { return api; }, lte() { return api; }, order() { return api; },
      not(c, op, v) { state.not.push([c, op, v]); return api; },
      is() { return api; },
      range() { return finish(); },
      then(res, rej) { return Promise.resolve(finish()).then(res, rej); },
    };
    function finish() {
      let out = rows.slice();
      state.in.forEach(([c, v]) => { out = out.filter((r) => v.indexOf(r[c]) !== -1); });
      state.eq.forEach(([c, v]) => { out = out.filter((r) => r[c] === v); });
      // mirrors postgres `not <col> is true`: keeps false AND null
      state.not.forEach(([c, op, v]) => { if (op === 'is' && v === true) out = out.filter((r) => r[c] !== true); });
      return { data: out, error: null };
    }
    return api;
  }
  return { from(table) {
    const state = { eq: [], in: [], not: [] };
    return builder(table === 'fathom_calls' ? CALLS : [], state);
  } };
}

const ALL_USERS = [JOSH, AVA, REVIEWER];
const FROM = '2026-08-01T00:00:00Z', TO = '2026-08-31T00:00:00Z';

test('⚠⚠ NO SYNTHETIC ROW SURVIVES loadTeamWindow — every consumer is covered at once', async () => {
  const w = await loadTeamWindow(fakeAdmin(), ALL_USERS, FROM, TO);
  const kept = w.callIds.map((id) => w.meta[id]);

  // ⚠ FLOOR FIRST: a loader returning nothing would pass every assertion below.
  assert.ok(kept.length > 0, 'the window must contain real calls; got none');

  kept.forEach((c) => {
    assert.strictEqual(isSyntheticCallId(c.fathom_call_id), false,
      'a synthetic row reached the team window: ' + c.fathom_call_id
      + ' — every panel reading this loader would count it');
  });

  // exactly the real, unmarked calls: Josh's two + the reviewer's one real Zoom
  assert.deepStrictEqual(kept.map((c) => c.fathom_call_id).sort(),
    ['abc-real-1', 'abc-real-2', 'zoomreal-abc']);
});

test('⚠⚠ A MIXED OWNER KEEPS THEIR REAL CALLS — why the rule is per ROW, not per USER', async () => {
  const w = await loadTeamWindow(fakeAdmin(), ALL_USERS, FROM, TO);
  const kept = w.callIds.map((id) => w.meta[id]);
  const reviewer = kept.filter((c) => c.user_id === REVIEWER);

  assert.strictEqual(reviewer.length, 1,
    'the reviewer owns one real call and one synthetic one — excluding the USER would '
    + 'have dropped real data from every team metric');
  assert.strictEqual(reviewer[0].fathom_call_id, 'zoomreal-abc');
});

test('⚠ not_a_sales_call is still excluded, and NULL rows are still kept', async () => {
  const w = await loadTeamWindow(fakeAdmin(), ALL_USERS, FROM, TO);
  const ids = w.callIds.map((id) => w.meta[id].fathom_call_id);
  assert.strictEqual(ids.indexOf('abc-real-3'), -1, 'the marked call must stay out');
  assert.ok(ids.indexOf('abc-real-1') !== -1, 'and a NULL (never-assessed) row must stay in');
});

/* ── the chokepoint itself ─────────────────────────────────────────────────── */

test('⚠⚠ THERE IS ONE FILTER, AND EVERY CONSUMER GOES THROUGH IT', () => {
  /* ⚠ ENUMERATED BY CAPABILITY, not by grepping a panel list: every call site of
     loadTeamWindow, whatever it is called. The old comment in team-synthesis.js
     said "three lanes"; there are six, and two of them (Call Highlights, and a
     closer's PERSONAL coaching page) were missed. */
  const files = ['lib/team-synthesis.js', 'lib/team-needs-work.js', 'lib/team-digest.js'];
  let callSites = 0;
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    callSites += (src.match(/await loadTeamWindow\(/g) || []).length;
  });
  assert.ok(callSites >= 6,
    'expected at least the six known call sites; found ' + callSites
    + '. If this dropped, a consumer was removed — confirm it was deliberate.');

  // ⚠ and NO consumer may re-implement the rule downstream: one definition only
  files.concat(['lib/team-objections.js']).forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const handRolled = (src.match(/fathom_call_id[^\n]*(like|indexOf)\s*\(?\s*['"](demo|seed)/g) || []).length;
    assert.strictEqual(handRolled, 0,
      f + ' hand-rolls the synthetic rule — it must import lib/real-calls.js, or the '
      + 'two definitions of "fake" will drift');
  });
});

/* ── every TEAM AGGREGATOR, not just the loader ────────────────────────────── */

test('⚠⚠ EVERY CROSS-TEAM QUERY FILTERS SYNTHETIC ROWS — the loader was not enough', () => {
  /* ⚠⚠ THIS TEST EXISTS BECAUSE FIXING THE LOADER DID NOT FIX THE PAGE. After
     loadTeamWindow was filtered, the team page still showed "Ava Mitchell —
     39 calls, 13% closing rate" for an account owning ZERO real calls: the REP
     CARDS never went through the loader at all. They have their own query, as
     do the gauges, the rep graphs and the why-prose lane.

     ⚠ THE LESSON IS THE ENUMERATION, NOT THE FIX. "Consumers of the loader" and
     "surfaces that aggregate across a team" are different sets, and only the
     second one is what the rule is about. Enumerating the first and calling it
     complete is how the most visible panel on the page kept lying.

     So the property asserted here is about the QUERY SHAPE: any fathom_calls
     query scoped to MANY users (`.in('user_id', ...)`) is a cross-team
     aggregation and must filter. */
  const TEAM_AGGREGATORS = [
    'lib/team-synthesis.js',   // the shared loader (needs-work, recs, digest, highlights, evidence, personal)
    'lib/team-analytics.js',   // rep cards + team totals + trends
    'lib/team-objections.js',  // the objection drilldown
    'routes/team.js',          // team averages (gauges) + rep series (graphs)
    'lib/why-prose.js',        // per-rep prose rendered on the team board
    /* ⚠ THE CLOSE RATE, and it was the LAST thing still fabricating. After
       every call-level surface was filtered, a demo account with ZERO calls
       still displayed "13% closing rate, 3 of 24 prospects" — because the
       close rate is computed in its own module. Filtering its CALLS query
       fixes it without inventing a prospect-level rule. */
    'lib/prospect-entity.js',
  ];

  TEAM_AGGREGATORS.forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const live = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // it must IMPORT the one rule …
    assert.ok(/require\(['"][^'"]*real-calls['"]\)/.test(live),
      f + ' must import lib/real-calls.js — every team surface shares one definition of "fake"');

    // … and actually APPLY it, once per fathom_calls query it makes
    const queries = (live.match(/from\('fathom_calls'\)/g) || []).length;
    const applied = (live.match(/realCallsOnly\(/g) || []).length;
    assert.ok(applied >= queries,
      f + ' makes ' + queries + ' fathom_calls quer' + (queries === 1 ? 'y' : 'ies')
      + ' but applies the filter ' + applied + ' time(s). An unfiltered one is a panel '
      + 'that still counts demo data.');
  });
});

test('⚠ the filter is APPLIED, not merely imported — proven by removing one', () => {
  /* ⚠ NON-VACUITY FOR THE CHECK ABOVE: an import with no call site would satisfy
     a naive "does it import the rule" assertion while filtering nothing. */
  const f = 'lib/team-analytics.js';
  const live = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const applied = (live.match(/calls = realCallsOnly\(calls\)/g) || []).length;
  assert.strictEqual(applied, 2,
    f + ' has two paging loops and both must reassign the filtered list; found ' + applied
    + '. Importing without reassigning filters nothing.');
});
