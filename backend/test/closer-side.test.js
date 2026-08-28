const test = require('node:test');
const assert = require('node:assert');
const cs = require('../lib/closer-side');
const worker = require('../lib/analysis-worker');

const PROMPT = worker._buildHighlightExtractorPrompt({
  turns: [{ speaker: 'PROSPECT', text: 'How much is it?', start_seconds: 10 }],
  highlights: [],
});

// ─── four states, four values ───────────────────────────────────────────────

test('⚠⚠ the four states of closer_response are DISTINCT values, not three nulls', () => {
  // a verbatim span / __no_reply__ / __moment_is_closer__ / null are four
  // different facts. Collapsing any pair is the absent-vs-excluded failure:
  // "he said nothing", "he is the one talking" and "we could not find it" become
  // indistinguishable, and the first two are findings while the third is a gap.
  assert.notStrictEqual(cs.NO_REPLY, cs.MOMENT_IS_CLOSER);
  assert.strictEqual(cs.SENTINELS.length, 2);
  assert.ok(cs.isSentinel(cs.NO_REPLY));
  assert.ok(cs.isSentinel(cs.MOMENT_IS_CLOSER));
  assert.ok(!cs.isSentinel(null), 'null is the could-not-quote case, not a sentinel');
  assert.ok(!cs.isSentinel(''), 'empty is not a sentinel');
  assert.ok(!cs.isSentinel('I hear you, but the price is the price'), 'a real quote is not a sentinel');
  assert.ok(!cs.isSentinel(undefined) && !cs.isSentinel(7) && !cs.isSentinel({}), 'total on non-strings');
});

test('the prompt names both sentinels EXACTLY as the code matches them', () => {
  // ⚠ A sentinel is a string contract between a PROMPT and a PARSER. If the
  // prompt says one thing and the code matches another, every no-reply is
  // silently stored as an unquotable string and the finding is lost — with
  // nothing failing, because a wrong sentinel is just text.
  assert.ok(PROMPT.indexOf(cs.NO_REPLY) !== -1, 'prompt must use ' + cs.NO_REPLY);
  assert.ok(PROMPT.indexOf(cs.MOMENT_IS_CLOSER) !== -1, 'prompt must use ' + cs.MOMENT_IS_CLOSER);
});

// ─── the wrong-exchange failure ─────────────────────────────────────────────

test('⚠⚠ the prompt says WHICH line counts as the reply, and forbids searching the call', () => {
  // "A rule that silently picks a distant line is how a quote ends up attached
  // to the wrong exchange." A reply lifted from elsewhere reads as evidence and
  // is about something else — worse than no reply, because it is credible.
  const at = PROMPT.indexOf('WHICH LINE COUNTS AS THE REPLY');
  assert.ok(at !== -1, 'the reply must be DEFINED, not left to the model');
  const scope = PROMPT.slice(at, at + 700);
  assert.ok(/SAME EXCHANGE/.test(scope), 'must bound it to the exchange');
  assert.ok(/DO NOT search later in the call/.test(scope), 'must forbid the distant-line failure');
  assert.ok(/treat it as no reply/.test(scope), 'and say what to do instead');
});

test('a CLOSER-spoken moment is told not to go hunting for another of his lines', () => {
  // Measured on real stored moments: of the five types that never carried a
  // reply, strong_moment is 874 CLOSER-spoken vs 58 PROSPECT and
  // missed_opportunity is 463/453. For those the closer's side is the quote —
  // asking for "his reply" is an invitation to fetch an unrelated line.
  const at = PROMPT.indexOf('ALREADY THE CLOSER SPEAKING');
  assert.ok(at !== -1, 'the closer-spoken case must be handled explicitly');
  const scope = PROMPT.slice(at, at + 400);
  assert.ok(scope.indexOf(cs.MOMENT_IS_CLOSER) !== -1);
  assert.ok(/Do NOT go looking for another line/.test(scope));
});

// ─── sentinels must never be treated as quotes ──────────────────────────────

test('⚠⚠ a sentinel is never fed to the quote verifier', () => {
  // labelForQuote() cannot reconstruct "__no_reply__", so without this the
  // verifier records a real finding as a REJECTED QUOTE and counts it against
  // the extractor in resp_rejected — a measurement corrupted by a result.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const live = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = live.indexOf('var respLabel = labelForQuote');
  assert.ok(at !== -1, 'the verifier call must exist');
  const before = live.slice(Math.max(0, at - 400), at);
  assert.ok(/closerSide\.isSentinel\(resp\)/.test(before),
    'the sentinel guard must run BEFORE labelForQuote, not after');
});

