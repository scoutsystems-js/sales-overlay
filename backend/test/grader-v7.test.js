// Grader v7 contract tests: cash_collected extraction + follow-up-email
// greeting rule + version bump. The two prompt changes and the bump ship in
// ONE commit (prompt-change discipline: prompt content and the version that
// stamps it are one atomic change).
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const NORM = { turns: [{ speaker: 'A', text: 'hello', start_seconds: 0 }], closer_name: 'Josh', speaker_confidence: 'matched' };

test('ANALYSIS_PROMPT_VERSION is at least v7 (v7 contracts below are version-independent)', () => {
  const m = worker.ANALYSIS_PROMPT_VERSION.match(/^v(\d+)-/);
  assert.ok(m && parseInt(m[1], 10) >= 7, 'version must be v7+');
});

test('grader prompt defines cash_collected: explicit-only, zero-default, never inferred', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.ok(p.includes('"cash_collected"'), 'JSON template must include the cash_collected key');
  assert.ok(/cash_collected/.test(p) && /explicit/i.test(p), 'field definition must demand an explicit amount');
  assert.ok(/never (guess|infer)/i.test(p), 'must forbid guessing/inferring an amount');
  assert.ok(/\b0\b.*(not|no|nothing|absent|stated)/i.test(p) || /zero/i.test(p), 'must define the zero default');
});

test('grader prompt pins the follow-up greeting to the transcript name, omit-if-unclear', () => {
  const p = worker._buildSectionGraderPrompt(NORM, 1800, '');
  assert.ok(/greeting/i.test(p), 'follow_up_email bullet must address the greeting');
  assert.ok(/omit the name/i.test(p), 'must instruct omitting the name when unclear');
  assert.ok(/meeting title/i.test(p), 'must explicitly forbid the meeting title as a name source');
});

test('sanitizeCashCollected: numbers + clean string formats normalize; ambiguous/junk → 0', () => {
  const f = worker._sanitizeCashCollected;
  // numbers
  assert.strictEqual(f(3000), 3000);
  assert.strictEqual(f(2999.999), 3000);      // rounded to cents
  assert.strictEqual(f(1497.5), 1497.5);
  assert.strictEqual(f(0), 0);
  assert.strictEqual(f(-500), 0);             // negative = extraction error
  assert.strictEqual(f(NaN), 0);
  assert.strictEqual(f(Infinity), 0);
  assert.strictEqual(f(2_000_000), 0);        // > $1M on one call = implausible ⇒ 0
  // clean string formats (amendment): normalize then same bounds/rounding
  assert.strictEqual(f('3000'), 3000);        // plain numeric string
  assert.strictEqual(f('$3,000'), 3000);      // leading currency symbol + thousands sep
  assert.strictEqual(f('3,000.50'), 3000.5);  // thousands sep + cents
  assert.strictEqual(f('$1497.50'), 1497.5);  // symbol, no separators
  assert.strictEqual(f(' 2500 '), 2500);      // padded
  // anything that doesn't normalize unambiguously to one number → 0
  assert.strictEqual(f('3000 or 5000'), 0);   // ambiguous — two candidate amounts
  assert.strictEqual(f('3,00'), 0);           // malformed separator
  assert.strictEqual(f('$'), 0);
  assert.strictEqual(f(''), 0);
  assert.strictEqual(f('-500'), 0);
  assert.strictEqual(f(null), 0);
  assert.strictEqual(f(undefined), 0);
});
