/**
 * THE MISSED-SIGNAL PAIR, WIRED (H722, Justin's rulings 2026-09-04): ONE renderer, TWO placements —
 * beside the moment on the review page, and on Team → Coaching for managers and above. The sentence
 * is assembled in code from the two ends and the gap, states no principle and asserts no causal link.
 * The floor (five minutes) and the closer-spoken-DQ exclusion hold through every route.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); }, requireSubscription: function (_req, _res, next) { next(); } });
const P = require('../lib/missed-signal-pair');

const H = (o) => Object.assign({ speaker: 'PROSPECT', speaker_verified: true, section: 'discovery', quote: 'q', observation: 'o', closer_response: null, closer_response_verified: null }, o);
// c1: a real pair (36 min) + a flag two minutes before the DQ (under the floor) + a DQ the closer speaks (excluded)
const HL = {
  c1: [H({ id: 'h1', fathom_call_id: 'c1', type: 'risk_signal', handling: 'deflected', timestamp_seconds: 183, quote: 'I invested money in things that did not work out', closer_response: 'I am not just a salesperson', closer_response_verified: true }),
       H({ id: 'h2', fathom_call_id: 'c1', type: 'barrier', handling: 'ignored', timestamp_seconds: 2280, quote: 'my cards are maxed' }),
       H({ id: 'h3', fathom_call_id: 'c1', type: 'disqualify_signal', timestamp_seconds: 2388, quote: 'even 20 grand, I do not have it', section: 'close' }),
       H({ id: 'h4', fathom_call_id: 'c1', type: 'disqualify_signal', timestamp_seconds: 2500, speaker: 'CLOSER', quote: 'our conversation is premature' })],
  cseed: [H({ id: 's1', fathom_call_id: 'cseed', type: 'risk_signal', handling: 'ignored', timestamp_seconds: 10 }), H({ id: 's2', fathom_call_id: 'cseed', type: 'disqualify_signal', timestamp_seconds: 3000 })],
  cz: [H({ id: 'z1', fathom_call_id: 'cz', type: 'risk_signal', handling: 'ignored', timestamp_seconds: 10 }), H({ id: 'z2', fathom_call_id: 'cz', type: 'disqualify_signal', timestamp_seconds: 3000 })],
};
const CALLS = { c1: { id: 'c1', fathom_call_id: 'abc123', user_id: 'A', title: 'AF | Someone', call_date: '2026-09-02T10:00:00Z', recording_url: 'https://r/x', not_a_sales_call: null, duplicate_of: null, duration_seconds: 3600, sync_status: 'processed', exclusion_reason: null },
  cseed: { id: 'cseed', fathom_call_id: 'seed-2026-08-16-1', user_id: 'A', title: 'Seed', call_date: '2026-09-02T10:00:00Z', not_a_sales_call: null, duplicate_of: null },
  cz: { id: 'cz', fathom_call_id: 'zzz', user_id: 'Z', title: 'Elsewhere', call_date: '2026-09-02T10:00:00Z', not_a_sales_call: null, duplicate_of: null } };
const PROFILES = [{ user_id: 'A', managed_by: 'mgr', role: 'user', active: true, first_name: 'Ava', last_name: 'Reyes', team_name: null },
  { user_id: 'mgr', managed_by: null, role: 'manager', active: true, first_name: 'Mia', last_name: null, team_name: 'Team' },
  { user_id: 'Z', managed_by: 'other', role: 'user', active: true, first_name: 'Zed', last_name: null, team_name: null }];
function fakeAdmin() {
  return { auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'A', email: 'ava@x.io' }, { id: 'mgr', email: 'mia@x.io' }, { id: 'Z', email: 'zed@x.io' }] }, error: null }) } },
    from(table) {
      const ch = { f: {}, _in: null, select() { return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, not() { return ch; }, is() { return ch; }, order() { return ch; }, limit() { return ch; }, gte() { return ch; }, lte() { return ch; }, range() { return ch; },
        maybeSingle() { return ch.then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
        then(res, rej) {
          const filt = (list) => list.filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]) && (!ch._in || ch._in[1].indexOf(r[ch._in[0]]) !== -1));
          let rows = [];
          if (table === 'user_profiles') rows = filt(PROFILES.slice());
          else if (table === 'fathom_calls') rows = filt(Object.values(CALLS));
          else if (table === 'call_highlights') rows = filt([].concat(HL.c1, HL.cseed, HL.cz));
          else if (table === 'call_analyses') rows = filt([{ fathom_call_id: 'c1', status: 'done' }]);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        } };
      return ch;
    } };
}

test('⚠ the sentence claims what the data carries: a signal raised, not explored, a disqualification later — never "foreshadowed"', () => {
  const p = P.findMissedSignalPairs(HL.c1)[0];
  const s = P.pairSentence(p);
  assert.ok(/not explored/.test(s), s);
  assert.ok(!/foreshadow|caused|led to|because/.test(s), s);
  assert.ok(/00:03:03/.test(s) && /00:39:48/.test(s) && /36 min/.test(s));
});

test('⚠⚠ the review payload carries the pairs from the ONE builder both review routes use; the floor and the closer-DQ exclusion hold', async () => {
  const fathom = require('../routes/fathom');
  const out = await fathom._loadCallReview(fakeAdmin(), 'c1', 'A');
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.highlights.length, 4, 'every moment still renders');
  assert.strictEqual(out.body.missed_signal_pairs.length, 1, 'one pair: h2 is under the floor, h4 is the closer speaking');
  assert.strictEqual(out.body.missed_signal_pairs[0].signal.id, 'h1');
  assert.strictEqual(out.body.missed_signal_pairs[0].dq.id, 'h3');
  assert.ok(/not explored/.test(out.body.missed_signal_pairs[0].sentence));
});

function appFor(actorId, role) {
  const teamRoutes = require('../routes/team'); teamRoutes._setAdminClientForTests(() => fakeAdmin());
  const a = express(); a.use(express.json());
  a.use(function (req, _res, next) { req.user = { id: actorId, role }; req.userProfileRole = role; next(); });
  a.use('/team', teamRoutes); return a;
}
function get(app, p) { return new Promise((resolve, reject) => { const server = http.createServer(app).listen(0, () => {
  http.get({ port: server.address().port, path: p }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); }).on('error', (e) => { server.close(); reject(e); }); }); }); }

test('⚠⚠ /team/coachable-moments (H726, replaced /team/missed-signal-pairs): a rep is refused; a manager sees every member — the pair as one kind, synthetic rows and other teams excluded, a member with nothing drawn with zero', async () => {
  assert.strictEqual((await get(appFor('A', 'user'), '/team/coachable-moments?from=2026-08-01T00:00:00Z&to=2026-09-30T00:00:00Z')).status, 403);
  assert.strictEqual((await get(appFor('mgr', 'manager'), '/team/missed-signal-pairs?from=2026-08-01T00:00:00Z&to=2026-09-30T00:00:00Z')).status, 404, 'the old section\'s route is gone — one panel');
  const r = await get(appFor('mgr', 'manager'), '/team/coachable-moments?from=2026-08-01T00:00:00Z&to=2026-09-30T00:00:00Z');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.total_items, 1, 'the seed call and the other team never count');
  assert.equal(r.body.followup_priority, undefined, 'follow-up is not hardcoded as the manager priority');
  const names = r.body.reps.map((x) => x.user_id).sort();
  assert.deepStrictEqual(names, ['A', 'mgr'], 'every member returned, the manager included (a team member on every team surface)');
  const a = r.body.reps.find((x) => x.user_id === 'A'); const m = r.body.reps.find((x) => x.user_id === 'mgr');
  assert.strictEqual(a.name, 'Ava Reyes'); assert.strictEqual(a.items.length, 1); assert.deepStrictEqual(m.items, []);
  const it = a.items[0];
  assert.strictEqual(it.kind, 'missed_signal_pair'); assert.strictEqual(it.call_id, 'c1'); assert.strictEqual(it.pair.signal.id, 'h1'); assert.strictEqual(it.pair.dq.id, 'h3'); assert.strictEqual(it.pair.gap_seconds, 2205);
  assert.strictEqual(it.consequence, '36 min later, a disqualification.');
  assert.ok(!/foreshadow|caused|led to|because/.test(JSON.stringify(r.body)));
});

test('⚠⚠ ONE renderer, TWO placements: missedPairHtml is called by the review row and by the Team → Coaching panel, never a second implementation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const LIVE = stripComments(src);
  const defs = LIVE.match(/function missedPairHtml\(/g) || [];
  assert.strictEqual(defs.length, 1, 'exactly one renderer');
  const entry = fnBody(LIVE, 'highlightEntryHtml'); const panel = fnBody(LIVE, 'coachableItemHtml');
  assert.ok(/missedPairHtml\(/.test(entry), 'the review row calls it');
  assert.ok(/missedPairHtml\(/.test(panel), 'the coachable-moments item calls it for a pair');
  assert.ok(!/function teamMissedHtml\(/.test(LIVE) && !/Missed Signals<\/h2>/.test(LIVE), 'missed signals is NOT its own section any more (H726)');
  assert.ok(/key: 'coachable',\s*label: 'Coachable moments',\s*page: 'team-coaching'/.test(LIVE), 'the panel is registered on team-coaching only');
  assert.ok(/coachable:\s*\{\s*flag: 'teamCoachableLoading',\s*set: 'teamCoachable',\s*url: '\/team\/coachable-moments\?' \+ teamQP\(\)/.test(LIVE), 'the lane');
  assert.ok(/teamCoachable:\s*'both'/.test(LIVE), 'lane scope declared');
  const coaching = fnBody(LIVE, 'renderTeamCoaching');
  assert.ok(/loadTeam\('coachable'\)/.test(coaching) && /teamCoachableHtml\(\)/.test(coaching), 'Team → Coaching kicks the lane and draws the panel');
});

test('⚠ the renderer, executed from the live source: both quotes, both timestamps, the gap, the sentence; escaped; no internal words', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fn = new Function('escapeHtml', 'formatTimestampDisplay', 'clipHref', fnBody(LIVE, 'missedPairHtml') + '\n return missedPairHtml;')(esc, (s) => new Date(s * 1000).toISOString().substr(11, 8), (u, s) => u ? u + '?t=' + s : null);
  const pair = P.findMissedSignalPairs(HL.c1)[0]; pair.sentence = P.pairSentence(pair);
  const html = fn(pair, { recordingUrl: 'https://r/x', prospect_name: 'Someone <b>', title: 'AF | Someone', call_date: '2026-09-02T10:00:00Z' });   // H730: the head shows the prospect's NAME
  assert.ok(/I invested money in things that did not work out/.test(html) && /even 20 grand, I do not have it/.test(html));
  assert.ok(/00:03:03/.test(html) && /00:39:48/.test(html) && /36 min/.test(html));
  /* H723: the prose sentence renders in NEITHER placement — the ends are laid out, and the
     sentence repeated them. It stays on the payload as the text form. The guard words stay
     absent in BOTH forms. */
  assert.ok(!/not explored|missed-pair-sentence/.test(html), 'no prose sentence where the ends are laid out');
  assert.ok(!/foreshadow|caused|led to|because/.test(html) && !/foreshadow|caused|led to|because/.test(pair.sentence));
  assert.ok(/&lt;b&gt;/.test(html), 'escaped');
  assert.ok(!/disqualify_signal|risk_signal|handling|gap_seconds/.test(html), 'no field names for a customer');
});

