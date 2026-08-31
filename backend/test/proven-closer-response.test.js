/**
 * ⚠⚠ AN UNPROVEN REPLY MUST NOT BE PRESENTED AS THE REP'S WORDS.
 *
 * `closer_response_verified` is stamped true only when the quote locator
 * independently proves the closer said it. Measured 2026-08-31: 544 of 4,263
 * showable replies (13%) are NOT proven — the model's guess at who spoke.
 *
 * ⚠ Two lanes already required proof (`routes/me.js`, `lib/section-breakdown.js`)
 * and FIVE did not. A capability sweep found them; comparing the two named in
 * the report would have fixed one.
 *
 * ⚠⚠ AND THE TWO FAILURE MODES ARE NOT THE SAME. Rendering an unproven reply
 * shows a manager words the rep may never have said. FEEDING ONE TO A MODEL is
 * worse: the model builds coaching prose around them, and that prose reads as
 * authoritative with nothing on screen a reader could check it against.
 *
 * ⚠ THE STANDARD IS OMIT, NOT CAVEAT — a caveat inside a two-line evidence row
 * reads as noise, and this is the 6b defect that already had to be repaired in
 * the knowledge base once.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { provenCloserResponse, displayCloserResponse, NO_REPLY, MOMENT_IS_CLOSER } = require('../lib/closer-side');

test('a proven reply is returned as text', () => {
  assert.strictEqual(provenCloserResponse({ closer_response: 'I hear you.', closer_response_verified: true }), 'I hear you.');
});

test('⚠ an UNPROVEN reply is withheld, not caveated', () => {
  assert.strictEqual(provenCloserResponse({ closer_response: 'I hear you.', closer_response_verified: false }), null);
});

test('⚠⚠ NEVER-ASSESSED is withheld too — NULL is not permission', () => {
  // three-valued on purpose: null = never assessed, false = assessed and not
  // provable, true = proven. Only true may be shown.
  assert.strictEqual(provenCloserResponse({ closer_response: 'I hear you.', closer_response_verified: null }), null);
  assert.strictEqual(provenCloserResponse({ closer_response: 'I hear you.' }), null);
});

test('a sentinel is still withheld even when verified', () => {
  assert.strictEqual(provenCloserResponse({ closer_response: NO_REPLY, closer_response_verified: true }), null);
  assert.strictEqual(provenCloserResponse({ closer_response: MOMENT_IS_CLOSER, closer_response_verified: true }), null);
});

test('malformed input is total, never thrown on', () => {
  [null, undefined, {}, { closer_response: null, closer_response_verified: true }, { closer_response: '   ', closer_response_verified: true }]
    .forEach(r => assert.strictEqual(provenCloserResponse(r), null));
});

test('provenCloserResponse is STRICTER than displayCloserResponse, never looser', () => {
  const row = { closer_response: 'real words', closer_response_verified: false };
  assert.ok(displayCloserResponse(row.closer_response), 'display would show it');
  assert.strictEqual(provenCloserResponse(row), null, 'proven must not');
});

/* ⚠⚠ THE CAPABILITY GUARD. The report named TWO lanes; a sweep found FIVE
   emitting a reply with no proof gate. Comparing the two would have fixed one.
   This asserts the PROPERTY — any lane that turns closer_response into text a
   user or a model sees goes through provenCloserResponse — so a sixth lane
   inherits the rule instead of the bug. */
test('every lane that emits a closer reply gates it on proof', () => {
  const fs = require('fs'), path = require('path');
  const LANES = [
    'lib/team-needs-work.js', 'lib/objection-synthesis.js', 'lib/session-analytics.js',
    'lib/team-objections.js', 'lib/team-objection-summary.js',
  ];
  const strip = (s) => s.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  LANES.forEach((f) => {
    const src = strip(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    assert.ok(src.length > 500, f + ': strip must leave the module');
    // it must import and use the proof gate
    if (!/provenCloserResponse/.test(src)) bad.push(f + ' never gates on proof');
    // and must not emit the weaker gate's output as a reply
    if (/closer_response:\s*(str\()?\s*displayCloserResponse/.test(src)) {
      bad.push(f + ' emits a reply through the weaker display gate');
    }
    /* ⚠ ONLY LANES THAT QUERY NEED THE SELECT. team-objection-summary is a
       CONSUMER — it receives instances from computeTeamObjections, which does
       select the flag. My first version required it everywhere and failed on
       correct code: the check's scope was wider than its claim. */
    var queries = /from\(\s*'call_highlights'/.test(src) || /inChunks\(\s*'call_highlights'/.test(src);
    if (queries && !/closer_response_verified/.test(src)) {
      bad.push(f + ' queries the reply but never selects closer_response_verified');
    }
  });
  assert.deepStrictEqual(bad, []);
});
