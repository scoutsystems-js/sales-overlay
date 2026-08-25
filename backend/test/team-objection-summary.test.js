/**
 * THE COACHING SUMMARY — step 3 of the team objection drilldown.
 *
 * ⚠⚠ THIS IS THE ONLY PART OF THE FEATURE THAT CAN BE WRONG WITHOUT LOOKING
 * WRONG. Steps 1 and 2 render counts a manager can add up; this renders a
 * paragraph that reads identically whether it is grounded or invented. So the
 * tests here are about what reaches the model and what is allowed back out,
 * not about the prose.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  computeTeamObjectionSummary, _classifyCloser, _positionPct, _pickEvidence, _buildPrompt,
  _MIN_BUCKET, _MIN_GAP_PP,
} = require('../lib/team-objection-summary');

/* ── fixtures ────────────────────────────────────────────────────────────── */

const JOSH = 'josh', AVA = 'ava';

/* Josh: one clearly weak category (timing) against a decent baseline.
   Ava:  ONLY synthetic calls — a demo copy and a seed row. */
const CALLS = [
  { id: 'c1', user_id: JOSH, fathom_call_id: 'real-1', title: 'Real one', call_date: '2026-08-10T00:00:00Z', recording_url: 'https://fathom.video/calls/1', source: 'fathom', duration_seconds: 3600, not_a_sales_call: null },
  { id: 'c2', user_id: JOSH, fathom_call_id: 'real-2', title: 'Real two', call_date: '2026-08-09T00:00:00Z', recording_url: 'https://fathom.video/calls/2', source: 'fathom', duration_seconds: 3600, not_a_sales_call: null },
  { id: 'c3', user_id: JOSH, fathom_call_id: 'real-3', title: 'Marked',   call_date: '2026-08-08T00:00:00Z', recording_url: 'https://fathom.video/calls/3', source: 'fathom', duration_seconds: 3600, not_a_sales_call: true },
  { id: 'c4', user_id: AVA,  fathom_call_id: 'demo-copy-1', title: 'Copy of Josh', call_date: '2026-08-10T00:00:00Z', recording_url: 'https://fathom.video/calls/1', source: 'fathom', duration_seconds: 3600, not_a_sales_call: null },
  { id: 'c5', user_id: AVA,  fathom_call_id: 'seed-2026-08-16-x', title: 'Seeded', call_date: '2026-08-10T00:00:00Z', recording_url: null, source: 'fathom', duration_seconds: 3600, not_a_sales_call: null },
];

function hl(id, call, cat, res, extra) {
  return Object.assign({
    id: id, fathom_call_id: call, type: 'objection', objection_category: cat,
    objection_surface: cat + ' surface', resolution: res,
    quote: 'prospect line ' + id, observation: 'observation ' + id,
    closer_response: 'closer line ' + id, timestamp_seconds: 3000,
    speaker_verified: true, closer_response_verified: true,
  }, extra || {});
}

// timing 7 moments, 1 handled (14%); fear 7 moments, 6 handled (86%)
// → timing gap is enormous, comfortably over MIN_GAP_PP
const HIGHLIGHTS = [];
for (let i = 0; i < 7; i++) HIGHLIGHTS.push(hl('t' + i, i < 4 ? 'c1' : 'c2', 'timing', i === 0 ? 'handled' : 'unhandled'));
for (let i = 0; i < 7; i++) HIGHLIGHTS.push(hl('f' + i, i < 4 ? 'c1' : 'c2', 'fear', i === 0 ? 'unhandled' : 'handled'));
// on the MARKED call — must never reach the summary
for (let i = 0; i < 8; i++) HIGHLIGHTS.push(hl('m' + i, 'c3', 'partner', 'unhandled'));
// on Ava's SYNTHETIC calls — must never reach the summary
for (let i = 0; i < 8; i++) HIGHLIGHTS.push(hl('d' + i, 'c4', 'partner', 'unhandled'));
for (let i = 0; i < 8; i++) HIGHLIGHTS.push(hl('s' + i, 'c5', 'partner', 'unhandled'));

