/**
 * 10d — the WHY sentence.
 *
 * ⚠⚠ THE CAUSE IS COUNTED, NOT INFERRED. The model is NEVER asked why. JS counts
 * the modal uncovered discovery area from 7d's `what_mattered` — a field already
 * verified at write time (the area exists for that rep, was marked uncovered, and
 * the prospect's quote reconstructs) — and the model only turns the handed
 * numbers into a sentence. "Let the model explain why" is the drift this guards.
 *
 * ⚠ TWO TIERS, because the structured cause exists for one rep in eight. Tier 1
 * is numbers only and always available. Tier 2 adds the counted cause and appears
 * only when the modal area covers ≥40% of that rep's calls that have a
 * what_mattered, with ≥10 such calls. Josh is 93/130 = 72%; nobody else has a
 * coverage map at all.
 */
const test = require('node:test');
const assert = require('node:assert');
const W = require('../lib/why-prose');

const REP = {
  display_name: 'josh',
  prospect_close_rate: 27, prospect_close_wins: 39, prospect_close_total: 142,
  obj_handle_rate: 13, obj_handled: 17, obj_total: 132,
  weakest_section: { section: 'discovery', score: 47 },
  weakest_objection: { category: 'timing', rate: 7, handled: 3, total: 42,
                       comparable: false, team_rate: null, is_lowest: null },
};
const wm = (key, n) => Array.from({ length: n }, () => ({ area_key: key, reason_verified: true }));

// ── tiering ───────────────────────────────────────────────────────────────

test('TIER 2 when the modal area is concentrated enough and has volume', () => {
  const f = W.computeWhyFacts(REP, wm('income_goal_and_motivation', 93).concat(wm('previous_attempts', 37)));
  assert.strictEqual(f.tier, 2);
  assert.strictEqual(f.cause.area_key, 'income_goal_and_motivation');
  assert.strictEqual(f.cause.count, 93);
  assert.strictEqual(f.cause.denominator, 130);
  assert.strictEqual(f.cause.share, 72);
  assert.strictEqual(f.cause.area, 'income goal and motivation', 'humanised for the sentence');
});

test('TIER 1 when the modal area is too THIN — under the call minimum', () => {
  const f = W.computeWhyFacts(REP, wm('income_goal_and_motivation', 9));
  assert.strictEqual(f.tier, 1);
  assert.strictEqual(f.cause, null, 'no cause is offered rather than a weak one');
});

test('TIER 1 when the modal area is too DIFFUSE — under the share minimum', () => {
  // 12 of 40 = 30%: plenty of calls, no dominant area. Naming one would present
  // a coin flip as a finding.
  const f = W.computeWhyFacts(REP, wm('a', 12).concat(wm('b', 11), wm('c', 9), wm('d', 8)));
  assert.strictEqual(f.tier, 1);
  assert.strictEqual(f.cause, null);
});

test('TIER 1 with no what_mattered at all — the case for 7 of 8 reps', () => {
  [[], null, undefined].forEach((rows) => {
    const f = W.computeWhyFacts(REP, rows);
    assert.strictEqual(f.tier, 1, JSON.stringify(rows));
    assert.strictEqual(f.cause, null);
  });
});

test('UNVERIFIED rows are not counted toward the cause', () => {
  // The whole claim rests on the field having been verified at write time.
  const rows = wm('x', 20).map((r, i) => (i < 15 ? { area_key: 'x', reason_verified: false } : r));
  const f = W.computeWhyFacts(REP, rows);
  assert.strictEqual(f.tier, 1, 'only 5 verified rows — under the minimum');
});

test('the thresholds are the ruled ones', () => {
  assert.strictEqual(W.TIER2_MIN_SHARE_PCT, 40);
  assert.strictEqual(W.TIER2_MIN_CALLS, 10);
});

// ── the facts handed to the model ─────────────────────────────────────────

test('tier-1 facts carry every number the sentence may use, and no others', () => {
  const f = W.computeWhyFacts(REP, []);
  assert.strictEqual(f.name, 'josh');
  assert.deepStrictEqual(f.closing, { rate: 27, closed: 39, total: 142 });
  assert.deepStrictEqual(f.objections, { rate: 13, handled: 17, total: 132 });
  assert.deepStrictEqual(f.weakest_section, { section: 'discovery', score: 47 });
  assert.strictEqual(f.weakest_objection.category, 'timing');
  assert.strictEqual(f.weakest_objection.comparable, false);
});

test('an unmeasured rep produces facts that say so rather than zeros', () => {
  const f = W.computeWhyFacts({ display_name: 'ava', prospect_close_total: 0, obj_total: 0 }, []);
  assert.strictEqual(f.closing, null, 'no closing rate to narrate');
  assert.strictEqual(f.objections, null);
  assert.strictEqual(f.tier, 1);
});

// ── the prompt contract ───────────────────────────────────────────────────

