/**
 * TEAM VIEW ORDER — and the RULE behind it, not just the sequence.
 *
 * Justin, 2026-08-19: Manager Daily Digest moves from the BOTTOM of the team
 * view (below the three score lists) to the TOP, under the gauges.
 *
 * ⚠⚠ THE PROPERTY WORTH PINNING IS NOT "digest is third". It is:
 *   EVERYTHING ABOVE THE DATE PICKER IS A FIXED WINDOW.
 *   EVERYTHING BELOW IT ANSWERS TO THE PICKER.
 * The gauges are a fixed 7 days; the digest is a fixed ET-day (verified:
 * GET /team/digest ignores from/to and keys on `date`, defaulting to
 * etYesterday). Rendering either BELOW the picker would put a panel the picker
 * cannot change underneath a control that appears to drive it — and the digest
 * carries its own date chips, so two adjacent date controls would read as one.
 *
 * A test that pinned only the index would pass if someone moved the picker
 * above the gauges, which is the same defect wearing different coordinates.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// ⚠ strip comments first — this codebase archives removed code in place, so a
// raw scan reports the OLD position as still live. Line comments before block
// comments: a `/*` inside a `//` line is a false opener.
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function renderBody() {
  const at = LIVE.indexOf('content.innerHTML =\n      teamHeaderHtml()');
  assert.ok(at !== -1, 'stale anchor — the team render assignment moved');
  const end = LIVE.indexOf('Chart.js draws only after', at);
  const body = LIVE.slice(at, end === -1 ? at + 4000 : end);
  assert.ok(body.length > 400 && body.length < 6000, 'slice suspicious: ' + body.length);
  return body;
}

/* ⚠⚠ ARCHIVED AND REPLACED BY A STRONGER PROPERTY (the split, 2026-08-31).

   These pinned a WITHIN-PAGE ordering: gauges -> digest -> picker -> graphs, so
   a fixed ET-day panel could never render beneath a control that appears to
   drive it. That ordering is gone, and NOT because it was abandoned — the
   digest now has a page of its OWN WITH NO DATE PICKER ON IT AT ALL, which is
   the same rule enforced by STRUCTURE instead of by sequence.

   Original assertions, kept so nobody reinstates the weaker form:
     gauges < digest  .  digest < picker  .  picker < graphs
     digest < each of Team Overview / Closing Score / Objection Handling Score
*/
test('the digest renders EXACTLY ONCE — it was moved, not copied', () => {
  const n = (LIVE.match(/<h2>Daily Digest<\/h2>/g) || []).length;
  assert.strictEqual(n, 1, 'expected one digest section in the render path, got ' + n);
});

test('⚠⚠ the digest page has NO date picker — the rule, enforced structurally', () => {
  const at = LIVE.indexOf('function renderTeamDigest');
  assert.ok(at !== -1, 'stale anchor — the digest page is gone');
  const body = LIVE.slice(at, LIVE.indexOf('allPanelsHiddenNoteHtml();', at));
  assert.ok(body.length > 300 && body.length < 2500, 'slice must cover it: ' + body.length);
  assert.ok(/teamDigestHtml\(\)/.test(body), 'the digest is what this page is for');
  assert.ok(!/teamControlsHtml\(\)/.test(body),
    'a fixed ET-day panel must never sit under a control that appears to drive it');
  assert.ok(!/repSeriesSectionHtml\(\)/.test(body),
    'the picker-driven graphs belong to Performance');
});

test('⚠ the picker-driven panels live WITH the picker, on Performance', () => {
  const at = LIVE.indexOf('function renderTeamPerformance');
  assert.ok(at !== -1, 'stale anchor — the performance page is gone');
  const fn = LIVE.slice(at, LIVE.indexOf('allPanelsHiddenNoteHtml();', at));
  assert.ok(fn.length > 300 && fn.length < 4000, 'slice must cover it: ' + fn.length);

  /* ⚠⚠ NARROWED TO THE MAIN BODY ON PURPOSE, AND THE NARROWING IS ASSERTED.
     This function has an EARLY-RETURN branch for the glance-tile drilldown that
     renders its own header + controls + detail. A whole-function search finds
     THAT teamControlsHtml() first and reports the gauges as sitting under the
     picker — the scope-wider-than-the-claim failure. Pin the branch's existence
     so narrowing past it can never hide its removal. */
  assert.ok(/teamDetailHtml\(\)/.test(fn), 'stale anchor — the glance drilldown branch is gone');
  const bodyAt = fn.lastIndexOf('content.innerHTML =');
  assert.ok(bodyAt > fn.indexOf('teamDetailHtml()'), 'the main body must follow the drill branch');
  const body = fn.slice(bodyAt);

  const gauges = body.indexOf('avgPanelHtml()');
  const picker = body.indexOf('teamControlsHtml()');
  const graphs = body.indexOf('repSeriesSectionHtml()');
  [['avgPanelHtml', gauges], ['teamControlsHtml', picker], ['repSeriesSectionHtml', graphs]]
    .forEach(([n, ix]) => assert.ok(ix !== -1, 'stale anchor — ' + n + ' is not on Performance'));
  // ⚠ the gauges are STILL a fixed 7 days, so the original rule still binds HERE
  assert.ok(gauges < picker, 'the fixed-window dials must not sit under the picker');
  assert.ok(picker < graphs, 'the graphs DO answer to the picker, so they follow it');
});

