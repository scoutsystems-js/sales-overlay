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

test('closer_response for these types inherits the v14 verbatim contract', () => {
  const r = PROMPT.split('\n').find((l) => l.indexOf('- closer_response:') !== -1 && /risk|barrier|responding to it/i.test(l))
    || PROMPT.split('\n').filter((l) => l.indexOf('- closer_response:') !== -1).pop();
  assert.ok(/contiguous verbatim span|HOW TO QUOTE/.test(r), 'must demand an exact span');
  assert.ok(/null/.test(r), 'must allow null rather than forcing a quote');
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

test('types that carry neither get null for both', () => {
  ['buying_signal', 'strong_moment', 'rapport_moment', 'missed_opportunity', 'disqualify_signal'].forEach((t) => {
    const out = worker._sanitizeHighlights([hl({ type: t, closer_response: 'x y z', handling: 'addressed' })], 3600);
    assert.strictEqual(out[0].handling, null, t);
    assert.strictEqual(out[0].closer_response, null, t);
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

test('closer_response must INCLUDE short interjections, not tidy them out', () => {
  // The version pin lives in ONE place (the tripwire in grader-v11.test.js).
  // What belongs here is the contract this file is about.
  //
  // Measured cause of the failure this fixes: the deflection spans four closer
  // turns, and the model quoted it while dropping "You know what I mean?" from
  // the middle — which HOW TO QUOTE already forbids in the abstract, but which
  // a human transcriber would naturally omit. The span broke and the quote was
  // discarded, leaving the handling verdict with no evidence.
  // v20 (Justin's ruling) supersedes v19 here: rather than teaching the model
  // to keep a long span intact, take the SINGLE SHARPEST LINE. Single-line
  // spans reconstruct reliably; multi-turn ones are where it broke (2 of 3).
  // Seeing the real words beats reading an explanation of why there are none.
  const r = PROMPT.split('\n').filter((l) => l.indexOf('- closer_response:') !== -1).pop();
  assert.ok(/SINGLE SHARPEST LINE, NOT THE FULLEST REPLY/i.test(r), 'v20 ruling missing');
  assert.ok(/rather than stitching several together/i.test(r));
  assert.ok(/interjection/i.test(r), 'the multi-line fallback must still name what gets dropped');
  assert.ok(/A short quote that survives beats a fuller one that does not/i.test(r),
    'must tell it which way to trade off, not just what to avoid');
});

test('the OBJECTION closer_response instruction was not collateral damage', () => {
  // Both blocks contain a line starting "- closer_response: the closer", and a
  // prefix-matching edit overwrote the objection one while leaving the
  // risk/barrier one untouched. Pin both so the next edit cannot repeat it.
  const all = PROMPT.split('\n').filter((l) => l.indexOf('- closer_response:') !== -1);
  assert.strictEqual(all.length, 2, 'expected exactly two closer_response instructions');
  const objection = all[0];
  assert.ok(/answering this objection/i.test(objection), 'the objection instruction must address objections');
  assert.ok(/HOW TO QUOTE/.test(objection), 'and still inherit the verbatim contract');
});

// ─── 8b surface guards ─────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const PANEL = HTML.slice(HTML.indexOf('function renderRiskSignalsHtml'), HTML.indexOf('function renderWhatMatteredHtml'));

test('GUARD: the review API selects the fields the panel needs', () => {
  // Same omission has shipped twice before (Part 1b's `section`, 2b's `id`).
  // Here the panel would render verdicts with no reply and no proof state.
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const sel = src.match(/\.select\('id, timestamp_seconds, speaker, quote[^']*'\)/);
  assert.ok(sel, 'review highlights select not found');
  ['handling', 'closer_response', 'closer_response_verified'].forEach((c) => {
    assert.ok(sel[0].indexOf(c) !== -1, 'select must include ' + c);
  });
});

test('WORDING: the panel never implies it captured everything', () => {
  assert.ok(/Risk signals captured on this call/.test(PANEL), 'must say CAPTURED, not a bare count');
  assert.ok(/not every one/i.test(PANEL) && /Absence here doesn/i.test(PANEL),
    'must state explicitly that absence is not evidence of absence');
});

test('an UNPROVEN reply is never quoted, but its existence is still stated', () => {
  // Withholding silently would read as "he said nothing", which is a different
  // and wrong claim — the verdict already says he replied.
  assert.ok(/closer_response_verified === true/.test(PANEL), 'quoting must require proof');
  assert.ok(/couldn’t be matched to the transcript/.test(PANEL), 'the withheld case must be explained');
});

test('the verdict shows even with no quote at all', () => {
  // The judgement is real whether or not the evidence survived verification.
  const verdictIdx = PANEL.indexOf('rs-verdict');
  const replyIdx = PANEL.indexOf('rs-reply');
  assert.ok(verdictIdx !== -1 && replyIdx !== -1);
  assert.ok(verdictIdx < replyIdx, 'the verdict is built independently of, and before, the reply');
});

test('deflected is the state made visually obvious', () => {
  assert.ok(/is-deflected/.test(PANEL), 'deflected rows must carry their own class');
  assert.ok(/rs-verdict\.deflected/.test(HTML), 'and its own styling');
});

test('the panel is suppressed on a role-inverted call, like 7d', () => {
  assert.ok(/role_inverted === true/.test(PANEL));
});
