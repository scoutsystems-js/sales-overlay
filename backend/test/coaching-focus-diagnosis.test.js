'use strict';
/* BLOCK 003 (SCOUT-BUILD-SESSION.md): THE STAGE SCORE SAYS WHERE; THE PERIOD'S EVIDENCE SAYS WHY.
   The lowest stage is found by the verified-only stage records (H768 floor). Then every reviewed instance of THAT stage
   in the window is read: the reviewer-classified `move` of each finding is the behaviour identity; distinct calls are
   counted; two calls make a recurring pattern, one call is isolated and never a trend; a low average carried by one call
   is said plainly; nothing supporting the stage is an explicit insufficient state that keeps the stage. Discovery's
   strength comes from the stage record's own work record (context.discovery.areas). Executed on the real path the route
   runs (loadCoachableTeam, periodOnly) and on the real page renderer. */
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
const HASH = P.prepare({ outcome: 'follow_up', transcript_stored: transcript }).hash;
const read = { decisions: [{ state: 'undecided', evidence: [{ turn: 6, quote: TURNS[5][1] }, { turn: 7, quote: TURNS[6][1] }], reason: 'The prospect deferred.' }] };
const stageFacts = { version: SF.VERSION, source_hash: HASH, status: 'checked', decisions: [], reads: [read, read] };
const F = {
  ask: { section: 'close', move: 'asking for the sale', observation: 'The closer asked for the sale and the prospect deferred without an agreed next step.', recommendation: 'Agree a specific next step when the prospect defers.', turn_ids: [6, 7, 8] },
  confirm: { section: 'close', move: 'confirming understanding', observation: 'The closer presented the investment without checking what the prospect had understood.', recommendation: 'Check understanding before asking for the decision.', turn_ids: [4, 5, 6] },
  whyNow: { section: 'discovery', move: 'establishing why now', observation: 'The closer moved to the program without establishing what made a change pressing now.', recommendation: 'Establish why now before presenting.', turn_ids: [1, 2, 3] },
  finance: { section: 'discovery', move: 'qualifying financially', observation: 'The closer moved into the program while available resources remained unresolved.', recommendation: 'Establish financial fit before presenting the offer.', turn_ids: [1, 2, 3] },
  financeAtDecision: { section: 'discovery', move: 'qualifying financially', observation: 'The closer moved into the program while available resources remained unresolved, and the prospect deferred on affordability.', recommendation: 'Establish financial fit before presenting the offer.', turn_ids: [1, 2, 3, 6, 7] } };
function record(findings, withFacts) {
  const list = [].concat(findings || []);
  const r = { version: 'call-period-review-v10', source_hash: HASH, kb_hash: 'k', findings: list.map((f, i) => ({ ...f, moment: i + 1 })), decisions: list.map((_, i) => ({ moment: i + 1, verdict: 'approved' })) };
  if (withFacts) r.stage_facts = stageFacts;
  return r;
}
function eligibility(scores, areas) {
  const sections = Object.fromEntries(S.SECTIONS.map(s => [s, { state: 'evaluated', score: scores[s], grade: S.canonicalGrade(scores[s]) }]));
  const out = { summary: { version: S.VERSION, review_version: require('../lib/stage-eligibility-review').VERSION, factual_version: require('../lib/stage-observation-review').VERSION, source_hash: 'src', sections } };
  if (areas) out.context = { discovery: { areas: areas.map(a => ({ area: a, evidence_turns: [1] })) } };
  return out;
}
const LOW_CLOSE = { intro: 70, discovery: 90, pitch: 70, objection: 70, close: 30 };
const LOW_DISCOVERY = { intro: 70, discovery: 30, pitch: 70, objection: 70, close: 90 };
/* Ten calls (the H768 floor), c1 newest. `perCall[id]` may override scores/areas/record for one call. */
function wire(perCall, base) {
  const calls = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + (i + 1), user_id: 'r1', call_date: '2026-09-' + String(10 - i).padStart(2, '0') + 'T10:00:00Z', source: 'fathom', recording_url: 'https://fathom.video/calls/1' }));
  return { from: function (table) {
    const q = { ids: null, sel: null, select: s => { q.sel = s; return q; }, in: (_c, v) => { q.ids = v; return q; }, eq: () => q, gte: () => q, lte: () => q, not: () => q, is: () => q, order: () => q, range: () => q,
      then: (resolve, reject) => {
        let out = { data: [], error: null };
        if (table === 'fathom_calls') out = { data: calls, error: null };
        else if (table === 'call_analyses' && /transcript_stored/.test(q.sel || '')) out = { data: (q.ids || []).map(id => ({ fathom_call_id: id, outcome: 'follow_up', why_outcome: null, transcript_stored: transcript })), error: null };
        else if (table === 'call_analyses') out = { data: calls.map(c => { const o = (perCall || {})[c.id] || {}; return { fathom_call_id: c.id, status: 'done', outcome: 'follow_up', prospect_name: 'Pat', stage_eligibility: eligibility(o.scores || base || LOW_CLOSE, o.areas), rep_period_coaching: o.record || null }; }), error: null };
        return Promise.resolve(out).then(resolve, reject);
      } };
    return q;
  } };
}
async function focus(perCall, base) { const out = await loadCoachableTeam(wire(perCall, base), ['r1'], '2026-08-12', '2026-09-30', Promise.resolve('k'), { periodOnly: true }); return out.reps[0].period_summary; }

