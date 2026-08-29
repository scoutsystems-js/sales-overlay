const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠ STANDING RULING (Justin, 2026-08-28): ANYTHING A CUSTOMER CAN SEE IS
   WRITTEN FOR THEM. No internal names, no mechanism, no explanation of how
   Scout works inside, and nothing they cannot act on. If a message cannot tell
   them what happened and what to do, it should not be on screen.
   He caught three in one evening — "Bucketing returned unusable output", the
   cost warning saying the money "goes to the company not them", and the ticket
   confirmation explaining "there is no inbox in Scout". */

const ROOT = path.join(__dirname, '..');
const FILES = ['web/dashboard.html', 'web/admin.html', 'web/login.html', 'web/set-password.html'];

// Strip comments FIRST (line, then block) — this codebase explains its rules in
// prose, and a raw scan reports the DOCUMENTATION of a rule as a violation of
// it. Line comments first: a `/*` inside a `//` line is a false opener.
function live(src) {
  const noLine = src.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* Words that describe HOW SCOUT WORKS. A customer-visible sentence containing
   one of these is describing our machinery to someone who cannot act on it. */
const MECHANISM = [
  'bucketing', 'synthesis returned', 'unusable output', 'prompt version',
  'no inbox in Scout', 'billed to the company', 'reanalyze', 'a deploy ends',
  'temp password fallback', 'analysis worker', 'the extractor', 'the grader',
];

// A "sentence" = a quoted string of >=5 real words with no code punctuation.
function sentences(src) {
  const out = [];
  const re = /'([^'\\\n]{20,300})'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const s = m[1];
    if (/[<>{};=\\]|function|querySelector|innerHTML/.test(s)) continue;
    const words = s.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z',.\-]*$/.test(w));
    if (words.length >= 5) out.push(s);
  }
  return out;
}

test('⚠⚠ no customer-visible string names an internal mechanism', () => {
  const offenders = [];
  FILES.forEach((f) => {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) return;
    sentences(live(fs.readFileSync(p, 'utf8'))).forEach((s) => {
      MECHANISM.forEach((t) => {
        if (s.toLowerCase().indexOf(t.toLowerCase()) !== -1) offenders.push(f + ': ' + s);
      });
    });
  });
  assert.deepStrictEqual(offenders, [],
    'customer-visible text naming an internal mechanism:\n  ' + offenders.join('\n  '));
});

test('the same rule holds for server-generated user-facing reasons', () => {
  // These reach the screen verbatim as `reason` / `error`.
  const offenders = [];
  ['lib/team-needs-work.js', 'lib/team-digest.js'].forEach((f) => {
    const src = live(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    ['Bucketing', 'unusable output'].forEach((t) => {
      if (src.indexOf(t) !== -1) offenders.push(f + ' still says "' + t + '"');
    });
  });
  assert.deepStrictEqual(offenders, []);
});

test('⚠⚠ THE COST-OWNERSHIP WARNING IS REMOVED, NOT SOFTENED', () => {
  // Justin's ruling: there should be NO warning at all. Telling a rep the money
  // comes from the company puts a hesitation in their head about spending
  // someone else's money on their own coaching. Removed, not reworded.
  const src = live(fs.readFileSync(path.join(ROOT, 'web/dashboard.html'), 'utf8'));
  assert.strictEqual(src.indexOf('whoseMoney'), -1, 'the variable must be gone, not just unused');
  assert.strictEqual(src.indexOf('billed to the company'), -1);
  ['not to them', 'company money', 'costs the company'].forEach((t) => {
    assert.strictEqual(src.indexOf(t), -1, 'a reworded cost warning is still a cost warning: ' + t);
  });
  // and the confirmation itself must survive — this is a removal, not a gutting
  assert.ok(src.indexOf('Manual outcome tags are kept') !== -1, 'the confirm text must remain');
});
