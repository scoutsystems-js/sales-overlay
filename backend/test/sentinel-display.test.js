const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { displayCloserResponse, NO_REPLY, MOMENT_IS_CLOSER } = require('../lib/closer-side');

/* ⚠⚠⚠ A SENTINEL IS A RESULT, NOT A QUOTE — AND IT LEAKED.
   v29 added `__no_reply__` / `__moment_is_closer__` to `closer_response` and
   guarded them against the quote VERIFIER only. The RENDER paths were never
   checked. The performance synthesis does
       quote: str(closer_response) || str(quote)
   and a sentinel is a NON-EMPTY STRING, so it WON that fallback: a live
   what-to-improve insight came back with the evidence quote set to the literal
   text `__moment_is_closer__`. A manager would have read that as the proof. */

const ROOT = path.join(__dirname, '..');
function live(p) {
  const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
  return src.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('⚠⚠ the display gate refuses BOTH sentinels and keeps real text', () => {
  assert.strictEqual(displayCloserResponse(MOMENT_IS_CLOSER), null);
  assert.strictEqual(displayCloserResponse(NO_REPLY), null);
  assert.strictEqual(displayCloserResponse('  ' + NO_REPLY + ' '), null, 'whitespace must not smuggle one through');
  assert.strictEqual(displayCloserResponse('I hear you, but the price is the price'), 'I hear you, but the price is the price');
  assert.strictEqual(displayCloserResponse(''), null);
  assert.strictEqual(displayCloserResponse(null), null);
  assert.strictEqual(displayCloserResponse(42), null, 'total on non-strings');
});

/* ⚠ ENUMERATED BY CAPABILITY: every consumer that turns `closer_response` into
   TEXT — for a screen, a prompt, the voice corpus or a KB entry. A consumer
   that wants the MEANING asks isSentinel() instead. */
const CONSUMERS = [
  'lib/performance-synthesis.js', 'lib/team-synthesis.js', 'lib/team-needs-work.js',
  'lib/closer-voice.js', 'lib/kb-entry.js', 'lib/section-breakdown.js',
  'lib/session-analytics.js', 'lib/team-objections.js', 'lib/team-objection-summary.js',
  'lib/objection-synthesis.js',
];

test('⚠⚠ every text consumer goes through the gate', () => {
  const bad = [];
  CONSUMERS.forEach((f) => {
    const src = live(f);
    if (!/displayCloserResponse/.test(src)) bad.push(f + ' never gates');
    // the raw field must not be turned into text without the gate
    const raw = src.match(/str\(\s*[a-z]\.closer_response/g) || [];
    if (raw.length) bad.push(f + ' still stringifies closer_response raw (' + raw.length + ')');
  });
  assert.deepStrictEqual(bad, []);
});

test('⚠⚠ the synthesis quote fallback cannot be won by a sentinel', () => {
  // This is the exact line that leaked. A sentinel is non-empty, so an ungated
  // `str(closer_response) || str(quote)` prefers it over the real quote.
  ['lib/performance-synthesis.js', 'lib/team-synthesis.js'].forEach((f) => {
    const src = live(f);
    assert.ok(!/quote: str\(r\.closer_response/.test(src),
      f + ': the ungated fallback is the defect');
    assert.ok(/quote: str\(displayCloserResponse\(r\.closer_response\)/.test(src),
      f + ': the fallback must be gated');
  });
});

test('⚠ each consumer IMPORTS it — a call to an undefined identifier passes `node -c`', () => {
  // Nine files got the call before the import loop had run. Every one still
  // passed a syntax check, because identifier resolution is a RUNTIME fact.
  CONSUMERS.forEach((f) => {
    const src = live(f);
    /* ⚠ ASSERT THE INTENT, NOT A ONE-EXPORT LITERAL. This originally matched
       `displayCloserResponse } = require(...)`, which went stale the moment a
       SECOND gate was added to closer-side and the import became a list — a
       guard failing on exactly the change it polices. It now checks that every
       closer-side function the file CALLS is also imported. */
    var imp = /\{([^}]*)\}\s*=\s*require\('\.\/closer-side'\)/.exec(src);
    assert.ok(imp, f + ' does not import from closer-side at all');
    var imported = imp[1].split(',').map(function (x) { return x.trim(); });
    ['displayCloserResponse', 'provenCloserResponse'].forEach(function (fn) {
      var callsIt = new RegExp(fn + '\\s*\\(').test(src.replace(imp[0], ''));
      if (callsIt) assert.ok(imported.indexOf(fn) !== -1, f + ' calls ' + fn + ' without importing it');
    });
  });
});