test('a sentinel is not stamped closer_response_verified=false either', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const live = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const line = live.split('\n').find((l) => /closer_response_verified = false/.test(l)
    || (/closer_response_verified/.test(l) && /false/.test(l) && /isSentinel/.test(l)));
  assert.ok(line, 'the verified=false site must exist');
  const at = live.indexOf('closer_response_verified = false');
  const around = live.slice(Math.max(0, at - 300), at + 60);
  assert.ok(/isSentinel/.test(around), 'sentinels must be excluded from the false stamp too');
});

// ─── one definition ─────────────────────────────────────────────────────────

test('the sentinel strings are defined ONCE, not written out per consumer', () => {
  // Three consumers agree on these strings: the prompt, the sanitizer and the
  // verifier. Written out three times they drift, and the drift is invisible —
  // a mismatched sentinel is indistinguishable from a closer who said nothing.
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..');
  ['lib/analysis-worker.js'].forEach((f) => {
    const live = fs.readFileSync(path.join(dir, f), 'utf8')
      .split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // The prompt names them (it must — it is instructing a model in prose), but
    // no COMPARISON may hand-roll them.
    assert.ok(!new RegExp("===\\s*'" + cs.NO_REPLY + "'").test(live),
      f + ' compares against a hand-rolled sentinel; use closerSide.isSentinel');
    assert.ok(!new RegExp("===\\s*'" + cs.MOMENT_IS_CLOSER + "'").test(live),
      f + ' compares against a hand-rolled sentinel; use closerSide.isSentinel');
  });
});

// ─── ⚠⚠ THE GUARD THAT WOULD HAVE CAUGHT THE FIRST v29 SHIP ─────────────────

test('⚠⚠ the SANITIZER keeps closer_response for EVERY type — not just the three', () => {
  // THIS IS THE ONE THAT MATTERED. v29 shipped with the prompt asking every type
  // for a reply and the SANITIZER still assigning closerResponse only inside
  // `if (risk_signal||barrier)` and `if (objection)`. The model supplied the
  // value and the pipeline threw it away.
  //
  // ⚠ AND EVERY CHECK PASSED: the token gate read the model's RAW JSON, so it
  // reported 12/12 coverage while a 30-call production re-grade wrote 0 of 137.
  // A measurement taken at the MODEL BOUNDARY cannot see a consumer downstream
  // of it discarding the value. This test runs the real sanitizer instead.
  const types = worker._VALID_HIGHLIGHT_TYPES;
  assert.ok(types.length >= 8, 'the real type list must load');
  const rows = types.map((t) => ({
    timestamp_seconds: 10, speaker: 'PROSPECT',
    quote: 'How much is this going to cost me',
    observation: 'the prospect asked for the price',
    type: t, closer_response: 'Well it depends which package you go with',
  }));
  const out = worker._sanitizeHighlights(rows, 3600);
  assert.strictEqual(out.length, types.length, 'no moment may be dropped');
  const lost = out.filter((o) => !o.closer_response).map((o) => o.type);
  assert.deepStrictEqual(lost, [], 'sanitizer discarded closer_response for: ' + lost.join(', '));
});

test('the sanitizer preserves both sentinels for every type', () => {
  // A sentinel that survives the model and dies in the sanitizer is the same
  // defect one layer down, and it would look identical: an empty column.
  const types = worker._VALID_HIGHLIGHT_TYPES;
  [cs.NO_REPLY, cs.MOMENT_IS_CLOSER].forEach((sent) => {
    const out = worker._sanitizeHighlights(types.map((t) => ({
      timestamp_seconds: 10, speaker: 'PROSPECT', quote: 'a quote that is long enough',
      observation: 'an observation', type: t, closer_response: sent,
    })), 3600);
    const lost = out.filter((o) => o.closer_response !== sent).map((o) => o.type);
    assert.deepStrictEqual(lost, [], sent + ' lost for: ' + lost.join(', '));
  });
});

test('handling stays risk/barrier-only — the hoist must not have widened it too', () => {
  // closer_response became universal; `handling` deliberately did NOT. Two
  // competing "was it dealt with" fields on one row is a bug factory, and
  // `resolution` belongs to objections alone.
  const out = worker._sanitizeHighlights(worker._VALID_HIGHLIGHT_TYPES.map((t) => ({
    timestamp_seconds: 10, speaker: 'PROSPECT', quote: 'a quote that is long enough',
    observation: 'an observation', type: t,
    closer_response: 'some reply', handling: 'deflected', resolution: 'handled',
  })), 3600);
  out.forEach((o) => {
    if (o.type === 'risk_signal' || o.type === 'barrier') assert.strictEqual(o.handling, 'deflected', o.type);
    else assert.strictEqual(o.handling, null, o.type + ' must not carry handling');
    if (o.type === 'objection') assert.strictEqual(o.resolution, 'handled');
    else assert.strictEqual(o.resolution, null, o.type + ' must not carry resolution');
  });
});
