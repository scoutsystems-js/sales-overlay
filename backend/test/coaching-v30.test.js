/**
 * v30 per-moment coaching.
 *
 * ⚠⚠ THE LOAD-BEARING TEST HERE IS THE CALL-SITE ONE. Testing `coachCallMoments`
 * in isolation proves the function works and says NOTHING about whether the
 * pipeline calls it — this project has shipped a correct, never-invoked function
 * more than once (the dead mount line, the orphaned strip builder, the voice
 * profile wired to nothing). So the arity, the phase and the in-scope arguments
 * are asserted against the real worker source.
 *
 * ⚠ AND THE FOUR HOPS. `closer_response` was SELECTED by every query and dropped
 * by the shaper in the middle, so both ends looked correct and the panel rendered
 * orphan quotes for weeks. `coaching` crosses the same four hops and each one is
 * pinned separately.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../lib/coaching');
const { buildSectionBreakdown } = require('../lib/section-breakdown');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function code(s) {
  // line comments FIRST, then block — a `/*` inside a `//` is a false opener
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('⚠ THE ANCHOR IS RENDERED BY THE CARD, NOT CARRIED IN THE PROSE', () => {
  /* Third attempt at this. As a PROMPT INSTRUCTION it was dropped twice. Assembled
     into the coaching prose it was then removed by the duplicate-stripper — and
     because the card had no timestamp of its own, that strip deleted the ONLY
     timestamp on the surface. It now comes from timestamp_seconds at render, where
     no model and no de-duplicator can reach it. */
  assert.strictEqual(typeof C.coachingOpening, 'undefined',
    'the prose opening must not come back — the card owns the anchor');
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coaching.js'), 'utf8');
  assert.ok(!/function coachingOpening/.test(lib), 'the builder must be gone, not merely unexported');

  const page = code(read('web/dashboard.html'));
  assert.ok(/var ts = m\.timestamp_seconds/.test(page), 'the card must read the timestamp');
  assert.ok(/srk-at/.test(page), 'and render it beside the speaker label');
  const me = code(read('routes/me.js'));
  assert.ok(/timestamp_seconds: \(typeof m\.timestamp_seconds === 'number'\)/.test(me),
    'the route must carry timestamp_seconds to the card');
});

test('⚠ the render-time stripper is GONE — it is what removed the timestamp', () => {
  const page = code(read('web/dashboard.html'));
  assert.ok(!/var coachText/.test(page), 'the duplicate-stripper must not survive');
  const w = code(read('lib/analysis-worker.js'));
  assert.ok(!/opening \+ '\\n\\n'/.test(w), 'the write path must not prepend an opening');
  assert.ok(/coaching: entry\.coaching\.trim\(\)/.test(w), 'it stores the model text as written');
});

test('only coachable moments are selected — and a HANDLED objection is not one', () => {
  const picked = C.selectCoachableMoments([
    { type: 'objection', resolution: 'partial', quote: 'too much' },
    { type: 'objection', resolution: 'handled', quote: 'sorted' },      // a good moment
    { type: 'risk_signal', quote: 'not sure about this' },
    { type: 'barrier', quote: 'lender said no' },
    { type: 'missed_opportunity', quote: 'you skipped it' },
    { type: 'buying_signal', quote: 'when do we start' },               // not to fix
    { type: 'strong_moment', quote: 'nice work' },                      // not to fix
    { type: 'rapport_moment', quote: 'we both ski' },                   // not to fix
    { type: 'objection', resolution: 'partial', quote: '   ' },         // no usable quote
  ]);
  assert.deepStrictEqual(picked.map(p => p.type),
    ['objection', 'risk_signal', 'barrier', 'missed_opportunity']);
});

test('ONE prompt covers EVERY moment — never one call per moment', () => {
  const moments = [
    { time: '00:01:00', quote: 'first thing',  observation: 'a', section: 'close' },
    { time: '00:02:00', quote: 'second thing', observation: 'b', section: 'pitch' },
    { time: '00:03:00', quote: 'third thing',  observation: 'c', section: 'discovery' },
  ].map(m => Object.assign({ closerResponse: null }, m));
  const p = C.buildCoachingPrompt(moments, { outcome: 'follow_up' });
  moments.forEach(m => assert.ok(p.indexOf(m.quote) !== -1, 'missing ' + m.quote));
  assert.ok(/MOMENT 1/.test(p) && /MOMENT 2/.test(p) && /MOMENT 3/.test(p));
  assert.ok(p.indexOf('There are 3 moments below') !== -1);
  // the model returns an array so each piece maps back to its row
  assert.ok(/JSON array/.test(p) && /"moment":1/.test(p));
});

test('the prompt carries the rules Justin ruled on, and they are not optional', () => {
  const p = C.buildCoachingPrompt(
    [{ time: '00:01:00', quote: 'q', observation: 'o', section: 'close', closerResponse: null }],
    { outcome: 'lost' });
  assert.ok(/NEVER INVENT THE PROSPECT/.test(p), 'the never-invent rule');
  assert.ok(/NEVER NAME THE PROSPECT/.test(p), 'why_outcome named the wrong person once');
  assert.ok(/ISOLATION IS CORRECT TECHNIQUE/.test(p), 'Scout coached a rep out of isolating');
  assert.ok(/COACH THE PRINCIPLE, NOT A SCRIPT/.test(p), 'principles, not word tracks');
  assert.ok(/OUTRANKS THE QUOTE/.test(p), 'the observation beats a garbled ASR quote');
  assert.ok(/is this something you would want to do/.test(p), 'commitment, not a date');
  assert.ok(!/when would you want to get started/.test(p), 'the retired phrasing must not return');
});

