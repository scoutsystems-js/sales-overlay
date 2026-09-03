/**
 * THE BLIND HARNESS, SCORED ON PLANTED CASES BEFORE IT IS BELIEVED (H708). Labels held
 * aside; the two errors separate; unsure its own outcome; base rate beside every score;
 * right-for-the-wrong-reason surfaced; mistakes grouped by reason.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const H = require('../lib/classifier-harness');

function items() {
  const out = [];
  for (let i = 0; i < 90; i++) out.push({ id: 's' + i, label: 'sales', stratum: i < 20 ? 'short_followup' : 'normal' });
  for (let i = 0; i < 30; i++) out.push({ id: 'n' + i, label: 'not_sales', stratum: i < 10 ? 'training' : 'internal' });
  out.push({ id: 'hard-reconnect', label: 'sales', stratum: 'hard', hard: true });
  out.push({ id: 'hard-debrief', label: 'not_sales', stratum: 'hard', hard: true });
  return out;
}

test('drawSets: two shuffled sets, every stratum split, labels in a separate map, reproducible by seed', () => {
  const a = H.drawSets(items(), { seed: 7, tuningShare: 1 / 3 });
  const b = H.drawSets(items(), { seed: 7, tuningShare: 1 / 3 });
  assert.deepStrictEqual(a.tuning, b.tuning, 'same seed, same draw');
  assert.strictEqual(a.tuning.length + a.held_out.length, 122);
  assert.ok(a.tuning.every((id) => !a.held_out.includes(id)), 'disjoint');
  assert.ok(Math.abs(a.tuning.length - 122 / 3) <= 4, 'about a third in tuning: ' + a.tuning.length);
  assert.ok(a.manifest.strata['sales:short_followup'].held_out >= 12, 'the short follow-ups are mostly held out');
  assert.ok(a.manifest.held_out.base_rate_sales >= 70 && a.manifest.held_out.base_rate_sales <= 80, 'base rate reported: ' + a.manifest.held_out.base_rate_sales);
  assert.strictEqual(Object.keys(a.labels).length, 122, 'labels live in their own map — the runner is never handed them');
  const c = H.drawSets(items(), { seed: 8 });
  assert.notDeepStrictEqual(a.tuning.slice(0, 10), c.tuning.slice(0, 10), 'a different seed draws differently');
});

test('⚠⚠ PLANTED: "always say sales" scores exactly the base rate and deletes nothing; a perfect predictor has zero errors', () => {
  const labels = { s1: 'sales', s2: 'sales', s3: 'sales', n1: 'not_sales' };
  const always = ['s1', 's2', 's3', 'n1'].map((id) => ({ id, verdict: 'sales', reason_class: 'prospect_pitch_or_price' }));
  const r = H.score(always, labels);
  assert.strictEqual(r.base_rate_sales, 75); assert.strictEqual(r.always_sales_would_score, 75);
  assert.strictEqual(r.wrong_not_sales.count, 0, 'never deletes a real call');
  assert.strictEqual(r.wrong_sales.count, 1); assert.strictEqual(r.wrong_sales.rate, 100, 'lets every training through');
  const perfect = [{ id: 's1', verdict: 'sales', reason_class: 'prospect_pitch_or_price' }, { id: 'n1', verdict: 'not_sales', reason_class: 'no_prospect_internal_staff' }];
  const p = H.score(perfect, labels);
  assert.strictEqual(p.wrong_not_sales.count, 0); assert.strictEqual(p.wrong_sales.count, 0); assert.strictEqual(p.right.count, 2);
});

test('⚠⚠ PLANTED: the two errors are counted SEPARATELY, unsure is its own outcome, and a right verdict on the wrong reason is surfaced', () => {
  const labels = { s1: 'sales', s2: 'sales', s3: 'sales', n1: 'not_sales', n2: 'not_sales' };
  const rows = [
    { id: 's1', verdict: 'not_sales', reason_class: 'no_prospect_internal_staff', reason: 'two staff, no prospect' },   // the expensive error
    { id: 's2', verdict: 'unsure', reason_class: 'cannot_tell' },
    { id: 's3', verdict: 'sales', reason_class: 'recording_stub', reason: 'a stub' },                                     // right, wrong reason
    { id: 'n1', verdict: 'sales', reason_class: 'prospect_pitch_or_price', reason: 'a pitch was made' },                 // the cheaper error
    { id: 'n2', verdict: 'not_sales', reason_class: 'training_or_roleplay' },
  ];
  const r = H.score(rows, labels, { s1: { title: 'Nick & Chanice Ward' } });
  assert.deepStrictEqual({ wn: r.wrong_not_sales.count, ws: r.wrong_sales.count, u: r.unsure.count, right: r.right.count }, { wn: 1, ws: 1, u: 1, right: 2 });
  assert.strictEqual(r.wrong_not_sales.rate, 33.3, 'of the 3 real calls'); assert.strictEqual(r.wrong_sales.rate, 50, 'of the 2 non-sales calls'); assert.strictEqual(r.unsure.rate, 20);
  assert.strictEqual(r.right_for_wrong_reason.length, 1); assert.strictEqual(r.right_for_wrong_reason[0].id, 's3');
  assert.deepStrictEqual(Object.keys(r.mistakes_by_reason).sort(), ['no_prospect_internal_staff', 'prospect_pitch_or_price'], 'mistakes grouped by reason');
  const text = H.renderReport(r, 'planted');
  assert.ok(/wrong "not a sales call"[^\n]*1 of 3 real calls \(33\.3%\)/.test(text) && /wrong "sales"[^\n]*1 of 2/.test(text) && /unsure[^\n]*1 of 5 \(20%\)/.test(text), text);
  assert.ok(/Nick & Chanice Ward/.test(text), 'the wrong ones are shown in plain language with their title');
  assert.ok(!/accuracy/i.test(text), 'never one accuracy figure');
});

test('⚠⚠ NOTHING AUTO-MARKS: the worker stores the verdict beside the call and never writes not_a_sales_call from it', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'));
  assert.ok(/sales_call_verdict:\s*salesCallVerdict\(graderParsed\)\.verdict/.test(src), 'stored on the analysis row');
  const lines = src.split('\n').filter((l) => /sales_call_verdict|salesCallVerdict/.test(l));
  assert.ok(lines.length >= 3);
  lines.forEach((l) => assert.ok(!/not_a_sales_call|fathom_calls/.test(l), 'the verdict never reaches fathom_calls: ' + l.trim()));
  assert.ok(/ANALYSIS_PROMPT_VERSION = 'v39-2026-09-03'/.test(src), 'the field shipped with its version bump');
  const W = require('../lib/analysis-worker');
  assert.deepStrictEqual(W._salesCallVerdict({ sales_call_verdict: 'Not_Sales', sales_call_reason_class: 'training_or_roleplay', sales_call_reason: ' a role-play ' }), { verdict: 'not_sales', reason_class: 'training_or_roleplay', reason: 'a role-play' });
  assert.strictEqual(W._salesCallVerdict({ sales_call_verdict: 'maybe' }).verdict, null, 'an unknown verdict is NULL, never a guess');
  const prompt = W._buildSectionGraderPrompt({ turns: [{ speaker: 'CLOSER', display_name: 'A', text: 'hello', start_seconds: 1 }], highlights: [], closer_name: 'A', speaker_confidence: 'matched' }, 600, '', [], {});
  const iReason = prompt.indexOf('- sales_call_reason:'), iVerdict = prompt.indexOf('- sales_call_verdict:');
  assert.ok(iReason !== -1 && iVerdict !== -1 && iReason < iVerdict, 'the reason is asked for BEFORE the verdict');
  assert.ok(/"sales_call_reason": "\.\.\.",\n\s*"sales_call_reason_class": "\.\.\.",\n\s*"sales_call_verdict"/.test(prompt), 'and the JSON shape puts the reason first');
});
