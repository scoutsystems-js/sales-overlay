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

test('⚠⚠ /team/missed-signal-pairs: a rep is refused (managers and above); a manager sees their own team\'s pairs, synthetic rows and other teams excluded, sentence attached', async () => {
  assert.strictEqual((await get(appFor('A', 'user'), '/team/missed-signal-pairs?from=2026-08-01T00:00:00Z&to=2026-09-30T00:00:00Z')).status, 403);
  const r = await get(appFor('mgr', 'manager'), '/team/missed-signal-pairs?from=2026-08-01T00:00:00Z&to=2026-09-30T00:00:00Z');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.total_pairs, 1, 'the seed call and the other team never count');
  assert.strictEqual(r.body.reps.length, 1);
  assert.strictEqual(r.body.reps[0].user_id, 'A'); assert.strictEqual(r.body.reps[0].name, 'Ava Reyes');
  const p = r.body.reps[0].pairs[0];
  assert.strictEqual(p.call_id, 'c1'); assert.strictEqual(p.signal.id, 'h1'); assert.strictEqual(p.dq.id, 'h3'); assert.strictEqual(p.gap_seconds, 2205);
  assert.ok(/not explored/.test(p.sentence));
});

test('⚠⚠ ONE renderer, TWO placements: missedPairHtml is called by the review row and by the Team → Coaching panel, never a second implementation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const LIVE = stripComments(src);
  const defs = LIVE.match(/function missedPairHtml\(/g) || [];
  assert.strictEqual(defs.length, 1, 'exactly one renderer');
  const entry = fnBody(LIVE, 'highlightEntryHtml'); const panel = fnBody(LIVE, 'teamMissedHtml');
  assert.ok(/missedPairHtml\(/.test(entry), 'the review row calls it');
  assert.ok(/missedPairHtml\(/.test(panel), 'the coaching panel calls it');
  assert.ok(/key: 'missed',\s*label: 'Missed signals',\s*page: 'team-coaching'/.test(LIVE), 'the panel is registered on team-coaching only');
  assert.ok(/missed:\s*\{\s*flag: 'teamMissedLoading',\s*set: 'teamMissed',\s*url: '\/team\/missed-signal-pairs\?' \+ teamQP\(\)/.test(LIVE), 'the lane');
  assert.ok(/teamMissed:\s*'both'/.test(LIVE), 'lane scope declared');
  const coaching = fnBody(LIVE, 'renderTeamCoaching');
  assert.ok(/loadTeam\('missed'\)/.test(coaching) && /teamMissedHtml\(\)/.test(coaching), 'Team → Coaching kicks the lane and draws the panel');
});

test('⚠ the renderer, executed from the live source: both quotes, both timestamps, the gap, the sentence; escaped; no internal words', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fn = new Function('escapeHtml', 'formatTimestampDisplay', 'clipHref', fnBody(LIVE, 'missedPairHtml') + '\n return missedPairHtml;')(esc, (s) => new Date(s * 1000).toISOString().substr(11, 8), (u, s) => u ? u + '?t=' + s : null);
  const pair = P.findMissedSignalPairs(HL.c1)[0]; pair.sentence = P.pairSentence(pair);
  const html = fn(pair, { recordingUrl: 'https://r/x', title: 'AF | Someone <b>', call_date: '2026-09-02T10:00:00Z' });
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
