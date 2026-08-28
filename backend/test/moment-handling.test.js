/**
 * 8a — was the risk signal / barrier actually engaged with?
 *
 * v17 created risk_signal and barrier. Both can be raised and dropped, and that
 * is the coachable event — invisible unless someone re-listens to the call.
 *
 * WHY THIS COULD NOT BE DERIVED (measured before building, on the motivating
 * call): the prospect discloses "I lost over $300,000" at 2722s. In the next 15
 * turns the closer says 20 words — "Yeah.", "It just…". The real response lands
 * at 2775s, 16 turns and 53 seconds later, and it is a DEFLECTION: "don't bring
 * the ex-girlfriend into the conversation with a date with the hot blonde… I
 * respect it, I know what you went through."
 *
 * So both obvious proxies fail: a turn window MISSES the response entirely, and
 * "did he reply / how much did he say" scores the deflection as engagement —
 * exactly backwards from the coaching point. It has to be judged where the
 * transcript is in view.
 */
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const FAKE = { turns: [{ speaker: 'CLOSER', display_name: 'C', text: 'hello there friend', start_seconds: 1 }], highlights: [], closer_name: 'C', speaker_confidence: 'matched' };
const PROMPT = worker._buildHighlightExtractorPrompt(FAKE);

function hl(over) {
  return Object.assign({
    timestamp_seconds: 100, speaker: 'PROSPECT',
    quote: 'I lost over three hundred thousand dollars two years ago',
    observation: 'o', type: 'risk_signal', section: 'discovery',
  }, over);
}

// ─── the prompt contract ───────────────────────────────────────────────────

test('closer_response and handling are asked for on risk_signal AND barrier', () => {
  assert.ok(/type="risk_signal"[\s\S]{0,40}type="barrier"|risk_signal.{0,40}barrier/.test(PROMPT),
    'the block must cover both types');
  const h = PROMPT.split('\n').find((l) => l.indexOf('- handling:') !== -1);
  assert.ok(h, 'handling instruction missing');
  assert.ok(/addressed/.test(h) && /deflected/.test(h) && /ignored/.test(h), 'all three values must be named');
});

test('handling is stated as an OPERATION with the worked example, not an adjective', () => {
  // The lesson is now proven three times — v14 (copy a span, not "verbatim"),
  // v17 (could they decide their way out, not "resistance"), and here.
  const h = PROMPT.split('\n').find((l) => l.indexOf('- handling:') !== -1);
  assert.ok(/engage with the SUBSTANCE|substance of what/i.test(h), 'must state the test as an operation');
  assert.ok(/warmth, length and sympathy are NOT engagement/i.test(h), 'must rule out the obvious false positives');
  assert.ok(/ex-girlfriend/i.test(h), 'the worked deflection example must be present');
  assert.ok(/validates the feeling and never touches the concern/i.test(h), 'must say WHY it is a deflection');
});

test('closer_response inherits the v14 verbatim contract', () => {
  // ⚠ THE SELECTOR WAS HEURISTIC-THEN-POSITIONAL (match on "risk|barrier", else
  // .pop()). v29 consolidated three instructions into one, so both halves would
  // have retargeted silently. Select by content, and assert the PROPERTY where
  // it now lives: the span rule on the instruction, the null rule in its block.
  const r = closerResponseInstructions();
  assert.strictEqual(r.length, 1);
  assert.ok(/contiguous verbatim span/.test(r[0]), 'must demand an exact span');
  assert.ok(/HOW TO QUOTE/.test(r[0]), 'and point at the shared contract');
  const at = PROMPT.indexOf('FOR EVERY MOMENT OF EVERY TYPE');
  assert.ok(at !== -1);
  assert.ok(/Use null ONLY/.test(PROMPT.slice(at, at + 2200)),
    'must still allow null rather than forcing a quote it cannot produce');
});

// ─── sanitation ────────────────────────────────────────────────────────────

test('risk_signal and barrier keep closer_response and handling', () => {
  ['risk_signal', 'barrier'].forEach((t) => {
    const out = worker._sanitizeHighlights([hl({ type: t, closer_response: 'I respect it, I know what you went through', handling: 'deflected' })], 3600);
    assert.strictEqual(out.length, 1, t);
    assert.strictEqual(out[0].closer_response, 'I respect it, I know what you went through', t);
    assert.strictEqual(out[0].handling, 'deflected', t);
  });
});

test('they still do NOT get resolution or objection_category', () => {
  // Those belong to objections. Letting them through would violate the CHECK
  // and corrupt the handle-rate denominator.
  const out = worker._sanitizeHighlights([hl({ type: 'barrier', resolution: 'handled', objection_category: 'logistical', handling: 'addressed' })], 3600);
  assert.strictEqual(out[0].resolution, null);
  assert.strictEqual(out[0].objection_category, null);
  assert.strictEqual(out[0].handling, 'addressed');
});

