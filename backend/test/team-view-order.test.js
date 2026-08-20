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

test('the digest renders EXACTLY ONCE — it was moved, not copied', () => {
  const n = (LIVE.match(/<h2>Manager Daily Digest<\/h2>/g) || []).length;
  assert.strictEqual(n, 1, 'expected one digest section in the render path, got ' + n);
});

test('⚠⚠ the digest sits ABOVE the date picker, with the gauges — a fixed window', () => {
  const body = renderBody();
  const gauges = body.indexOf('avgPanelHtml()');
  const digest = body.indexOf('Manager Daily Digest');
  const picker = body.indexOf('teamControlsHtml()');
  const graphs = body.indexOf('repSeriesSectionHtml()');
  [['avgPanelHtml', gauges], ['digest', digest], ['teamControlsHtml', picker],
   ['repSeriesSectionHtml', graphs]].forEach(([n, i]) => {
    assert.ok(i !== -1, 'stale anchor — ' + n + ' is not in the render body');
  });
  assert.ok(gauges < digest, 'gauges come first');
  assert.ok(digest < picker,
    'THE RULE: the digest is a fixed ET-day panel and the picker cannot change '
    + 'it, so it must not render beneath the picker');
  assert.ok(picker < graphs, 'the graphs DO answer to the picker, so they follow it');
});

test('⚠ the digest is no longer last — it precedes the score lists', () => {
  const body = renderBody();
  const digest = body.indexOf('Manager Daily Digest');
  // ⚠ renamed 2026-08-20: the ranked lists gained the word "Score".
  ['Team Overview', 'Closing Score', 'Objection Handling Score'].forEach((h) => {
    const at = body.indexOf('<h2>' + h + '</h2>');
    assert.ok(at !== -1, 'stale anchor — the "' + h + '" score list is gone');
    assert.ok(digest < at, 'the digest must now come before the ' + h + ' list');
  });
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
