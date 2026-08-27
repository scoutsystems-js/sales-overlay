/**
 * WHY AN EXTRACTION PRODUCED NOTHING — recorded on the row, not lost to a log.
 *
 * ⚠⚠ THE DEFECT THIS CLOSES WAS THE SILENCE, NOT THE PARSE. A highlight failure
 * is non-fatal by design, so its only trace was a console.warn with no reason
 * and no snippet, in a log that does not survive a restart. What reached the
 * database was a normal graded call with an empty list and nothing saying what
 * happened — which is why 7 of 9 long Zoom calls sat undiagnosed for days.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const hf = require('../lib/highlight-failure');

const WORKER = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');

test('a successful extraction records NOTHING — it is not an error', () => {
  assert.strictEqual(hf.describeHighlightFailure({ text: '[{"a":1}]', parsed: [{ a: 1 }], count: 1 }), null);
});

test('⚠⚠ PARSED CLEANLY WITH ZERO MOMENTS IS NOT A FAILURE, and must not read as one', () => {
  /* A short or one-sided call legitimately has nothing worth flagging. Folding
     this in with the parse failures is the absent-vs-excluded collapse: it makes
     a healthy call look broken and puts a number in front of someone that never
     reaches zero. */
  const r = hf.describeHighlightFailure({ text: '[]', parsed: [], count: 0 });
  assert.match(r, /^no_moments:/);
  assert.ok(!/unparseable|empty_response/.test(r), 'must not be confused with a real failure');
});

test('⚠ NO CONTENT is reported as such, not as unparseable', () => {
  // An empty string fails to parse too — calling it 'unparseable' would send
  // someone looking at output that never existed.
  const r = hf.describeHighlightFailure({ text: '', parsed: null, count: 0 });
  assert.match(r, /^empty_response:/);
});

test('⚠⚠ AN UNPARSEABLE RESPONSE CARRIES THE OUTPUT — a bare label answers nothing', () => {
  // The real defect: a raw newline inside a JSON string. Whoever reads this row
  // must be able to SEE it without re-running the call.
  const broken = '[{"quote":"line one\nline two","observation":"x"}]';
  const r = hf.describeHighlightFailure({ text: broken, parsed: null, count: 0, stopReason: 'end_turn' });
  assert.match(r, /^unparseable:/);
  assert.ok(r.indexOf('line one') !== -1, 'the model output must be in the reason');
  assert.ok(r.indexOf('stop_reason=end_turn') !== -1,
    'stop_reason distinguishes TRUNCATION from malformed content — they look identical and have different fixes');
});

test('the snippet is bounded — a reason must not store a transcript', () => {
  const huge = '[' + 'x'.repeat(50000);
  const r = hf.describeHighlightFailure({ text: huge, parsed: null, count: 0 });
  assert.ok(r.length < hf.SNIPPET + 200, 'reason grew unbounded: ' + r.length);
});

test('⚠⚠ IT IS WRITTEN TO THE DATABASE, NOT THE RETURN VALUE', () => {
  /* The first draft put it beside `highlights_count` in the returned object,
     which reaches no database at all — the column would have stayed empty
     forever while every test passed. Assert it is inside the payload that is
     actually upserted. */
  const i = WORKER.indexOf('var analysisPayload');
  const j = WORKER.indexOf('var upsert = await admin', i);
  assert.ok(i !== -1 && j > i, 'stale anchor for the analysis payload');
  const payload = WORKER.slice(i, j);
  assert.ok(/highlight_error/.test(payload),
    'the reason must be in the upserted payload or the column never populates');
});

test('⚠ WRITE THE NULL — recorded on success too, or absent and fine are the same row', () => {
  const i = WORKER.indexOf('var analysisPayload');
  const j = WORKER.indexOf('var upsert = await admin', i);
  const payload = WORKER.slice(i, j);
  // Assigned unconditionally from the classifier, never inside an if.
  assert.ok(/highlight_error:\s+highlightErrorReason/.test(payload),
    'must write the classifier result directly, including its null');
});

test('the highlight failure stays NON-FATAL — grades still ship', () => {
  const at = WORKER.indexOf('var highlightErrorReason');
  const src = WORKER.slice(at, at + 900);
  assert.ok(!/setAnalysisStatus\([^)]*'error'/.test(src), 'must not turn a highlight failure into a failed analysis');
  assert.ok(!/markFathomCallErrored/.test(src), 'and must not error the call');
});

test('⚠⚠ A PERSIST FAILURE IS RECORDED TOO — a second route to zero highlights', () => {
  /* The parse-time classifier cannot see this one: the extraction SUCCEEDED and
     the write failed. Without it the row reads "extraction fine, no moments",
     which is the opposite of what happened — the same absent-vs-excluded
     collapse that made the Zoom investigation take days. */
  const at = WORKER.indexOf('var persisted = await persistHighlights');
  assert.ok(at !== -1, 'stale anchor: the persist call site moved');
  const src = WORKER.slice(at, at + 900);
  assert.ok(/persisted && persisted\.error/.test(src), 'must check the persist result');
  assert.ok(/highlight_error/.test(src), 'and record it on the row');
  assert.ok(/persist_failed/.test(src), 'labelled distinctly from a parse failure');

  // And the reason must actually leave persistHighlights, or there is nothing to record.
  const pAt = WORKER.indexOf('async function persistHighlights');
  const pSrc = WORKER.slice(pAt, WORKER.indexOf('\n}', pAt));
  assert.ok(/error:\s*'insert failed/.test(pSrc), 'the insert error must travel with the result');
});
