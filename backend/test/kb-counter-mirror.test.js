/**
 * ⚠⚠ THE BROWSER COPY OF buildCounter CANNOT DRIFT FROM THE LIB.
 * dashboard.html cannot require() lib/kb-counter, so kbBuildCounter() is a
 * hand-mirrored copy. Same pattern as section-breakdown-mirror and
 * tile-metrics-mirror: extract the inline function, run BOTH against identical
 * inputs, assert they agree. A silent divergence here would show a different
 * number on screen from the one the route computed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib/kb-counter');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

test('the inline mirror agrees with lib/kb-counter on every state', () => {
  const at = PAGE.indexOf('function kbBuildCounter(d) {');
  assert.ok(at !== -1, 'stale anchor — the inline mirror moved or was removed');
  const end = PAGE.indexOf('\n  }', at);
  assert.ok(end > at, 'could not bracket the mirror');
  const src = PAGE.slice(at, end + 4);
  assert.ok(src.length > 400 && src.length < 3000, 'slice suspicious: ' + src.length);

  // eslint-disable-next-line no-new-func
  const mirror = new Function('return (' + src.replace('function kbBuildCounter', 'function') + ')')();

  const CASES = [
    { analysedToday: 0, closedToday: 0, harvested: 0 },
    { analysedToday: 5, closedToday: 0, harvested: 0 },
    { analysedToday: 3, closedToday: 2, harvested: 0 },
    { analysedToday: 4, closedToday: 1, harvested: 3 },   // the live case today
    { analysedToday: 1, closedToday: 1, harvested: 1 },   // singular wording
  ];
  CASES.forEach((c) => {
    const a = lib.buildCounter(c);
    const b = mirror(c);
    assert.deepStrictEqual(b, a,
      'mirror diverged on ' + JSON.stringify(c) + ' — the card would show a '
      + 'different number from the one the route computed');
  });
});

test('⚠ NON-VACUITY — a broken mirror is detected', () => {
  const at = PAGE.indexOf('function kbBuildCounter(d) {');
  const end = PAGE.indexOf('\n  }', at);
  const broken = PAGE.slice(at, end + 4)
    .replace("headline: String(harvested)", "headline: String(harvested + 1)");
  assert.notStrictEqual(broken, PAGE.slice(at, end + 4), 'injection did not match');
  // eslint-disable-next-line no-new-func
  const m = new Function('return (' + broken.replace('function kbBuildCounter', 'function') + ')')();
  assert.notDeepStrictEqual(m({ analysedToday: 4, closedToday: 1, harvested: 3 }),
    lib.buildCounter({ analysedToday: 4, closedToday: 1, harvested: 3 }));
});
