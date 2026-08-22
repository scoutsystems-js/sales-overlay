/**
 * THE TEAM OBJECTION DRILLDOWN — instance list + per-closer grid.
 *
 * ⚠⚠ THE TEST THAT MATTERS IS THE SYNTHETIC ONE. The three demo reps carry
 * COPIES of Josh's calls under different user_ids and different
 * fathom_call_ids, so a naive per-closer grid shows FOUR closers where there is
 * ONE — Josh compared against himself three times, presented as a team. That is
 * the feature's core claim being false, not a cosmetic problem.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

const { computeTeamObjections } = require('../lib/team-objections');
const { isSyntheticCallId, realCallsOnly } = require('../lib/real-calls');

/* ── a supabase stand-in over fixed rows ─────────────────────────────────── */
const JOSH = 'josh', AVA = 'ava';
const CALLS = [
  { id: 'c1', user_id: JOSH, fathom_call_id: 'abc-real-1', title: 'Real call', call_date: '2026-08-10T00:00:00Z', recording_url: 'https://fathom.video/calls/1', source: 'fathom', not_a_sales_call: null },
  { id: 'c2', user_id: JOSH, fathom_call_id: 'abc-real-2', title: 'Zoom call', call_date: '2026-08-09T00:00:00Z', recording_url: 'https://zoom.us/rec/9', source: 'zoom', not_a_sales_call: null },
  { id: 'c3', user_id: JOSH, fathom_call_id: 'abc-real-3', title: 'Marked',    call_date: '2026-08-08T00:00:00Z', recording_url: 'https://fathom.video/calls/3', source: 'fathom', not_a_sales_call: true },
  // ⚠ a DEMO COPY: real-looking recording_url, real-looking everything.
  { id: 'c4', user_id: AVA,  fathom_call_id: 'demo-copy-1', title: 'Copy of Josh', call_date: '2026-08-10T00:00:00Z', recording_url: 'https://fathom.video/calls/1', source: 'fathom', not_a_sales_call: null },
  // ⚠ a SEED row
  { id: 'c5', user_id: AVA,  fathom_call_id: 'seed-2026-08-16-x', title: 'Seeded', call_date: '2026-08-10T00:00:00Z', recording_url: null, source: 'fathom', not_a_sales_call: null },
];
const HIGHLIGHTS = [
  { id: 'h1', fathom_call_id: 'c1', type: 'objection', objection_category: 'partner', resolution: 'unhandled', quote: 'my wife', observation: 'obs', closer_response: 'resp', timestamp_seconds: 600, objection_surface: 's', speaker_verified: true, closer_response_verified: true },
  { id: 'h2', fathom_call_id: 'c1', type: 'objection', objection_category: 'fear',    resolution: 'handled',   quote: 'scared',  observation: 'obs', closer_response: 'resp', timestamp_seconds: 900, objection_surface: 's', speaker_verified: true, closer_response_verified: true },
  { id: 'h3', fathom_call_id: 'c2', type: 'objection', objection_category: 'timing',  resolution: 'unhandled', quote: 'later',   observation: 'obs', closer_response: null,   timestamp_seconds: 120, objection_surface: 's', speaker_verified: true, closer_response_verified: false },
  { id: 'h4', fathom_call_id: 'c3', type: 'objection', objection_category: 'fear',    resolution: 'unhandled', quote: 'marked',  observation: 'obs', closer_response: null,   timestamp_seconds: 10,  objection_surface: 's', speaker_verified: true, closer_response_verified: false },
  { id: 'h5', fathom_call_id: 'c4', type: 'objection', objection_category: 'partner', resolution: 'unhandled', quote: 'my wife', observation: 'obs', closer_response: 'resp', timestamp_seconds: 600, objection_surface: 's', speaker_verified: true, closer_response_verified: true },
  { id: 'h6', fathom_call_id: 'c5', type: 'objection', objection_category: 'fear',    resolution: 'handled',   quote: 'seeded',  observation: 'obs', closer_response: null,   timestamp_seconds: 30,  objection_surface: 's', speaker_verified: true, closer_response_verified: false },
  { id: 'h7', fathom_call_id: 'c1', type: 'buying_signal', objection_category: null,  resolution: null,        quote: 'nope',    observation: 'obs', closer_response: null,   timestamp_seconds: 5,   objection_surface: null, speaker_verified: true, closer_response_verified: false },
];
const ANALYSES = [{ fathom_call_id: 'c1', outcome: 'follow_up', status: 'done' }];

