/**
 * (d) NO GREY TEXT — the durable version.
 *
 * ⚠ RAISED THREE TIMES. The first two passes repainted individual sites and it
 * came back, because four grey TOKENS stayed alive — including `--muted`, an
 * exact duplicate of `--text-muted`. A token that still exists will be used.
 *
 * THE RULE: grey is retired as a COLOUR. Hierarchy is carried by SIZE, WEIGHT
 * and LETTER-SPACING instead — the labels were already 11px, uppercase and
 * tracked, so the colour was doing work the typography already did. That is what
 * makes this durable rather than a third repaint.
 *
 * ⚠ OPACITY IS ALLOWED, DELIBERATELY. Justin's ruling 2026-08-16: the no-grey
 * rule targets unreadable low-contrast BODY TEXT, not depth cues that make a
 * dense control legible. The calendar's 45% out-of-month days are an APPROVED
 * exception and must survive this guard.
 *
 * ⚠ COMMENTS ARE STRIPPED FIRST so a rule can be EXPLAINED without failing —
 * the lesson from the selling-context and rep-series guards, where prose that
 * named a banned identifier broke the check.
 */
const test = require('node:test');
const { stripComments } = require('./helpers/strip-comments');   // ⚠ ONE stripper (H684) — this file's private copy is gone
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// /* … */ and <!-- … --> removed: archived code may legitimately mention greys.
const LIVE = stripComments(RAW).replace(/<!--[\s\S]*?-->/g, '');   // JS/CSS comments through the shared stripper; HTML comments are markup, stripped here

const DEAD_TOKENS = ['--text-muted', '--text-dim', '--muted', '--text-soft'];

test('the grey TOKENS are gone — not merely unused', () => {
  // Unused-but-defined is how this came back twice: the next person reaches for
  // whatever the theme offers.
  DEAD_TOKENS.forEach((t) => {
    assert.strictEqual(new RegExp('\\' + t + '\\s*:').test(LIVE), false,
      t + ' must not be DEFINED — a token that exists will get used');
    assert.strictEqual(new RegExp('var\\(' + t + '\\)').test(LIVE), false,
      t + ' must not be REFERENCED');
  });
});

test('no rule sets a text colour to grey', () => {
  // Anything from #5a5a5a to #cccccc, in hex or rgb().
  const hexHits = LIVE.match(/color:\s*#(?:5[a-f0-9]|6[0-9a-f]|7[0-9a-f]|8[0-9a-f]|9[0-9a-f]|a[0-9a-f]|b[0-9a-f]|c[0-9a-c])[0-9a-f]{4}\b/gi) || [];
  const greyHex = hexHits.filter((h) => {
    const m = h.match(/#([0-9a-f]{6})/i)[1].toLowerCase();
    return m[0] === m[2] && m[2] === m[4] && m[1] === m[3] && m[3] === m[5];   // r==g==b
  });
  assert.deepStrictEqual(greyHex, [], 'grey text colours found: ' + greyHex.join(', '));

  const rgbGrey = (LIVE.match(/color:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi) || [])
    .filter((s) => { const n = s.match(/\d+/g).map(Number); return n[0] === n[1] && n[1] === n[2] && n[0] > 80 && n[0] < 210; });
  assert.deepStrictEqual(rgbGrey, [], 'grey rgb() text colours found: ' + rgbGrey.join(', '));
});

test('OPACITY DIMMING SURVIVES — the approved calendar exception', () => {
  // If this ever fails, the guard has been tightened past its ruling.
  assert.ok(/\.dp-out\s*\{[^}]*opacity:\s*\.45/.test(LIVE),
    "the calendar's 45% out-of-month dimming is an approved exception and must remain");
  assert.ok(/opacity:/.test(LIVE), 'opacity-based depth cues are allowed generally');
});

test('HIERARCHY IS CARRIED BY TYPOGRAPHY, since it is no longer carried by colour', () => {
  // The whole justification for the swap. If a label loses its size/weight/
  // tracking it becomes indistinguishable from the value beside it.
  const label = LIVE.match(/\.glance-label\s*\{[^}]*\}/);
  assert.ok(label, '.glance-label rule missing');
  assert.ok(/font-size:\s*11px/.test(label[0]), 'smaller than its value');
  assert.ok(/text-transform:\s*uppercase/.test(label[0]), 'cased differently');
  assert.ok(/letter-spacing/.test(label[0]), 'tracked');
  assert.ok(/font-weight:\s*600/.test(label[0]), 'and weighted, so the distinction is explicit');
});

test('GUARD IS NON-VACUOUS: it would catch a reintroduced grey', () => {
  // A guard that cannot fail is decoration. Prove the matcher fires.
  const sample = '.x { color: #8b8b8b; } .y { color: rgb(139, 139, 139); }';
  const hex = (sample.match(/color:\s*#[0-9a-f]{6}/gi) || []).filter((h) => {
    const m = h.match(/#([0-9a-f]{6})/i)[1].toLowerCase();
    return m[0] === m[2] && m[2] === m[4] && m[1] === m[3] && m[3] === m[5];
  });
  assert.strictEqual(hex.length, 1, 'the hex matcher must fire on #8b8b8b');
  const rgb = (sample.match(/color:\s*rgb\([^)]*\)/gi) || [])
    .filter((s) => { const n = s.match(/\d+/g).map(Number); return n[0] === n[1] && n[1] === n[2] && n[0] > 80 && n[0] < 210; });
  assert.strictEqual(rgb.length, 1, 'the rgb matcher must fire on rgb(139,139,139)');
});

test('⚠ CONVERTED (H684): this file now reads the dashboard through the shared stripper — the 42 lines behind `/admin/*` are visible to it', () => {
  const page = stripComments(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  assert.ok(page.indexOf("var target = params.get('user');") !== -1, 'the ?user= pivot restore must be visible');
  assert.ok(/state\.me\.role === 'manager' \|\| state\.me\.role === 'admin' \|\| state\.me\.role === 'owner'/.test(page), 'the role check must be visible');
});
