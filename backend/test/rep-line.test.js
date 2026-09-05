/**
 * H734 — THE REP LINE IS THE JUDGEMENT, executed. verifyLine is driven with a line for every rule it enforces;
 * the route is executed on a fake wire with the model seam stubbed, so the line attached to each rep is the
 * one the page draws, and its claim is asserted against the set beneath it. Plants: the evidence link removed
 * (the membership check) → these fail; kept and its answer discarded → these fail.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const muPath = require.resolve('../lib/model-usage');
const realMu = require(muPath);
const captured = []; let reply = () => '{}';
require.cache[muPath].exports = Object.assign({}, realMu, {
  createWithUsage: async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; },
  usageFor: function () { return async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; }; },
  setUsageRecorder: function () {},
});
const RL = require('../lib/rep-line');
const D = require('../lib/doctrine');

const REP = { user_id: 'godwin', name: 'Godwin Ona', calls: 12 };
function item(i, callId, extra) { return Object.assign({ kind: 'objection_unhandled', direction: 'cost', label: 'Objection left unhandled', call_id: callId, call_date: '2026-08-2' + i, outcome: 'lost', prospect_name: 'Marcus Bellweather', moment: { id: 'h' + i, timestamp_seconds: 900 + i, speaker: 'PROSPECT', quote: 'I need to think about the money', closer_response: 'Take your time', closer_response_verified: true, observation: 'The closer let it slide.', resolution: 'unhandled' }, consequence: 'The call did not close.' }, extra || {}); }
const ITEMS = [item(1, 'c1'), item(2, 'c2'), item(3, 'c3'), item(4, 'c4', { kind: 'earned_signal', direction: 'forward', label: 'Buying signal the closer earned', move: 'digging for pain', move_summary: 'two hard questions on the cost of staying' }), item(5, 'c5')];
const SCOPE = D.lossScope([{ fathom_call_id: 'c1', outcome: 'lost' }, { fathom_call_id: 'c2', outcome: 'lost' }, { fathom_call_id: 'c3', outcome: 'lost' }, { fathom_call_id: 'c5', outcome: 'lost' }], [{ fathom_call_id: 'c5', type: 'disqualify_signal' }]);
const good = { kind: 'pattern', judgement: '3 calls where they rolled past a money signal and the deal went nowhere', evidence_ids: ['m1', 'm2', 'm3'], calls_claimed: 3 };

test('⚠⚠ a good line passes and is assembled name — judgement; the evidence and the count are what it opens to', () => {
  const v = RL.verifyLine(good, REP, ITEMS, SCOPE);
  assert.ok(v.ok, v.reason); assert.strictEqual(v.kind, 'pattern');
  assert.strictEqual(v.line, 'Godwin — 3 calls where they rolled past a money signal and the deal went nowhere.');
  assert.deepStrictEqual(v.evidence_ids, ['m1', 'm2', 'm3']); assert.strictEqual(v.calls, 3);
});
test('⚠⚠ EVIDENCED: a cited moment not beneath the line refuses it; a stated number that the evidence does not cover refuses it; one call is not a pattern', () => {
  /* the count would PASS here (2 stated, 2 real calls among m1,m9's real neighbour) — only the membership check can refuse it,
     so a plant that removes or discards that check produces a line citing a moment that is not beneath it */
  const ghost = RL.verifyLine(Object.assign({}, good, { judgement: '2 calls where they rolled past a money signal', evidence_ids: ['m1', 'm2', 'm9'], calls_claimed: 2 }), REP, ITEMS, SCOPE);
  assert.ok(!ghost.ok && /not beneath it: m9/.test(ghost.reason), 'a cited moment that is not beneath the line refuses it for THAT reason: ' + JSON.stringify(ghost));
  assert.match(RL.verifyLine(Object.assign({}, good, { evidence_ids: ['m1', 'm2'] }), REP, ITEMS, SCOPE).reason, /states 3 but the evidence covers 2/);
  assert.match(RL.verifyLine(Object.assign({}, good, { judgement: 'three calls where they rolled past a money signal', evidence_ids: ['m1', 'm2'] }), REP, ITEMS, SCOPE).reason, /states 3/, 'number words count too');
  assert.match(RL.verifyLine(Object.assign({}, good, { calls_claimed: 4 }), REP, ITEMS, SCOPE).reason, /claims 4/);
  assert.match(RL.verifyLine(Object.assign({}, good, { judgement: 'rolled past a money signal', evidence_ids: ['m1'] }), REP, ITEMS, SCOPE).reason, /one call is a restatement/);
  assert.ok(!RL.verifyLine(Object.assign({}, good, { evidence_ids: [] }), REP, ITEMS, SCOPE).ok, 'no evidence, no line');
});
test('⚠⚠ THE DOCTRINE, in code: no word track, never the prospect\'s name, no "but" after a number, a DQ call never a loss, never out of isolating; a strength line carries no subtracting clause', () => {
  const j = (s, extra) => RL.verifyLine(Object.assign({}, good, { judgement: s }, extra || {}), REP, ITEMS, SCOPE);
  assert.match(j('3 calls where they should have said "money aside, is this what you want?"').reason, /word track/);
  assert.match(j('3 calls where they let Marcus talk them out of the price').reason, /names the prospect/);
  /* the live false positive (2026-09-05): a name field reading "Prospect" or "Unknown prospect" is a placeholder, and "the prospect" in a judgement is not a name */
  const PLACEHOLDER = ITEMS.map((it) => Object.assign({}, it, { prospect_name: 'Unknown prospect' }));
  assert.ok(RL.verifyLine(Object.assign({}, good, { judgement: '3 calls where they drew out the prospect\'s own frame on cost' }), REP, PLACEHOLDER, SCOPE).ok, 'a placeholder name never trips the check');
  assert.deepStrictEqual(RL._nameTokens(PLACEHOLDER), []); assert.deepStrictEqual(RL._nameTokens(ITEMS.slice(0, 1)), ['Marcus', 'Bellweather']);
  /* the live unparseable shape: reasoning after the JSON and a revised object — the LAST balanced object is read */
  const revised = RL._extractJson('```json\n{"kind":"pattern","judgement":"3 calls where x","evidence_ids":["m1","m2","m3"],"calls_claimed":2}\n```\n\nWait, let me recount {m1, m2}.\n\n```json\n{"kind":"pattern","judgement":"2 calls where y","evidence_ids":["m1","m2"],"calls_claimed":2}\n```');
  assert.strictEqual(revised && revised.judgement, '2 calls where y', 'the revision is what is read');
  assert.strictEqual(RL._extractJson('Looking at the moments: {m1 is fine} then {"kind":"none"}').kind, 'none', 'prose braces do not break it');
  assert.match(j('3 calls closed cleanly but the follow-ups slipped').reason, /subtracting clause/);
  assert.match(j('3 calls where they deflected an early signal and the prospect disqualified themselves, Godwin Ona').reason, /names the closer/, 'the live defect of 2026-09-05: the closer\'s own name appended');
  assert.ok(RL.verifyLine(good, Object.assign({}, REP, { line_name: 'Godwin Ona' }), ITEMS, SCOPE).line.indexOf('Godwin Ona — ') === 0, 'the board name is used where the first name is ambiguous');
  assert.match(RL.verifyLine({ kind: 'strength', judgement: 'strong discovery on every call, though the closes were soft', evidence_ids: ['m1', 'm2'], calls_claimed: 2 }, REP, ITEMS, SCOPE).reason, /subtracting clause/);
  assert.match(j('2 calls where they lost the deal after the money came up', { evidence_ids: ['m1', 'm5'], calls_claimed: 2 }).reason, /disqualified prospect as a loss/, 'c5 carries a DQ');
  assert.ok(j('2 calls where they lost the deal after the money came up', { evidence_ids: ['m1', 'm2'], calls_claimed: 2 }).ok, 'the same words on two real losses stand');
  assert.match(j('3 calls where, instead of isolating, they should have answered the objection').reason, /isolating/);
  assert.strictEqual(RL.verifyLine({ kind: 'none' }, REP, ITEMS, SCOPE).kind, 'none', 'silence is an answer');
});
test('⚠ the prompt carries the moments by id, the doctrine block, the team material, never the prospect\'s name, and tells a DQ call as disqualified', () => {
  const material = { hasMaterial: true, contextText: 'TEAM MATERIAL: the offer', notes: { text: '1. On this team, isolate twice.' }, doctrineBlock: (lane) => 'SCOUT\'S METHOD for ' + lane };
  const p = RL.buildRepLinePrompt(REP, ITEMS, material, { lossScope: SCOPE, doctrineBlock: material.doctrineBlock('rep-line') });
  assert.ok(/\[m1\]/.test(p) && /\[m5\]/.test(p) && /SCOUT'S METHOD for rep-line/.test(p) && /TEAM MATERIAL: the offer/.test(p) && /MANAGER NOTES/.test(p));
  assert.ok(p.indexOf('Marcus') === -1 && p.indexOf('Bellweather') === -1, 'the prospect is never named to the model');
  assert.ok(/\[m5\][^\n]*Disqualified \(the prospect could not buy/.test(p) && /\[m1\][^\n]*outcome: Lost/.test(p), 'a DQ call is told as disqualified, a real loss as lost');
  assert.ok(/the move that earned it: digging for pain/.test(p), 'the arc move rides on an earned signal');
  assert.ok(Array.isArray(D.LANE_KEYS['rep-line']) && D.LANE_KEYS['rep-line'].length >= 8, 'the lane reads the doctrine');
});

/* ── the route, executed ── */
const P = { mgr: { user_id: 'mgr', role: 'manager', managed_by: null, niche: 'Sober living', offer: 'Team offer: the blueprint, long enough to count as material', qualifications: 'TEAM QUALIFICATIONS: 10k saved', script_raw: null, team_name: 'SLR' },
            godwin: { user_id: 'godwin', role: 'user', managed_by: 'mgr', first_name: 'Godwin', last_name: 'Ona' } };
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
function calls() { return ['c1', 'c2', 'c3'].map((id, i) => ({ id: id, fathom_call_id: id, user_id: 'godwin', title: 'T', call_date: '2026-08-2' + (i + 1) + 'T10:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null })); }
function fakeAdmin(writes) {
  return { from(table) {
    const ch = { f: {}, _in: null, _op: 'select', _p: null, select() { return ch; }, upsert(p) { ch._op = 'upsert'; ch._p = p; return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, is() { return ch; }, not() { return ch; }, gte() { return ch; }, lte() { return ch; }, order() { return ch; }, range() { return ch; }, limit() { return ch; },
      maybeSingle() { if (table === 'user_profiles') return Promise.resolve({ data: P[ch.f.user_id] ? Object.assign({}, P[ch.f.user_id]) : null, error: null }); return Promise.resolve({ data: null, error: null }); },
      then(res, rej) {
        if (ch._op === 'upsert') { writes.push({ table, row: ch._p }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let rows = [];
        if (table === 'user_profiles') rows = Object.values(P).filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]));
        else if (table === 'fathom_calls') rows = calls();
        else if (table === 'call_analyses') rows = [{ fathom_call_id: 'c1', outcome: 'lost', prospect_name: 'Marcus' }, { fathom_call_id: 'c2', outcome: 'lost', prospect_name: 'Dana' }, { fathom_call_id: 'c3', outcome: 'closed', prospect_name: 'Lee' }];
        else if (table === 'call_highlights') rows = [
          { id: 'h1', fathom_call_id: 'c1', type: 'objection', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', timestamp_seconds: 900, quote: 'I need to think about the money', observation: 'o', closer_response: 'ok', closer_response_verified: true },
          { id: 'h2', fathom_call_id: 'c2', type: 'objection', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', timestamp_seconds: 950, quote: 'That is more than I expected', observation: 'o', closer_response: 'ok', closer_response_verified: true },
          { id: 'h3', fathom_call_id: 'c3', type: 'objection', resolution: 'handled', section: 'close', speaker: 'PROSPECT', timestamp_seconds: 980, quote: 'Let me check with my wife', observation: 'o', closer_response: 'Is she the only thing?', closer_response_verified: true }];
        else if (table === 'knowledge_base' && ch.f.category === 'doctrine') rows = DOCTRINE_ROWS;
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  }, auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'godwin', email: 'godwin@x' }, { id: 'mgr', email: 'm@x' }] } }) } } };
}
async function runRoute() {
  const team = require('../routes/team');
  const l = team.stack.find((x) => x.route && x.route.path === '/coachable-moments');
  const handler = l.route.stack[l.route.stack.length - 1].handle;
  return new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; Promise.resolve().then(() => handler({ user: { id: 'mgr', email: 'm@x' }, query: {} }, res)).catch((e) => resolve({ code: 'threw', body: String(e && e.stack) })); });
}
test('⚠⚠ THE ROUTE, EXECUTED: each rep carries a line whose evidence is beneath it and whose count matches; the cache is written; nothing on file → no model call', async () => {
  const team = require('../routes/team'); const writes = []; team._setAdminClientForTests(() => fakeAdmin(writes));
  captured.length = 0;
  reply = () => JSON.stringify({ kind: 'pattern', judgement: '2 calls where they let a money hesitation sit and the call did not close', evidence_ids: ['m1', 'm2'], calls_claimed: 2 });
  const r = await runRoute();
  assert.strictEqual(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  const g = r.body.reps.find((x) => x.user_id === 'godwin');
  assert.ok(g && g.items.length === 3, 'three moments beneath: ' + JSON.stringify(g && g.items.length));
  assert.strictEqual(captured.length, 1, 'one model call for the one rep with moments (the manager has none)');
  assert.strictEqual(g.line.kind, 'pattern'); assert.strictEqual(g.line.line, 'Godwin — 2 calls where they let a money hesitation sit and the call did not close.');
  assert.deepStrictEqual(g.line.evidence_ids, ['m1', 'm2']); assert.strictEqual(g.line.calls, 2);
  assert.ok(writes.some((w) => w.table === 'objection_synthesis_cache' && w.row.synthesis_type === 'rep_line' && w.row.user_id === 'godwin'), 'cached on the synthesis cache');
  assert.ok(g.loss_scope === undefined, 'internals stay off the wire');
  // the claim against the set beneath it — the model cites a moment that is not there
  captured.length = 0; reply = () => JSON.stringify({ kind: 'pattern', judgement: '2 calls where they let a money hesitation sit', evidence_ids: ['m1', 'm2', 'm7'], calls_claimed: 2 });
  team._setAdminClientForTests(() => fakeAdmin([]));
  const r2 = await runRoute(); const g2 = r2.body.reps.find((x) => x.user_id === 'godwin');
  assert.strictEqual(g2.line.kind, 'refused', 'a line whose evidence is not beneath it is refused: ' + JSON.stringify(g2.line));
  assert.match(String(g2.line.reason), /not beneath it: m7/, 'for that reason — the count alone would have passed');
  assert.strictEqual(g2.line.line, RL.REFUSED_COPY);
  // nothing on file: no model call, the one shape
  const saved = P.mgr; P.mgr = Object.assign({}, saved, { offer: null, qualifications: null, niche: null });
  try { captured.length = 0; team._setAdminClientForTests(() => fakeAdmin([])); const r3 = await runRoute(); assert.strictEqual(captured.length, 0); assert.strictEqual(r3.body.no_material, true); assert.strictEqual(r3.body.reps.find((x) => x.user_id === 'godwin').line.kind, 'no_material'); }
  finally { P.mgr = saved; }
});
test('⚠ the panel draws one collapsed row per rep with the line as the head, the cited moments first, and toggles by state (executed from the page source)', () => {
  const fs = require('fs'); const path = require('path'); const { stripComments, fnBody } = require('./helpers/strip-comments');
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const src = fnBody(LIVE, 'repLineRowHtml') + '\n' + fnBody(LIVE, 'teamCoachableHtml');
  const state = { teamCoachable: { reps: [{ user_id: 'g', name: 'Godwin Ona', calls: 12, items: [{ kind: 'objection_unhandled', moment: { quote: 'A' } }, { kind: 'earned_signal', moment: { quote: 'B' } }], line: { kind: 'pattern', line: 'Godwin — 2 calls where they let it sit.', evidence_ids: ['m2'], calls: 2 } },
    { user_id: 'n', name: 'Nathan', calls: 3, items: [], line: { kind: 'no_items' } }] }, repLineOpen: { g: true } };
  const seen = [];
  const fn = new Function('state', 'escapeHtml', 'coachableItemHtml', 'laneWaitHtml', 'laneProblem', 'laneProblemHtml', 'noMaterialHtml', src + '\nreturn teamCoachableHtml();');
  const html = fn(state, (s) => String(s), (it) => { seen.push(it.moment.quote); return '<i>' + it.moment.quote + '</i>'; }, () => 'WAIT', () => null, () => 'PROBLEM', () => 'NOMAT');
  assert.strictEqual((html.match(/class="rep-line-row/g) || []).length, 2, 'one row per rep');
  assert.ok(/aria-expanded="true"/.test(html) && /aria-expanded="false"/.test(html), 'state drives the open row');
  assert.ok(html.indexOf('<span class="rep-line-name">Godwin</span> — 2 calls where they let it sit.') !== -1, 'the line is the head (H737: the name set apart)');
  assert.ok(/<span class="rep-line-kind">Pattern<\/span>/.test(html), 'the kind is named in a tag, not carried by colour alone');
  assert.deepStrictEqual(seen, ['B', 'A'], 'the cited moment is drawn first'); assert.ok(html.indexOf('Evidence for the line') < html.indexOf('<i>B</i>'));
  assert.ok(/Nathan — no qualifying moments across 3 calls\./.test(html), 'unmeasured is a sentence, never zero');
  assert.ok(/rep-line-body" hidden/.test(html), 'the other row is collapsed');
});
