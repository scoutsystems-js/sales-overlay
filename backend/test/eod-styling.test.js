/**
 * (u1)/(u3) — the EOD page's display styling.
 *
 * ⚠ THE PAGE'S JOB IS TYPE-THEN-COPY. Josh edits the fields and pastes the
 * result into Slack, so the editable fields and the copy action are the point.
 * Every assertion here exists to stop a future restyle making either harder —
 * "prettier" is not a defence for a regression in those two things.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('⚠ the outcome chip uses SEMANTIC tokens only — no new hues', () => {
  ['good', 'mid', 'bad'].forEach((tone) => {
    assert.ok(new RegExp('\\.eod-chip-' + tone + '\\s*\\{[^}]*color: var\\(--' + tone + '\\)').test(LIVE),
      '.eod-chip-' + tone + ' must take its text colour from --' + tone);
    assert.ok(new RegExp('\\.eod-chip-' + tone + '\\s*\\{[^}]*rgba\\(var\\(--' + tone + '-rgb\\)').test(LIVE),
      'the tint must be the band\'s own channels, not a hand-picked shade');
  });
  // The categorical rep ramp must never appear here.
  const css = LIVE.slice(LIVE.indexOf('.eod-chip {'), LIVE.indexOf('.eod-chip-none'));
  ['#06b6d4', '#f97316', '#a855f7', '#3b82f6', '#84cc16', '#ec4899', '#14b8a6']
    .forEach((c) => assert.strictEqual(css.indexOf(c), -1, 'categorical colour in the EOD chip: ' + c));
});

test('⚠⚠ ALL THREE TONES SHARE ONE ALPHA — they cannot drift apart', () => {
  const alphas = ['good', 'mid', 'bad'].map((t) => {
    const m = LIVE.match(new RegExp('\\.eod-chip-' + t + '\\s*\\{[^}]*background: rgba\\(var\\(--' + t + '-rgb\\),\\s*([\\d.]+)\\)'));
    assert.ok(m, 'no background alpha found for ' + t);
    return m[1];
  });
  assert.strictEqual(new Set(alphas).size, 1,
    'the three chips use different alphas ' + JSON.stringify(alphas) + ' — that is the hand-picked-shade drift');
});

test('an UNRECOGNISED outcome gets no colour rather than a guessed one', () => {
  const at = LIVE.indexOf('function eodOutcomeTone');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 200 && fn.length < 1200, 'slice suspicious: ' + fn.length);
  const tone = new Function(fn + '; return eodOutcomeTone;')();
  assert.strictEqual(tone('Closed - PIF'), 'good', 'COMPOSED outcomes must colour — this is the common close');
  assert.strictEqual(tone('Closed - Payment plan'), 'good');
  assert.strictEqual(tone('Follow up'), 'mid');
  assert.strictEqual(tone('Lost'), 'bad');
  assert.strictEqual(tone('No-show'), 'bad');
  assert.strictEqual(tone('Something a rep typed'), 'none', 'a wrong tone is worse than none');
  assert.strictEqual(tone(''), 'none');
  assert.strictEqual(tone(null), 'none');
});

test('⚠ (u3) read-only rows carry NO input chrome, editable ones do', () => {
  // The fake read-only input — a field-shaped box at opacity 0.8 that could not
  // be typed into — is what made it invisible which rows accept text.
  assert.ok(!/eod-input" style="opacity:0\.8/.test(LIVE),
    'the read-only row must not masquerade as an input');
  assert.ok(/\.eod-static \{/.test(LIVE), '.eod-static must exist for read-only rows');
  assert.ok(/\.eod-input:focus, \.eod-textarea:focus \{[^}]*border-color: var\(--accent\)/.test(LIVE),
    'editable fields need a focus ring, or the affordance is only a hover away');
});

test('⚠⚠ THE COPY PATH IS UNTOUCHED — the deliverable is the paste', () => {
  // eodSlackText builds from the DATA, never from the DOM, which is why display
  // styling cannot change what lands in Slack. If this ever reads the rendered
  // page, a restyle becomes able to corrupt Josh's deliverable.
  const at = LIVE.indexOf('function eodSlackText');
  assert.ok(at > 0, 'eodSlackText is gone');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 200 && fn.length < 3000, 'slice suspicious: ' + fn.length);
  assert.ok(!/querySelector|getElementById|innerHTML|textContent/.test(fn),
    'the Slack text must be built from state, never scraped from the DOM');
  assert.ok(!/eod-chip|eod-static/.test(fn), 'and must not know about display classes');
});
