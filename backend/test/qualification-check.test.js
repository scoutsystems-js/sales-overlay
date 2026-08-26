// Per-criterion qualification verdicts (Justin's ruling 2026-08-26).
//
// The gap: qualification_covered stored the prospect's disclosure verbatim and
// the rep's criteria already reached the grader, and NOTHING COMPARED THEM.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const qc = require('../lib/qualification-check');

const WORKER = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
const SELLING = fs.readFileSync(path.join(__dirname, '..', 'lib', 'selling-context.js'), 'utf8');

function stripComments(src) {
  const noLine = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}

// A labeller standing in for lib/quote-locate's labelForQuote.
function labellerFrom(map) {
  return (turns, quote) => (map[quote] === undefined ? null : map[quote]);
}

test('null input means NEVER EVALUATED and is not coerced to an empty array', () => {
  // ⚠ These are different facts. [] says "evaluated, this rep has no criteria";
  // null says "never evaluated". Collapsing them loses the distinction the
  // write-the-null rule exists to preserve.
  assert.strictEqual(qc.sanitizeQualificationCheck(undefined), null);
  assert.strictEqual(qc.sanitizeQualificationCheck(null), null);
  assert.strictEqual(qc.sanitizeQualificationCheck('nope'), null);
  assert.deepStrictEqual(qc.sanitizeQualificationCheck([]), []);
});

test('all three verdicts survive — failed and undetermined are NOT the same', () => {
  const out = qc.sanitizeQualificationCheck([
    { criterion: '640 or above credit score', covered: true, verdict: 'failed', evidence: 'about 60 or something' },
    { criterion: '10k saved', covered: true, verdict: 'passed', evidence: 'I have ten grand put away' },
    { criterion: 'not living paycheck to paycheck', covered: true, verdict: 'undetermined', evidence: null },
  ]);
  assert.deepStrictEqual(out.map(e => e.verdict), ['failed', 'passed', 'undetermined']);
});

test('a criterion that was never covered cannot carry a verdict', () => {
  // A prospect who was never asked is not a prospect who failed.
  const out = qc.sanitizeQualificationCheck([
    { criterion: '10k saved', covered: false, verdict: 'failed', evidence: 'invented' },
  ]);
  assert.strictEqual(out[0].verdict, 'undetermined');
  assert.strictEqual(out[0].evidence, null);
});

test('a decided verdict with no quote is downgraded', () => {
  const out = qc.sanitizeQualificationCheck([
    { criterion: '10k saved', covered: true, verdict: 'failed', evidence: null },
  ]);
  assert.strictEqual(out[0].verdict, 'undetermined');
});

test('an unknown verdict string becomes undetermined, and the criterion is KEPT', () => {
  // Dropping it would understate what the closer failed to establish.
  const out = qc.sanitizeQualificationCheck([
    { criterion: '10k saved', covered: true, verdict: 'probably fine', evidence: 'x'.repeat(20) },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].verdict, 'undetermined');
});

test('an entry with no criterion text is dropped — a verdict about nothing is meaningless', () => {
  const out = qc.sanitizeQualificationCheck([{ covered: true, verdict: 'failed', evidence: 'x' }]);
  assert.deepStrictEqual(out, []);
});

test('the array is capped so a pathological profile cannot blow the output budget', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ criterion: 'c' + i, covered: false }));
  assert.strictEqual(qc.sanitizeQualificationCheck(many).length, qc.MAX_CRITERIA);
});

test('VERIFY: the prospect\'s own words are accepted', () => {
  const entries = qc.sanitizeQualificationCheck([
    { criterion: '640 credit', covered: true, verdict: 'failed', evidence: 'about 60 or something' },
  ]);
  const out = qc.verifyQualificationCheck(entries, [], labellerFrom({ 'about 60 or something': 'PROSPECT' }));
  assert.strictEqual(out[0].verdict, 'failed');
  assert.strictEqual(out[0].evidence_verified, true);
  assert.strictEqual(out[0].evidence, 'about 60 or something');
});

