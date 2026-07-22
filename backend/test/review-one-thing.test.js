// Item D (2026-07-22): one_thing rendered twice on follow_up-class reviews.
//
// The verdict section ("Why this call…") pairs one_thing beneath the cause for
// BOTH loss ("The fix") and pending/follow_up ("The move") — added in grader v5
// (d87c97c) — but the highlights-footer suppression still keyed on
// whyState.kind === 'loss' only, so follow_up reviews showed the identical
// one_thing text twice. Guard: both call sites must share ONE predicate,
// verdictKindShowsOneThing, so they can never drift apart again.
//
// dashboard.html is an inline browser script (no module exports), so this test
// extracts the pure predicate from the HTML source and checks the call sites
// textually. Brittle-by-design tradeoff, documented in CLAUDE.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function extractPredicate() {
  const m = html.match(/function verdictKindShowsOneThing\s*\([^)]*\)\s*\{[^}]*\}/);
  assert.ok(m, 'dashboard.html must define function verdictKindShowsOneThing');
  return new Function('return ' + m[0])();
}

test('verdictKindShowsOneThing truth table: loss/pending pair one_thing in the verdict, win and no-verdict do not', () => {
  const fn = extractPredicate();
  assert.strictEqual(fn('loss'), true, 'loss-class verdict pairs one_thing ("The fix")');
  assert.strictEqual(fn('pending'), true, 'follow_up-class verdict pairs one_thing ("The move")');
  assert.strictEqual(fn('win'), false, 'win-class verdict shows the cause only — one_thing stays in the footer');
  assert.strictEqual(fn(null), false);
  assert.strictEqual(fn(undefined), false);
});

test('the verdict section and the footer suppression both use the shared predicate', () => {
  assert.ok(
    /if \(verdictKindShowsOneThing\(st\.kind\)\)/.test(html),
    'renderWhyOutcomeSectionHtml must gate the one_thing pairing on the predicate'
  );
  assert.ok(
    /if \(!\(whyState && verdictKindShowsOneThing\(whyState\.kind\)\)\)/.test(html),
    'the highlights footer must suppress one_thing exactly when the verdict already shows it'
  );
});

test('the drift-prone literal loss-only footer guard is gone', () => {
  assert.ok(
    !/whyState && whyState\.kind === 'loss'/.test(html),
    "footer must no longer hardcode kind === 'loss' — that is the guard that drifted when follow_up joined the verdict pairing"
  );
});
