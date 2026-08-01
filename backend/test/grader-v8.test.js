// Grader v8 contract tests: transaction-evidence cash extraction with
// per-structure rules, payment_structure field, first-person EOD summary.
// All prompt changes + the bump ship in ONE commit (prompt discipline).
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const NORM = { turns: [{ speaker: 'A', text: 'hello', start_seconds: 0 }], closer_name: 'Josh', speaker_confidence: 'matched' };

test('ANALYSIS_PROMPT_VERSION is at least v9 (v9 = sharper outcome criteria; v8 content intact)', () => {
  // "at least v9" — numeric parse so later bumps (v10 added highlight sections) don't break it.
  const m = worker.ANALYSIS_PROMPT_VERSION.match(/^v(\d+)-/);
  assert.ok(m, 'version should look like vN-YYYY-MM-DD');
  assert.ok(parseInt(m[1], 10) >= 9, 'expected >= v9, got ' + worker.ANALYSIS_PROMPT_VERSION);
});

test('v8 prompt hunts transaction evidence and names the vehicles', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.ok(/actively (look|search|scan)/i.test(p), 'must instruct active evidence hunting');
  assert.ok(/card/i.test(p) && /deposit/i.test(p), 'card + deposit evidence named');
  assert.ok(/Affirm|Klarna/i.test(p) && /BNPL|buy now/i.test(p), 'BNPL financing named');
  assert.ok(/first payment/i.test(p), 'plan first-payments named');
});

test('v8 prompt defines payment_structure: four values, closed-only', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.ok(p.includes('"payment_structure"'), 'JSON template includes payment_structure');
  for (const v of ['paid_in_full', 'payment_plan', 'bnpl', 'none_stated']) {
    assert.ok(p.includes(v), 'value present: ' + v);
  }
  assert.ok(/closed/i.test(p) && /none_stated/i.test(p), 'closed-only rule with none_stated default');
});

test('v8 prompt states per-structure cash rules explicitly (ruling 3)', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.ok(/paid_in_full.*full amount charged/is.test(p), 'PIF: full amount charged on the call');
  assert.ok(/payment_plan.*(never|not).*(total contract|contract value)/is.test(p), 'plan: never total contract value');
  assert.ok(/bnpl.*full financed amount/is.test(p), 'BNPL: full financed amount');
});

test('v8 prompt defines the first-person EOD summary with no AI tells', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.ok(p.includes('"eod_summary"'), 'JSON template includes eod_summary');
  assert.ok(/first person/i.test(p), 'first-person instruction');
  assert.ok(/2-4 sentence/i.test(p), 'length bound');
  assert.ok(/(no|without).*(coaching|self-criticism)/i.test(p), 'losses stated plainly, no coaching language');
  assert.ok(/third.person/i.test(p), 'forbids third-person narration of the closer');
});

test('sanitizePaymentStructure: allowlist + non-closed coupling → none_stated', () => {
  const f = worker._sanitizePaymentStructure;
  assert.strictEqual(f('paid_in_full', 'closed'), 'paid_in_full');
  assert.strictEqual(f('payment_plan', 'closed'), 'payment_plan');
  assert.strictEqual(f('bnpl', 'closed'), 'bnpl');
  assert.strictEqual(f('none_stated', 'closed'), 'none_stated');
  assert.strictEqual(f('PAID_IN_FULL', 'closed'), 'paid_in_full');   // case-normalized
  assert.strictEqual(f('installments', 'closed'), 'none_stated');    // unknown → none_stated
  assert.strictEqual(f(null, 'closed'), 'none_stated');
  // server-side coupling: any non-closed outcome forces none_stated
  assert.strictEqual(f('paid_in_full', 'follow_up'), 'none_stated');
  assert.strictEqual(f('bnpl', 'lost'), 'none_stated');
  assert.strictEqual(f('payment_plan', null), 'none_stated');
});

test('eod_summary persists as a capped string, null otherwise', () => {
  const f = worker._sanitizeEodSummary;
  assert.strictEqual(f('Spoke with Jamie about the program.'), 'Spoke with Jamie about the program.');
  assert.strictEqual(f('  padded  '), 'padded');
  assert.strictEqual(f(''), null);
  assert.strictEqual(f('   '), null);
  assert.strictEqual(f(123), null);
  assert.strictEqual(f(null), null);
  assert.strictEqual(f('x'.repeat(3000)).length, 2000);   // capped
});

// v9 (2026-07-27): sharper outcome criteria (Thread 1, ruling 5).
test('v9 outcome criteria: disqualified→lost, no_show=very short/no discovery-pitch-close, follow_up needs a live path', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.match(p, /DISQUALIFIED/);
  assert.match(p, /"lost", NOT "follow_up"/);
  assert.match(p, /under ~2 minutes.*NO discovery, NO pitch, and NO close/);
  assert.match(p, /live path forward/);
});