test('⚠ H723 — the block carries NO coloured left border (the swept accent) and its type sits on the scale, not on literals', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const rules = LIVE.match(/^\s*\.missed-pair[a-z-]*(?:\.[a-z-]+)?\s*\{[^}]*\}/gm) || [];
  assert.ok(rules.length >= 10, 'the block rules are present: ' + rules.length);
  rules.forEach((r) => {
    assert.ok(!/border-left/.test(r), 'no left border: ' + r.trim().slice(0, 60));
    assert.ok(!/font-size:\s*\d/.test(r), 'no literal font-size: ' + r.trim().slice(0, 60));
  });
  assert.ok(/\.missed-pair-end \{[^}]*font-size: var\(--fs-body\)/.test(LIVE), 'the quotes sit on the body step');
  assert.ok(/\.missed-pair-reply \{[^}]*font-size: var\(--fs-body\)/.test(LIVE), 'the reply sits on the body step');
});

test('⚠⚠ H723 — Open on the panel names the call\'s OWNER and openCallReview walks the pivot door when the owner differs (executed with stubs)', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const esc = (s) => String(s == null ? '' : s);
  const render = new Function('escapeHtml', 'formatTimestampDisplay', fnBody(LIVE, 'missedPairHtml') + '\n return missedPairHtml;')(esc, (s) => String(s));
  const html = render({ signal: { timestamp_seconds: 1, quote: 'q' }, dq: { timestamp_seconds: 400, quote: 'd' }, gap_seconds: 399 }, { callId: 'c1', ownerUserId: 'rep-1', title: 't' });
  assert.ok(/openCallReview\('c1', 'rep-1'\)/.test(html), 'the panel passes the owner: ' + html.slice(0, 200));
  const pivots = []; const loads = [];
  const state = { me: { user_id: 'mgr' }, viewingUserId: 'mgr', view: 'team-coaching' };
  const open = new Function('state', 'setUser', 'render', 'syncHashFromState', 'loadCallReview', 'window', fnBody(LIVE, 'openCallReview') + '\n return openCallReview;')(state, (u) => { pivots.push(u); state.viewingUserId = u; }, () => {}, () => {}, (id) => loads.push(id), { scrollTo: () => {} });
  open('c1', 'rep-1');
  assert.deepStrictEqual(pivots, ['rep-1'], 'a rep\'s call from a team page pivots first');
  assert.strictEqual(state.view, 'call-review'); assert.deepStrictEqual(loads, ['c1']);
  open('c2', 'mgr');
  assert.deepStrictEqual(pivots, ['rep-1', 'mgr'], 'own call while pivoted to a rep: pivots BACK to self (the review must follow the owner)');
  open('c4', 'mgr');
  assert.deepStrictEqual(pivots, ['rep-1', 'mgr'], 'own call while viewing self: no pivot');
  open('c3');
  assert.deepStrictEqual(pivots, ['rep-1', 'mgr'], 'no owner named: behaves as before (no pivot)');
  assert.ok(/openCallReview\(\\'' \+ escapeHtml\(p\.call_id\) \+ '\\', \\'' \+ escapeHtml\(p\.user_id \|\| ''\)/.test(LIVE), 'the verdict queue passes the owner too');
});