function fakeAdmin() {
  function builder(rows, state) {
    const api = {
      select() { return api; },
      eq(col, val) { state.eq.push([col, val]); return api; },
      in(col, vals) { state.in.push([col, vals]); return api; },
      gte() { return api; }, lte() { return api; },
      order() { return api; },
      not(col, op, val) { state.not.push([col, op, val]); return api; },
      range() { return finish(); },
      then(res, rej) { return Promise.resolve(finish()).then(res, rej); },
    };
    function finish() {
      let out = rows.slice();
      state.in.forEach(([col, vals]) => { out = out.filter((r) => vals.indexOf(r[col]) !== -1); });
      state.eq.forEach(([col, val]) => { out = out.filter((r) => r[col] === val); });
      // ⚠ mirrors postgres `not <col> is true`: keeps false AND null
      state.not.forEach(([col, op, val]) => {
        if (op === 'is' && val === true) out = out.filter((r) => r[col] !== true);
      });
      return { data: out, error: null };
    }
    return api;
  }
  return {
    _lastNot: [],
    from(table) {
      const state = { eq: [], in: [], not: [] };
      const rows = table === 'fathom_calls' ? CALLS
                 : table === 'call_highlights' ? HIGHLIGHTS
                 : table === 'call_analyses' ? ANALYSES : [];
      if (table === 'fathom_calls') this._lastNot = state.not;
      return builder(rows, state);
    },
  };
}

const OPTS = { emailMap: { josh: 'josh@x.io', ava: 'ava@demo' }, nameMap: { josh: 'Josh', ava: 'Ava' } };
const FROM = '2026-08-01T00:00:00Z', TO = '2026-08-31T00:00:00Z';

/* ── the predicate ───────────────────────────────────────────────────────── */

test('⚠ NON-VACUITY: the synthetic predicate accepts real ids and rejects both synthetic kinds', () => {
  assert.strictEqual(isSyntheticCallId('abc-real-1'), false, 'a real provider id must pass');
  assert.strictEqual(isSyntheticCallId('demo-copy-1'), true);
  assert.strictEqual(isSyntheticCallId('demo-rv-9'), true, 'the reviewer rows are covered by demo-');
  assert.strictEqual(isSyntheticCallId('seed-2026-08-16-x'), true);
  assert.strictEqual(isSyntheticCallId(null), false, 'a missing id is not a claim of synthetic');
  // and the filter actually removes them
  assert.strictEqual(realCallsOnly(CALLS).length, 3, 'three real calls of five');
});

/* ── the two surfaces ────────────────────────────────────────────────────── */

test('⚠⚠ NO DEMO OR SEED ROW REACHES EITHER SURFACE', async () => {
  const out = await computeTeamObjections(fakeAdmin(), [JOSH, AVA], FROM, TO, OPTS);

  // the grid: ONE closer, not two — Ava exists only as copies of Josh
  assert.strictEqual(out.grid.length, 1, 'the grid must show one closer, got: '
    + JSON.stringify(out.grid.map((g) => g.name)));
  assert.strictEqual(out.grid[0].user_id, JOSH);

  // the instance list: nothing from a synthetic call
  const syntheticCallIds = ['c4', 'c5'];
  out.instances.forEach((i) => {
    assert.ok(syntheticCallIds.indexOf(i.fathom_call_id) === -1,
      'a synthetic instance reached the feed: ' + JSON.stringify(i));
    assert.notStrictEqual(i.closer.user_id, AVA, 'a demo closer reached the feed');
  });
  assert.ok(out.instances.length > 0, 'floor: the feed must not be empty, or this proves nothing');
});

