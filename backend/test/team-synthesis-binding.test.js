'use strict';
/* ⚠⚠ GUARDS ON THE DERIVATION, NOT THE RENDERER (2026-09-01).
   `spoke` shipped with two guards proving "no wrong label is ever shown" — and
   BOTH TESTED THE RENDERER. They passed while the PRODUCER computed the right
   shape from the wrong source, so the property they claimed to protect was
   false in production for two blocks.
   ⚠ A GUARD ON THE CONSUMER CANNOT SEE A PRODUCER READING THE WRONG FIELD.
   These test the producer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const lane = require('../lib/team-synthesis.js');
const objLane = require('../lib/team-objection-summary.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

/* ── (b) the speaker is READ, never inferred ──────────────────────────────── */

test('⚠⚠ the LIVE defect: a CLOSER-spoken quote is never labelled the prospect', () => {
  // the exact row that rendered "The prospect, on Josh P's call" over
  // "I'll give you $1,000 off for doing that, for doing cash."
  const row = { speaker: 'CLOSER', speaker_verified: true, closer_response: '__moment_is_closer__' };
  assert.strictEqual(lane._spokeOf(row, null, "I'll give you $1,000 off for doing that, for doing cash."), 'closer',
    'the recorded speaker says CLOSER — the label must not come from which field we fell back to');
});

test('a proven closer reply is the closer, whatever the row says', () => {
  assert.strictEqual(lane._spokeOf({ speaker: 'PROSPECT', speaker_verified: true }, 'a proven reply', 'q'), 'closer',
    'closer_response is definitionally the closer');
});

test('a verified prospect line is the prospect', () => {
  assert.strictEqual(lane._spokeOf({ speaker: 'PROSPECT', speaker_verified: true }, null, 'I need to ask my wife.'), 'prospect');
});

test('⚠⚠ an UNVERIFIED speaker falls to UNLABELLED — never to a claim', () => {
  /* speaker_verified is three-valued: null = never assessed, false = assessed
     and NOT provable. Only `true` may attribute. Before this fix an unverified
     row was labelled "prospect", i.e. the fallback defaulted to an assertion —
     the opposite of what a fallback is for. */
  assert.strictEqual(lane._spokeOf({ speaker: 'CLOSER', speaker_verified: false }, null, 'q'), null, 'false = not provable');
  assert.strictEqual(lane._spokeOf({ speaker: 'CLOSER', speaker_verified: null }, null, 'q'), null, 'null = never assessed');
  assert.strictEqual(lane._spokeOf({ speaker: 'PROSPECT' }, null, 'q'), null, 'missing flag is not permission');
});

test('no quote at all is null, not a guess', () => {
  assert.strictEqual(lane._spokeOf({ speaker: 'CLOSER', speaker_verified: true }, null, ''), null);
  assert.strictEqual(lane._spokeOf(null, null, 'q'), null);
});

test('⚠ the recorded speaker is actually SELECTED — without it the gate can never pass', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  /* ⚠ SELECT BY CONTENT, NOT POSITION. There are TWO `inChunks('call_highlights'`
     calls in this file and the first is the objections select — anchoring on the
     first one tested a completely different query and failed on correct code. */
  const at = src.indexOf("closer_response_verified");
  assert.ok(at !== -1, 'anchor missing — the recommendations select is gone?');
  const start = src.lastIndexOf("inChunks('call_highlights'", at);
  assert.ok(start !== -1, 'no select encloses the anchor');
  const line = src.slice(start, src.indexOf(');', at) + 2);
  assert.ok(line.length > 60 && line.length < 500, 'slice sane: ' + line.length);
  assert.ok(line.indexOf('speaker,') !== -1, 'speaker must be in the column list: ' + line.slice(0, 160));
  assert.ok(line.indexOf('speaker_verified') !== -1, 'and so must the flag');
});

/* ── (a) the evidence is BOUND to the claim ───────────────────────────────── */

const REPS = ['Godwin Ona', 'Nick O\'Neal', 'Gabriel Ocasio', 'Yazan Younis', 'Josh P'];

test('⚠⚠ the LIVE mismatch: a claim naming Godwin and Nick may not cite Gabriel', () => {
  const prose = "Closing is the team's weakest section at 57. Godwin let a prospect walk with "
    + "'we'll reach out to you'; Nick accepted 'I'll shoot you a text'.";
  assert.ok(lane._evidenceMismatch(prose, 'Gabriel Ocasio', REPS), 'must be flagged and dropped');
  assert.strictEqual(lane._evidenceMismatch(prose, 'Godwin Ona', REPS), null, 'a named rep is fine');
  assert.strictEqual(lane._evidenceMismatch(prose, "Nick O'Neal", REPS), null);
});

test('⚠ a claim that names NOBODY is unconstrained — team-level prose is legitimate', () => {
  const prose = 'Discovery is the weakest section across the board and pain is rarely anchored to price.';
  assert.strictEqual(lane._evidenceMismatch(prose, 'Gabriel Ocasio', REPS), null,
    'constraining an unnamed claim would drop evidence for no reason');
});

