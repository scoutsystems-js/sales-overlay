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
  { id: 'h1', fathom_call_id: 'c1', type: 'objection', objection_category: 'partner', resolution: 'unhandled', quote: 'my wife', observation: 'obs', closer_response: 'resp', timestamp_seconds: 600, objection_surface: 'my wife has to approve', speaker_verified: true, closer_response_verified: true },
  { id: 'h2', fathom_call_id: 'c1', type: 'objection', objection_category: 'fear',    resolution: 'handled',   quote: 'scared',  observation: 'obs', closer_response: 'resp', timestamp_seconds: 900, objection_surface: 'cant afford it', speaker_verified: true, closer_response_verified: true },
  { id: 'h3', fathom_call_id: 'c2', type: 'objection', objection_category: 'timing',  resolution: 'unhandled', quote: 'later',   observation: 'obs', closer_response: null,   timestamp_seconds: 120, objection_surface: 'need to think about it', speaker_verified: true, closer_response_verified: false },
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
      is(c, v) { state.is.push([c, v]); return api; },
      range() { return finish(); },
      // the strict-standard path reads/writes objection_synthesis_cache
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      upsert() { return Promise.resolve({ error: null }); },
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
    _lastIs: [],
    from(table) {
      const state = { eq: [], in: [], not: [], is: [] };
      const rows = table === 'fathom_calls' ? CALLS
                 : table === 'call_highlights' ? HIGHLIGHTS
                 : table === 'call_analyses' ? ANALYSES : [];
      if (table === 'fathom_calls') { this._lastNot = state.not; this._lastIs = state.is; }
      return builder(rows, state);
    },
  };
}

/* ⚠ `strict: false` HERE IS DELIBERATE AND NARROW. These tests predate the
   strict standard and assert orthogonal properties — synthetic exclusion, the
   not_a_sales_call predicate, clip labels, bucket reconciliation. Running them
   through the classifier would make every one of them depend on a Claude call.
   The strict path has its own tests below, and a separate test asserts the ROUTE
   never passes this flag, so the escape hatch cannot reach production. */
const OPTS = { keyId: 'josh', strict: false,
  emailMap: { josh: 'josh@x.io', ava: 'ava@demo' }, nameMap: { josh: 'Josh', ava: 'Ava' } };
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
  /* ⚠ `is not true`, never `= false` — most rows are NULL, and `= false` drops
     them all. That property is what this line protects and it is unchanged.
     ⚠ A SECOND exclusion joined it 2026-08-24: cross-provider duplicates
     (`duplicate_of is null`). Asserting the exact list rather than membership
     is deliberate — it means a THIRD exclusion appearing here has to be
     acknowledged rather than absorbed silently. */
  assert.deepStrictEqual(admin._lastNot, [['not_a_sales_call', 'is', true]]);
  /* ⚠⚠ THE DUPLICATE EXCLUSION MOVED FROM .not() TO .is(), AND THAT IS THE FIX,
     NOT A REFACTOR. `.not('duplicate_of','is',null)` means NOT(IS NULL) — it
     kept ONLY the duplicates, so every count in the product showed 25 rows
     instead of 165. Asserting the CALL rather than just its presence is what
     the earlier version of this test failed to do. */
  assert.deepStrictEqual(admin._lastIs, [['duplicate_of', null]]);
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
  /* ⚠ The bound is a RUNAWAY-SLICE guard, not a size budget — it exists so a
     mis-anchored slice that swallowed half the file cannot pass. Raised
     2026-08-22 when the function legitimately grew (the strict-standard notice,
     the rep filter, client-side pooling of the average), and again 2026-08-26
     when every objection category — including the empty ones — started being
     listed. Keep an upper bound: without one, a slice running to the end of the
     document would satisfy every assertion below by containing everything. */
  assert.ok(src.length > 800 && src.length < 14000, 'slice must cover the function: ' + src.length);

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

/* ── THE STRICT STANDARD (Justin's ruling, 2026-08-22) ─────────────────────── */

/**
 * Run computeTeamObjections with the surface classifier stubbed.
 *
 * ⚠ The classifier is a Claude call living in team-needs-work. Stubbing it at
 * the require boundary is what lets these tests assert the RULE — which moments
 * count — without asserting anything about the model.
 */
function withClassifier(result, opts) {
  const nwPath = require.resolve('../lib/team-needs-work');
  const real = require(nwPath);
  const saved = require.cache[nwPath].exports;
  let calls = 0;
  require.cache[nwPath].exports = Object.assign({}, real, {
    getBucketMapping: async () => { calls++; return result; },
  });
  delete require.cache[require.resolve('../lib/team-objections')];
  const mod = require('../lib/team-objections');
  return {
    run: (admin, ids, o) => mod.computeTeamObjections(admin || fakeAdmin(), ids || [JOSH, AVA], FROM, TO,
      Object.assign({ keyId: 'josh', emailMap: OPTS.emailMap, nameMap: OPTS.nameMap }, o)),
    calls: () => calls,
    restore: () => {
      require.cache[nwPath].exports = saved;
      delete require.cache[require.resolve('../lib/team-objections')];
    },
  };
}