test('A. the same Close weakness on several calls is a recurring pattern; the summary carries its breadth; the example is from that pattern', async () => {
  const s = await focus({ c1: { record: record(F.ask) }, c3: { record: record(F.ask) }, c5: { record: record(F.ask) }, c7: { record: record([]) } });
  assert.equal(s.section, 'close'); assert.equal(s.focus.state, 'pattern');
  assert.equal(s.focus.move, 'asking for the sale'); assert.equal(s.focus.calls, 3); assert.equal(s.focus.recurring, true);
  assert.equal(s.focus.reviewed_calls, 4, 'four reviewed calls where Close counted, one of them with no finding');
  assert.match(s.focus.summary, /Close needs the most attention/); assert.match(s.focus.summary, /Asking for the sale came up in 3 of 4 reviewed Close calls/);
  assert.equal(s.focus.example.call_id, 'c1'); assert.equal(s.focus.example.move, 'asking for the sale');
});
test('B. two Close issues: the more recurrent one is primary, the smaller stays secondary', async () => {
  const s = await focus({ c1: { record: record(F.confirm) }, c2: { record: record(F.ask) }, c4: { record: record(F.ask) } });
  assert.equal(s.focus.move, 'asking for the sale'); assert.equal(s.focus.calls, 2);
  assert.deepEqual(s.focus.secondary.map(x => [x.move, x.calls]), [['confirming understanding', 1]]);
  assert.match(s.focus.summary, /Confirming understanding in 1\./);
});
test('C. one bad call among solid ones: no recurring weakness is claimed, and the low average is named as one call', async () => {
  const solid = { intro: 70, discovery: 90, pitch: 70, objection: 70, close: 75 };
  const s = await focus({ c6: { scores: { ...solid, close: 5 }, record: record(F.ask) } }, solid);
  assert.equal(s.section, 'close', 'mean 68 is still the lowest stage');
  assert.equal(s.focus.state, 'outlier'); assert.equal(s.focus.recurring, false);
  assert.deepEqual(s.focus.outlier, { call_id: 'c6', score: 5, mean_without: 75 });
  assert.match(s.focus.summary, /do not show a consistent Close problem/); assert.match(s.focus.summary, /driven mostly by one call/);
  assert.match(s.focus.summary, /Asking for the sale came up in one call/, 'the isolated finding is still offered, as isolated');
  assert.equal(s.focus.example.call_id, 'c6');
});
test('D. a recurring Discovery weakness beside a recurring Discovery strength: both stated, the strength never displaces the focus', async () => {
  const strong = ['goals', 'current_situation'], weak = ['goals'];
  const per = {}; for (let i = 1; i <= 10; i++) per['c' + i] = { areas: i <= 8 ? strong : weak };
  per.c1.record = record(F.whyNow); per.c2.record = record(F.whyNow); per.c3.record = record(F.whyNow); per.c4.record = record(F.finance); per.c5.record = record([]);
  const s = await focus(per, LOW_DISCOVERY);
  assert.equal(s.section, 'discovery'); assert.equal(s.focus.state, 'pattern'); assert.equal(s.focus.move, 'establishing why now'); assert.equal(s.focus.calls, 3);
  assert.deepEqual(s.focus.secondary.map(x => [x.move, x.calls]), [['qualifying financially', 1]]);
  assert.deepEqual(s.focus.strength.areas, ['goals', 'current_situation'], 'goals on ten calls outranks current situation on eight'); assert.equal(s.focus.strength.calls, 8); assert.equal(s.focus.strength.of, 10);
  assert.match(s.focus.strength.sentence, /Goals and current situation were established in 8 of 10 graded Discovery calls/);
  assert.match(s.focus.summary, /Establishing why now came up in 3 of 5 reviewed Discovery calls/);
});
test('D2. a strength needs two calls and a majority; a lone area is not a strength, and no strength is claimed outside Discovery', async () => {
  const per = {}; for (let i = 1; i <= 10; i++) per['c' + i] = { areas: i === 1 ? ['pain'] : [] };
  per.c1.record = record(F.whyNow);
  assert.equal((await focus(per, LOW_DISCOVERY)).focus.strength, null);
  assert.equal((await focus({ c1: { record: record(F.ask), areas: ['goals'] }, c2: { areas: ['goals'] } })).focus.strength, null);
});
test('E. one reviewed call: an isolated opportunity, never a trend', async () => {
  const s = await focus({ c5: { record: record(F.ask) } });
  assert.equal(s.focus.state, 'isolated'); assert.equal(s.focus.recurring, false); assert.equal(s.focus.calls, 1); assert.equal(s.focus.reviewed_calls, 1);
  assert.match(s.focus.summary, /reviewed calls show no repeated issue/); assert.doesNotMatch(s.focus.summary, /recurring|pattern|consistent/);
  assert.match(s.focus.summary, /Asking for the sale came up in one call/);
});
test('F. nothing reviewed supports the lowest stage: the stage is kept, the state says so, no other stage is substituted', async () => {
  const s = await focus({ c1: { record: record([]) } });
  assert.equal(s.section, 'close'); assert.equal(s.focus.section, 'close'); assert.equal(s.focus.state, 'insufficient');
  assert.equal(s.focus.move, null); assert.equal(s.focus.example, null);
  assert.match(s.focus.summary, /Close is the lowest-scoring area, but there is not yet enough reviewed evidence/);
});
test('G. a Discovery finding without current causal support cannot explain a weak Close; with the located decision in its exchange it can (Block 002, intact)', async () => {
  const without = await focus({ c1: { record: record(F.finance, true) }, c2: { record: record(F.finance) } });
  assert.equal(without.focus.state, 'insufficient'); assert.equal(without.focus.move, null);
  assert.equal(without.patterns.length, 1, 'the Discovery pattern is still listed');
  const withDecision = await focus({ c1: { record: record(F.financeAtDecision, true) } });
  assert.equal(withDecision.focus.support, 'purchase_decision_in_exchange'); assert.equal(withDecision.focus.move, 'qualifying financially');
  assert.equal(withDecision.focus.section, 'close', 'the diagnosed stage'); assert.equal(withDecision.focus.move_section, 'discovery', 'the pattern\'s own stage');
  assert.match(withDecision.focus.summary, /carried into the purchase decision/);
});
test('H. a rep below the ranking floor keeps no stage and no focus; the verified-only population is untouched', async () => {
  const out = await loadCoachableTeam(wire({ c1: { record: record(F.ask) } }), ['r1'], '2026-09-10', '2026-09-10T23:59:59Z', Promise.resolve('k'), { periodOnly: true });
  assert.equal(out.reps[0].period_summary.section, null); assert.equal(out.reps[0].period_summary.focus, null);
  assert.equal(out.reps[0].period_summary.patterns.length, 1);
});