test('an OBJECTION does not carry handling — it already has resolution', () => {
  // Two competing "was it dealt with" fields on one row is a bug factory, and
  // the handle rate reads resolution.
  const out = worker._sanitizeHighlights([hl({ type: 'objection', resolution: 'handled', handling: 'deflected' })], 3600);
  assert.strictEqual(out[0].resolution, 'handled');
  assert.strictEqual(out[0].handling, null);
});

test('v29: these types get `handling` null but now KEEP closer_response', () => {
  // ⚠⚠ THIS TEST USED TO ASSERT closer_response WAS NULL HERE, AND IT WAS RIGHT
  // UNTIL v29. It is also the test that should have caught v29's first ship:
  // I changed the PROMPT to ask every type for a reply and never touched the
  // sanitizer, so this stayed GREEN while the pipeline discarded every value
  // the model returned. A green suite meant "you changed nothing I guard",
  // and I read it as "shipped".
  //
  // `handling` is still risk/barrier-only, deliberately — closer_response
  // became universal, the verdict fields did not.
  ['buying_signal', 'strong_moment', 'rapport_moment', 'missed_opportunity', 'disqualify_signal'].forEach((t) => {
    const out = worker._sanitizeHighlights([hl({ type: t, closer_response: 'x y z', handling: 'addressed' })], 3600);
    assert.strictEqual(out[0].handling, null, t + ' must not carry a handling verdict');
    assert.strictEqual(out[0].closer_response, 'x y z', t + ' must KEEP the closer side (v29)');
  });
});

test('an invalid handling value becomes null rather than losing the moment', () => {
  ['maybe', '', 'ADDRESSED!', 42, null, {}].forEach((junk) => {
    const out = worker._sanitizeHighlights([hl({ handling: junk })], 3600);
    assert.strictEqual(out.length, 1, 'the moment must survive: ' + JSON.stringify(junk));
    assert.strictEqual(out[0].handling, null, JSON.stringify(junk));
  });
});

test('handling is accepted case-insensitively', () => {
  const out = worker._sanitizeHighlights([hl({ handling: 'Deflected' })], 3600);
  assert.strictEqual(out[0].handling, 'deflected');
});

test('a missing closer_response is null, not an empty string', () => {
  const out = worker._sanitizeHighlights([hl({ closer_response: '   ', handling: 'ignored' })], 3600);
  assert.strictEqual(out[0].closer_response, null);
  assert.strictEqual(out[0].handling, 'ignored', 'ignored is meaningful precisely when there is no response');
});

// Selects the closer_response instruction(s) BY CONTENT. Positional selection
// (all[0] / .pop()) silently retargets the moment another one is added — which
// is exactly what v29 did to the two guards that used to do it.
function closerResponseInstructions() {
  return PROMPT.split('\n').filter((l) => l.indexOf('- closer_response:') !== -1);
}

test('closer_response must INCLUDE short interjections, not tidy them out', () => {
  // Measured cause of the failure this fixes: the deflection spanned four closer
  // turns, and the model quoted it while dropping "You know what I mean?" from
  // the middle. The span broke and the quote was discarded, leaving the handling
  // verdict with no evidence. v20 (Justin's ruling): take the SINGLE SHARPEST
  // LINE — single-line spans reconstruct reliably, multi-turn ones are where it
  // broke (2 of 3).
  //
  // ⚠ THIS USED TO SELECT ITS TARGET WITH .pop() — the LAST closer_response line.
  // v29 added a universal instruction, so .pop() would silently have begun
  // checking a DIFFERENT line while the one it was written for stopped being
  // checked at all. A positional anchor is not an anchor; select by content.
  const r = closerResponseInstructions();
  assert.strictEqual(r.length, 1, 'ONE definition of closer_response, not one per type');
  assert.ok(/SINGLE SHARPEST LINE, NOT THE FULLEST REPLY/i.test(r[0]), 'v20 ruling missing');
  assert.ok(/rather than stitching several together/i.test(r[0]));
  assert.ok(/interjection/i.test(r[0]), 'the multi-line fallback must still name what gets dropped');
  assert.ok(/A short quote that survives beats a fuller one that does not/i.test(r[0]),
    'must tell it which way to trade off, not just what to avoid');
  assert.ok(/HOW TO QUOTE/.test(r[0]), 'and still inherit the verbatim contract');
});

// ─── v29: BOTH SIDES OF EVERY MOMENT ─────────────────────────────────────────