test('the cost rule follows the OUTCOME, so a closed call is never told it lost the deal', () => {
  const m = [{ time: '00:01:00', quote: 'q', observation: 'o', section: 'close', closerResponse: null }];
  assert.ok(/THIS CALL CLOSED/.test(C.buildCoachingPrompt(m, { outcome: 'closed' })));
  assert.ok(/THIS CALL WAS LOST/.test(C.buildCoachingPrompt(m, { outcome: 'lost' })));
  assert.ok(/STILL OPEN/.test(C.buildCoachingPrompt(m, { outcome: 'follow_up' })));
});

test('⚠ THE PIPELINE ACTUALLY CALLS IT — a function nothing invokes is the recurring failure', () => {
  const w = code(read('lib/analysis-worker.js'));
  assert.ok(/coachingLib = require\('\.\/coaching'\)/.test(w), 'the module must be imported');
  // called from inside analyzeCall, with in-scope identifiers
  /* ⚠ ASSERT THE PROPERTY, NOT THE EXACT ARGUMENT LIST. This pinned the literal
     five-argument call and went stale when `userId` was APPENDED for spend
     logging — a correct change, appended at the END precisely because inserting
     mid-list silently shifts every later argument into the wrong slot. What
     matters is that the pipeline calls it with in-scope identifiers. */
  const call = w.match(/coachCallMoments\(admin, fathomCallId, effectiveOutcome, whyReason, objection && objection\.notes([^)]*)\)/);
  assert.ok(call, 'the call site must pass the pipeline arguments');
  // it must run AFTER persistHighlights — it needs the row ids the insert created
  assert.ok(w.indexOf('persistHighlights(admin, fathomCallId') < w.indexOf('coachCallMoments(admin'),
    'coaching must run after the highlights are persisted');
  // and it must not be awaited — the drain dies on a redeploy
  assert.ok(!/await coachCallMoments/.test(w), 'must not be awaited');
});

test('⚠ ONE model call per CALL — the worker must not loop the coaching call per moment', () => {
  const w = code(read('lib/analysis-worker.js'));
  const site = w.slice(w.indexOf('async function coachCallMoments'));
  const body = site.slice(0, site.indexOf('\nmodule.exports'));
  /* H735: the function now reads the coaching record before the prompt and writes it after each entry — the ceiling moved with it; the property under test (one model call per call) is unchanged. */
  assert.ok(body.length > 400 && body.length < 6500, 'slice must cover the function: ' + body.length);
  /* ⚠⚠ COUNT BOTH FORMS. This counted `messages.create(` only, and the call now
     goes through the spend-logging seam — so after that change it counted ZERO
     and would have SILENTLY STOPPED GUARDING the rule it exists for. A guard
     that quietly measures nothing is worse than one that fails. */
  const calls = (body.match(/messages\.create\(|createWithUsage\(/g) || []).length;
  assert.strictEqual(calls, 1, 'exactly one model call for the whole set, got ' + calls);
});

test('⚠ FOUR HOPS — coaching is selected, shaped, mapped and rendered', () => {
  const me = code(read('routes/me.js'));
  assert.ok(/closer_response_verified, coaching'\)/.test(me), 'hop 1: the SELECT');
  assert.ok(/coaching: m\.coaching \|\| null/.test(me), 'hop 3: the route moment map');

  const sb = code(read('lib/section-breakdown.js'));
  assert.ok(/coaching: h\.coaching \|\| null/.test(sb), 'hop 2: the shaper — where closer_response was lost');

  const page = code(read('web/dashboard.html'));
  assert.ok(/srk-coach/.test(page), 'hop 4: the renderer');
});

test('hop 2 in ACTION — the shaper really carries it onto the moment', () => {
  const bd = buildSectionBreakdown('close', {
    analyses: [{ fathom_call_id: 'c1' }],
    highlights: [{ fathom_call_id: 'c1', section: 'close', type: 'objection', resolution: 'partial',
                   speaker: 'PROSPECT', quote: 'too much', observation: 'o',
                   coaching: 'At 00:01:00 the prospect said: "too much"\n\ncoach text' }],
    callMeta: {},
  });
  const m = (bd.bad || [])[0];
  assert.ok(m, 'the moment must reach the bad group');
  assert.ok(/coach text/.test(m.coaching), 'the shaper must copy coaching onto the moment');
});

test('the version bump landed and marks the coaching release', () => {
  const w = read('lib/analysis-worker.js');
  assert.ok(/ANALYSIS_PROMPT_VERSION = 'v47-2026-09-05'/.test(w));
  assert.ok(/ONE CALL PER CALL, COVERING ALL ITS MOMENTS/.test(w), 'the ruling must travel with the bump');
});