const ANALYSES = [
  { fathom_call_id: 'c1', outcome: 'follow_up', status: 'done', analyzed_at: '2026-08-11T00:00:00Z' },
  { fathom_call_id: 'c2', outcome: 'lost',      status: 'done', analyzed_at: '2026-08-11T00:00:00Z' },
  /* ⚠ c3's OUTCOME IS LOAD-BEARING IN THIS FIXTURE, and a first draft got it
     wrong. With outcome 'closed' its 8 unhandled partner objections are all
     CREDITED (Justin's ruling: an objection on a call that closed counts as
     handled), which makes partner Josh's STRONGEST category — so un-marking the
     call could never bring its moments into the prompt, and the test failed
     against correct code. A moment's meaning depends on its call's outcome; a
     fixture that ignores that demonstrates the wrong thing. */
  { fathom_call_id: 'c3', outcome: 'lost',      status: 'done', analyzed_at: '2026-08-11T00:00:00Z' },
  { fathom_call_id: 'c4', outcome: 'follow_up', status: 'done', analyzed_at: '2026-08-11T00:00:00Z' },
  { fathom_call_id: 'c5', outcome: 'follow_up', status: 'done', analyzed_at: '2026-08-11T00:00:00Z' },
];

function fakeAdmin(over) {
  over = over || {};
  const calls = over.calls || CALLS;
  const cache = over.cache || [];
  const writes = [];
  function builder(rows, state, table) {
    const api = {
      select() { return api; },
      eq(col, val) { state.eq.push([col, val]); return api; },
      in(col, vals) { state.in.push([col, vals]); return api; },
      gte() { return api; }, lte() { return api; }, order() { return api; },
      not(col, op, val) { state.not.push([col, op, val]); return api; },
      is() { return api; },
      range() { return finish(); },
      maybeSingle() { const r = finish(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
      upsert(row) { writes.push(row); return Promise.resolve({ error: null }); },
      then(res, rej) { return Promise.resolve(finish()).then(res, rej); },
    };
    function finish() {
      let out = rows.slice();
      state.in.forEach(([col, vals]) => { out = out.filter((r) => vals.indexOf(r[col]) !== -1); });
      state.eq.forEach(([col, val]) => { out = out.filter((r) => r[col] === val); });
      state.not.forEach(([col, op, val]) => {
        if (op === 'is' && val === true) out = out.filter((r) => r[col] !== true);
      });
      return { data: out, error: null };
    }
    return api;
  }
  return {
    _writes: writes,
    from(table) {
      const state = { eq: [], in: [], not: [] };
      const rows = table === 'fathom_calls' ? calls
                 : table === 'call_highlights' ? HIGHLIGHTS
                 : table === 'call_analyses' ? ANALYSES
                 : table === 'objection_synthesis_cache' ? cache : [];
      return builder(rows, state, table);
    },
  };
}

const OPTS = {
  keyId: JOSH,
  emailMap: { josh: 'josh@x.io', ava: 'ava@demo' },
  nameMap: { josh: 'Josh', ava: 'Ava' },
};
const FROM = '2026-08-01T00:00:00Z', TO = '2026-08-31T00:00:00Z';

/** Run the real function with the Anthropic call stubbed at the module edge. */
async function withModel(reply, fn, admin) {
  const path = require.resolve('@anthropic-ai/sdk');
  const saved = require.cache[path];
  const calls = [];
  require.cache[path] = {
    id: path, filename: path, loaded: true,
    exports: function Anthropic() {
      return { messages: { create: async (args) => { calls.push(args); return reply(args); } } };
    },
  };
  delete require.cache[require.resolve('../lib/team-objection-summary')];
  const mod = require('../lib/team-objection-summary');
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const out = await mod.computeTeamObjectionSummary(admin || fakeAdmin(), [JOSH, AVA], FROM, TO, OPTS);
    return { out, calls, fn };
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
    if (saved) require.cache[path] = saved; else delete require.cache[path];
    delete require.cache[require.resolve('../lib/team-objection-summary')];
  }
}

const GOOD_REPLY = () => ({
  content: [{ text: JSON.stringify({ closers: [{ name: 'Josh', why: 'He lets the first reason stand.', what_to_do: 'Isolate before answering.' }] }) }],
});

/* ── §4 · synthetic rows must never reach the model ───────────────────────── */

test('⚠⚠ NO DEMO OR SEED ROW REACHES THE SUMMARY — not the prompt, not the output', async () => {
  const { out, calls } = await withModel(GOOD_REPLY);
  assert.strictEqual(calls.length, 1, 'exactly one Claude call');
  const prompt = calls[0].messages[0].content;

  // ⚠ FLOOR FIRST: a prompt that mentioned nobody would pass every assertion
  // below by having nothing in it.
  assert.ok(prompt.indexOf('Josh') !== -1, 'the real closer must be in the prompt at all');
  assert.ok(prompt.length > 400, 'prompt suspiciously short: ' + prompt.length);

  assert.strictEqual(prompt.indexOf('Ava'), -1, 'a demo rep reached the model');
  ['d0', 'd7', 's0', 's7'].forEach((id) => {
    assert.strictEqual(prompt.indexOf('prospect line ' + id), -1,
      'a synthetic moment (' + id + ') reached the model — the summary would describe '
      + 'Josh\'s own calls back to him under another name and call it a team pattern');
  });
  const names = out.closers.map((c) => c.name);
  assert.deepStrictEqual(names, ['Josh'], 'only real closers may appear; got ' + JSON.stringify(names));
});

/* ── §3 · the cache key sees not-a-sales-call ─────────────────────────────── */

test('⚠⚠ A MARKED CALL LEAVES THE MODEL INPUT, AND COMES BACK WHEN UN-MARKED', async () => {
  /* The hash test below proves the cache KEY moves. This proves the thing the
     key is protecting: what the model is actually shown. A key that changed
     while the input did not would be a cache working correctly around a filter
     that was not. */
  const marked = await withModel(GOOD_REPLY);
  assert.strictEqual(marked.calls[0].messages[0].content.indexOf('prospect line m0'), -1,
    'a marked call\'s moments must not reach the model');

  const unmarked = await withModel(GOOD_REPLY, null,
    fakeAdmin({ calls: CALLS.map((c) => (c.id === 'c3' ? Object.assign({}, c, { not_a_sales_call: null }) : c)) }));

  // ⚠ NON-VACUITY IN THE OTHER DIRECTION: if the moments never appeared under
  // ANY condition, the assertion above would pass for the wrong reason.
  assert.notStrictEqual(unmarked.calls[0].messages[0].content.indexOf('prospect line m0'), -1,
    'un-marking must let that call\'s moments back in — otherwise the exclusion is not '
    + 'driven by the flag at all and the assertion above proves nothing');

  assert.notStrictEqual(JSON.stringify(marked.out.closers), JSON.stringify(unmarked.out.closers),
    'and the rendered output must differ — c3 adds 8 unhandled partner moments');
});

test('⚠⚠ the cache hash is computed over the FILTERED call list, both directions', async () => {
  function hashOf(calls) {
    const admin = fakeAdmin({ calls: calls });
    return withModel(GOOD_REPLY, null, admin).then(() => {
      const w = admin._writes.filter((r) => r.synthesis_type === 'team_objections')[0];
      assert.ok(w, 'a cache row must be written on a miss');
      return w.analysis_set_hash;
    });
  }
  const marked = await hashOf(CALLS);
  const unmarked = await hashOf(CALLS.map((c) => (c.id === 'c3' ? Object.assign({}, c, { not_a_sales_call: null }) : c)));
  assert.notStrictEqual(marked, unmarked,
    'marking a call must change the cache key, or a marked call keeps influencing the '
    + 'summary after it stops counting');
  // and it must come BACK — a one-way change would look identical on the first test
  const remarked = await hashOf(CALLS);
  assert.strictEqual(remarked, marked, 'un-marking must restore the original key exactly');
});

/* ── §2 · four states, and a data problem is never good news ──────────────── */

test('⚠⚠ no_volume / thin_types / even_performance / rate_gap are FOUR distinct states', () => {
  const cell = (t, h) => ({ total: t, handled: h, credited: 0, partial: 0, unhandled: t - h });
  const row = (cats) => {
    const by = { fear: cell(0, 0), logistical: cell(0, 0), timing: cell(0, 0), partner: cell(0, 0) };
    let T = 0, H = 0;
    Object.keys(cats).forEach((k) => { by[k] = cell(cats[k][0], cats[k][1]); T += cats[k][0]; H += cats[k][1]; });
    return { by_category: by, total: cell(T, H) };
  };

  // (a) not enough to say anything
  assert.strictEqual(_classifyCloser(row({ timing: [3, 0] })).state, 'no_volume');

  // (b) plenty of objections, none in a big enough single category
  const thin = _classifyCloser(row({ fear: [3, 1], timing: [3, 1], partner: [3, 1], logistical: [3, 1] }));
  assert.strictEqual(thin.state, 'thin_types');
  assert.notStrictEqual(thin.state, 'no_volume', 'there IS volume — it is spread, not absent');

  // (c) compared, and level → a FINDING, not a shortage
  const even = _classifyCloser(row({ fear: [10, 5], timing: [10, 5] }));
  assert.strictEqual(even.state, 'even_performance');
  assert.ok(even.ranking.length > 0, 'even performance still shows the ranking — a near-tie is a finding');

  // (d) a real gap
  const gap = _classifyCloser(row({ fear: [10, 9], timing: [10, 1] }));
  assert.strictEqual(gap.state, 'rate_gap');
  assert.strictEqual(gap.focus.category, 'timing');

  const states = ['no_volume', 'thin_types', 'even_performance', 'rate_gap'];
  assert.strictEqual(new Set(states).size, 4, 'the four states must remain distinct');
});

test('⚠ ONLY rate_gap gets a generated WHY — a data problem never renders as good news', async () => {
  const { out } = await withModel(GOOD_REPLY);
  out.closers.forEach((c) => {
    if (c.state !== 'rate_gap') {
      assert.strictEqual(c.why, null, c.state + ' must not carry a generated explanation');
      assert.deepStrictEqual(c.evidence, [], c.state + ' must not carry evidence');
    }
  });
});

test('⚠ a board where nobody clears the bar reports PER CLOSER, not one board sentence', async () => {
  // every closer thin: 3 per category
  const thinHl = [];
  ['fear', 'timing', 'partner', 'logistical'].forEach((c) => {
    for (let i = 0; i < 3; i++) thinHl.push(hl(c + i, 'c1', c, 'unhandled'));
  });
  const path = require.resolve('../lib/team-objections');
  const real = require(path);
  const saved = require.cache[path].exports;
  require.cache[path].exports = Object.assign({}, real, {
    computeTeamObjections: async () => ({
      board_size: 2, totals: { total: 12, handled: 0, credited: 0, partial: 0, unhandled: 12 },
      analysis_fingerprint: 'x', instances: [],
      grid: [{ user_id: JOSH, name: 'Josh',
        by_category: { fear: { total: 3, handled: 0, credited: 0 }, timing: { total: 3, handled: 0, credited: 0 }, partner: { total: 3, handled: 0, credited: 0 }, logistical: { total: 3, handled: 0, credited: 0 } },
        total: { total: 12, handled: 0, credited: 0 } }],
    }),
  });
  delete require.cache[require.resolve('../lib/team-objection-summary')];
  try {
    const mod = require('../lib/team-objection-summary');
    const out = await mod.computeTeamObjectionSummary(fakeAdmin(), [JOSH], FROM, TO, OPTS);
    assert.strictEqual(out.state, 'no_focus');
    assert.strictEqual(out.closers.length, 1, 'the closer is still named and still reported');
    assert.strictEqual(out.closers[0].state, 'thin_types',
      'the per-closer state survives — collapsing it into one board sentence is the '
      + 'conflation the four states exist to prevent');
  } finally {
    require.cache[path].exports = saved;
    delete require.cache[require.resolve('../lib/team-objection-summary')];
  }
});

/* ── Justin's wording ruling ──────────────────────────────────────────────── */

test('⚠⚠ NAMES THE CLOSER AT ANY TEAM SIZE — one closer is not "the team"', async () => {
  const { out, calls } = await withModel(GOOD_REPLY);
  assert.strictEqual(out.closers.length, 1);
  assert.strictEqual(out.closers[0].name, 'Josh');
  assert.strictEqual(out.state, 'per_closer',
    'there is no board-level paragraph to generate — the generalisation failure is '
    + 'structurally unreachable, not merely discouraged');
  const prompt = calls[0].messages[0].content;
  assert.ok(/never write about "closers"|Never write about "closers"/i.test(prompt),
    'the prompt must forbid collective phrasing explicitly as well');
});

test('⚠ ONE Claude call covers the whole board — no per-category fan-out', async () => {
  const { calls } = await withModel(GOOD_REPLY);
  assert.strictEqual(calls.length, 1);
});

/* ── what the model is allowed to send back ───────────────────────────────── */

test('⚠⚠ a model-invented closer name is DROPPED, never rendered', async () => {
  const reply = () => ({ content: [{ text: JSON.stringify({ closers: [
    { name: 'Josh', why: 'real', what_to_do: 'real' },
    { name: 'Marcus', why: 'invented person', what_to_do: 'invented' },
  ] }) }] });
  const { out } = await withModel(reply);
  const names = out.closers.map((c) => c.name);
  assert.deepStrictEqual(names, ['Josh'],
    'a plausible name for someone not on the board would read as a finding about a real rep');
  assert.ok(JSON.stringify(out).indexOf('invented person') === -1, 'and its prose must not leak in either');
});

test('⚠ evidence comes from the DB row, not from the model', async () => {
  const { out } = await withModel(GOOD_REPLY);
  const josh = out.closers[0];
  assert.ok(josh.evidence.length > 0, 'a rate_gap closer must carry its evidence');
  josh.evidence.forEach((e) => {
    assert.ok(/^prospect line t\d+$/.test(e.quote), 'quote must be the stored row: ' + e.quote);
    assert.ok(e.clip_url && e.clip_url.indexOf('?t=') !== -1, 'clip resolved through clip-link');
    assert.strictEqual(e.source, 'fathom', 'source rides with the clip so the label is provider-aware');
  });
});

test('⚠ a credited-but-unhandled moment is still FAILED evidence', () => {
  const moments = [
    { closer: { user_id: JOSH }, category: 'timing', resolution: 'unhandled', credited: true, closer_response: 'x' },
    { closer: { user_id: JOSH }, category: 'timing', resolution: 'handled', credited: false, closer_response: 'y' },
  ];
  const ev = _pickEvidence(moments, JOSH, 'timing');
  assert.strictEqual(ev.failed.length, 1, 'credited counts in the RATE but is not good handling');
  assert.strictEqual(ev.worked.length, 1);
});

test('⚠ position in the call is NULL when unknown, never 0%', () => {
  assert.strictEqual(_positionPct(1800, 3600), 50);
  assert.strictEqual(_positionPct(1800, null), null, 'a missing duration must not read as the opening seconds');
  assert.strictEqual(_positionPct(1800, 0), null);
  assert.strictEqual(_positionPct(null, 3600), null);
  assert.strictEqual(_positionPct(9999, 3600), 100, 'clamped, not >100');
});

/* ── the prompt itself ────────────────────────────────────────────────────── */

test('⚠⚠ THE PROMPT DEMANDS A MECHANISM AND FORBIDS RESTATING THE RATE', () => {
  const p = _buildPrompt([{
    name: 'Josh', category: 'timing', total: 55, handled: 4, baseline_pct: 25,
    evidence: {
      failed: [{ quote: 'q', closer_response: 'r', observation: 'o', resolution: 'unhandled', timestamp_seconds: 3200, duration_seconds: 3600 }],
      worked: [],
    },
  }]);
  assert.ok(/do NOT restate the numbers/i.test(p), 'the rule must be explicit');
  assert.ok(/MECHANISM/i.test(p), 'and it must name what is wanted instead');
  assert.ok(p.indexOf('89% through the call') !== -1,
    'position in the call must reach the model — it is what makes "it always lands after '
    + 'the price" available as an answer rather than a guess');
  assert.ok(p.indexOf('MOMENTS THAT DID NOT LAND') !== -1, 'failed moments are the subject');
});

test('⚠ with no failed moments the prompt says so rather than inviting a guess', () => {
  const p = _buildPrompt([{ name: 'Josh', category: 'timing', total: 9, handled: 1, baseline_pct: 30,
    evidence: { failed: [], worked: [] } }]);
  assert.ok(/none captured/i.test(p));
  assert.ok(/rather than guessing/i.test(p));
});

/* ── the gate, over HTTP, with a forged actor ─────────────────────────────── */

test('⚠⚠ A CLOSER IS REFUSED /team/objections/summary SERVER-SIDE', async () => {
  /* ⚠ THE EXPENSIVE LANE NEEDS ITS OWN GATE TEST, not an inherited assumption.
     This is the only route on the board that spends money per request, so an
     authorization gap here is not just a data leak — it is a closer able to
     bill a model call against a board they cannot see. */
  const express = require('express');
  const http = require('http');
  const authPath = require.resolve('../middleware/auth');
  const realAuth = require(authPath);
  const saved = require.cache[authPath].exports;

  // ⚠ requireRole reads `req.userProfileRole`, NOT `req.user.role` — the latter
  // holds Supabase's JWT claim ("authenticated") before requireAuth overwrites
  // it. Stamping only `req.user.role` sends the request to a DB lookup and
  // returns 503, which reads exactly like a passing gate failing for an
  // unrelated reason.
  let actor = { id: 'closer-1', role: 'user' };
  require.cache[authPath].exports = Object.assign({}, realAuth, {
    requireAuth: function (req, _res, next) {
      req.user = { id: actor.id, role: actor.role };
      req.userProfileRole = actor.role;
      next();
    },
  });
  delete require.cache[require.resolve('../routes/team')];
  const router = require('../routes/team');
  const app = express(); app.use('/team', router);
  const server = await new Promise((r) => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  const port = server.address().port;
  const get = () => new Promise((res, rej) => {
    http.get({ port, path: '/team/objections/summary?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z' }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: d }));
    }).on('error', rej);
  });

  try {
    const closer = await get();
    assert.strictEqual(closer.status, 403,
      'a closer must be refused by the gate. Got ' + closer.status + ': ' + closer.body);

    // ⚠ NON-VACUITY: a manager must NOT get 403, or this passes against a route
    // that refuses everyone — including the people it exists for.
    actor = { id: 'mgr-1', role: 'manager' };
    const mgr = await get();
    assert.notStrictEqual(mgr.status, 403, 'a manager must pass the gate; got ' + mgr.body);
  } finally {
    server.close();
    require.cache[authPath].exports = saved;
    delete require.cache[require.resolve('../routes/team')];
  }
});

