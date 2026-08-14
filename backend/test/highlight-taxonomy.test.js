/**
 * Highlight taxonomy split (Justin's ruling 2026-08-12).
 *
 * Scout was detecting the right moments and filing them under the wrong names.
 * On one real call three moments were tagged `objection` and only one was; the
 * best catch on the call — prior financial losses signalling skepticism that
 * could resurface at close — was filed as `rapport_moment`. The detection was
 * right; the vocabulary was too small.
 *
 * GOVERNING DEFINITION: "a true objection only happens after you drop price and
 * ask for the close."
 */
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');
const { highlightGroup } = require('../lib/highlight-section');

const FAKE = { turns: [{ speaker: 'CLOSER', display_name: 'C', text: 'hello there friend', start_seconds: 1 }], highlights: [], closer_name: 'C', speaker_confidence: 'matched' };
const PROMPT = worker._buildHighlightExtractorPrompt(FAKE);

// ─── the prompt contract ───────────────────────────────────────────────────

test('objection is NARROWED to post-price, post-ask resistance', () => {
  // Selector must target the TYPE DEFINITION line. `"objection"` alone also
  // matches the section-list line (objection is a section name too) and the
  // "FOR type=objection" header, so match the definition's dash form.
  const line = PROMPT.split('\n').find((l) => /^\s*"objection"\s+—/.test(l));
  assert.ok(line, 'objection type definition line missing');
  assert.ok(/after/i.test(line) && /price/i.test(line), 'must anchor to price being on the table');
  assert.ok(/close/i.test(line), 'must anchor to the close having been asked for');
  assert.ok(/earlier|before/i.test(line), 'must state that earlier resistance does NOT qualify');
});

test('risk_signal and barrier both exist and are distinguished by attitude vs obstacle', () => {
  const risk = PROMPT.split('\n').find((l) => /^\s*"risk_signal"\s+—/.test(l));
  const barrier = PROMPT.split('\n').find((l) => /^\s*"barrier"\s+—/.test(l));
  assert.ok(risk, 'risk_signal missing');
  assert.ok(barrier, 'barrier missing');
  assert.ok(/doubt|skeptic|attitud/i.test(risk), 'risk_signal must be attitudinal');
  assert.ok(/concrete|external|constraint/i.test(barrier), 'barrier must be concrete/external');
});

test('objection vs barrier is separated by the DECISION TEST, with both worked examples', () => {
  // Two earlier phrasings each improved the canonical case without settling it:
  // post-price timing (both are post-price) and "fact reported vs position
  // taken" (left it 2/3). The operative test is now: could the prospect change
  // it by deciding differently? Stated as an operation with both examples, the
  // way v14 stated the copy operation instead of repeating "verbatim".
  const obj = PROMPT.split('\n').find((l) => /^\s*"objection"\s+—/.test(l));
  const bar = PROMPT.split('\n').find((l) => /^\s*"barrier"\s+—/.test(l));

  assert.ok(/deciding differently|decide their way out/i.test(obj), 'objection must state the decision test');
  assert.ok(/deciding differently|decide their way out/i.test(bar), 'barrier must state the same test in reverse');

  // The worked examples must be present, not just the abstract rule.
  assert.ok(/4,800/.test(obj), 'the canonical objection example must be in the prompt');
  assert.ok(/5,000/.test(bar) && /spouse|sign/i.test(bar), 'the barrier examples must be in the prompt');
});

test('a question is NOT resistance merely for being a question', () => {
  // Justin's sales-manager lens. Manner and timing are the discriminators, and
  // typing a question as resistance requires evidence in HOW it was asked.
  assert.ok(/HOW TO TYPE A QUESTION/.test(PROMPT), 'the question-typing block is missing');
  assert.ok(/NOT resistance/i.test(PROMPT));
  assert.ok(/price break down|logistical question/i.test(PROMPT), 'the benign example must be present');
  assert.ok(/hurry up|impatient|demanding/i.test(PROMPT), 'the red-flag example must be present');
  assert.ok(/prefer the non-resistance reading/i.test(PROMPT), 'ambiguity must default AWAY from resistance');
});

test('rapport is restricted to GENUINE CONNECTION so disclosures stop landing there', () => {
  // The failure that prompted this: "I lost over $300,000" was filed as rapport
  // because the prospect was opening up. Opening up about a fear is a risk
  // signal; rapport is warmth.
  const line = PROMPT.split('\n').find((l) => /^\s*"rapport_moment"\s+—/.test(l));
  assert.ok(/genuine connection/i.test(line));
  assert.ok(/risk_signal/.test(line), 'must point disclosures-of-doubt at risk_signal instead');
});

test('the new types are in the schema vocabulary', () => {
  // The VERSION pin lives in exactly one place — the tripwire in
  // grader-v11.test.js. A second pin here meant every bump had to touch two
  // files, which is how a tripwire quietly becomes a chore people route around.
  assert.ok(worker._VALID_HIGHLIGHT_TYPES.indexOf('risk_signal') !== -1);
  assert.ok(worker._VALID_HIGHLIGHT_TYPES.indexOf('barrier') !== -1);
});

// ─── sanitation ────────────────────────────────────────────────────────────