test('VERIFY: the CLOSER\'s words downgrade the verdict and the quote is withheld', () => {
  // ⚠ Measured on 349 real calls: 55 of 286 reconstructible qualification quotes
  // are the closer ASKING ("Your credit, is your credit shot?"), not the prospect
  // answering. Deciding on those lets a closer's question disqualify a buyer.
  const entries = qc.sanitizeQualificationCheck([
    { criterion: '640 credit', covered: true, verdict: 'failed', evidence: 'is your credit shot?' },
  ]);
  const out = qc.verifyQualificationCheck(entries, [], labellerFrom({ 'is your credit shot?': 'CLOSER' }));
  assert.strictEqual(out[0].verdict, 'undetermined');
  assert.strictEqual(out[0].evidence, null);
  assert.strictEqual(out[0].evidence_verified, false);
  assert.strictEqual(out[0].covered, true, 'the ground WAS covered — only the verdict is withdrawn');
});

test('VERIFY: an unprovable quote downgrades — it can never CREATE a failure', () => {
  const entries = qc.sanitizeQualificationCheck([
    { criterion: 'c', covered: true, verdict: 'passed', evidence: 'not in the transcript' },
  ]);
  const out = qc.verifyQualificationCheck(entries, [], labellerFrom({}));
  assert.strictEqual(out[0].verdict, 'undetermined');
  // and nothing in the module can turn an undetermined into a failure
  const un = qc.verifyQualificationCheck(
    qc.sanitizeQualificationCheck([{ criterion: 'c', covered: true, verdict: 'undetermined', evidence: null }]),
    [], labellerFrom({}));
  assert.strictEqual(un[0].verdict, 'undetermined');
});

test('VERIFY: a throwing labeller degrades to undetermined rather than crashing the analysis', () => {
  const entries = qc.sanitizeQualificationCheck([
    { criterion: 'c', covered: true, verdict: 'failed', evidence: 'something' },
  ]);
  const out = qc.verifyQualificationCheck(entries, [], () => { throw new Error('boom'); });
  assert.strictEqual(out[0].verdict, 'undetermined');
});

test('hasFailedCriterion requires a VERIFIED failure — one notion of a DQ, not two', () => {
  assert.strictEqual(qc.hasFailedCriterion([{ verdict: 'failed', evidence_verified: true }]), true);
  assert.strictEqual(qc.hasFailedCriterion([{ verdict: 'failed', evidence_verified: false }]), false);
  assert.strictEqual(qc.hasFailedCriterion([{ verdict: 'undetermined', evidence_verified: true }]), false);
  assert.strictEqual(qc.hasFailedCriterion([]), false);
  assert.strictEqual(qc.hasFailedCriterion(null), false);
});

test('the prompt block is emitted ONLY when the rep has criteria on file', () => {
  const live = stripComments(WORKER);
  const at = live.indexOf('function qualificationCheckInstruction');
  assert.ok(at !== -1, 'the instruction builder is missing');
  const end = live.indexOf('\nfunction ', at + 10);
  const src = live.slice(at, end);
  assert.ok(src.length > 400, 'slice must cover the builder: ' + src.length);
  const fn = new Function(src + '\n; return qualificationCheckInstruction;')();
  assert.strictEqual(fn(null), '', 'a rep with no criteria must get NO block');
  assert.strictEqual(fn('   '), '', 'blank criteria must get NO block');
  const out = fn('10k saved, not living paycheck to paycheck, 640 or above credit score');
  assert.ok(out.indexOf('640 or above credit score') !== -1, 'the rep\'s own criteria must be in the block');
  assert.ok(/undetermined/.test(out), 'the third state must be offered');
  assert.ok(/PROSPECT/.test(out), 'the prospect-only evidence rule must be stated');
});