test('⚠ H724 — beside a moment (inline) the block shows only the gap and the disqualification end; the panel form keeps both ends', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const esc = (s) => String(s == null ? '' : s);
  const fn = new Function('escapeHtml', 'formatTimestampDisplay', fnBody(LIVE, 'missedPairHtml') + '\n return missedPairHtml;')(esc, (s) => new Date(s * 1000).toISOString().substr(11, 8));
  const pair = P.findMissedSignalPairs(HL.c1)[0];
  const inline = fn(pair, { inline: true });
  assert.ok(!/I invested money/.test(inline) && !/I am not just a salesperson/.test(inline), 'inline: no signal quote, no reply — that is the row above');
  assert.ok(/even 20 grand/.test(inline) && /36 min/.test(inline) && /00:39:48/.test(inline), 'inline: the gap and the DQ end');
  const panel = fn(pair, { title: 't' });
  assert.ok(/I invested money/.test(panel) && /I am not just a salesperson/.test(panel) && /even 20 grand/.test(panel), 'panel: both ends');
});

test('⚠ H726 — the panel renderer, executed: every kind labelled in plain words, the consequence shown, a rep with nothing drawn with a sentence, no wording-guard words, no field names', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hms = (s) => new Date(s * 1000).toISOString().substr(11, 8);
  const pairFn = new Function('escapeHtml', 'formatTimestampDisplay', fnBody(LIVE, 'missedPairHtml') + '\n return missedPairHtml;')(esc, hms);
  const itemFn = new Function('escapeHtml', 'formatTimestampDisplay', 'missedPairHtml', fnBody(LIVE, 'coachableItemHtml') + '\n return coachableItemHtml;')(esc, hms, pairFn);
  const state = { teamCoachable: { reps: [
    { user_id: 'A', name: 'Ava Reyes', calls: 12, items: [
      { kind: 'missed_signal_pair', direction: 'cost', label: 'Missed signal', call_id: 'c1', user_id: 'A', title: 'AF | Someone', call_date: '2026-09-02', pair: P.findMissedSignalPairs(HL.c1)[0], moment: HL.c1[0], consequence: '36 min later, a disqualification.' },
      { kind: 'earned_signal', direction: 'forward', label: 'Buying signal the closer earned', call_id: 'c2', user_id: 'A', title: 'AF | Other', call_date: '2026-09-01', moment: { timestamp_seconds: 300, speaker: 'PROSPECT', quote: 'You are right, I need to do something' }, move: 'digging for pain', move_summary: 'Built up the pain until he admitted it.', consequence: 'The call closed.' },
    ] },
    { user_id: 'mgr', name: 'Mia', calls: 3, items: [] },
    { user_id: 'new', name: 'Noor', calls: 0, items: [] },
  ] }, repLineOpen: { A: true } };   // H734: the panel is one row per rep; Ava's row open so her moments render
  const panelFn = new Function('state', 'escapeHtml', 'coachableItemHtml', 'laneWaitHtml', 'laneProblem', 'laneProblemHtml', 'noMaterialHtml', fnBody(LIVE, 'repLineRowHtml') + '\n' + fnBody(LIVE, 'teamCoachableHtml') + '\n return function(){return state.teamCoachable.reps.map(repLineRowHtml).join("");};')(state, esc, itemFn, () => 'wait', () => null, () => 'problem', () => 'NOMAT');
  const html = panelFn();
  assert.ok(/Ava Reyes/.test(html) && /Missed signal/.test(html) && /Buying signal the closer earned/.test(html) && /digging for pain/.test(html));
  /* a pair's block IS its consequence (the gap line and the disqualification end) — the item adds no second line, which would say it twice */
  assert.ok(/36 min later/.test(html) && /even 20 grand/.test(html) && /The call closed\./.test(html), 'the consequence, in code');
  assert.strictEqual((html.match(/36 min later/g) || []).length, 1, 'said once');
  assert.ok(/Mia<\/span> — no qualifying moments across 3 calls\./.test(html), 'zero is a measurement (H734: the sentence is the rep\'s row)');
  assert.ok(/Noor<\/span> — no counted calls in this window\./.test(html), 'no calls is a different fact from calls with nothing qualifying');
  assert.ok(/openCallReview\('c2', 'A'\)/.test(html), 'Open names the owner');
  assert.ok(!/foreshadow|caused|led to|because/.test(html));
  assert.ok(!/earned_signal|missed_signal_pair|objection_unhandled|closer_response|gap_seconds/.test(html.replace(/coach-item|missed-pair/g, '')), 'no field names for a customer');
});

