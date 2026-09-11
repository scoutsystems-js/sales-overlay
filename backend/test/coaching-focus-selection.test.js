'use strict';
/* BLOCK 002 (SCOUT-BUILD-SESSION.md): THE COACHING PRIORITY IS THE LOWEST STAGE'S, OR IT IS NOT THE PRIORITY.
   The approved rule: lowest stage → the strongest supported coaching pattern WITHIN that stage → one representative
   call → guidance. A finding from another stage is never presented as the reason the rep needs coaching in the lowest
   one, unless the cited exchange itself carries the located purchase decision (the one cross-stage signal the stored
   data can establish without a new model pass). Executed on the real path the route runs: loadCoachableTeam over a
   fake wire, periodOnly exactly as GET /team/coachable-moments calls it; then the real page renderer in Electron. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { loadCoachableTeam } = require('../lib/coachable-team');
const P = require('../lib/call-period-review');
const R = require('../lib/rep-period-coaching');
const S = require('../lib/stage-eligibility');
const SF = require('../lib/period-stage-facts');
const { fnBody, stripComments } = require('./helpers/strip-comments'), { renderComputed } = require('./helpers/electron-render');

const TURNS = [
  ['PROSPECT', 'I have not looked at what I could invest yet.'], ['CLOSER', 'Let me walk you through the program first.'],
  ['PROSPECT', 'Okay, go ahead.'], ['CLOSER', 'Here is how the first ninety days run.'], ['PROSPECT', 'That makes sense.'],
  ['CLOSER', 'The investment is twelve thousand. Shall we get you started today?'], ['PROSPECT', 'I need to think about it, I am not sure I can manage that right now.'],
  ['CLOSER', 'Understood, what would help you decide?'], ['PROSPECT', 'I will check my numbers this week.'], ['CLOSER', 'Let us talk on Friday then.'] ];
const transcript = TURNS.map((t, i) => ({ speaker: t[0], text: t[1], start_seconds: (i + 1) * 10 }));
const analysisRow = { outcome: 'follow_up', transcript_stored: transcript };
const HASH = P.prepare(analysisRow).hash;
// Two agreeing fact reads locating the purchase decision at turns 6–7 (the shape period-stage-facts.located walks).
const read = { decisions: [{ state: 'undecided', evidence: [{ turn: 6, quote: TURNS[5][1] }, { turn: 7, quote: TURNS[6][1] }], reason: 'The prospect deferred the purchase.' }] };
const stageFacts = { version: SF.VERSION, source_hash: HASH, status: 'checked', decisions: [], reads: [read, read] };
const FINDINGS = {
  close: { section: 'close', move: 'asking for the sale', observation: 'The closer asked for the sale and the prospect deferred without an agreed next step.', recommendation: 'Agree a specific next step when the prospect defers.', turn_ids: [6, 7, 8] },
  discovery: { section: 'discovery', move: 'qualifying financially', observation: 'The closer moved into the program while available resources remained unresolved.', recommendation: 'Establish financial fit before presenting the offer.', turn_ids: [1, 2, 3] },
  discoveryAtDecision: { section: 'discovery', move: 'qualifying financially', observation: 'The closer moved into the program while available resources remained unresolved, and the prospect deferred on affordability.', recommendation: 'Establish financial fit before presenting the offer.', turn_ids: [1, 2, 3, 6, 7] },
  closeOther: { section: 'close', move: 'confirming understanding', observation: 'The closer presented the investment without checking what the prospect had understood.', recommendation: 'Check understanding before asking for the decision.', turn_ids: [4, 5, 6] } };
function record(finding, withFacts) {
  const r = { version: 'call-period-review-v10', source_hash: HASH, kb_hash: 'k', findings: [{ ...finding, moment: 1 }], decisions: [{ moment: 1, verdict: 'approved' }] };
  if (withFacts) r.stage_facts = stageFacts;
  return r;
}
function eligibility(scores) { const sections = Object.fromEntries(S.SECTIONS.map(s => [s, { state: 'evaluated', score: scores[s], grade: S.canonicalGrade(scores[s]) }])); return { summary: { version: S.VERSION, review_version: require('../lib/stage-eligibility-review').VERSION, factual_version: require('../lib/stage-observation-review').VERSION, source_hash: 'src', sections } }; }
const LOW_CLOSE = { intro: 70, discovery: 90, pitch: 70, objection: 70, close: 30 };
// Ten calls (the H768 floor); records land on the named calls, newest first: c1 is the most recent.
function wire(records) {
  const calls = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + (i + 1), user_id: 'r1', call_date: '2026-09-' + String(10 - i).padStart(2, '0') + 'T10:00:00Z', source: 'fathom', recording_url: 'https://fathom.video/calls/1' }));
  return { from: function (table) {
    const q = { ids: null, sel: null, select: s => { q.sel = s; return q; }, in: (_c, v) => { q.ids = v; return q; }, eq: () => q, gte: () => q, lte: () => q, not: () => q, is: () => q, order: () => q, range: () => q,
      then: (resolve, reject) => {
        let out = { data: [], error: null };
        if (table === 'fathom_calls') out = { data: calls, error: null };
        else if (table === 'call_analyses' && /transcript_stored/.test(q.sel || '')) out = { data: (q.ids || []).map(id => ({ fathom_call_id: id, outcome: 'follow_up', why_outcome: null, transcript_stored: transcript })), error: null };
        else if (table === 'call_analyses') out = { data: calls.map(c => ({ fathom_call_id: c.id, status: 'done', outcome: 'follow_up', prospect_name: 'Pat', close_score_earned: 30, stage_eligibility: eligibility(LOW_CLOSE), rep_period_coaching: records[c.id] || null })), error: null };
        return Promise.resolve(out).then(resolve, reject);
      } };
    return q;
  } };
}
async function summary(records) { const out = await loadCoachableTeam(wire(records), ['r1'], '2026-08-12', '2026-09-30', Promise.resolve('k'), { periodOnly: true }); return out.reps[0].period_summary; }

test('A. a rep whose lowest stage is Close gets a Close focus, never the Discovery finding that sits beside it', async () => {
  const s = await summary({ c1: record(FINDINGS.discovery), c2: record(FINDINGS.close) });
  assert.equal(s.section, 'close');
  assert.ok(s.focus, 'a focus exists');
  assert.equal(s.focus.section, 'close'); assert.equal(s.focus.move, 'asking for the sale'); assert.equal(s.focus.support, 'same_section');
  assert.equal(s.patterns[0].section, 'close', 'the focus pattern leads the list');
  assert.equal(s.patterns.length, 2, 'the Discovery finding is still listed — nothing is deleted');
});
test('B. an unrelated Discovery finding on one of the calls cannot become the Close coaching point', async () => {
  const s = await summary({ c1: record(FINDINGS.discovery), c3: record(FINDINGS.discovery, true) });
  assert.equal(s.section, 'close');
  assert.equal(s.focus, null, 'no finding supports the lowest stage');
  assert.equal(s.patterns.length, 1); assert.equal(s.patterns[0].calls, 2, 'the Discovery pattern stays, counted honestly');
  assert.match(s.focus_note, /Close/); assert.match(s.focus_note, /other areas/);
});
test('C. a Discovery finding whose cited exchange carries the located purchase decision CAN support the Close focus', async () => {
  const s = await summary({ c1: record(FINDINGS.discovery, true), c2: record(FINDINGS.discoveryAtDecision, true) });
  assert.ok(s.focus, 'the finding that reaches the decision supports Close');
  assert.equal(s.focus.section, 'discovery'); assert.equal(s.focus.support, 'purchase_decision_in_exchange');
  assert.equal(s.focus.calls, 1, 'only the example that reaches the decision counts — the other Discovery example does not');
  assert.equal(s.focus.example.call_id, 'c2'); assert.deepEqual(s.focus.example.decision_turns, [6, 7]);
  const without = await summary({ c2: record(FINDINGS.discoveryAtDecision) });
  assert.equal(without.focus, null, 'the same cited turns with no located decision on record establish nothing');
});
test('D. a recurring supported pattern in the lowest stage is preferred over a single, newer finding', async () => {
  const s = await summary({ c1: record(FINDINGS.closeOther), c2: record(FINDINGS.close), c4: record(FINDINGS.close) });
  assert.equal(s.focus.move, 'asking for the sale'); assert.equal(s.focus.calls, 2); assert.equal(s.focus.recurring, true);
  assert.equal(s.focus.example.call_id, 'c2', 'the representative example is the most recent supporting call');
});
test('E. one supported finding in the lowest stage is still a focus, and no trend is invented', async () => {
  const s = await summary({ c5: record(FINDINGS.close) });
  assert.ok(s.focus); assert.equal(s.focus.calls, 1); assert.equal(s.focus.recurring, false);
});
test('F. the representative example is the finding itself: same section and move, its quotes located in the stored transcript', async () => {
  const s = await summary({ c2: record(FINDINGS.close) });
  const e = s.focus.example;
  assert.equal(e.section, s.focus.section); assert.equal(e.move, s.focus.move);
  assert.equal(e.observation, FINDINGS.close.observation); assert.equal(e.recommendation, FINDINGS.close.recommendation);
  assert.deepEqual(e.evidence.map(t => t.quote), FINDINGS.close.turn_ids.map(n => TURNS[n - 1][1]));
  assert.ok(e.clip_url, 'the example carries its clip');
});
test('a rep below the ranking floor has no lowest stage and therefore no focus, and says why', async () => {
  const out = await loadCoachableTeam(wire({ c1: record(FINDINGS.close) }), ['r1'], '2026-09-10', '2026-09-10T23:59:59Z', Promise.resolve('k'), { periodOnly: true });
  const s = out.reps[0].period_summary;
  assert.equal(s.section, null); assert.equal(s.focus, null); assert.equal(s.patterns.length, 1, 'the reviewed example is still there');
});

/* THE PAGE: the one open pattern under "Lowest-scoring area" is the focus; with no focus nothing opens and the
   sentence says the coaching below is from other areas. Rendered by the real functions. */