// "spouse pressure" is a real objection; the other two are not coachable.
/* ⚠⚠ THE POINT OF THIS FIXTURE: h2 is stored as category `fear`, and its PHRASE
   is "cant afford it" — which the classifier calls a DISQUALIFICATION, not an
   objection. No stored column can make that call: `objection_category` has no
   disqualification value, and `fear` is exactly where a money phrase lands.
   That is why the strict standard needs the classifier and cannot be derived. */
const MAPPING_OK = {
  ok: true,
  mapping: {
    'my wife has to approve': 'Spouse / partner approval',
    'need to think about it': 'Needs time / think it over',
    'cant afford it': 'Cannot afford it',
  },
  bucketClass: {
    'Spouse / partner approval': 'true_objection',
    'Needs time / think it over': 'true_objection',
    'Cannot afford it': 'disqualification',
  },
};

test('⚠⚠ A NON-COACHABLE MOMENT LEAVES THE GRID, THE TOTALS AND THE FEED — AND IS COUNTED', async () => {
  const h = withClassifier(MAPPING_OK);
  try {
    const out = await h.run();
    assert.strictEqual(out.strict, true, 'the strict standard must be in force');

    // the fixture's logistical moments are classified as a payment failure
    // stored as `fear`, classified as a disqualification -> out of the grid
    assert.strictEqual(out.grid[0].by_category.fear.total, 0,
      'a disqualification must not sit in the grid, whatever its stored category');
    assert.strictEqual(out.excluded.disqualifications, 1, 'and it must be counted so the panel can say so');
    assert.strictEqual(out.excluded.logistical, 0);

    // ⚠ and out of the FEED too — the feed is the evidence for the rate, so a
    // moment that does not count must not appear as though it does
    const inFeed = out.instances.filter((i) => i.category === 'fear').length;
    assert.strictEqual(inFeed, 0, 'the excluded moment must not appear in the moment list');

    // ⚠ FLOOR: the true objections must still be there, or this passes by
    // excluding everything.
    assert.ok(out.totals.total >= 2, 'true objections must survive; got ' + out.totals.total);
  } finally { h.restore(); }
});

test('⚠⚠ THE RATE ACTUALLY MOVES — strict vs loose on identical rows', async () => {
  const strictRun = withClassifier(MAPPING_OK);
  let strictOut, looseOut;
  try { strictOut = await strictRun.run(); } finally { strictRun.restore(); }
  const looseRun = withClassifier(MAPPING_OK);
  try { looseOut = await looseRun.run(null, null, { strict: false }); } finally { looseRun.restore(); }

  assert.ok(looseOut.totals.total > strictOut.totals.total,
    'the loose denominator must be larger — otherwise nothing was excluded and this '
    + 'test proves nothing. loose ' + looseOut.totals.total + ' vs strict ' + strictOut.totals.total);
  assert.strictEqual(looseOut.strict, false, 'and the loose run must SAY it is not the standard');
});

test('⚠⚠ AN UNCLASSIFIED PHRASE COUNTS — never a silent shrink of the denominator', async () => {
  // a mapping that knows nothing about the fixture's phrases
  const h = withClassifier({ ok: true, mapping: {}, bucketClass: {} });
  try {
    const out = await h.run();
    assert.strictEqual(out.excluded.disqualifications + out.excluded.logistical, 0,
      'nothing may be excluded on the strength of a phrase the classifier never saw');
    assert.ok(out.totals.total > 0, 'and every moment must still count');
  } finally { h.restore(); }
});

test('⚠⚠ A CLASSIFIER FAILURE REPORTS strict:false — it does NOT serve loose numbers as strict', async () => {
  /* This is the direction that flatters: without the exclusion the rate reads
     HIGHER than the truth. Presenting that as "the strict standard" would be a
     data problem rendering as good news. */
  const h = withClassifier({ ok: false, reason: 'Anthropic API failure (HTTP 529)' });
  try {
    const out = await h.run();
    assert.strictEqual(out.strict, false, 'the payload must admit the standard was not applied');
    assert.ok(/529|failure/i.test(out.strict_reason || ''), 'and say why: ' + out.strict_reason);
    assert.ok(out.totals.total > 0, 'the panel still shows data — it just does not claim to be strict');
  } finally { h.restore(); }
});

test('⚠ the classification is CACHED — a second identical load must not re-classify', async () => {
  const store = [];
  const admin = fakeAdmin();
  const realFrom = admin.from.bind(admin);
  admin.from = function (table) {
    if (table !== 'objection_synthesis_cache') return realFrom(table);
    return {
      select() { return this; }, eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: store[0] || null, error: null }); },
      upsert(row) { store.push({ synthesis: row.synthesis }); return Promise.resolve({ error: null }); },
    };
  };
  const h = withClassifier(MAPPING_OK);
  try {
    await h.run(admin);
    assert.strictEqual(h.calls(), 1, 'the first load classifies');
    await h.run(admin);
    assert.strictEqual(h.calls(), 1, 'the second must read the cache, not spend another call');
  } finally { h.restore(); }
});

test('⚠⚠ THE ROUTE NEVER OPTS OUT OF THE STANDARD', () => {
  /* `strict:false` exists so tests of orthogonal properties need not depend on a
     Claude call. If it ever reached the route, the panel would quietly go back
     to the looser definition Justin just ruled against — and the numbers would
     read higher, which nobody questions. */
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.strictEqual(/strict\s*:\s*false/.test(src), false,
    'routes/team.js must not disable the strict objection standard');
});