test('⚠ not_a_sales_call is excluded, and the predicate keeps NULL rows', async () => {
  const admin = fakeAdmin();
  const out = await computeTeamObjections(admin, [JOSH, AVA], FROM, TO, OPTS);
  assert.ok(out.instances.every((i) => i.fathom_call_id !== 'c3'), 'the marked call must not appear');
  // ⚠ `is not true`, never `= false` — most rows are NULL, and `= false` drops them all.
  assert.deepStrictEqual(admin._lastNot, [['not_a_sales_call', 'is', true]]);
  assert.ok(out.instances.some((i) => i.fathom_call_id === 'c1'),
    'NULL not_a_sales_call rows must survive — this is the half a `= false` predicate breaks');
});

test('only type=objection is counted', async () => {
  const out = await computeTeamObjections(fakeAdmin(), [JOSH], FROM, TO, OPTS);
  assert.strictEqual(out.instances.length, 3, 'h1 h2 h3 — never the buying_signal');
  assert.ok(out.instances.every((i) => i.id !== 'h7'));
});

test('the category filter narrows the INSTANCES but never the grid', async () => {
  const all = await computeTeamObjections(fakeAdmin(), [JOSH], FROM, TO, OPTS);
  const one = await computeTeamObjections(fakeAdmin(), [JOSH], FROM, TO, Object.assign({ category: 'partner' }, OPTS));
  assert.strictEqual(one.instances.length, 1, 'one partner instance');
  assert.strictEqual(one.instances[0].category, 'partner');
  // ⚠ the grid stays whole: it is the map of where to click, so filtering it by
  // the current selection would hide every other category from the reader.
  assert.strictEqual(one.grid[0].total.total, all.grid[0].total.total);
  assert.strictEqual(one.grid[0].by_category.fear.total, 1);
});

test('clips come from clip-link, and Zoom is not special-cased away', async () => {
  const out = await computeTeamObjections(fakeAdmin(), [JOSH], FROM, TO, OPTS);
  const fathom = out.instances.find((i) => i.source === 'fathom');
  const zoom = out.instances.find((i) => i.source === 'zoom');
  assert.ok(/\?t=|&t=/.test(fathom.clip_url), 'fathom clip must carry a timestamp: ' + fathom.clip_url);
  assert.ok(zoom.clip_url, 'zoom still gets a link — the LABEL differs, the link does not');
  assert.ok(zoom.source === 'zoom', 'source must ride along so the label can be chosen');
});

test('the four buckets sum to the total, so the rate reconciles with the counts', async () => {
  const out = await computeTeamObjections(fakeAdmin(), [JOSH], FROM, TO, OPTS);
  const t = out.grid[0].total;
  assert.strictEqual(t.handled + t.credited + t.partial + t.unhandled, t.total);
  assert.strictEqual(t.total, 3);
  assert.strictEqual(t.rate, 33, '1 handled of 3');
});

test('⚠ an empty team returns the empty shape, never a throw', async () => {
  const out = await computeTeamObjections(fakeAdmin(), [], FROM, TO, OPTS);
  assert.deepStrictEqual(out.instances, []);
  assert.deepStrictEqual(out.grid, []);
  assert.strictEqual(out.instance_count, 0);
});

/* ── the denominator travels with the payload ────────────────────────────── */

