/* The manual DQ outcome (2026-08-30). Justin: "when a call is marked as DQ it
   should count in calls analyzed but not obj handling % or closing %."
   These guards pin the ASYMMETRY — counted here, excluded there — because a DQ
   that also disappeared from calls-analyzed would be `not_a_sales_call` wearing
   a new name, and that is exactly what the ruling rejects. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dq = require('../lib/dq-exclusion');
const outcomeTag = require('../lib/outcome-tag');
const prospect = require('../lib/prospect-entity');

test('⚠⚠ the GRADER cannot emit disqualified — the two lists differ on purpose', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const m = worker.match(/const VALID_OUTCOMES = \[([^\]]*)\]/);
  assert.ok(m, "the grader's own VALID_OUTCOMES must exist");
  assert.ok(m[1].indexOf('disqualified') === -1,
    'THE GRADER MUST NOT BE ABLE TO INFER A DQ. It removes the call from the close rate '
    + 'and the handle rate, so a model error would silently let a rep off, or mark them '
    + 'down, with nothing on screen to say so. Whether a prospect was ever winnable turns '
    + 'on things that are not in the transcript — a human states it.');
  assert.ok(outcomeTag.TAGGABLE_OUTCOMES.indexOf('disqualified') !== -1,
    'a human must be able to set it');
  assert.strictEqual(outcomeTag.TAGGABLE_OUTCOMES.length, outcomeTag.VALID_OUTCOMES.length + 1,
    'taggable is the grader list plus exactly one value');
});

test('⚠⚠ a DQ prospect leaves BOTH halves of the close rate', () => {
  const calls = [
    { id: '1', user_id: 'u', prospect_id: 'pA', call_date: '2026-08-01', outcome: 'closed' },
    { id: '2', user_id: 'u', prospect_id: 'pB', call_date: '2026-08-01', outcome: 'lost' },
    { id: '3', user_id: 'u', prospect_id: 'pC', call_date: '2026-08-01', outcome: 'disqualified' },
  ];
  /* ⚠ UPDATED 2026-08-30: DQ now leaves the denominator at TWO levels, and they
     agree. `ratedCallsOnly` drops the CALLS before rollup (used where a call list
     is filtered); `hadAConversation` inside closeRate drops a prospect whose every
     call was a no-show or a DQ (used by the graph and gauge, which do not filter
     the call list). Both are the same ruling — calls TAKEN, not booked — so the
     old "baseline includes it" assertion is no longer true, by design. */
  const shared = prospect.closeRateForCalls(calls, {});
  assert.deepStrictEqual({ c: shared.closed, t: shared.total }, { c: 1, t: 2 },
    'the SHARED computation drops the DQ prospect on its own');

  const after = prospect.rollupProspects(dq.ratedCallsOnly(calls), {}).u;
  assert.deepStrictEqual({ c: after.closed, t: after.total }, { c: 1, t: 2 },
    'the DQ prospect must leave the DENOMINATOR, not just the numerator — otherwise '
    + 'the rep is marked down for a call that could not be won');
  assert.strictEqual(after.pct, 50);
});

test('⚠ a prospect with OTHER calls keeps them — only the DQ call leaves', () => {
  const calls = [
    { id: '1', user_id: 'u', prospect_id: 'pA', call_date: '2026-08-01', outcome: 'disqualified' },
    { id: '2', user_id: 'u', prospect_id: 'pA', call_date: '2026-08-02', outcome: 'closed' },
  ];
  const r = prospect.rollupProspects(dq.ratedCallsOnly(calls), {}).u;
  assert.deepStrictEqual({ c: r.closed, t: r.total }, { c: 1, t: 1 },
    'the same by-construction property the not_a_sales_call filter relies on: a prospect '
    + 'with other calls must not be orphaned by one of them being excluded');
});

