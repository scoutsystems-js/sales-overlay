const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠⚠ JUSTIN'S RULING 2026-08-28 — SUPPRESS. Scout does not surface legal or
   liability matters ANYWHERE: not as coaching, not as a notable moment, not as
   the day's focus, and not on some other surface either.

   The incident: a rep told a prospect to overstate income on a financing
   application, and the digest made it TODAY'S FOCUS. It failed in the most
   expensive way available — it rendered as an INSIGHT, not as a wrong number,
   so a manager acting on it coaches the wrong thing. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-digest.js'), 'utf8');
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠ the digest prompt EXCLUDES legal/compliance moments', () => {
  assert.ok(/EXCLUSION — legal, compliance and liability matters/.test(LIVE),
    'the exclusion must be in the prompt that runs, not only in a comment');
  assert.ok(/DO NOT select it as a notable moment and DO NOT make it the focus/.test(LIVE),
    'it must cover BOTH surfaces — notable AND focus');
  assert.ok(/misrepresenting income or assets/.test(LIVE),
    'it must name the concrete shape, not gesture at "legal issues"');
});

test('⚠ suppression is at SELECTION, not at display', () => {
  // Filtering after the model has built the day around the moment leaves the
  // summary and focus still shaped by it with the evidence quietly missing —
  // worse than including it, because the reasoning stops being checkable.
  const at = LIVE.indexOf('EXCLUSION — legal');
  assert.ok(at !== -1);
  const before = LIVE.slice(0, at);
  assert.ok(/"notable"/.test(before) && /"focus"/.test(before),
    'the exclusion must sit with the output contract the model is answering');
  assert.ok(/do not allude to the excluded moment in the summary/.test(LIVE),
    'and must stop it leaking into the summary');
});

test('⚠ an empty notable list is the CORRECT answer, not a reason to reach', () => {
  assert.ok(/an empty list is the correct answer, not a reason to reach for it/.test(LIVE),
    'without this the model substitutes something weaker rather than returning []');
});

test('⚠⚠ THE PROMPT VERSION IS IN THE CACHE KEY — or the fix changes nothing on screen', () => {
  /* A digest is generated once per day and CACHED. Without the version, every
     digest already cached — including the one that made a legal matter the
     focus — keeps rendering exactly as before, indefinitely, and the fix looks
     shipped. The needs-work lane already paid for this once. */
  assert.ok(/DIGEST_PROMPT_VERSION/.test(LIVE), 'the version must exist');
  const at = LIVE.indexOf('function digestSetHash');
  const fn = LIVE.slice(at, LIVE.indexOf('\n}', at));
  assert.ok(fn.length > 100, 'slice must cover the hash: ' + fn.length);
  assert.ok(/DIGEST_PROMPT_VERSION/.test(fn),
    'the version must be folded into the HASH, not merely declared beside it');
});

test('⚠ the hash still folds in analyses, call ids and the KB hash', () => {
  // Adding the version must not displace what was already there — a quiet
  // regression here would re-introduce the synced-but-unanalyzed collision.
  const at = LIVE.indexOf('function digestSetHash');
  const fn = LIVE.slice(at, LIVE.indexOf('\n}', at));
  ['analyzed_at', 'calls:', 'kb:'].forEach((t) =>
    assert.ok(fn.indexOf(t) !== -1, 'hash lost an input: ' + t));
});
