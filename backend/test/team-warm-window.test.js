'use strict';
/**
 * ⚠⚠ THE ONE THING THAT CAN MAKE THIS FEATURE POINTLESS.
 *
 * A warm-up keyed differently from the read is INDISTINGUISHABLE FROM NO
 * WARM-UP AT ALL: the cron spends a model call, writes a row nobody hits, and
 * the first manager still waits 26 seconds — with nothing anywhere saying why.
 * There is no error, no failed write and no wrong number to notice.
 *
 * So this pins the WINDOW STRING the cron computes against the window string the
 * browser sends. They are two implementations of one thing in two runtimes (a
 * browser file cannot `require()`), which is the same situation as the SQL/JS
 * scope mirror — so it is guarded the same way: transpile the client's own
 * source and run it.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { _defaultTeamWindow } = require('../lib/team-warm');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

/* Extract the two client functions that build the default team window. Sliced
   with an explicit fromIndex and length-asserted — a backwards slice silently
   tests the empty string. */
function clientWindowFn() {
  const a = HTML.indexOf('function rangeToIso(');
  assert.ok(a > 0, 'rangeToIso not found');
  const rangeToIso = HTML.slice(a, HTML.indexOf('\n  }', a) + 4);
  assert.ok(rangeToIso.length > 80 && rangeToIso.length < 400, 'rangeToIso slice: ' + rangeToIso.length);

  const b = HTML.indexOf('var today = new Date().toISOString().slice(0, 10);');
  assert.ok(b > 0, 'the default-window derivation was not found');
  const c = HTML.indexOf('rangeToIso(monthAgo, today)', b);
  assert.ok(c > b, 'the rangeToIso call was not found after the derivation');
  const body = HTML.slice(b, c + 'rangeToIso(monthAgo, today)'.length);
  assert.ok(body.length > 200 && body.length < 4000, 'derivation slice: ' + body.length);

  return new Function('NOW', rangeToIso + '\nvar Date_ = Date;'
    + '\nvar today = new Date_(NOW).toISOString().slice(0, 10);'
    + '\nvar monthAgo = new Date_(NOW - 29 * 86400000).toISOString().slice(0, 10);'
    + '\nreturn rangeToIso(monthAgo, today);');
}

test('the cron computes byte-for-byte the window the browser sends', () => {
  const client = clientWindowFn();
  /* Several instants, including either side of a UTC midnight and a leap day —
     the derivation is day-anchored, and a day boundary is where an off-by-one
     would live. */
  const stamps = [
    Date.UTC(2026, 8, 1, 8, 47, 0),
    Date.UTC(2026, 8, 1, 23, 59, 59),
    Date.UTC(2026, 8, 2, 0, 0, 1),
    Date.UTC(2024, 1, 29, 12, 0, 0),
    Date.UTC(2026, 0, 1, 0, 0, 0),
  ];
  for (const t of stamps) {
    const want = client(t);
    const got = _defaultTeamWindow(new Date(t));
    assert.deepStrictEqual(got, want,
      'the warm-up would write a cache entry the page never reads, at ' + new Date(t).toISOString());
  }
});

test('⚠ the window is DAY-anchored, not click-time-anchored', () => {
  /* This is the property that makes warming possible at all. If either end
     carried the instant, the cron and the page would compute different windows
     on every load — the DATA query uses the exact from/to, so a window differing
     by hours can include a call the other excludes, giving a different hash and
     a guaranteed miss. */
  const morning = _defaultTeamWindow(new Date(Date.UTC(2026, 8, 1, 4, 0, 0)));
  const evening = _defaultTeamWindow(new Date(Date.UTC(2026, 8, 1, 22, 0, 0)));
  assert.deepStrictEqual(morning, evening,
    'two runs on the same UTC day must produce the same window');
  assert.ok(/T00:00:00\.000Z$/.test(morning.from), 'from must be midnight: ' + morning.from);
  assert.ok(/T23:59:59\.999Z$/.test(morning.to), 'to must be end-of-day: ' + morning.to);
});

test('a total failure to warm says so, rather than reading as normal', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-warm.js'), 'utf8');
  assert.ok(/NOTHING WARMED/.test(src),
    'a silent no-op means the first manager pays full price and nobody knows why');
  assert.ok(/instanceof ReferenceError|instanceof TypeError/.test(src),
    'a programmer error and an operational one must not print identically');
});

test('the cron reuses the digest manager set and skips loudly without one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const at = src.indexOf('warmTeamRecommendations');
  assert.ok(at > 0, 'the warm-up is not wired into the cron');
  const seg = src.slice(Math.max(0, at - 2200), at + 800);
  assert.ok(/digest\.managerMap/.test(seg),
    '"who is a manager" must not have a second answer here');
  assert.ok(/SKIPPED/.test(seg),
    'warming a manager set we could not establish is worse than not warming — say so');
  /* ⚠ Isolated SEPARATELY from the digest: sharing its try would report a
     warm-up failure as a digest failure, and that isolation is what hid two days
     of missing digests. */
  assert.ok(/recommendations warm-up threw \(isolated\)/.test(seg),
    'the warm-up needs its own catch, not the digest\'s');
});