const source = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'), live = stripComments(source);
function example(f, id, extra) { return Object.assign({ call_id: id, call_date: '2026-09-0' + id.slice(1) + 'T12:00:00Z', prospect_name: 'Pat', outcome: 'follow_up', source: 'fathom', clip_url: 'https://fathom.video/calls/1?t=60', evidence: f.turn_ids.map(n => ({ speaker: TURNS[n - 1][0], quote: TURNS[n - 1][1], timestamp_seconds: n * 10 })), decision_turns: [] }, f, extra); }
const calls = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + (i + 1), call_date: '2026-09-' + String(10 - i).padStart(2, '0') + 'T10:00:00Z', analysis_status: 'done', analysis: { stage_eligibility: eligibility(LOW_CLOSE) }, period_review_current: true }));
const window = { from: '2026-09-01', to: '2026-09-10T23:59:59Z' };
function page(reps) {
  const funcs = ['scoreColor', 'ymd', 'dayLabel', 'rangeLabelInclusive', 'coachingRepName', 'coachingRepWorkspaceHtml', 'coachingPeriodWorkspaceHtml', 'coachingPeriodExampleHtml', 'selectCoachingRep'].map(n => fnBody(live, n)).join('\n');
  return '<html><head>' + source.slice(source.indexOf('<style>'), source.indexOf('</style>') + 8) + '</head><body data-view="team-coaching"><main class="page" id="content"></main><script>var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var state={teamCoachable:{reps:' + JSON.stringify(reps) + '}};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(c,u){window.opened=[c,u];}' + funcs + ';document.querySelector("#content").innerHTML=coachingRepWorkspaceHtml(state.teamCoachable.reps);</script></body></html>';
}
const probe = `(()=>{const open=[...document.querySelectorAll('details.coaching-pattern[open]')].map(d=>d.querySelector('summary strong').textContent);return {open,text:document.body.innerText};})()`;
test('the page opens exactly the focus pattern under the lowest-scoring area, and opens nothing when no finding supports it', () => {
  const withFocus = [{ user_id: 'a', name: 'Ava', calls: 10, period_summary: R.summarize(calls, [example(FINDINGS.discovery, 'c1'), example(FINDINGS.close, 'c2')], window) }];
  const r = renderComputed(page(withFocus), probe);
  assert.deepEqual(r.open, ['asking for the sale']);
  assert.match(r.text, /Lowest-scoring area/i); assert.doesNotMatch(r.text, /other areas/);
  const noFocus = [{ user_id: 'a', name: 'Ava', calls: 10, period_summary: R.summarize(calls, [example(FINDINGS.discovery, 'c1')], window) }];
  const n = renderComputed(page(noFocus), probe);
  assert.deepEqual(n.open, [], 'an off-stage pattern is never opened as the lowest stage\'s reason');
  assert.match(n.text, /No reviewed change in Close for these dates/);
  assert.match(n.text, /qualifying financially/i, 'the Discovery finding is still on the page, collapsed');
});