/* ── the output budget, which is the binding constraint ───────────────────── */

test('⚠⚠ THE OUTPUT BUDGET CLEARS A FULL BOARD — a truncated JSON fails EVERY closer', () => {
  const { _outputBudget, _MAX_CLOSERS_IN_PROMPT } = require('../lib/team-objection-summary');

  /* MEASURED on the live board 2026-08-22: one closer's answer is why 494 +
     what_to_do 330 chars ≈ 230 tokens, ~270 with the JSON wrapper. The failure
     this pins is not a shorter summary — the response stops mid-JSON, the parse
     fails, and the whole panel returns "unavailable" for everyone at once. It
     is invisible on a one-closer board and total on a real team, which is
     exactly why it is asserted rather than eyeballed. */
  const MEASURED_TOKENS_PER_CLOSER = 270;
  const need = _MAX_CLOSERS_IN_PROMPT * MEASURED_TOKENS_PER_CLOSER;
  assert.ok(_outputBudget(_MAX_CLOSERS_IN_PROMPT) >= need,
    'a full board needs ~' + need + ' output tokens; the budget allows only '
    + _outputBudget(_MAX_CLOSERS_IN_PROMPT) + '. Either raise the ceiling or lower '
    + 'MAX_CLOSERS_IN_PROMPT — do not leave them inconsistent.');

  // headroom at every size in between, not just at the ends
  for (let n = 1; n <= _MAX_CLOSERS_IN_PROMPT; n++) {
    assert.ok(_outputBudget(n) >= n * MEASURED_TOKENS_PER_CLOSER,
      n + ' closers: budget ' + _outputBudget(n) + ' < needed ' + n * MEASURED_TOKENS_PER_CLOSER);
  }

  // ⚠ NON-VACUITY: the assertion must be capable of failing. The 4096 ceiling a
  // first draft used does NOT clear a full board — that is the defect this pins.
  const oldBudget = (n) => Math.min(4096, Math.max(1200, 300 * n));
  assert.ok(oldBudget(_MAX_CLOSERS_IN_PROMPT) < need,
    'the superseded 4096 ceiling should fail this check — if it passes, the check is toothless');
});