/**
 * ⚠ THE BACKEND HALF OF THE CLAIM. The placement argument rests on the digest
 * being picker-independent; if that ever stops being true the layout reasoning
 * silently becomes wrong. Assert it where it is decided.
 */
test('⚠⚠ GET /team/digest really is picker-independent — the premise of the layout', () => {
  const team = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  const at = team.indexOf("router.get('/digest'");
  assert.ok(at !== -1, 'stale anchor — the digest route moved');
  const route = team.slice(at, at + 1200);
  assert.ok(/req\.query\.date/.test(route), 'the digest keys on an explicit date');
  assert.ok(/etYesterday/.test(route), 'and defaults to ET-yesterday');
  assert.ok(!/req\.query\.from|req\.query\.to/.test(route),
    'the digest must NOT read from/to — if it ever does, it answers to the '
    + 'picker and belongs BELOW it (see team-view order)');
});

/**
 * ⚠⚠ THE FOUR-MODAL TRAP. `.kb-modal-dialog` is shared by bucketEvidenceModal,
 * kbModal, memberAddModal and summaryModal. Widening the CLASS to give the
 * objection drilldown full width would stretch the KB upload form and the
 * add-member form too — where a form is WORSE wide than at 520px — and the
 * damage would be invisible until someone opened an unrelated form.
 */
test('⚠⚠ the drilldown width is SCOPED — the shared modal class is untouched', () => {
  /* ⚠ anchor on the UNSCOPED rule: '#bucketEvidenceModal .kb-modal-dialog {'
     CONTAINS '.kb-modal-dialog {', so a naive indexOf finds the scoped rule I
     just added and measures that instead. The check would then assert the
     shared class is 520px by reading a completely different rule. */
  const sharedAt = LIVE.search(/\n\s*\.kb-modal-dialog \{/);
  assert.ok(sharedAt !== -1, 'stale anchor — the shared dialog rule');
  const shared = LIVE.slice(sharedAt, LIVE.indexOf('}', sharedAt));
  assert.ok(shared.length > 60 && shared.length < 600, 'slice suspicious: ' + shared.length);
  assert.ok(/max-width:\s*520px/.test(shared),
    'the SHARED dialog must stay 520px — four modals use it, and two are forms');

  const scoped = LIVE.match(/#bucketEvidenceModal \.kb-modal-dialog \{[^}]*\}/);
  assert.ok(scoped, 'the drilldown needs its own scoped width rule');
  assert.ok(/max-width:\s*min\(/.test(scoped[0]), 'scoped rule must set a wide max-width');

  // and it really is only that one modal being widened
  const others = ['kbModal', 'memberAddModal', 'summaryModal'];
  others.forEach((id) => {
    assert.ok(!new RegExp('#' + id + '[^{]*\\.kb-modal-dialog').test(LIVE),
      id + ' must not have been widened');
  });
});

test('⚠ the 31-day boundary reads as DERIVED, not chosen', () => {
  const at = LIVE.indexOf('var DAILY_BUCKET_MAX_DAYS');
  assert.ok(at !== -1, 'stale anchor');
  // the comment lives above the constant; take the block before it
  const ctx = PAGE.slice(Math.max(0, PAGE.indexOf('var DAILY_BUCKET_MAX_DAYS') - 900),
                        PAGE.indexOf('var DAILY_BUCKET_MAX_DAYS') + 60);
  assert.ok(/calendar month/.test(ctx),
    'the number must be justified by calendar months, or a future reader reads '
    + '31 as an arbitrary pick and "tidies" it to 30');
  assert.strictEqual(Number((ctx.match(/DAILY_BUCKET_MAX_DAYS = (\d+)/) || [])[1]), 31);
});
