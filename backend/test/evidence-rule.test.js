/**
 * WHICH MOMENT MAY BACK WHICH CLAIM — shipped, and MEASURED NOT TO FIX IT.
 *
 * ⚠⚠ READ THIS BEFORE ASSUMING THE PROBLEM IS SOLVED. The rule is correct
 * guidance and it did NOT move the number: 67% of what-to-improve evidence was
 * mismatched before it, 75% after (small live sample — call it "no change").
 * It ships because it is right, not because it works.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ER = require('../lib/evidence-rule');
const TEAM = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
const PERF = fs.readFileSync(path.join(__dirname, '..', 'lib', 'performance-synthesis.js'), 'utf8');

test('⚠ THE RULE NAMES TYPES AND ONE EXCEPTION — an adjective is not a rule', () => {
  // "Cite appropriate evidence" is something a model agrees with and misapplies;
  // this codebase has paid for that three times (v14, v17, v18).
  ER.NEGATIVE_TYPES.forEach((t) => assert.ok(ER.EVIDENCE_RULE.indexOf(t) !== -1, 'missing ' + t));
  ER.POSITIVE_TYPES.forEach((t) => assert.ok(ER.EVIDENCE_RULE.indexOf(t) !== -1, 'missing ' + t));
  assert.ok(/EXCEPTION/.test(ER.EVIDENCE_RULE), 'the one legitimate case must be stated, not implied');
  assert.ok(/MISSED it or did not act on it/.test(ER.EVIDENCE_RULE));
});

test('⚠ THE TWO TYPE LISTS ARE DISJOINT — a type in both makes the rule unfollowable', () => {
  const overlap = ER.NEGATIVE_TYPES.filter((t) => ER.POSITIVE_TYPES.indexOf(t) !== -1);
  assert.deepStrictEqual(overlap, []);
});

test('BOTH syntheses carry it, above the list it governs', () => {
  [['team', TEAM], ['performance', PERF]].forEach(function (pair) {
    const src = pair[1];
    assert.ok(/EVIDENCE_RULE/.test(src), pair[0] + ' must include the rule');
    const rAt = src.indexOf('EVIDENCE_RULE)') !== -1 ? src.indexOf('EVIDENCE_RULE)') : src.indexOf('EVIDENCE_RULE,');
    const lAt = src.indexOf('EVIDENCE MOMENTS');
    assert.ok(rAt !== -1 && lAt !== -1 && rAt < lAt, pair[0] + ': the rule must precede the list');
  });
});

test('⚠⚠ THE TYPE WAS ALREADY ON EVERY CANDIDATE LINE — the data was never the gap', () => {
  /* My first diagnosis said the synthesis threw the type away before the prompt.
     It does not, and has not since July — which is why the fix had to be the
     RULE rather than the data, and why passing more information could not help. */
  assert.ok(/\+ c\.type \+/.test(TEAM), 'team candidates carry their type');
  assert.ok(/\+ c\.type \+/.test(PERF), 'performance candidates carry their type');
});

test('⚠⚠ THE VERSION IS DELIBERATELY NOT IN EITHER CACHE KEY', () => {
  /* A version bump forces every cached synthesis to regenerate at real cost.
     The rule was measured not to work, so spending on that would be paying to
     look busy. Put it back the day a fix moves the number. */
  const hashOf = (src, re) => { const m = re.exec(src); return m ? m[1] : ''; };
  assert.ok(!/EVIDENCE_RULE_VERSION/.test(hashOf(TEAM, /update\(([\s\S]*?)\)\.digest/)),
    'team hash must not carry the version while the rule is unproven');
  assert.ok(!/EVIDENCE_RULE_VERSION/.test(hashOf(PERF, /var hashInput = ([\s\S]*?);\n/)),
    'performance hash must not carry it either');
  assert.ok(ER.EVIDENCE_RULE_VERSION, 'the constant stays, ready for the day it is earned');
});

test('⚠ NO SERVER-SIDE SUPPRESSION WAS ADDED', () => {
  // A filter would hide the remaining failures instead of revealing them, and we
  // would never learn whether the real fix worked. The 69% must stay measurable.
  [TEAM, PERF].forEach(function (src) {
    assert.ok(!/improve\s*=\s*improve\.filter/.test(src), 'the model still chooses');
    assert.ok(!/POSITIVE_TYPES\.indexOf/.test(src), 'no type-based stripping of the model output');
  });
});
