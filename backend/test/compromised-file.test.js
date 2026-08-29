/**
 * COMPROMISED FILES ARE NOT GRADED (Justin's ruling 2026-08-29).
 *
 * A transcript carrying one distinct speaker across a substantial conversation
 * is unreadable as a sales call, and the grader scores it anyway — measured on
 * live data at 71, 47, 32, and a 100-minute Fathom call at 60. This pins the
 * rule, the floor, the reuse of the single exclusion flag, and the guard that
 * stops the detection overruling a person.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cf = require('../lib/compromised-file');

const turns = (n, speakers, chars) => Array.from({ length: n }, (_, i) => ({
  speaker: Array.isArray(speakers) ? speakers[i % speakers.length] : speakers,
  text: 'x'.repeat(Math.ceil(chars / n)),
}));

test('a substantial single-speaker transcript is compromised', () => {
  // the three live Zoom cases that carried confident scores
  [35146, 13641, 10678].forEach(c => {
    assert.strictEqual(cf.assessTranscript(turns(1, 'Godwin Ona', c)).compromised, true, c + ' chars');
  });
  // and the worst one in the corpus is FATHOM, not Zoom — the fault is not
  // provider-specific and nothing in the rule may become so
  assert.strictEqual(cf.assessTranscript(turns(200, 'CLOSER', 56825)).compromised, true);
});

test('a SHORT single-speaker call is a short call, not a compromised file', () => {
  // the live tail: voicemails, no-shows and test meetings
  [1179, 1108, 878, 206, 83, 21].forEach(c => {
    assert.strictEqual(cf.assessTranscript(turns(1, 'Josh', c)).compromised, false, c + ' chars');
  });
});

test('the floor sits INSIDE the empty band, not on a data point', () => {
  // largest short call 1179 | smallest substantial 4731 — nothing between them
  assert.ok(cf.MIN_COMPROMISED_CHARS > 1179, 'floor must clear the largest short call');
  assert.ok(cf.MIN_COMPROMISED_CHARS < 4731, 'floor must admit the smallest substantial one');
});

test('a healthy two-sided call is never touched, however long', () => {
  assert.strictEqual(cf.assessTranscript(turns(400, ['CLOSER', 'PROSPECT'], 90000)).compromised, false);
  assert.strictEqual(cf.assessTranscript(turns(2, ['CLOSER', 'PROSPECT'], 2400)).compromised, false);
});

test('no attribution at all is ONE unidentified voice, not zero speakers', () => {
  const r = cf.assessTranscript(turns(50, null, 9000));
  assert.strictEqual(r.speakers, 1);
  assert.strictEqual(r.compromised, true);
});

test('an EMPTY transcript is not a compromised file — the worker errors on it first', () => {
  assert.strictEqual(cf.assessTranscript([]).compromised, false);
  assert.strictEqual(cf.assessTranscript([]).speakers, 0);
});

test('total on junk — an analysis must not fail because this could not decide', () => {
  [null, undefined, 'nope', 42, {}, [{}], [{ text: null }]].forEach(v => {
    assert.doesNotThrow(() => cf.assessTranscript(v));
    assert.strictEqual(cf.assessTranscript(v).compromised, false);
  });
});

test('nothing in the rule knows about Zoom, phones or dial-ins', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'compromised-file.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
                  .filter(l => l.trim().indexOf('//') !== 0).join('\n');
  assert.ok(code.length > 400, 'stripped source is too small — the check is not measuring');
  [/zoom/i, /fathom/i, /phone/i, /dial/i, /provider/i].forEach(re => {
    assert.ok(!re.test(code), 'detection must be data-driven, not provider-specific: ' + re);
  });
});

// ── the wiring, which is where this can silently stop working ───────────────
const WORKER = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
const ME = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8');

test('the gate runs BEFORE the Claude calls, so a compromised call is never graded', () => {
  const gate = WORKER.indexOf('fileCheck.compromised');
  const phase6 = WORKER.indexOf('Phase 6: two parallel Claude calls');
  assert.ok(gate > 0 && phase6 > 0, 'anchors stale');
  assert.ok(gate < phase6, 'the compromised-file gate must precede grading');
});

test('it reuses the ONE exclusion flag rather than adding a second path', () => {
  const gate = WORKER.slice(WORKER.indexOf('Phase 5b'), WORKER.indexOf('Phase 6: two parallel'));
  assert.ok(gate.length > 600, 'gate slice is too small — the check is not measuring');
  assert.ok(/not_a_sales_call:\s*true/.test(gate), 'must set the existing exclusion flag');
  assert.ok(/exclusion_reason:\s*'compromised_file'/.test(gate), 'must record the reason');
});

test('the detection NEVER overrules a person', () => {
  const gate = WORKER.slice(WORKER.indexOf('Phase 5b'), WORKER.indexOf('Phase 6: two parallel'));
  assert.ok(/humanSaidItCounts/.test(gate), 'the override guard is missing');
  assert.ok(/not_sales_marked_by/.test(gate), 'the guard must read who marked it');
  assert.ok(/fileCheck\.compromised\s*&&\s*!humanSaidItCounts/.test(gate),
    'the gate must be skipped when a person has said the call counts');
  // an automatic mark must stay distinguishable from a human one, or the guard
  // above cannot tell them apart on the next run
  assert.ok(/not_sales_marked_by:\s*null/.test(gate), 'an automatic mark must leave marked_by NULL');
});

test('a human mark clears the reason in BOTH directions', () => {
  const upd = ME.slice(ME.indexOf("router.post('/calls/:id/not-a-sales-call'"));
  assert.ok(upd.length > 500, 'route slice is too small');
  assert.ok(/exclusion_reason:\s*null/.test(upd),
    'un-marking must clear the reason or the call returns still wearing the badge');
});

test('the customer never sees the mechanism', () => {
  const gate = WORKER.slice(WORKER.indexOf('Phase 5b'), WORKER.indexOf('Phase 6: two parallel'));
  const msg = (gate.match(/var compReason =([\s\S]*?);\n/) || [])[1] || '';
  assert.ok(msg.length > 60, 'could not find the customer message');
  [/speaker/i, /character/i, /transcript/i, /label/i, /null/i].forEach(re => {
    assert.ok(!re.test(msg), 'customer message names a mechanism: ' + re);
  });
  assert.ok(/mark it as a sales call/i.test(msg), 'it must say what they can do');
});

// ── clearing the grade a pre-existing call already carries ─────────────────
test('the refusal CLEARS the stale grade, or the page contradicts itself', () => {
  const gate = WORKER.slice(WORKER.indexOf('Phase 5b'), WORKER.indexOf('Phase 6: two parallel'));
  assert.ok(gate.length > 600, 'gate slice too small — the check is not measuring');
  /* FOUND ON REAL DATA, NOT BY READING: after the first re-analysis the five
     Fathom calls still carried 60/58/26/20/14 and up to 5 highlights, so the
     review page would have shown "this could not be graded" beside a confident
     score drawn from the very transcript it says is unreadable. A brand-new
     call has nothing to clear, which is exactly why it never showed up in the
     original verification. */
  assert.ok(/clearedGradeFields/.test(gate), 'the gate must clear the graded output');
  assert.ok(/call_highlights[\s\S]{0,80}\.delete\(\)/.test(gate),
    'highlights quote speakers we cannot attribute — they must go too');
});

