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

test('the version moved with the prompt', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v18-2026-08-12'/);
});