test('⚠⚠ board_size RIDES IN THE PAYLOAD — the note must not need another lane', async () => {
  /* The grid's note reads "N of M closers on this board". M was read from
     state.teamOverview, so it appeared only when the user had passed through
     the Team page first and DISAPPEARED on a deep link or a refresh — a count
     documented as "always stated" that silently was not. Observed live on
     #team-objections?from=…: "1 closer has objection data in this range."   */
  const two = await computeTeamObjections(fakeAdmin(), [JOSH, AVA], FROM, TO, OPTS);
  assert.strictEqual(two.board_size, 2, 'board_size is exactly the set enumerated');
  assert.strictEqual(two.grid.length, 1, 'and it is NOT the grid length — Ava is all copies');

  // present on every exit path, including the two early returns
  const none = await computeTeamObjections(fakeAdmin(), [], FROM, TO, OPTS);
  assert.strictEqual(none.board_size, 0, 'empty team still reports its size');
  const noReal = await computeTeamObjections(fakeAdmin(), [AVA], FROM, TO, OPTS);
  assert.strictEqual(noReal.grid.length, 0, 'Ava has only synthetic calls');
  assert.strictEqual(noReal.board_size, 1, 'the all-synthetic early return reports it too');
});

test('⚠ the grid note reads its OWN payload, never state.teamOverview', () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const at = html.indexOf('function teamObjGridHtml');
  assert.ok(at > -1, 'stale anchor: teamObjGridHtml not found');
  const src = html.slice(at, html.indexOf('\n  }', at) + 4);
  assert.ok(src.length > 800 && src.length < 6000, 'slice must cover the function: ' + src.length);

  // strip comments — this file archives removed code in place and explains its
  // own rules in prose, so a raw match reports the explanation as a violation.
  const live = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(live.indexOf('board_size') !== -1, 'the note must read d.board_size');
  assert.strictEqual(live.indexOf('teamOverview'), -1,
    'the drilldown must not depend on a value the overview lane happens to have loaded');
});

/* ── the gate, over HTTP, with a forged closer ───────────────────────────── */

test('⚠⚠ A CLOSER IS REFUSED /team/objections SERVER-SIDE', async () => {
  const authPath = require.resolve('../middleware/auth');
  const realAuth = require(authPath);
  const saved = require.cache[authPath].exports;

  // ⚠ requireRole is the REAL implementation — it is the thing under test.
  // Only the token decode is stubbed, because obtaining a closer's token means
  // signing in, and the forged actor exercises every line after auth.
  //
  // ⚠⚠ THE STUB STAMPS `req.userProfileRole`, NOT JUST `req.user.role`, AND THE
  // DIFFERENCE IS THE WHOLE TEST. requireRole deliberately ignores
  // `req.user.role` — before requireAuth overwrites it that field holds
  // Supabase's JWT claim ("authenticated" for anyone logged in), so trusting it
  // would 403 every user. It reads `req.userProfileRole`, falling back to a DB
  // lookup. Setting only `req.user.role` sent the request to that lookup and
  // returned 503 with no database — which looks exactly like a passing gate
  // failing for an unrelated reason.
  let actor = { id: 'closer-1', role: 'user' };
  require.cache[authPath].exports = Object.assign({}, realAuth, {
    requireAuth: function (req, _res, next) {
      req.user = { id: actor.id, role: actor.role };
      req.userProfileRole = actor.role;      // what requireRole actually reads
      next();
    },
  });
  delete require.cache[require.resolve('../routes/team')];
  const router = require('../routes/team');

  const app = express(); app.use('/team', router);
  const server = await new Promise((r) => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  const port = server.address().port;
  function get() {
    return new Promise((res, rej) => {
      http.get({ port, path: '/team/objections?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z' }, (r) => {
        let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: d }));
      }).on('error', rej);
    });
  }
  try {
    const closer = await get();
    assert.strictEqual(closer.status, 403,
      'a closer must be refused by the gate, not by a hidden nav link. Got ' + closer.status + ': ' + closer.body);

    // ⚠ NON-VACUITY: a manager must NOT get 403 through the same harness, or
    // this would pass against a route that refuses everyone.
    actor = { id: 'mgr-1', role: 'manager' };
    const mgr = await get();
    assert.notStrictEqual(mgr.status, 403, 'a manager must pass the gate; got ' + mgr.body);
  } finally {
    server.close();
    require.cache[authPath].exports = saved;
    delete require.cache[require.resolve('../routes/team')];
  }
});