test('the prompt FORBIDS supplying a cause and forbids intensifiers', () => {
  const p = W.buildWhyPrompt(W.computeWhyFacts(REP, wm('income_goal_and_motivation', 93).concat(wm('x', 37))));
  assert.ok(/only the facts below/i.test(p), 'must restrict the model to the handed facts');
  assert.ok(/do not invent[\s\S]{0,40}cause/i.test(p), 'must forbid inventing a cause');
  assert.ok(/constantly/i.test(p), 'must name the banned intensifiers explicitly');
  assert.ok(/onboarding|follow-up/i.test(p), 'must say WHY intensifiers are banned, not just that they are');
});

test('a tier-1 prompt does not mention a cause at all', () => {
  const p = W.buildWhyPrompt(W.computeWhyFacts(REP, []));
  assert.ok(!/uncovered/i.test(p), 'no cause facts, so no cause vocabulary: ' + p.slice(0, 200));
  assert.ok(/do not speculate/i.test(p), 'and it must be told not to fill the gap');
});

// ── verification of what comes back ───────────────────────────────────────

test('a sentence whose numbers all trace to the facts PASSES', () => {
  const f = W.computeWhyFacts(REP, wm('income_goal_and_motivation', 93).concat(wm('x', 37)));
  const ok = W.verifyWhySentence(
    'Discovery is josh\'s weakest section at 47. On 93 of his 130 calls the ground left uncovered was income goal and motivation.', f);
  assert.strictEqual(ok.ok, true, ok.reason);
});

test('AN INVENTED NUMBER IS REJECTED', () => {
  const f = W.computeWhyFacts(REP, []);
  const bad = W.verifyWhySentence('Discovery is his weakest section at 47, down 12 points from last month.', f);
  assert.strictEqual(bad.ok, false);
  assert.ok(/12/.test(bad.reason), bad.reason);
});

test('AN INTENSIFIER IS REJECTED — the data does not carry it', () => {
  const f = W.computeWhyFacts(REP, []);
  ['josh constantly scores low on discovery at 47.',
   'josh consistently scores low on discovery at 47.',
   'josh always scores low on discovery at 47.'].forEach(function (s) {
    const r = W.verifyWhySentence(s, f);
    assert.strictEqual(r.ok, false, s);
    assert.ok(/intensifier/i.test(r.reason), r.reason);
  });
});

test('a tier-1 sentence that asserts a CAUSE anyway is rejected', () => {
  const f = W.computeWhyFacts(REP, []);
  const r = W.verifyWhySentence(
    'Discovery is his weakest section at 47 because he is not challenging prospects enough.', f);
  assert.strictEqual(r.ok, false);
  assert.ok(/cause/i.test(r.reason), r.reason);
});

// ── the deterministic fallback ────────────────────────────────────────────

test('the FALLBACK sentence is correct on its own, with no model involved', () => {
  const f = W.computeWhyFacts(REP, wm('income_goal_and_motivation', 93).concat(wm('x', 37)));
  const s = W.fallbackSentence(f);
  assert.ok(s.indexOf('discovery') !== -1 || s.indexOf('Discovery') !== -1);
  assert.ok(s.indexOf('47') !== -1);
  assert.ok(s.indexOf('93') !== -1 && s.indexOf('130') !== -1);
  assert.strictEqual(W.verifyWhySentence(s, f).ok, true, 'the fallback must pass its own verifier');
});

test('the fallback holds for tier 1 and for an unmeasured rep', () => {
  const t1 = W.computeWhyFacts(REP, []);
  assert.strictEqual(W.verifyWhySentence(W.fallbackSentence(t1), t1).ok, true);
  const none = W.computeWhyFacts({ display_name: 'ava', prospect_close_total: 0, obj_total: 0 }, []);
  const s = W.fallbackSentence(none);
  assert.ok(typeof s === 'string' && s.length > 0, 'never empty');
  assert.strictEqual(W.verifyWhySentence(s, none).ok, true);
});

test('humanising an area key never leaks snake_case into prose', () => {
  assert.strictEqual(W.humanArea('income_goal_and_motivation'), 'income goal and motivation');
  assert.strictEqual(W.humanArea('previous_attempts'), 'previous attempts');
  assert.strictEqual(W.humanArea(''), null);
  assert.strictEqual(W.humanArea(null), null);
});

test('⚠ A TIER-2 REP CANNOT BE GIVEN A DIFFERENT, FABRICATED CAUSE', () => {
  // The hole the first verifier had: it only asked "is there a cause when there
  // is no evidence". A tier-2 rep could be handed a cause that has nothing to do
  // with the counted area and it passed. Found by running the guards against
  // live facts rather than fixtures.
  const f = W.computeWhyFacts(REP, wm('income_goal_and_motivation', 93).concat(wm('x', 37)));
  assert.strictEqual(f.tier, 2);
  const r = W.verifyWhySentence('Discovery is his weakest section at 47 because he rushes past rapport.', f);
  assert.strictEqual(r.ok, false, 'a fabricated cause must be refused even at tier 2');
  assert.ok(/not the counted one/.test(r.reason), r.reason);

  // The counted cause, stated, still passes.
  const good = W.verifyWhySentence(
    'Discovery is his weakest section at 47, because on 93 of 130 assessed calls the ground left uncovered was income goal and motivation.', f);
  assert.strictEqual(good.ok, true, good.reason);
});