test('⚠ H729 — the review lists its moments BY CALL TIME, whatever order the wire returns; the pair still sits beside its own moment', async () => {
  const fathom = require('../routes/fathom');
  const scrambled = fakeAdmin();
  const origFrom = scrambled.from.bind(scrambled);
  scrambled.from = (table) => { const ch = origFrom(table); if (table === 'call_highlights') { const t = ch.then.bind(ch); ch.then = (res, rej) => t((r) => res({ data: (r.data || []).slice().reverse(), error: null }), rej); } return ch; };
  const out = await fathom._loadCallReview(scrambled, 'c1', 'A');
  const ts = out.body.highlights.map((h) => h.timestamp_seconds);
  assert.deepStrictEqual(ts, ts.slice().sort((a, b) => a - b), 'ascending by call time: ' + ts.join(','));
  assert.strictEqual(out.body.highlights[0].id, 'h1');
  assert.strictEqual(out.body.missed_signal_pairs[0].signal.id, 'h1', 'the pair is keyed on the moment, not its position');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  assert.ok(/\.order\('timestamp_seconds', \{ ascending: true \}\)/.test(src), 'the query asks for time order too');
  assert.ok(/\.order\('timestamp_seconds', \{ ascending: true \}\)\.order\('sequence_order', \{ ascending: true \}\)/.test(src), 'time first, the model\'s order only as the tie-break');
});
