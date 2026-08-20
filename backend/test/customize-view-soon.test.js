/**
 * "CUSTOMIZE VIEW" — the coming-soon tag on the team controls row (2026-08-20).
 *
 * ⚠⚠ INERT IS A TAG CHOICE, NOT A STYLE CHOICE. The nav's coming-soon items are
 * <span>, and that IS the implementation: a span has no href, so it cannot
 * navigate, is not in the tab order, gets no link semantics from a screen
 * reader, and has no :hover affordance unless one is written. Styling an <a> to
 * LOOK disabled leaves every one of those behaviours intact — it would still
 * focus, still announce as a link, still fire on Enter. The same applies to a
 * <button>, which is focusable and clickable by default.
 *
 * ⚠ SO THESE TESTS ASSERT THE TAG AND THE ABSENCE OF INTERACTIVE ATTRIBUTES,
 * not the appearance. Appearance can drift without the promise breaking;
 * interactivity cannot.
 *
 * ⚠ PLACEMENT IS A PROMISE ABOUT A LOCATION. It sits in teamControlsHtml beside
 * Manage Members and Generate Summary, because that is where the real control
 * will live. A tag parked wherever it fitted would move when the feature lands,
 * which is the opposite of what a coming-soon marker is for.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ Strip LINE comments before BLOCK comments: a `/*` inside a `//` line is a
   false opener that can swallow hundreds of lines and make present code look
   absent. This codebase archives removed code in place, so an unstripped match
   reports archived markup as live. */
const LIVE = RAW.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Slice a named function with fromIndex + a length assertion. */
function fnBody(name, min, max) {
  const at = LIVE.indexOf('function ' + name);
  assert.ok(at > -1, name + ' must exist');
  // ⚠ fromIndex — an unbounded indexOf finds the FIRST '\n  }' in the file,
  // which is far earlier, and slice(bigger, smaller) silently returns ''.
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(fn.length > min && fn.length < max,
    'slice must cover ' + name + ', got ' + fn.length);
  return fn;
}

/* ⚠ THE MARKUP LIVES IN A HELPER THE ROW CALLS, so placement and inertness are
   asserted in DIFFERENT places. Checking only the helper would prove a correct
   tag exists that nothing renders — the dead-call-site failure this codebase
   has already paid for once. */
const controlsFn = () => fnBody('teamControlsHtml', 300, 4000);
const soonFn     = () => fnBody('customizeViewSoonHtml', 60, 800);

test('⚠⚠ PLACEMENT — the team controls row actually CALLS it', () => {
  const fn = controlsFn();
  assert.ok(/customizeViewSoonHtml\(\)/.test(fn),
    'the tag must be rendered BY the team controls row, beside Manage Members ' +
    'and Generate Summary — a helper nothing calls is a promise nobody sees');
  // ⚠ and it must come AFTER the existing buttons, i.e. at the end of the row
  assert.ok(fn.indexOf('summaryBtnHtml()') < fn.indexOf('customizeViewSoonHtml()'),
    'it belongs at the end of the row, after Generate Summary');
});

test('⚠⚠ the helper produces the label', () => {
  assert.ok(soonFn().indexOf('Customize View') > -1, 'label present');
});

test('⚠⚠ it is a <span>, never an <a> or a <button> — that IS the inertness', () => {
  const fn = soonFn();
  const i = fn.indexOf('Customize View');
  assert.ok(i > -1, 'must be present');
  // the opening tag immediately before the label
  const before = fn.slice(Math.max(0, i - 220), i);
  const lastOpen = before.lastIndexOf('<');
  assert.ok(lastOpen > -1, 'the label must sit inside an element');
  const tag = before.slice(lastOpen);
  assert.ok(/^<span/.test(tag),
    'must be a <span>; an <a> or <button> stays focusable, keyboard-activatable ' +
    'and link/button-announced no matter how it is styled. Got: ' + tag.slice(0, 60));
  assert.ok(!/<a\b/.test(tag) && !/<button\b/.test(tag), 'no anchor or button');
});

test('⚠ it carries NO interactive attributes — no href, no onclick, no tabindex', () => {
  const fn = soonFn();
  const i = fn.indexOf('Customize View');
  const region = fn.slice(Math.max(0, i - 260), i + 120);
  assert.ok(!/href=/.test(region), 'no href — it must not navigate');
  assert.ok(!/onclick=/.test(region), 'no onclick — it must not act');
  assert.ok(!/tabindex=/.test(region), 'no tabindex — it must stay out of tab order');
  assert.ok(/aria-disabled="true"/.test(region),
    'aria-disabled announces the promise to a screen reader, matching the nav tabs');
});

test('⚠ it reuses the EXISTING soon classes — one pattern, not a second one', () => {
  const fn = soonFn();
  const i = fn.indexOf('Customize View');
  const region = fn.slice(Math.max(0, i - 260), i + 160);
  assert.ok(/nav-soon\b/.test(region), 'reuses .nav-soon');
  assert.ok(/nav-soon-tag/.test(region), 'reuses the .nav-soon-tag pill');
  assert.ok(/>soon</.test(region), 'the tag reads "soon", same word as the nav');
});

test('⚠⚠ NON-VACUITY — every assertion above fails if the span becomes an anchor', () => {
  // An absence assertion is the easiest test here to write and have mean
  // nothing, so prove the matcher fires against the defect it names.
  const broken = soonFn().replace(
    /<span class="nav-link nav-soon"([^>]*)>Customize View/,
    '<a href="#" class="nav-link nav-soon"$1>Customize View');
  assert.notStrictEqual(broken, soonFn(), 'the fixture must actually change');
  const i = broken.indexOf('Customize View');
  const before = broken.slice(Math.max(0, i - 220), i);
  const tag = before.slice(before.lastIndexOf('<'));
  assert.ok(!/^<span/.test(tag), 'the tag check must reject an anchor');
  assert.ok(/href=/.test(broken.slice(Math.max(0, i - 260), i + 120)),
    'the href check must detect a reintroduced href');
});
