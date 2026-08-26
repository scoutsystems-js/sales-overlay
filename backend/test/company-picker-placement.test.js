// The company picker moved to the top-right of the company name card
// (Justin, 2026-08-26). It was previously rendered TWICE — in the team controls
// row and again in the objections drilldown's own strip.
//
// ⚠ THE DRILLDOWN RENDERS teamHeaderHtml() TOO, so leaving its own copy in place
// would have put two pickers on that page. This guards the count, not the CSS.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// ⚠ LINE comments first, then block comments — a block opener inside a line
// comment is a false opener that swallows real code.
function stripComments(src) {
  const noLine = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}
const LIVE = stripComments(HTML);

function slice(from, to, floor) {
  const a = LIVE.indexOf(from);
  assert.ok(a !== -1, 'stale anchor: ' + from);
  const b = LIVE.indexOf(to, a);
  assert.ok(b !== -1, 'stale end anchor: ' + to);
  const out = LIVE.slice(a, b);
  assert.ok(out.length >= floor, 'slice too short (' + out.length + ') — a backwards slice tests nothing');
  return out;
}

test('there is exactly ONE picker call site, and it is the company card', () => {
  const calls = (LIVE.match(/teamSelectHtml\(\)/g) || []).length;
  // one definition + one call
  assert.strictEqual(calls, 2, 'expected the definition plus a single call site, found ' + calls);
  const header = slice('function teamHeaderHtml()', 'function teamControlsHtml()', 300);
  assert.ok(/page-header-side">' \+ teamSelectHtml\(\)/.test(header),
    'the picker is not rendered inside the company card');
});

test('the controls row and the drilldown no longer render their own', () => {
  const controls = slice('function teamControlsHtml()', 'function objDrillControlsHtml', 200);
  assert.ok(!/teamSelectHtml/.test(controls), 'the controls row still renders a picker');
  // ⚠ END ANCHOR MUST BE DISTINCTIVE — 'function ' matches the START anchor
  // itself, giving an empty slice that passes every negative assertion vacuously.
  const drill = slice('function objDrillControlsHtml()', 'function customizeViewSoonHtml', 150);
  assert.ok(!/teamSelectHtml/.test(drill),
    'the drilldown still renders its own — with the header it would show TWO');
});

test('the date picker survived the move', () => {
  // ⚠ Splitting this header once before silently removed the date picker from
  // three pages. The picker leaving must not take anything else with it.
  const controls = slice('function teamControlsHtml()', 'function objDrillControlsHtml', 200);
  assert.ok(/datePickerHtml\('team'\)/.test(controls), 'the controls row lost its date picker');
  const drill = slice('function objDrillControlsHtml()', 'function customizeViewSoonHtml', 150);
  assert.ok(/datePickerHtml\('team'\)/.test(drill), 'the drilldown lost its date picker');
  assert.ok(/repFilterHost/.test(drill), 'the drilldown lost its rep filter');
});

test('the top-right placement is SCOPED to the company card', () => {
  // .page-header is rendered by every view; an unscoped side-slot rule would
  // re-lay-out a dozen unrelated pages.
  assert.ok(/\.page-header--company \.page-header-side \{\s*position: absolute/.test(LIVE),
    'the placement rule is missing or unscoped');
  assert.ok(!/^\s*\.page-header \.page-header-side \{\s*position: absolute/m.test(LIVE),
    'the placement leaked onto the global .page-header');
});

test('the admin-only gate is unchanged by the move', () => {
  const fn = slice('function teamSelectHtml()', 'function teamControlsHtml()', 200);
  assert.ok(/ctx2\.is_owner/.test(fn), 'the owner check is gone from the picker');
  assert.ok(/return '';/.test(fn), 'the picker no longer returns empty for a non-owner');
});