test('the new types survive sanitisation; unknown types are still dropped', () => {
  const out = worker._sanitizeHighlights([
    { timestamp_seconds: 10, speaker: 'PROSPECT', quote: 'I lost over three hundred thousand dollars', observation: 'o', type: 'risk_signal', section: 'discovery' },
    { timestamp_seconds: 20, speaker: 'PROSPECT', quote: 'the loan only approved five thousand of it', observation: 'o', type: 'barrier', section: 'close' },
    { timestamp_seconds: 30, speaker: 'PROSPECT', quote: 'this is a made up category entirely', observation: 'o', type: 'vibes', section: 'close' },
  ], 3600);
  assert.deepStrictEqual(out.map((h) => h.type), ['risk_signal', 'barrier']);
});

// ─── grouping: where the new types land in the section breakdown ───────────

test('risk_signal and barrier are "what to fix", not "what worked"', () => {
  // They are deal risks. Filing them as wins would put "the prospect lost
  // $300k" under the rep's own good moments.
  assert.strictEqual(highlightGroup({ type: 'risk_signal' }), 'bad');
  assert.strictEqual(highlightGroup({ type: 'barrier' }), 'bad');
});

test('the unchanged types keep their existing grouping', () => {
  assert.strictEqual(highlightGroup({ type: 'buying_signal' }), 'good');
  assert.strictEqual(highlightGroup({ type: 'rapport_moment' }), 'good');
  assert.strictEqual(highlightGroup({ type: 'strong_moment' }), 'good');
  assert.strictEqual(highlightGroup({ type: 'missed_opportunity' }), 'bad');
  assert.strictEqual(highlightGroup({ type: 'objection', resolution: 'handled' }), 'good');
  assert.strictEqual(highlightGroup({ type: 'objection', resolution: 'unhandled' }), 'bad');
});

// ─── the objection-only fields stay objection-only ─────────────────────────

test('resolution and objection_category remain OBJECTION-only', () => {
  // barrier/risk_signal have no "handled" semantics, and the DB CHECK only
  // permits the four objection categories. Letting them through would both
  // violate the constraint and corrupt the handle rate's denominator.
  const out = worker._sanitizeHighlights([
    { timestamp_seconds: 10, speaker: 'PROSPECT', quote: 'the loan only approved five thousand', observation: 'o', type: 'barrier', resolution: 'handled', objection_category: 'logistical' },
  ], 3600);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].resolution, null, 'a barrier is not "handled"');
  assert.strictEqual(out[0].objection_category, null);
});

// ─── v23: three live typing fixes (Justin's screenshot) ───────────────────

test('BARRIER must IMPEDE the purchase, with both live negatives named', () => {
  const bar = PROMPT.split('\n').find((l) => /^\s*"barrier"\s+—/.test(l));
  assert.ok(/IMPEDES the purchase/i.test(bar), 'the operative word is impede');
  // 1. clarifying the deal is not resisting it — same family as
  //    "a question is not an objection".
  assert.ok(/CLARIFYING/i.test(bar) && /545/.test(bar), 'the payment-clarification negative must be present');
  // 2. moving to pay is the opposite of a barrier.
  assert.ok(/credit card/i.test(bar) && /buying_signal/.test(bar), 'the moving-to-pay negative must be present');
  assert.ok(/moves the purchase FORWARD/i.test(bar), 'must state the general rule, not only the examples');
});

test('HANDLING cuts BOTH ways — a challenge is engagement', () => {
  // The mirror of the v18 warmth fix. Scored a pointed challenge as "moved
  // past"; Justin called that response phenomenal.
  const h = PROMPT.split('\n').find((l) => l.indexOf('- handling:') !== -1);
  assert.ok(/warmth, length and sympathy are NOT engagement/i.test(h), 'the original direction must survive');
  assert.ok(/CHALLENGE IS ENGAGEMENT/i.test(h), 'the new direction');
  assert.ok(/taking you a year/i.test(h), 'the worked example must be present');
  assert.ok(/whether the concern was TOUCHED/i.test(h), 'must state the principle behind both directions');
});

test('the UI badges ONLY the types a closer response bears on', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.ok(/var HANDLING_TYPES = \['risk_signal', 'barrier', 'objection'\]/.test(html),
    'badging every type alike is what made the removed panel feel cluttered');
  assert.ok(/No response/.test(html), 'the third state is labelled "No response"');
  assert.ok(/Engaged with/.test(html) && /Moved past/.test(html));
});

test('the standalone risk-signal panel is GONE from the render path', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.strictEqual((html.match(/^  function renderRiskSignalsHtml/gm) || []).length, 0,
    'the panel must not be live — Justin never wanted a second section');
  assert.strictEqual((html.match(/^\s*\+ renderRiskSignalsHtml/gm) || []).length, 0, 'and it must not be called');
  assert.ok(/REMOVED 2026-08-13/.test(html), 'kept commented in place, per the standing convention');
});

test('an unverified reply is absent from the row, with no explanatory noise', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const fn = html.slice(html.indexOf('function highlightEntryHtml'), html.indexOf('function highlightTypeLabel'));
  assert.ok(/closer_response_verified === true/.test(fn), 'quoting requires proof');
  assert.ok(!/couldn’t be matched|could not be matched/.test(fn),
    'the panel\'s explanatory line must NOT be carried into a row — it reads as noise there');
});