test('⚠⚠ EVERY citable moment type is asked for the closer side, by capability', () => {
  // The fault this closes: only objection/risk_signal/barrier were ever asked
  // for a reply, so 4,692 of 8,238 real moments (55%) carried ONLY the
  // prospect's words — and a synthesis making a claim about the CLOSER could
  // not quote him. `missed_opportunity` was the sharpest case: a type whose
  // whole meaning is that the closer missed something, recording nothing he did.
  //
  // ⚠ ASSERTED AGAINST THE REAL TYPE LIST, NOT ONE COPIED IN HERE. A hand-copied
  // enumeration passes forever after a ninth type is added; reading
  // VALID_HIGHLIGHT_TYPES means a new type FAILS this until it is covered.
  const types = worker._VALID_HIGHLIGHT_TYPES;
  assert.ok(Array.isArray(types) && types.length >= 8, 'the real type list must load: ' + types);
  const at = PROMPT.indexOf('FOR EVERY MOMENT OF EVERY TYPE');
  assert.ok(at !== -1, 'the universal block must exist and be scoped to every type');
  const scope = PROMPT.slice(at, at + 2200);
  assert.ok(scope.length > 1000, 'scope must cover the block: ' + scope.length);
  // the five that carried nothing before are named explicitly, so the model
  // cannot read "every type" as "the ones I was already doing".
  ['buying_signal', 'strong_moment', 'missed_opportunity', 'rapport_moment', 'disqualify_signal']
    .forEach((t) => assert.ok(scope.indexOf(t) !== -1, 'previously-empty type not named: ' + t));
  // and no type in the real list is excluded by the instruction.
  types.forEach((t) => assert.ok(!new RegExp('omit[^.]*' + t).test(scope), 'excluded: ' + t));
});

test('⚠⚠ "he said nothing" is recordable, and is DISTINCT from "we could not find it"', () => {
  // A single null would collapse "the closer did not reply" into "no exact span
  // available" — the absent-vs-excluded failure this codebase has hit before.
  // On a missed_opportunity the first is often the most coachable fact there is.
  const at = PROMPT.indexOf('FOR EVERY MOMENT OF EVERY TYPE');
  const scope = PROMPT.slice(at, at + 2200);
  assert.ok(/__no_reply__/.test(scope), 'no-reply must have its own value');
  assert.ok(/Use null ONLY when he did reply/.test(scope),
    'null must be reserved for the could-not-quote case, or the two collapse');
  assert.ok(!/Use null if the closer did not respond/i.test(PROMPT),
    'the old wording sent BOTH cases to null — it must not survive anywhere');
});

test('the risk/barrier block keeps `handling` and no longer claims closer_response as its own', () => {
  // It used to say "omit them for every other type", which DIRECTLY contradicts
  // a universal closer_response rule. Contradictory instructions inside one
  // prompt get resolved by the model, not by us.
  assert.ok(/FOR type="risk_signal" AND type="barrier" MOMENTS, also include this field/.test(PROMPT));
  assert.ok(!/also include these two fields/.test(PROMPT), 'stale two-field header survived');
  assert.ok(/- handling: exactly one of/.test(PROMPT), 'handling itself must survive');
});

test('the objection block kept its own fields and lost only the duplicated instruction', () => {
  assert.ok(/- resolution: exactly one of/.test(PROMPT), 'resolution must survive');
  assert.ok(/objection_surface/.test(PROMPT), 'the objection block itself must survive');
});

// ─── the 8b panel was REMOVED; its good parts live in the ROW ────────────

const fs = require('node:fs');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const ROW = HTML.slice(HTML.indexOf('function highlightEntryHtml'), HTML.indexOf('function highlightTypeLabel'));

test('the standalone risk-signal panel is out of the render path', () => {
  assert.strictEqual((HTML.match(/^  function renderRiskSignalsHtml/gm) || []).length, 0);
  assert.strictEqual((HTML.match(/^\s*\+ renderRiskSignalsHtml/gm) || []).length, 0);
});

test('the handling badge and the reply now live in the Call Highlights ROW', () => {
  // This is what Justin actually asked for: the existing section improved.
  assert.ok(/HANDLING_TYPES.indexOf\(h\.type\) !== -1 && h\.handling/.test(ROW), 'badge is in the row');
  assert.ok(/Engaged with/.test(ROW) && /Moved past/.test(ROW) && /No response/.test(ROW));
  assert.ok(/closer_response_verified === true/.test(ROW), '"You said" requires a proven quote');
});

test('ONLY the three types a closer response bears on are badged', () => {
  assert.ok(/var HANDLING_TYPES = \['risk_signal', 'barrier', 'objection'\]/.test(HTML),
    'badging every type alike is what made the removed panel feel cluttered');
});

test('the row does NOT carry the panel unmatched-quote explanation', () => {
  assert.ok(!/could not be matched/.test(ROW) && ROW.indexOf('\u2019t be matched') === -1,
    'inside a row that reads as noise — the badge carries the meaning');
});

test('GUARD: the review API still selects the fields the row needs', () => {
  const sel = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8')
    .match(/\.select\('id, timestamp_seconds, speaker, quote[^']*'\)/);
  assert.ok(sel, 'review highlights select not found');
  ['handling', 'closer_response', 'closer_response_verified'].forEach((c) => {
    assert.ok(sel[0].indexOf(c) !== -1, 'select must include ' + c);
  });
});
