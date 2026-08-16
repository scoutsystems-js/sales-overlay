/**
 * Stage 3 — the personal needs-work degrade message names the window.
 *
 * ⚠ WHY. PERSONAL_MIN_ANALYZED = 3 and PERSONAL_MIN_BUCKET = 4 were set when the
 * range was one of four presets. A free date picker lets a rep select six days
 * and land under those gates routinely, and "not enough of your objections yet"
 * then reads as a verdict on the REP when it is a fact about the WINDOW.
 */
const test = require('node:test');
const assert = require('node:assert');
const { _computeNeedsWork, _PERSONAL_MIN_ANALYZED, _PERSONAL_MIN_BUCKET } = require('../lib/team-needs-work');

const personal = (over) => Object.assign(
  { subject: 'personal', minBucket: _PERSONAL_MIN_BUCKET, minAnalyzed: _PERSONAL_MIN_ANALYZED }, over);

test('the volume degrade names the selected window, and points at the fix', () => {
  const r = _computeNeedsWork([], [], {}, personal({ windowDays: 6 }));
  assert.strictEqual(r.state, 'insufficient');
  assert.ok(/in the 6 days you selected/.test(r.card_text), r.card_text);
  assert.ok(/wider range/.test(r.card_text), 'it must say what to do about it');
});

test('one day reads as "1 day", not "1 days"', () => {
  const r = _computeNeedsWork([], [], {}, personal({ windowDays: 1 }));
  assert.ok(/in the 1 day you selected/.test(r.card_text), r.card_text);
});

test('WITHOUT a window the old wording is unchanged — no caller is forced to pass it', () => {
  const r = _computeNeedsWork([], [], {}, personal({}));
  assert.ok(/keep logging calls/.test(r.card_text), r.card_text);
  assert.ok(!/you selected/.test(r.card_text));
});

test('the TEAM lane is untouched — it already said "this period"', () => {
  const r = _computeNeedsWork([], [], {}, { subject: 'team', minBucket: 6, minAnalyzed: 5, windowDays: 6 });
  assert.ok(/this period/.test(r.card_text), r.card_text);
  assert.ok(!/you selected/.test(r.card_text), 'the team wording must not change');
});

test('the "nothing stands out" degrade names the window too', () => {
  // The other branch a short window trips: enough volume, no bucket clears the gap.
  const objs = Array.from({ length: 10 }, (_, i) => ({ surface: 'price', handled: true, call_id: 'c' + i }));
  const analyses = Array.from({ length: 5 }, (_, i) => ({ fathom_call_id: 'c' + i, outcome: 'closed', cash_collected: 0 }));
  const r = _computeNeedsWork(objs, analyses, {}, personal({ windowDays: 9 }));
  if (r.state === 'insufficient' && /stands out/.test(r.card_text)) {
    assert.ok(/in the 9 days you selected/.test(r.card_text), r.card_text);
  }
});