test('a MANUALLY set outcome survives the refusal', () => {
  const gate = WORKER.slice(WORKER.indexOf('Phase 5b'), WORKER.indexOf('Phase 6: two parallel'));
  assert.ok(/outcome_source === 'manual'/.test(gate), 'must read the prior outcome source');
  assert.ok(/clearedGradeFields\(!outcomeIsManual\)/.test(gate),
    "a person's judgement about how the call ended is not derived from the transcript");
  const cf = require('../lib/compromised-file');
  assert.ok('outcome' in cf.clearedGradeFields(true), 'inferred outcome is cleared');
  assert.ok(!('outcome' in cf.clearedGradeFields(false)), 'manual outcome is never cleared');
});

test('ONE definition of the cleared fields, shared with the backfill', () => {
  const cf = require('../lib/compromised-file');
  const f = cf.clearedGradeFields(true);
  // the headline number and every section score must be in it
  ['overall_score', 'intro_score', 'discovery_score', 'pitch_score', 'objection_score',
   'close_score', 'close_score_earned'].forEach(k => {
    assert.ok(k in f, 'clearedGradeFields must clear ' + k);
    assert.strictEqual(f[k], null, k + ' must be cleared to null');
  });
  const backfill = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'mark-compromised-zoom-2026-08-29.js'), 'utf8');
  assert.ok(/clearedGradeFields/.test(backfill),
    'the backfill must share the helper — two hand-written lists drift');
});

/* ── the third exclusion reason: the source is gone ───────────────────────── */
test('a THIRD reason rides the same flag, and each renders its own label', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  function fn(name) {
    const at = html.indexOf('function ' + name + '(');
    assert.ok(at > 0, name + ' is missing — anchor stale');
    const end = html.indexOf('\n  }', at);
    const src = html.slice(at, end + 4);
    assert.ok(src.length > 100 && src.length < 3000, 'slice must cover ' + name + ': ' + src.length);
    return src;
  }
  const api = new Function(fn('exclusionLabel') + '\n' + fn('exclusionTitle')
    + '\nreturn { label: exclusionLabel, title: exclusionTitle };')();

  assert.strictEqual(api.label({ exclusion_reason: 'compromised_file' }), 'Compromised file');
  assert.strictEqual(api.label({ exclusion_reason: null }), 'Not a sales call');
  const sd = api.label({ exclusion_reason: 'source_disconnected' });
  assert.ok(/can.{0,3}t be graded/i.test(sd), 'the third reason needs its own label, got: ' + sd);

  /* ⚠ EACH REASON MUST READ DIFFERENTLY. Three states sharing one label is the
     absent-vs-excluded collapse: a call that CAN never be graded would look
     identical to one a person set aside. */
  const labels = ['compromised_file', 'source_disconnected', null].map(r => api.label({ exclusion_reason: r }));
  assert.strictEqual(new Set(labels).size, 3, 'all three labels must differ: ' + labels.join(' | '));

  // customer language: says what happened AND what they can do, no mechanism
  const t = api.title({ exclusion_reason: 'source_disconnected' });
  assert.ok(/reconnect/i.test(t), 'it must say what they can do');
  [/transcript/i, /provider/i, /null/i, /exclusion/i, /sync_status/i].forEach(re => {
    assert.ok(!re.test(t), 'customer copy names a mechanism: ' + re);
  });
});

test('the exclusion stays ONE flag — the third reason adds no second boolean', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '054_exclusion_reason_source_disconnected.sql'), 'utf8');
  assert.ok(/source_disconnected/.test(sql), 'the migration must allow the new reason');
  assert.ok(/compromised_file/.test(sql), 'and must keep the existing one');
  /* ⚠ A new BOOLEAN would be ~21 more filters that can drift out of step with
     not_a_sales_call. The reason column is never aggregated on. */
  assert.ok(!/add column/i.test(sql), 'no new column — the reason rides the existing one');
});
