const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠ SEVEN HUES, A BOARD OF NINE. Sober Living Riches has 9 members, so reps 8
   and 9 drew in reps 1 and 2's colours — two identical lines on one chart, which
   the legend cannot disambiguate. Live today, not theoretical. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const at = LIVE.indexOf('var REP_LINE_COLORS = [');
const RAMP = new Function('return ' + LIVE.slice(LIVE.indexOf('[', at), LIVE.indexOf('];', at) + 1))();

test('the ramp is still 7 vivid, non-semantic hues', () => {
  assert.strictEqual(RAMP.length, 7, 'the hue count is load-bearing for the cycle maths');
  ['#09e046', '#f87171', '#fbbf24'].forEach((reserved) =>
    assert.ok(RAMP.indexOf(reserved) === -1, 'a semantic hue must never enter the ramp: ' + reserved));
});

test('⚠⚠ the SECOND cycle is dashed, so rep 8 is distinguishable from rep 1', () => {
  assert.ok(/borderDash: \(Math\.floor\(i \/ REP_LINE_COLORS\.length\) % 2\) \? \[6, 4\] : undefined/.test(LIVE),
    'the dash must key on the CYCLE index, not on the rep index');
  // and the maths must actually separate them
  const style = (i) => RAMP[i % RAMP.length] + '/' + ((Math.floor(i / RAMP.length) % 2) ? 'dash' : 'solid');
  const seen = new Set();
  for (let i = 0; i < 14; i++) seen.add(style(i));
  assert.strictEqual(seen.size, 14, '14 reps must produce 14 distinct styles');
});

test('⚠ a 9-rep board — the live case — has no repeat', () => {
  const style = (i) => RAMP[i % RAMP.length] + '/' + ((Math.floor(i / RAMP.length) % 2) ? 'dash' : 'solid');
  const seen = new Set();
  for (let i = 0; i < 9; i++) seen.add(style(i));
  assert.strictEqual(seen.size, 9, 'Sober Living Riches has 9 members');
});

test('⚠ the FIRST cycle is untouched — no dash on reps 1-7', () => {
  // Dashing everything would be a visual change nobody asked for.
  for (let i = 0; i < 7; i++) {
    assert.strictEqual((Math.floor(i / RAMP.length) % 2) ? 'dash' : 'solid', 'solid', 'rep ' + (i + 1));
  }
});

test('⚠⚠ the reason MORE HUES was rejected is recorded, not just the fix', () => {
  // Otherwise the next person "improves" this by adding two colours and
  // re-creates either a semantic collision or the pastel complaint.
  assert.ok(/space is exhausted/i.test(SRC) || /SPACE IS EXHAUSTED/.test(SRC),
    'the measurement that ruled out more hues must be on file at the code');
  assert.ok(/GREYS/.test(SRC) && /reads as DISABLED/i.test(SRC),
    'including WHY the only qualifying candidates were unusable');
});