test('⚠ first names match, and an initial never does', () => {
  assert.ok(lane._proseNamesRep('Josh let it slide.', 'Josh P'), 'first-name mention counts');
  assert.strictEqual(lane._proseNamesRep('P did well.', 'P Something'), false, 'a one-letter token must never match');
  assert.strictEqual(lane._proseNamesRep('Joshua was strong.', 'Josh P'), false,
    'word boundary — "Josh" must not match inside "Joshua"');
});

test('no evidence at all is not a mismatch', () => {
  assert.strictEqual(lane._evidenceMismatch('Godwin did X.', null, REPS), null);
});

/* ── (c) one FORMAT, two runtimes ─────────────────────────────────────────── */

test('⚠⚠ the browser and the server render the SAME hh:mm:ss', () => {
  const a = HTML.indexOf('function tsFromClipUrl');
  assert.ok(a !== -1, 'anchor missing');
  const src = HTML.slice(a, HTML.indexOf('\n  }', a) + 4);
  assert.ok(src.length > 200 && src.length < 2000, 'slice sane: ' + src.length);
  const tsFromClipUrl = eval('(' + src + ')');
  /* ⚠ THEY ARE DELIBERATELY NOT ONE FUNCTION — different runtime, different
     input (a URL vs seconds), and a browser file cannot require the lib. What
     must not drift is the FORMAT, which is what this pins. */
  [0, 42, 2022, 3600, 7660, 36000].forEach((sec) => {
    const browser = tsFromClipUrl('https://x/y?t=' + sec);
    assert.strictEqual(browser, objLane._hmsOf(sec), 'format drift at ' + sec + 's');
    assert.ok(/^\d{2}:\d{2}:\d{2}$/.test(browser), 'hh:mm:ss at ' + sec + 's, got ' + browser);
  });
  // the specific regression: minutes must not run past sixty
  assert.strictEqual(tsFromClipUrl('https://x/y?t=7660'), '02:07:40', 'was "127:40"');
});

test('⚠ the lane version moved — both values live inside the cached payload', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  /* ⚠⚠ CONVERTED 2026-09-01 — pinned `v3-` and went red on the next bump. The
     property is that the version is IN THE KEY and moves with the prompt, not
     that it holds any particular value. */
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\|\|recs:' \+ RECS_LANE_VERSION/.test(code),
    'a change to `spoke` or to the binding is invisible on every cached window '
    + 'unless the version is folded into the key');
  assert.ok(/RECS_LANE_VERSION = 'v\d+-/.test(code), 'and it must be a versioned string');
});

/* ── ⚠⚠ AND THE CALL SITES — WITHOUT THESE, TWO OF THE GUARDS ABOVE PASS WITH
      THE DEFECT FULLY RESTORED. Proven, not assumed: reverting the derivation
      to the old inline ternary left `spokeOf` defined and correct, so every
      unit test above stayed green while the producer ignored it.
      ⚠ THIS IS THE SAME LESSON THE BLOCK FILED — a guard on a helper cannot see
      a caller that does not call it — and I hit it while writing the guards
      FOR that lesson. Exercising a function and grepping for its name are the
      same check twice: both confirm it EXISTS, neither confirms it RUNS. ── */

const LIB = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
const stripped = LIB.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠ the candidate builder CALLS spokeOf — it does not re-derive inline', () => {
  assert.ok(/spoke:\s*spokeOf\(r, reply, /.test(stripped),
    'the producer must call the function, or the fix is unreachable');
  assert.strictEqual(/spoke:\s*reply \? 'closer' :/.test(stripped), false,
    'the old which-field-did-I-use derivation must be gone');
});

test('⚠⚠ resolveInsights CALLS evidenceMismatch and DROPS on a mismatch (module-level since H724, so a test can execute it; resolve() delegates to it)', () => {
  const at = stripped.indexOf('function resolveInsights(arr, byId, allRepNames, opts)');   // opts = the page facts (H728)
  assert.ok(at !== -1, 'anchor missing');
  const fn = stripped.slice(at, stripped.indexOf('async function computeTeamRecommendations(', at));
  assert.ok(fn.length > 200 && fn.length < 3000, 'slice sane: ' + fn.length);
  assert.ok(fn.indexOf('evidenceMismatch(') !== -1, 'the check must be called inside resolveInsights');
  assert.ok(/if \(mism\)[^\n]*ev = null/.test(fn),
    'and a mismatch must actually DROP the evidence — computing it and ignoring it is worse than not checking');
  assert.ok(/function resolve\(arr, direction\) \{ return resolveInsights\(arr, byId, allRepNames, \{ facts: facts, direction: direction \}\); \}/.test(stripped), 'the lane resolves through the module-level function, with the page facts');
  /* executed: the rep mismatch drops the quote through the real function */
  const out = lane._resolveInsights([{ claim: 'Godwin and Nick rush the close.', data: 'x', evidence_id: 'm1', subject: { kind: 'objection', category: null } }],
    { m1: { id: 'm1', rep: 'Gabriel Ocasio', type: 'objection', quote: 'q', spoke: 'prospect' } }, ['Godwin Ona', "Nick O'Neal", 'Gabriel Ocasio']);
  assert.strictEqual(out[0].quote, null);
});
