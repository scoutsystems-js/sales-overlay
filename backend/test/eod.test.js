// EOD Report tests — pure pieces: prospect-name prefill derivation and the
// edit-overlay merge rule ("override if present, else analysis value").
const test = require('node:test');
const assert = require('node:assert');
const eod = require('../routes/eod');

test('prospectNameFromTitle: takes the segment after the last pipe, falls back whole/unknown', () => {
  const f = eod._prospectNameFromTitle;
  assert.strictEqual(f('PS Sober Living Riches | Tasha Presberry'), 'Tasha Presberry');
  assert.strictEqual(f('A | B | Carol Jones'), 'Carol Jones');
  assert.strictEqual(f('Fathom Demo'), 'Fathom Demo');
  assert.strictEqual(f('  padded  '), 'padded');
  assert.strictEqual(f('Trailing pipe | '), 'Trailing pipe');   // empty tail → fall back to whole
  assert.strictEqual(f(''), 'Unknown prospect');
  assert.strictEqual(f(null), 'Unknown prospect');
});

test('applyEdits: user override wins per-field, analysis value otherwise, edited flags accurate', () => {
  const analysis = { prospect_name: 'Tasha Presberry', outcome: 'follow_up', cash_collected: 0, summary: 'Grader summary.', payment_structure: 'none_stated' };
  const edits = { cash_collected: '500', summary: 'My own words.' };
  const out = eod._applyEdits(analysis, edits);
  assert.strictEqual(out.fields.prospect_name, 'Tasha Presberry');
  assert.strictEqual(out.fields.outcome, 'follow_up');
  assert.strictEqual(out.fields.cash_collected, '500');
  assert.strictEqual(out.fields.summary, 'My own words.');
  assert.strictEqual(out.fields.payment_structure, 'none_stated');
  assert.deepStrictEqual(out.edited, { prospect_name: false, outcome: false, cash_collected: true, summary: true, payment_structure: false });
  // empty-string override is still an override (user cleared the field on purpose)
  const cleared = eod._applyEdits(analysis, { summary: '' });
  assert.strictEqual(cleared.fields.summary, '');
  assert.strictEqual(cleared.edited.summary, true);
});

test('EDITABLE_FIELDS matches the migration CHECK constraint exactly (022: + payment_structure)', () => {
  assert.deepStrictEqual(eod._EDITABLE_FIELDS.slice().sort(),
    ['cash_collected', 'outcome', 'payment_structure', 'prospect_name', 'summary']);
});

test('payment_structure edits are a constrained choice (route-level allowlist)', () => {
  assert.deepStrictEqual(eod._PAYMENT_STRUCTURES.slice().sort(),
    ['bnpl', 'none_stated', 'paid_in_full', 'payment_plan']);
});

test('outcome prefill: composed label for closed + known structure, plain outcome otherwise', () => {
  const f = eod._outcomePrefill;
  assert.strictEqual(f({ outcome: 'closed', payment_structure: 'paid_in_full' }), 'Closed - PIF');
  assert.strictEqual(f({ outcome: 'closed', payment_structure: 'payment_plan' }), 'Closed - Payment plan');
  assert.strictEqual(f({ outcome: 'closed', payment_structure: 'bnpl' }), 'Closed - Financed');
  // closed but structure unknown → plain outcome, no composition
  assert.strictEqual(f({ outcome: 'closed', payment_structure: 'none_stated' }), 'closed');
  assert.strictEqual(f({ outcome: 'closed' }), 'closed');
  // non-closed never composes, whatever structure claims
  assert.strictEqual(f({ outcome: 'follow_up', payment_structure: 'paid_in_full' }), 'follow_up');
  assert.strictEqual(f({ outcome: 'lost' }), 'lost');
  assert.strictEqual(f({}), null);
});

test('summary prefill: eod_summary wins, overall_summary is the pre-v8 fallback', () => {
  const f = eod._summaryPrefill;
  assert.strictEqual(f({ eod_summary: 'First person.', overall_summary: 'Analytical.' }), 'First person.');
  assert.strictEqual(f({ eod_summary: null, overall_summary: 'Analytical.' }), 'Analytical.');
  assert.strictEqual(f({ eod_summary: '', overall_summary: 'Analytical.' }), 'Analytical.');
  assert.strictEqual(f({}), null);
});