/* THE PAGE: the diagnosis and the strength render under the lowest-scoring area; only the focus pattern opens. */
const source = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'), live = stripComments(source);
function example(f, id) { return Object.assign({ call_id: id, call_date: '2026-09-0' + id.slice(1) + 'T12:00:00Z', prospect_name: 'Pat', outcome: 'follow_up', source: 'fathom', clip_url: 'https://fathom.video/calls/1?t=60', evidence: f.turn_ids.map(n => ({ speaker: TURNS[n - 1][0], quote: TURNS[n - 1][1], timestamp_seconds: n * 10 })), decision_turns: [] }, f); }
function calls(base, areas) { return Array.from({ length: 10 }, (_, i) => ({ id: 'c' + (i + 1), call_date: '2026-09-' + String(10 - i).padStart(2, '0') + 'T10:00:00Z', analysis_status: 'done', analysis: { stage_eligibility: eligibility(base, areas) }, period_review_current: i < 4 })); }
const window = { from: '2026-09-01', to: '2026-09-10T23:59:59Z' };
function page(reps) {
  const funcs = ['scoreColor', 'ymd', 'dayLabel', 'rangeLabelInclusive', 'coachingRepName', 'coachingRepWorkspaceHtml', 'coachingPeriodWorkspaceHtml', 'coachingPeriodExampleHtml', 'selectCoachingRep'].map(n => fnBody(live, n)).join('\n');
  return '<html><head>' + source.slice(source.indexOf('<style>'), source.indexOf('</style>') + 8) + '</head><body data-view="team-coaching"><main class="page" id="content"></main><script>var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var state={teamCoachable:{reps:' + JSON.stringify(reps) + '}};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(c,u){window.opened=[c,u];}' + funcs + ';document.querySelector("#content").innerHTML=coachingRepWorkspaceHtml(state.teamCoachable.reps);</script></body></html>';
}
const probe = `(()=>{const ex=document.querySelector('.coaching-rep-detail > .coaching-period-example [data-call]');const notes=[...document.querySelectorAll('.coaching-period-priority .coaching-period-diagnosis')].map(n=>n.textContent);const advice=(document.querySelector('.coaching-period-priority .coaching-example-next p')||{}).textContent||null;const other=[...document.querySelectorAll('.coaching-other .coaching-period-example [data-call]')].map(b=>b.dataset.call);return {example:ex?ex.dataset.call:null,advice,other,notes,text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth};})()`;
test('the page shows the period diagnosis and the strength beneath the lowest-scoring area, opens only the focus pattern, and says when evidence is insufficient', () => {
  const withPattern = [{ user_id: 'a', name: 'Ava', calls: 10, period_summary: R.summarize(calls(LOW_DISCOVERY, ['goals', 'current_situation']), [example(F.whyNow, 'c1'), example(F.whyNow, 'c2'), example(F.finance, 'c3')], window) }];
  for (const width of [1400, 390]) {
    const r = renderComputed(page(withPattern), probe, { width });
    assert.equal(r.example, 'c2', 'the call example is the primary pattern\'s most recent call (c2 is dated after c1 in this fixture)'); assert.equal(r.advice, F.whyNow.recommendation, 'what to coach is the representative finding\'s recommendation'); assert.deepEqual(r.other, ['c3'], 'the secondary finding is the other coaching, collapsed'); assert.equal(r.overflow, false, 'width ' + width);
    assert.equal(r.notes.length, 2, 'the diagnosis and the strength, nothing else');
    assert.match(r.notes[0], /Discovery needs the most attention\. Establishing why now came up in 2 of 4 reviewed Discovery calls\. Qualifying financially in 1\./);
    assert.match(r.notes[1], /Current situation and goals were established in 10 of 10 graded Discovery calls/);
  }
  const insufficient = [{ user_id: 'a', name: 'Ava', calls: 10, period_summary: R.summarize(calls(LOW_CLOSE), [example(F.finance, 'c1')], window) }];
  const n = renderComputed(page(insufficient), probe);
  assert.equal(n.example, null); assert.equal(n.advice, null); assert.equal(n.notes.length, 1); assert.match(n.text, /No reviewed call in Close to show for these dates/);
  assert.match(n.notes[0], /Close is the lowest-scoring area, but there is not yet enough reviewed evidence/);
  assert.deepEqual(n.other, ['c1'], 'the off-stage finding stays on the page, under the collapsed other coaching');
});
