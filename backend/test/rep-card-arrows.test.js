/**
 * THE REP CARD ARROWS (Justin, 2026-09-03; H704). "Code has a tendency to over-label
 * and explain data points" — the line "▼ 4 vs prior period · 143 calls" goes. In its
 * place: a small coloured arrow to the right of the closing %, and the change.
 * NOTHING ELSE. Same on objection handle rate and average call time.
 *
 * ⚠ THE ARROW TRACKS MOVEMENT SINCE LAST PERIOD AND NOTHING ELSE: up = went up,
 * down = went down, colour follows direction, IDENTICAL across the three metrics.
 * It carries no judgement — the band, the gauge and the rankings do that.
 * ⚠ THE PARTIAL-PERIOD TRAP: the delta is computed on the SERVER and only when
 * BOTH windows clear the comparison floor (MIN_BUCKET — a floor guards a
 * COMPARISON, never a count, H660); otherwise it is null and no arrow renders.
 * No label, no words: labels are what is being removed.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { liveCard, JOSH, DRE, DANIEL, STATE, LIVE } = require('./helpers/rep-card-live');
const ta = require('../lib/team-analytics');
const { MIN_BUCKET } = require('../lib/team-needs-work');

test('⚠⚠ the band carries the name only — no movement chip, no call count, no "vs prior period"', () => {
  const html = liveCard()(STATE)(JOSH);
  const band = html.slice(html.indexOf('rep-card-band'), html.indexOf('rep-card-body'));
  assert.ok(!/rep-move|prior period|rep-card-calls|\d+ calls?</.test(band), 'band is name + monogram only: ' + band.slice(0, 300));
  assert.ok(!/prior period/.test(html), 'the words are gone from the whole card');
});

test('⚠⚠ three arrows, one style: closing %, objections handled, avg call time — each the arrow and the change, nothing else', () => {
  const html = liveCard()(STATE)(Object.assign({}, JOSH, { close_delta: 2, obj_delta: -4, time_delta: 3.2 }));
  const lead = html.slice(html.indexOf('rep-card-lead-val'), html.indexOf('rep-card-lead-label'));
  assert.ok(/24%[\s\S]{0,60}<span class="rep-delta up">▲ 2%<\/span>/.test(lead), 'closing: arrow + change to the right of the %: ' + lead);
  const obj = html.slice(html.indexOf('Objection handle %') - 400, html.indexOf('Objection handle %'));
  assert.ok(/13%[\s\S]{0,60}<span class="rep-delta down">▼ 4%<\/span>/.test(obj), 'objections: same style: ' + obj.slice(-200));
  const time = html.slice(html.indexOf('47.3'), html.indexOf('Avg call time'));
  assert.ok(/<span class="rep-delta up">▲ 3\.2 min<\/span>/.test(time), 'call time: same style, its own unit: ' + time);
  const deltas = html.match(/class="rep-delta (up|down)"/g) || [];
  assert.strictEqual(deltas.length, 3, 'exactly three arrows');
  assert.ok(!/rep-delta[^>]*>[^<]*(vs|prior|period|calls|better|worse|good|bad)/i.test(html), 'no words on an arrow');
});

test('⚠⚠ colour follows DIRECTION, identical across metrics — a longer call is "up" and green, like a higher rate', () => {
  const html = liveCard()(STATE)(Object.assign({}, JOSH, { close_delta: -1, obj_delta: 5, time_delta: -2.5 }));
  assert.ok(/rep-delta down">▼ 1%/.test(html) && /rep-delta up">▲ 5%/.test(html) && /rep-delta down">▼ 2\.5 min/.test(html));
  assert.ok(/\.rep-delta\.up \{[^}]*var\(--good\)/.test(LIVE) && /\.rep-delta\.down \{[^}]*var\(--bad\)/.test(LIVE), 'one rule per direction, no per-metric colour');
  assert.ok(!/rep-delta-(closing|obj|time)/.test(LIVE), 'no per-metric arrow class exists');
});

test('⚠ null or zero delta → no arrow, and no placeholder in its place', () => {
  const none = liveCard()(STATE)(Object.assign({}, JOSH, { close_delta: null, obj_delta: 0, time_delta: undefined }));
  assert.ok(!/rep-delta/.test(none), 'no arrow when unmeasurable or flat');
  assert.ok(!/rep-delta/.test(liveCard()(STATE)(DRE)) && !/rep-delta/.test(liveCard()(STATE)(DANIEL)));
});

test('⚠⚠ the server computes the delta only when BOTH windows clear the comparison floor (the partial-period trap)', () => {
  assert.strictEqual(typeof ta.repDelta, 'function');
  assert.strictEqual(ta.repDelta(24, 22, 40, 35, MIN_BUCKET), 2);
  assert.strictEqual(ta.repDelta(22, 24, 40, 35, MIN_BUCKET), -2);
  assert.strictEqual(ta.repDelta(47.3, 44.1, 40, 35, MIN_BUCKET, 1), 3.2, 'call time keeps one decimal');
  assert.strictEqual(ta.repDelta(24, 22, 40, MIN_BUCKET - 1, MIN_BUCKET), null, 'prior window below the floor → null');
  assert.strictEqual(ta.repDelta(24, 22, MIN_BUCKET - 1, 40, MIN_BUCKET), null, 'current window below the floor (a Tuesday) → null');
  assert.strictEqual(ta.repDelta(null, 22, 40, 40, MIN_BUCKET), null);
  assert.strictEqual(ta.repDelta(24, null, 40, 40, MIN_BUCKET), null);
  assert.strictEqual(ta.repDelta(24, 24, 40, 40, MIN_BUCKET), 0);
});

test('⚠⚠ computeTeamAnalytics (EXECUTED) puts close_delta / obj_delta / time_delta on every rep, null below the floor', async () => {
  const rows = [], analyses = [];
  for (let i = 0; i < 8; i++) { rows.push({ id: 'a' + i, user_id: 'A', call_date: '2026-07-20T00:00:00Z', duration_seconds: 2400 + i * 60 });
    analyses.push({ fathom_call_id: 'a' + i, analyzed_at: '2026-07-20T01:00:00Z', overall_score: 60, outcome: i % 2 ? 'closed' : 'lost', status: 'done' }); }
  const admin = { from(table) { const data = table === 'fathom_calls' ? rows : (table === 'call_analyses' ? analyses : []);
    const chain = { select() { return chain; }, in() { return chain; }, not() { return chain; }, is() { return chain; }, eq() { return chain; }, gte() { return chain; }, lte() { return chain; }, order() { return chain; }, range() { return chain; },
      then(res) { res({ data: data, error: null }); } }; return chain; } };
  const out = await ta.computeTeamAnalytics(admin, ['A'], '2026-07-15T00:00:00Z', '2026-07-25T00:00:00Z', {});
  const a = out.per_rep[0];
  ['close_delta', 'obj_delta', 'time_delta'].forEach(k => assert.ok(k in a, 'payload carries ' + k));
  /* the fake returns the same rows for both windows: 8 calls ≥ floor on both sides, so time_delta is 0; no objections → obj_delta null */
  assert.strictEqual(a.time_delta, 0);
  assert.strictEqual(a.obj_delta, null);
});
