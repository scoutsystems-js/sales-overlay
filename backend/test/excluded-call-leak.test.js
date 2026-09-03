/* NOT-A-SALES-CALL DATA REACHING COACHING (2026-08-30).
   Justin found Discovery coaching on a closer's internal meeting with his own
   sales manager. Three distinct defects, and the middle one is the worst because
   it is silent and survives any display fix. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ⚠ line comments FIRST, then block — a block opener inside a `//` line is a
// false opener that eats to the next real closer.
function code(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('⚠⚠ per-moment COACHING is gated on not_a_sales_call, like the harvest beside it', () => {
  const w = code('lib/analysis-worker.js');
  assert.ok(/not_a_sales_call === true\) \{[\s\S]{0,200}?skipped — not a sales call/.test(w),
    'THE HARVEST CHECKED THE FLAG AND THE COACHING ONE LINE ABOVE IT DID NOT, so a marked '
    + 'call still had per-moment coaching written for it. Both gates or neither.');
  assert.ok(/shouldHarvest\(effectiveOutcome, callRow && callRow\.not_a_sales_call\)/.test(w),
    'the harvest gate must keep taking the flag');
});

test('⚠⚠ marking a call RETRACTS what it already produced — a forward gate cannot un-say', () => {
  /* ⚠ MOVED 2026-09-03 (H712): the retraction call site lives in lib/not-sales-mark.js (the ONE mark). */
  const me = code('lib/not-sales-mark.js');
  assert.ok(/retractExcludedCall\(admin, a\.callId\)/.test(me),
    'a call is almost always marked AFTER it was analysed, so by then its moments are in '
    + 'the knowledge base and its coaching is written. Measured before this shipped: 4 KB '
    + 'moments from 2 marked calls, one an internal check-up.');
  assert.ok(/await retractExcludedCall/.test(me),
    'AWAITED, unlike the re-analysis: the caller must not be told the call is excluded '
    + 'while its moments are still teaching the knowledge base');

  const r = code('lib/excluded-call-retraction.js');
  assert.ok(/from\('knowledge_base'\)[\s\S]{0,120}source_fathom_call_id/.test(r),
    'harvested KB moments must be deleted');
  assert.ok(/coaching: null/.test(r), 'per-moment coaching must be cleared');
});

test('⚠ a failed retraction must NEVER roll back the mark', () => {
  /* ⚠ MOVED 2026-09-03 (H712): the retraction call site lives in lib/not-sales-mark.js (the ONE mark). */
  const me = code('lib/not-sales-mark.js');
  // ⚠ anchor on the CALL SITE, not the import — indexOf finds the first
  // occurrence, which is the require at the top of the file.
  const i = me.indexOf('retractExcludedCall(admin, a.callId)');
  assert.ok(i !== -1, 'call site not found');
  const slice = me.slice(i, i + 900);
  assert.ok(slice.length > 500, 'slice must cover the block: ' + slice.length);
  assert.ok(/catch \(e\) \{[\s\S]{0,260}retraction failed/.test(slice),
    'the mark is the user\'s decision; a failed cleanup is logged, never a rollback');
});

test('⚠⚠ the review page shows NO coaching for an excluded call — but still OPENS', () => {
  const page = code('web/dashboard.html');
  assert.ok(/var excluded = !!\(review && review\.not_a_sales_call === true\)/.test(page),
    'THE FLAG IS FLAT ON THE REVIEW OBJECT. A first version read review.call.not_a_sales_call, '
    + 'which is always undefined — the suppression would have been inert while looking correct.');
  assert.ok(/No coaching for this call/.test(page), 'the suppressed state must say why');
  assert.ok(/count it again/.test(page),
    'IT STILL OPENS BY DESIGN: the standing ruling is that a marked call must remain openable '
    + 'or it can never be UN-marked from here. Hiding it would be data loss wearing a filter.');
});

test('⚠ the server both SELECTS and EMITS the flag — either alone is the same bug', () => {
  const f = code('routes/fathom.js');
  assert.ok(/not_a_sales_call, exclusion_reason'\)/.test(f), 'selected on the review query');
  assert.ok(/not_a_sales_call: call\.not_a_sales_call === true/.test(f), 'and emitted to the client');
});

test('⚠⚠ a MARKED call is not clickable from the list — but still renders', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/isNS \? '' : ' onclick="openCallReview/.test(page),
    'THE EARLIER RULING IS CLOSED OFF: a marked call had to stay openable so it could be '
    + 'un-marked. It no longer does — the COUNT THIS CALL button is on the row itself, so '
    + 'the un-mark is reachable without opening the call.');
  assert.ok(/is-not-sales not-clickable/.test(page),
    'and it must stop LOOKING clickable — a row that invites a click and does nothing reads '
    + 'as broken, which is worse than one that never invited it');
  assert.ok(/library-card' \+ \(isNS \? ' is-not-sales/.test(page),
    'the row STILL RENDERS with its badge — excluded must stay visible, only the way in closes');
});
