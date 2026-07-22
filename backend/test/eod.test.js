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
  const analysis = { prospect_name: 'Tasha Presberry', outcome: 'follow_up', cash_collected: 0, summary: 'Grader summary.' };
  const edits = { cash_collected: '500', summary: 'My own words.' };
  const out = eod._applyEdits(analysis, edits);
  assert.strictEqual(out.fields.prospect_name, 'Tasha Presberry');
  assert.strictEqual(out.fields.outcome, 'follow_up');
  assert.strictEqual(out.fields.cash_collected, '500');
  assert.strictEqual(out.fields.summary, 'My own words.');
  assert.deepStrictEqual(out.edited, { prospect_name: false, outcome: false, cash_collected: true, summary: true });
  // empty-string override is still an override (user cleared the field on purpose)
  const cleared = eod._applyEdits(analysis, { summary: '' });
  assert.strictEqual(cleared.fields.summary, '');
  assert.strictEqual(cleared.edited.summary, true);
});

test('EDITABLE_FIELDS matches the migration CHECK constraint exactly', () => {
  assert.deepStrictEqual(eod._EDITABLE_FIELDS.slice().sort(),
    ['cash_collected', 'outcome', 'prospect_name', 'summary']);
});