test('nothing hardcodes a threshold — criteria are free text and differ per company', () => {
  const live = stripComments(WORKER) + stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'qualification-check.js'), 'utf8'));
  // "640" may appear only inside the prompt's worked EXAMPLE of comparing, never
  // as a rule. Assert it is not used in a comparison anywhere.
  assert.ok(!/>=\s*640|640\s*<=|credit\w*\s*[<>]/.test(live), 'a threshold is hardcoded — criteria are per-company free text');
});

test('selling-context returns the criteria on EVERY exit path', () => {
  const live = stripComments(SELLING);
  const returns = live.match(/return \{ contextText[^}]*\}/g) || [];
  assert.ok(returns.length >= 3, 'expected 3 return sites, found ' + returns.length);
  returns.forEach(r => assert.ok(/qualifications:/.test(r),
    'a return path omits qualifications — the caller would silently get undefined: ' + r.slice(0, 80)));
});

test('the worker passes the criteria into the grader prompt', () => {
  const live = stripComments(WORKER);
  assert.ok(/buildSectionGraderPrompt\([^)]*\{ qualifications: selling\.qualifications/.test(live),
    'the call site does not pass the criteria — the block would never render');
  assert.ok(/qualification_check: qualCheckOut/.test(live), 'the result is not persisted');
  assert.ok(/verifyQualificationCheck\(qualCheckOut, normalized\.turns, labelForQuote\)/.test(live),
    'the write-time verification is not wired');
});

/* ── Raw control characters in grader JSON ────────────────────────────────────
   Found while running the truncation gate, and PRE-EXISTING — not caused by the
   qualification check. JSON forbids a literal newline inside a string; when the
   model emits one, JSON.parse rejects THE WHOLE RESPONSE and the entire analysis
   fails, not just the offending field.

   ⚠ The cause is one of our own instructions: v25 told the grader to put a blank
   line between paragraphs of follow_up_email. On the longest call in the corpus
   it obliges with TEN literal newlines in that one string. */

const worker = require('../lib/analysis-worker');

test('a literal newline inside a string no longer kills the whole response', () => {
  const broken = '{"a": 1, "follow_up_email": "Linda —\nGreat talking with you.", "outcome": "closed"}';
  assert.throws(() => JSON.parse(broken), 'fixture must genuinely be invalid JSON');
  const out = worker._extractFirstJsonObject(broken);
  assert.ok(out, 'the response should be recovered');
  assert.strictEqual(out.outcome, 'closed');
  assert.strictEqual(out.follow_up_email, 'Linda —\nGreat talking with you.',
    'the paragraph break must be PRESERVED, not stripped');
});

test('tabs and carriage returns are repaired too', () => {
  const out = worker._extractFirstJsonObject('{"a":"x\ty\rz"}');
  assert.strictEqual(out.a, 'x\ty\rz');
});

test('the repair is a NO-OP on healthy responses', () => {
  // A response that already parses cannot contain a raw control character in a
  // string, so the repair can only ever turn a failure into a success.
  const healthy = '{"a":1,"b":"line one\\nline two","c":[{"d":"}"}]}';
  assert.deepStrictEqual(worker._extractFirstJsonObject(healthy), JSON.parse(healthy));
});

test('the repair does not rescue genuinely malformed JSON', () => {
  assert.strictEqual(worker._extractFirstJsonObject('{"a": }'), null);
  assert.strictEqual(worker._extractFirstJsonObject('not json at all'), null);
});

test('the ARRAY extractor gets the same repair — observation/quote are free prose', () => {
  const broken = '[{"quote":"he said\nthen paused","type":"objection"}]';
  assert.throws(() => JSON.parse(broken));
  const out = worker._extractFirstJsonArray(broken);
  assert.ok(Array.isArray(out) && out.length === 1);
  assert.strictEqual(out[0].quote, 'he said\nthen paused');
});
