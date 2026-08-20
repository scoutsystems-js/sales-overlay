/**
 * THE REP FILTER BECOMES A CUSTOM MULTI-SELECT (Justin, 2026-08-20).
 *
 * ⚠⚠ THE CAUSE, ESTABLISHED RATHER THAN ASSUMED: it was a native <select>.
 * A native select's popup is rendered by the OS/UA, not by the page. Choosing an
 * option fires `change` and the popup closes, and there is no API anywhere in
 * HTML or CSS to keep it open — `preventDefault()` on `change` does not reopen
 * it, because the close already happened and `change` is not cancelable. The
 * previous implementation even leaned into that, resetting `this.selectedIndex
 * = 0` after every pick so the label came back. So hiding three reps cost three
 * open-pick-close cycles. THAT is Justin's complaint, and it is a property of
 * the tag, not of the styling — which is why this had to become a div.
 *
 * ⚠ WHAT A NATIVE SELECT GAVE FOR FREE AND A DIV DOES NOT: focus, tab order,
 * keyboard activation, Escape-to-close, and a screen-reader role. Every one of
 * those is re-implemented here and asserted below, because losing them is the
 * usual price of this swap and it is invisible to a mouse user.
 *
 * ⚠ THE SWATCH COSTS NOTHING: repFilterRoster() already collected
 * `color: ds.borderColor` and threw it away. With the legend capped at 10, an
 * 11th rep's colour appears NOWHERE else — so the dropdown becomes the only
 * place it can be seen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ line comments BEFORE block comments — a `/*` inside a `//` is a false
   opener that can swallow hundreds of lines and make present code look absent. */
const LIVE = RAW.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fnBody(name, min, max) {
  const at = LIVE.indexOf('function ' + name);
  assert.ok(at > -1, name + ' must exist');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(fn.length > min && fn.length < max,
    'slice must cover ' + name + ', got ' + fn.length);
  return fn;
}

test('⚠⚠ IT IS NO LONGER A NATIVE <select> — that tag is the cause, not the styling', () => {
  const fn = fnBody('repFilterHtml', 300, 8000);
  assert.ok(!/<select/.test(fn),
    'a native select closes its popup on every pick and no API can stop it');
  assert.ok(!/<option/.test(fn), 'and no options');
  assert.ok(/<button/.test(fn), 'a button opens it');
  assert.ok(/role="listbox"/.test(fn), 'the list announces itself as a listbox');
  assert.ok(/role="option"/.test(fn), 'and its rows as options');
});

test('⚠⚠ TOGGLING DOES NOT CLOSE — the whole point of the change', () => {
  const t = fnBody('repFilterToggle', 60, 2000);
  assert.ok(!/repFilterClose\(/.test(t),
    'toggling a rep must leave the panel open so three can be picked in a row');
  // and the row handler must stop the click reaching the outside-click closer
  const fn = fnBody('repFilterHtml', 300, 8000);
  assert.ok(/stopPropagation\(\)/.test(fn),
    'a row click must not bubble to the document handler that closes the panel');
});

test('⚠ THE SWATCH IS RENDERED — the roster already carried the colour', () => {
  const roster = fnBody('repFilterRoster', 100, 2000);
  assert.ok(/color:\s*ds\.borderColor/.test(roster), 'the roster still collects it');
  const fn = fnBody('repFilterHtml', 300, 8000);
  assert.ok(/r\.color/.test(fn),
    'and repFilterHtml must now USE it — with the legend capped at 10, an 11th ' +
    'rep has nowhere else to show their colour');
});

test('⚠ EVERYTHING THAT WORKED TODAY STILL WORKS', () => {
  const fn = fnBody('repFilterHtml', 300, 8000);
  assert.ok(/reps shown/.test(fn), '"N of M reps shown"');
  assert.ok(/'All '/.test(fn), '"All N reps"');
  assert.ok(/Show all/.test(fn), 'Show all');
  assert.ok(/Remove all/.test(fn), 'Remove all');
  assert.ok(/rep-filter-on/.test(fn), 'the glanceable filtered state survives');
  // persistence is keyed per team and must not have moved
  const key = fnBody('repFilterStoreKey', 40, 600);
  assert.ok(/state\.teamSelected/.test(key), 'still keyed per team');
});

test('⚠⚠ KEYBOARD AND FOCUS — a native select gave these free, a div does not', () => {
  const fn = fnBody('repFilterHtml', 300, 8000);
  assert.ok(/aria-expanded=/.test(fn), 'the button reports open state');
  assert.ok(/aria-haspopup="listbox"/.test(fn), 'and that it opens a listbox');
  assert.ok(/aria-selected=/.test(fn), 'each row reports its own state');
  assert.ok(/tabindex="0"/.test(fn), 'rows are reachable by Tab');

  const key = fnBody('repFilterKeydown', 60, 2000);
  assert.ok(/Escape/.test(key), 'Escape closes');
  assert.ok(/Enter/.test(key) && /' '/.test(key), 'Enter and Space toggle');

  const close = fnBody('repFilterClose', 40, 1200);
  assert.ok(/focus\(\)/.test(close),
    'focus returns to the button on close, or the user is stranded');
});

test('⚠ OUTSIDE CLICK CLOSES IT, and the listener is not stacked', () => {
  const open = fnBody('repFilterOpen', 60, 2000);
  assert.ok(/addEventListener/.test(open), 'an outside-click listener is armed');
  const close = fnBody('repFilterClose', 40, 1200);
  assert.ok(/removeEventListener/.test(close),
    'and removed on close — otherwise every open stacks another listener');
});

test('⚠⚠ NON-VACUITY — the select assertions fail if the tag comes back', () => {
  const broken = fnBody('repFilterHtml', 300, 8000) + "\n  var x = '<select class=\"user-select\">';";
  assert.ok(/<select/.test(broken), 'the matcher must detect a reintroduced select');
});