test('⚠⚠ THE RATE SITES EXCLUDE IT AND THE COUNT SITES DO NOT', () => {
  /* ⚠ LINE COMMENTS FIRST, THEN BLOCK — a block-comment opener sitting inside a
     `//` line is a FALSE OPENER that pairs with the next real closer and eats
     everything between. Stripping blocks first swallowed a real `require` line
     here and reported a correct file as missing its import. */
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // RATE denominators — every one must apply the shared predicate
  ['lib/prospect-entity.js', 'lib/team-objections.js', 'lib/team-needs-work.js', 'lib/session-analytics.js']
    .forEach((f) => {
      const src = read(f);
      assert.ok(/isDisqualified|ratedCallsOnly/.test(src),
        f + ' computes a rate with a prospect or objection denominator and must exclude DQ calls');
      assert.ok(/require\(['"]\.\/dq-exclusion['"]\)/.test(src),
        f + ' must use the SHARED predicate, not a hand-rolled outcome comparison — '
        + 'two definitions of "excluded" is how they diverge');
    });

  // COUNT sites — the call must remain visible and counted
  const sa = read('lib/session-analytics.js');
  assert.ok(/analyzed: statusCounts\.done/.test(sa),
    'calls-analyzed must stay a raw status count: a DQ call IS work that happened');
  const backlog = read('lib/grading-backlog.js');
  assert.ok(!/disqualified/.test(backlog),
    'the grading backlog must NOT exclude DQ calls — hiding them is the not_a_sales_call '
    + 'behaviour this deliberately is not');
});

test('⚠ the dropdown offers it, and the route accepts only what a human may set', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  /* ⚠ AMENDED 2026-09-03 (H709): the dropdown is DERIVED from the one outcome map, where DQ is a member. */
  assert.ok(/disqualified: 'DQ'/.test(page) && /OUTCOME_ORDER = \['closed', 'follow_up', 'lost', 'no_show', 'disqualified'\]/.test(page) && /OUTCOME_OPTS = OUTCOME_ORDER\.map/.test(page), 'the option must be in the dropdown, through the map');
  const me = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/TAGGABLE_OUTCOMES\.indexOf\(outcome\) === -1/.test(me),
    'the tag route must validate against TAGGABLE, or a human cannot set what the dropdown offers');
});

test('⚠ the manual freeze covers DQ for free — it keys on the SOURCE, not the value', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  assert.ok(/manualLocked = !!\(existingRow\.data && existingRow\.data\.outcome_source === 'manual'\)/.test(worker),
    'the read-before-write guard must key on outcome_source, which makes it value-agnostic — '
    + 'if it ever enumerated outcomes instead, a new value would silently not be frozen and '
    + 're-analysis would clobber a human DQ mark');
  assert.ok(/effectiveOutcome = manualLocked \? existingRow\.data\.outcome : inferredOutcome/.test(worker),
    'the frozen value must be what flows downstream');
});

test('⚠ a DQ call keeps its score, its coaching and its moments — only rates change', () => {
  const tag = require('../lib/outcome-tag');
  // close_score is NOT forced to 100 (that is the closed-call rule) and NOT zeroed
  assert.strictEqual(tag.effectiveCloseScore('disqualified', 42, 100), 42,
    'a DQ call keeps the score it EARNED: the call was still run, and how it was run is '
    + 'still coachable. Forcing or zeroing it would hide real work.');
  assert.strictEqual(tag.effectiveCloseScore('closed', 42, 42), 100, 'the closed-call rule is untouched');

  /* ⚠ AND THE KB HARVEST STILL RUNS ON A DQ CALL — deliberately, and it is the
     same principle as keeping the score. Justin's 2026-08-29 ruling replaced the
     closed-only gate: "there's always a coaching moment you can take from a
     call", with quality held by the proven-closer-line bar rather than by the
     outcome. A DQ prospect was never winnable; the closer's own lines on that
     call are still their lines.
     ⚠ I asserted the opposite first, from a superseded note rather than from the
     source, and the guard caught it. The gate is NOT outcome-gated. */
  const { shouldHarvest } = require('../lib/kb-harvest');
  assert.strictEqual(shouldHarvest('disqualified'), true,
    'a DQ call still has coachable closer lines — the harvest gate is not outcome-gated');
  assert.strictEqual(shouldHarvest('disqualified', true), false,
    'not_a_sales_call still blocks it — that flag hides the call, a DQ does not');
});
