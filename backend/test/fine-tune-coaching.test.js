'use strict';
/* ⚠⚠ FINE TUNE COACHING (Justin, 2026-09-02) — Add-to-Knowledge-Base from the
   other end: a manager corrects a piece of coaching, Scout extracts the concept,
   the manager confirms it, and it is stored in the team KB where the coaching
   lane reads it as a heavily weighted example. THE TEST THAT DECIDES WHETHER
   THIS WORKS IS THE ISOLATION REPLAY: a stored concept saying isolating is
   correct on this team must CHANGE the coaching output for a test moment, on a
   checkable field. The model is stubbed at the module edge; the stub answers
   from what it is asked, so the test proves the PROMPT carries the note and the
   WORKER stores what came back — the live model's answer is reported beside it. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

/* A chainable fake admin: rows per table, eq() filters, writes recorded. */
function fakeAdmin(tables) {
  const writes = [];
  const admin = {
    writes,
    from(table) {
      const rows = () => tables[table] || [];
      const f = [];
      let pendingUpdate = null, pendingInsert = null;
      const chain = {
        select() { return chain; }, order() { return chain; }, limit() { return chain; }, in() { return chain; },
        eq(c, v) { f.push((r) => r[c] === v); return chain; },
        update(patch) { pendingUpdate = patch; return chain; },
        insert(row) { pendingInsert = row; return chain; },
        maybeSingle() { const out = rows().filter((r) => f.every((p) => p(r))); return Promise.resolve({ data: out[0] || null, error: null }); },
        then(res, rej) {
          if (pendingInsert) { writes.push({ table, op: 'insert', row: pendingInsert }); (tables[table] = tables[table] || []).push(Object.assign({ id: 'new-' + writes.length }, pendingInsert)); return Promise.resolve({ data: null, error: null }).then(res, rej); }
          if (pendingUpdate) { const hit = rows().filter((r) => f.every((p) => p(r))); hit.forEach((r) => Object.assign(r, pendingUpdate)); writes.push({ table, op: 'update', patch: pendingUpdate, n: hit.length }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
          return Promise.resolve({ data: rows().filter((r) => f.every((p) => p(r))), error: null }).then(res, rej);
        },
      };
      return chain;
    },
  };
  return admin;
}

/* Stub the SDK at the module edge, evicting every module between a lane and it. */
async function withModel(reply, fn) {
  const p = require.resolve('@anthropic-ai/sdk');
  const saved = require.cache[p];
  const calls = [];
  require.cache[p] = { id: p, filename: p, loaded: true, exports: function Anthropic() {
    return { messages: { create: async (args) => { calls.push(args); return reply(args); } } };
  } };
  const evict = ['../lib/model-usage', '../lib/coaching-corrections', '../lib/analysis-worker', '../routes/kb'];
  evict.forEach((m) => { try { delete require.cache[require.resolve(m)]; } catch (e) {} });
  const prev = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key';
  try { return await fn(calls); }
  finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
    if (saved) require.cache[p] = saved; else delete require.cache[p];
    evict.forEach((m) => { try { delete require.cache[require.resolve(m)]; } catch (e) {} });
  }
}

const ISOLATING = { id: 'h-iso', fathom_call_id: 'call-1', user_id: 'rep', type: 'objection', resolution: 'unhandled', section: 'objection',
  timestamp_seconds: 1500, quote: "I need to think about the money.", observation: 'The closer set the price aside and asked whether the prospect wanted the outcome.',
  closer_response: "Money aside — is this what you want?", closer_response_verified: true, speaker: 'PROSPECT', speaker_verified: true };
const CONCEPT = "On this team, isolating the objection ('money aside, is this what you want?') is correct — do not coach closers away from it.";
const CORRECTION_ROW = { id: 'kb-c1', category: 'coaching_correction', label: 'Team coaching notes', content: CONCEPT, scope: 'team', team_owner_id: 'mgr', uploaded_by: 'mgr', created_at: '2026-09-02T04:00:00Z',
  metadata: { category: 'coaching_correction', concept: CONCEPT, concept_hash: 'abc', feedback: 'do not tell closers to stop isolating', given_on: { fathom_call_id: 'call-0', highlight_id: 'h-0', rep_user_id: 'rep' } } };

function coachingReply(args) {
  const prompt = args.messages[0].content;
  const notes = /MANAGER NOTES/.test(prompt);
  return { content: [{ type: 'text', text: JSON.stringify([{ moment: 1,
    coaching: notes ? 'Keep isolating the objection — on this team that is exactly right. Then ask for the commitment.' : 'Stop asking them to set the money aside; answer the price objection directly.',
    applied_manager_notes: notes ? [1] : [] }]) }] };
}

test('⚠⚠ THE ISOLATION REPLAY — a stored correction CHANGES the coaching written for the moment, on a checkable field', async () => {
  const run = (withCorrection) => withModel(coachingReply, async () => {
    const worker = require('../lib/analysis-worker');
    const admin = fakeAdmin({
      call_highlights: [Object.assign({}, ISOLATING)],
      user_profiles: [{ user_id: 'rep', managed_by: 'mgr', role: 'user' }],
      knowledge_base: withCorrection ? [Object.assign({}, CORRECTION_ROW)] : [],
    });
    const out = await worker._coachCallMoments(admin, 'call-1', 'lost', null, null, 'rep');
    return { out, row: admin.from === undefined ? null : (function () { return admin; })(), highlight: (function () { return admin; })() };
  });
  const without = await withModel(coachingReply, async () => {
    const worker = require('../lib/analysis-worker');
    const tables = { call_highlights: [Object.assign({}, ISOLATING)], user_profiles: [{ user_id: 'rep', managed_by: 'mgr', role: 'user' }], knowledge_base: [] };
    const out = await worker._coachCallMoments(fakeAdmin(tables), 'call-1', 'lost', null, null, 'rep');
    return { out, h: tables.call_highlights[0] };
  });
  const withIt = await withModel(coachingReply, async (calls) => {
    const worker = require('../lib/analysis-worker');
    const tables = { call_highlights: [Object.assign({}, ISOLATING)], user_profiles: [{ user_id: 'rep', managed_by: 'mgr', role: 'user' }], knowledge_base: [Object.assign({}, CORRECTION_ROW)] };
    const out = await worker._coachCallMoments(fakeAdmin(tables), 'call-1', 'lost', null, null, 'rep');
    return { out, h: tables.call_highlights[0], prompt: calls[0].messages[0].content };
  });
  assert.strictEqual(without.out.written, 1); assert.strictEqual(withIt.out.written, 1);
  assert.ok(/Stop asking them to set the money aside/.test(without.h.coaching), 'without the note Scout coaches the rep out of isolating (the defect)');
  assert.ok(/Keep isolating/.test(withIt.h.coaching), 'with the note the coaching changes');
  assert.deepStrictEqual(withIt.h.coaching_applied_notes, ['kb-c1'], 'the checkable field: which correction shaped the coaching');
  assert.ok(without.h.coaching_applied_notes === undefined || without.h.coaching_applied_notes === null || (Array.isArray(without.h.coaching_applied_notes) && without.h.coaching_applied_notes.length === 0), 'no note, nothing applied');
  assert.ok(/MANAGER NOTES/.test(withIt.prompt) && withIt.prompt.indexOf(CONCEPT) !== -1, 'the prompt carries the concept verbatim');
  assert.ok(withIt.prompt.indexOf('outrank') !== -1 && /genuinely different/.test(withIt.prompt), 'weighted example, not a hard rule — Scout may still say a moment was different');
  void run;
});

test('⚠⚠ SUBSTITUTION, NOT SUPPRESSION — the grader and the extractor never see a correction', () => {
  const cc = require('../lib/coaching-corrections');
  const { GRADER_CATEGORIES, SYNTHESIS_CATEGORIES } = require('../lib/selling-context');
  assert.ok(!GRADER_CATEGORIES.includes(cc.METADATA_CATEGORY) && !SYNTHESIS_CATEGORIES.includes(cc.METADATA_CATEGORY), 'filter (b): the metadata category is in neither list');
  const sc = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'selling-context.js'), 'utf8'));
  assert.ok(/\.eq\('category', 'user_upload'\)/.test(sc), 'filter (a): selling context only ever reads user uploads');
  assert.notStrictEqual(cc.CATEGORY, 'user_upload');
  const w = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'));
  const coach = w.slice(w.indexOf('async function coachCallMoments'), w.indexOf('\nmodule.exports'));
  const rest = w.slice(0, w.indexOf('async function coachCallMoments'));
  assert.ok(/loadCorrections\(/.test(coach), 'the coaching pass reads the corrections');
  assert.ok(!/loadCorrections\(|managerNotes/.test(rest), 'nothing before the coaching pass — grader, extractor, harvest — touches them');
});

test('⚠ ACCUMULATE, NEVER OVERWRITE — oldest first, dedupe on the concept hash, and the hash moves when a note is added', async () => {
  const cc = require('../lib/coaching-corrections');
  const a = Object.assign({}, CORRECTION_ROW, { id: 'k1', created_at: '2026-09-01T00:00:00Z' });
  const b = Object.assign({}, CORRECTION_ROW, { id: 'k2', created_at: '2026-09-02T00:00:00Z', content: 'On this team, a partner objection is warm — isolate and set the next step.', metadata: Object.assign({}, CORRECTION_ROW.metadata, { concept: 'On this team, a partner objection is warm — isolate and set the next step.', concept_hash: 'def' }) });
  const dup = Object.assign({}, a, { id: 'k3', created_at: '2026-09-03T00:00:00Z' });
  const one = await cc.loadCorrections(fakeAdmin({ knowledge_base: [b, a] }), 'mgr');
  assert.deepStrictEqual(one.rows.map((r) => r.id), ['k1', 'k2'], 'oldest first, whatever order the store returns');
  const two = await cc.loadCorrections(fakeAdmin({ knowledge_base: [b, a, dup] }), 'mgr');
  assert.deepStrictEqual(two.rows.map((r) => r.id), ['k1', 'k2'], 'a repeated concept collapses onto the FIRST, never the newest');
  assert.notStrictEqual(one.hash, (await cc.loadCorrections(fakeAdmin({ knowledge_base: [a] }), 'mgr')).hash, 'the hash moves when the set changes');
  assert.strictEqual((await cc.loadCorrections(fakeAdmin({ knowledge_base: [] }), 'mgr')).hash, 'none');
  assert.ok(/1\. /.test(one.text) && /2\. /.test(one.text), 'numbered, so a lane can say which it applied');
});

test('⚠⚠ THE ROW IS STRUCTURED AND JOINABLE — given_on carries the call, the moment and the rep', () => {
  const cc = require('../lib/coaching-corrections');
  const row = cc.buildCorrectionRow({ target: { scope: 'team', team_owner_id: 'mgr', uploaded_by: 'mgr' }, concept: CONCEPT, feedback: 'stop telling them not to isolate', subject: 'objection', direction: 'prefer', objectionCategory: 'fear',
    givenOn: { surface: 'call_review_moment', fathomCallId: 'call-1', highlightId: 'h-iso', repUserId: 'rep', momentType: 'objection', section: 'objection', coachingSnapshot: 'Stop asking them to set the money aside.', quote: ISOLATING.quote }, addedBy: 'mgr', extraction: { model: 'x', prompt_version: 'v1', input_tokens: 10, output_tokens: 5 } });
  assert.strictEqual(row.category, 'coaching_correction'); assert.strictEqual(row.scope, 'team'); assert.strictEqual(row.team_owner_id, 'mgr'); assert.strictEqual(row.uploaded_by, 'mgr');
  assert.strictEqual(row.label, 'Team coaching notes'); assert.strictEqual(row.source_label, 'Team coaching notes');
  assert.strictEqual(row.content, CONCEPT, 'the concept is what the model reads');
  assert.deepStrictEqual(row.metadata.given_on, { surface: 'call_review_moment', fathom_call_id: 'call-1', highlight_id: 'h-iso', rep_user_id: 'rep', moment_type: 'objection', section: 'objection', coaching_snapshot: 'Stop asking them to set the money aside.', quote: ISOLATING.quote });
  assert.strictEqual(row.metadata.feedback, 'stop telling them not to isolate'); assert.strictEqual(row.metadata.category, 'coaching_correction');
  assert.ok(row.metadata.concept_hash && row.metadata.concept_hash.length >= 20);
  assert.strictEqual(row.source_fathom_call_id, 'call-1'); assert.strictEqual(row.source_quote_hash, null, 'opts out of the harvested-moment dedupe index; dedupe is the concept hash');
  const failed = cc.buildCorrectionRow({ target: { scope: 'team', team_owner_id: 'mgr', uploaded_by: 'mgr' }, concept: null, feedback: 'my words', givenOn: { fathomCallId: 'c', highlightId: 'h', repUserId: 'r' }, addedBy: 'mgr' });
  assert.strictEqual(failed.metadata.concept, null); assert.strictEqual(failed.content, 'my words', 'extraction failed: the verbatim words are stored, never dropped');
});

test('⚠ the extraction is ONE model call on its own lane, and a bad answer is a null concept, not a throw', async () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'coaching-corrections.js'), 'utf8'));
  assert.ok(/usageFor\('fine-tune-coaching'\)/.test(src), 'attributed under its own lane in model_usage');
  await withModel(() => ({ content: [{ type: 'text', text: '{"concept":"On this team, isolating is correct.","subject":"objection","direction":"prefer","objection_category":"fear"}' }], usage: { input_tokens: 900, output_tokens: 40 } }), async (calls) => {
    const cc = require('../lib/coaching-corrections');
    const r = await cc.extractConcept({ feedback: 'do not coach them out of isolating', moment: ISOLATING, coaching: 'Stop asking them to set the money aside.' });
    assert.strictEqual(calls.length, 1); assert.strictEqual(r.ok, true); assert.strictEqual(r.concept, 'On this team, isolating is correct.'); assert.strictEqual(r.subject, 'objection');
  });
  await withModel(() => ({ content: [{ type: 'text', text: 'not json' }] }), async () => {
    const cc = require('../lib/coaching-corrections');
    const r = await cc.extractConcept({ feedback: 'x', moment: ISOLATING, coaching: 'y' });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.concept, null);
  });
});

test('⚠⚠ THE ROUTE: managers and above only; first call extracts and stores NOTHING; the confirmed call stores the row per team', async () => {
  await withModel(() => ({ content: [{ type: 'text', text: JSON.stringify({ concept: CONCEPT, subject: 'objection', direction: 'prefer', objection_category: 'fear' }) }] }), async (calls) => {
    const kb = require('../routes/kb');
    const tables = { call_highlights: [Object.assign({}, ISOLATING, { coaching: 'Stop asking them to set the money aside.' })], user_profiles: [{ user_id: 'mgr', role: 'manager', managed_by: null }, { user_id: 'rep', role: 'user', managed_by: 'mgr' }], knowledge_base: [] };
    const admin = fakeAdmin(tables);
    kb._setAdminClientForTests(() => admin);
    const l = kb.stack.find((x) => x.route && x.route.path === '/fine-tune');
    assert.ok(l, 'POST /kb/fine-tune exists');
    const handler = l.route.stack[l.route.stack.length - 1].handle;
    const call = (user, body) => new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; Promise.resolve().then(() => handler({ user, body, headers: {} }, res)).catch((e) => resolve({ code: 'threw', body: { error: String(e && e.message) } })); });
    const rep = await call({ id: 'rep', email: 'rep@x' }, { fathom_call_id: 'call-1', highlight_id: 'h-iso', feedback: 'no' });
    assert.strictEqual(rep.code, 403, 'a rep cannot fine-tune: ' + JSON.stringify(rep));
    const first = await call({ id: 'mgr', email: 'm@x' }, { fathom_call_id: 'call-1', highlight_id: 'h-iso', feedback: 'do not coach them out of isolating' });
    assert.strictEqual(first.code, 200, JSON.stringify(first));
    assert.strictEqual(first.body.concept, CONCEPT); assert.strictEqual(first.body.stored, false);
    assert.strictEqual(admin.writes.filter((w) => w.table === 'knowledge_base').length, 0, 'nothing stored until confirmed');
    const second = await call({ id: 'mgr', email: 'm@x' }, { fathom_call_id: 'call-1', highlight_id: 'h-iso', feedback: 'do not coach them out of isolating', concept: CONCEPT + ' Edited.', confirm: true });
    assert.strictEqual(second.code, 200, JSON.stringify(second)); assert.strictEqual(second.body.stored, true);
    const row = admin.writes.find((w) => w.table === 'knowledge_base').row;
    assert.strictEqual(row.content, CONCEPT + ' Edited.', 'the manager\'s wording wins');
    assert.strictEqual(row.scope, 'team'); assert.strictEqual(row.team_owner_id, 'mgr'); assert.strictEqual(row.uploaded_by, 'mgr');
    assert.deepStrictEqual([row.metadata.given_on.fathom_call_id, row.metadata.given_on.highlight_id, row.metadata.given_on.rep_user_id], ['call-1', 'h-iso', 'rep']);
    assert.strictEqual(calls.length, 1, 'the confirmed call re-uses the manager\'s text — no second extraction');
    const again = await call({ id: 'mgr', email: 'm@x' }, { fathom_call_id: 'call-1', highlight_id: 'h-iso', feedback: 'x', concept: CONCEPT + ' Edited.', confirm: true });
    assert.strictEqual(again.body.duplicate, true, 'the same concept twice is one note');
  });
});

test('⚠ THE CONTROL: on the Call Review moment rows, beside Add to KB, same gate; confirm-before-store in the client; the KB page names the notes', () => {
  const row = fnBody(LIVE, 'highlightEntryHtml');
  assert.ok(/fineTuneFromRow\(/.test(row) && /canMarkStandard\(\)/.test(row), 'the button sits in the shared row renderer behind the manager gate');
  const fn = fnBody(LIVE, 'fineTuneCoaching');
  assert.ok((fn.match(/scoutPrompt\(/g) || []).length >= 2, 'ask for the correction, then show the concept back');
  assert.ok(/value:/.test(fn), 'the concept is prefilled so the manager can edit it');
  assert.ok(/confirm: true/.test(fn), 'the second request confirms');
  assert.ok(/couldn(\\u2019|[\u2019'])t summarise/i.test(fn), 'extraction failure is said, and the words are kept');
  assert.ok(LIVE.indexOf("coaching_correction: 'Team coaching notes'") !== -1, 'the KB page names the group for reps and managers alike');
  assert.ok(/Your manager wrote/.test(fnBody(LIVE, 'renderKbEntries')), 'an entry shows the concept and the manager\'s words');
});

test('⚠ the health-snapshot line no longer promises a control to everyone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'health-snapshot.js'), 'utf8');
  assert.ok(!/with a control to grade them/.test(src) && /handled by an admin/.test(src));
});

/* ── SURFACE ② — Team → Coaching "What to improve" insights (2026-09-02) ──────
   Same helper, same gate, same confirm-then-store flow. The one shape change
   is in the DATA: an insight now carries the highlight id it cites (it always
   carried the call id), because the control needs a moment to record what it
   was given on — and that is a payload change, so the lane version bumps. */
test('⚠⚠ SURFACE ②: an insight carries its moment (highlight id + call id), and the lane version moved with the shape', () => {
  const ts = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8'));
  assert.ok(/highlight_id: r\.id/.test(ts), 'the candidate keeps the highlight row id');
  assert.ok(/inChunks\('call_highlights', 'id, fathom_call_id, timestamp_seconds, quote, speaker/.test(ts), 'and the id is SELECTED — a field read at the consumer and selected nowhere is undefined everywhere, silently');
  assert.ok(/highlight_id: ev \? ev\.highlight_id : null/.test(ts), 'the rendered item carries it');
  assert.ok(/call_id: ev \? ev\.call_id : null/.test(ts), 'and the call id');
  const v = /RECS_LANE_VERSION = '([^']+)'/.exec(ts);
  assert.ok(v && v[1] !== 'v4-2026-09-01-never-diminish', 'a payload-shape change bumps the lane version in the cache key');
});

test('⚠⚠ SURFACE ②: the SAME helper, called from the insight with surface recorded; the route keeps the surface', () => {
  const insight = fnBody(LIVE, 'teamInsightHtml');
  assert.ok(/canMarkStandard\(\)/.test(insight) && /it\.highlight_id/.test(insight) && /it\.call_id/.test(insight), 'the control renders only where the insight names a moment, behind the manager gate');
  assert.ok(/fineTuneFromInsight\(/.test(insight), 'the insight calls the bridge');
  const bridge = fnBody(LIVE, 'fineTuneFromInsight');
  assert.ok(/fineTuneCoaching\(\{/.test(bridge) && /surface: 'team_coaching_insight'/.test(bridge), 'the bridge calls the one helper with its surface');
  const helper = fnBody(LIVE, 'fineTuneCoaching');
  assert.ok(/surface: target\.surface/.test(helper) || /surface: t\.surface/.test(helper), 'the helper posts the surface it was given');
  assert.strictEqual((LIVE.match(/async function fineTuneCoaching\(/g) || []).length, 1, 'one control, two callers');
  const row = fnBody(LIVE, 'highlightEntryHtml');
  assert.ok(/fineTuneFromRow\(/.test(row) || /fineTuneCoaching\(\{/.test(row), 'surface ① calls the same helper');
  const kb = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'kb.js'), 'utf8'));
  assert.ok(/SURFACES = \['call_review_moment', 'team_coaching_insight'\]/.test(kb), 'a closed set of surfaces on the server');
  assert.ok(/surface: surface/.test(kb), 'given_on.surface is what the client said, validated');
});

test('⚠ the Call Review loading state waits in words, not three bare boxes', () => {
  const body = fnBody(LIVE, 'renderCallReview');
  assert.ok(/laneWaitHtml\(/.test(body), 'the one helper');
  assert.ok(!/review-skeleton-section/.test(body), 'no bare boxes');
});

/* ── THE LANES (2026-09-02): three coaching lanes read the notes through ONE
   shared wording. Needs-work is deliberately NOT one of them: its only model
   call classifies objection phrases into buckets, which sets the handle RATE
   — a note there would let a manager move a metric by correcting coaching. */
const laneSrc = (f) => stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8'));

test('⚠⚠ ONE WORDING, THREE COACHING LANES + 7c; the classifier, the grader and the extractor never see a note', () => {
  const cc = require('../lib/coaching-corrections');
  assert.strictEqual(typeof cc.promptLane, 'function', 'the lane text is lifted into one place');
  const lane = cc.promptLane('1. On this team, isolating is correct.');
  assert.ok(/MANAGER NOTES/.test(lane) && /outrank/.test(lane) && /genuinely different/.test(lane), 'weighted example, not a hard rule');
  assert.strictEqual(cc.promptLane(''), '', 'no notes, no lane');
  assert.ok(/applied_manager_notes/.test(cc.promptLane('1. x', { applied: true })) && !/applied_manager_notes/.test(lane), 'only 7c asks which notes were applied');
  ['team-synthesis.js', 'team-objection-summary.js', 'performance-synthesis.js', 'coaching.js'].forEach((f) => assert.ok(/promptLane\(/.test(laneSrc(f)), f + ' renders the shared lane'));
  ['team-synthesis.js', 'team-objection-summary.js', 'performance-synthesis.js'].forEach((f) => assert.ok(/loadCorrections(Safe)?\(/.test(laneSrc(f)), f + ' loads the team notes'));
  assert.ok(!/MANAGER NOTES/.test(laneSrc('coaching.js')), 'coaching.js no longer carries its own copy of the wording');
  assert.ok(!/loadCorrections(Safe)?\(|promptLane\(|managerNotes/.test(laneSrc('team-needs-work.js')), 'needs-work: the bucket classifier sets a RATE — a note must not reach it');
  assert.ok(!/loadCorrections(Safe)?\(|promptLane\(/.test(laneSrc('selling-context.js')), 'the grader/extractor context never carries a note');
  const w = laneSrc('analysis-worker.js');
  assert.ok(!/loadCorrections(Safe)?\(|managerNotes|promptLane\(/.test(w.slice(0, w.indexOf('async function coachCallMoments'))), 'grader and extractor untouched');
});

test('⚠⚠ EACH LANE\'S CACHE KEY MOVES WITH THE NOTES, and its version moved with the prompt', () => {
  const ts = laneSrc('team-synthesis.js');
  assert.ok(/\|\|notes:' \+ corr\.hash/.test(ts) && /RECS_LANE_VERSION = 'v7-/.test(ts), 'recommendations');
  const os = laneSrc('team-objection-summary.js');
  assert.ok(/\|notes:' \+ corr\.hash/.test(os) && /PROMPT_VERSION = 'v12-/.test(os), 'objections Why');
  const ps = laneSrc('performance-synthesis.js');
  assert.ok(/\|\|notes:' \+ corr\.hash/.test(ps) && /SYNTH_RULE_VERSION = 'v4-/.test(ps), 'performance summary');
  const nw = laneSrc('team-needs-work.js');
  assert.ok(!/notes:/.test(nw), 'needs-work: no bump, nothing regenerates, nothing changed');
});

test('⚠ the objections and performance prompts CARRY the note when there is one, and omit the lane when there is none (executed)', () => {
  const os = require('../lib/team-objection-summary');
  const withNote = os._buildPrompt([], '1. On this team, isolating is correct.');
  assert.ok(/MANAGER NOTES/.test(withNote) && /isolating is correct/.test(withNote));
  assert.ok(withNote.indexOf('MANAGER NOTES') < withNote.indexOf('Respond with ONLY'), 'the lane sits before the answer format');
  assert.ok(!/MANAGER NOTES/.test(os._buildPrompt([], '')), 'no lane without notes');
  const ps = require('../lib/performance-synthesis');
  const obj = {}; ['fear', 'timing', 'partner', 'logistical', 'uncategorized', 'price', 'money', 'think', 'spouse', 'time', 'trust', 'other'].forEach((c) => { obj[c] = { handled: 0, total: 0 }; });
  const agg = { sections: {}, strongest: null, weakest: null, win_avg: null, win_n: 0, loss_avg: null, loss_n: 0, blended: null, done_n: 0, obj: new Proxy(obj, { get: (o, k) => o[k] || { handled: 0, total: 0 } }) };
  assert.ok(/MANAGER NOTES/.test(ps._buildPrompt(agg, [], [], '', '1. On this team, isolating is correct.')));
  assert.ok(!/MANAGER NOTES/.test(ps._buildPrompt(agg, [], [], '', '')));
});

test('⚠ JUSTIN, LIVE: a multi-line box tall enough to read a paragraph, and ONE green button style with the login\'s hover pair', () => {
  const modal = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'scout-modal.js'), 'utf8');
  assert.ok(/o\.multiline/.test(modal) && /textarea/.test(modal), 'the prompt dialog can be a textarea');
  assert.ok(/min-height:\s*1[6-9]\dpx|min-height:\s*2\d\dpx/.test(modal), 'tall enough to read a paragraph without scrolling');
  assert.ok(/TEXTAREA/.test(modal) && /(metaKey|ctrlKey)/.test(modal), 'Enter writes a newline in the textarea; Cmd/Ctrl+Enter confirms');
  const fn = fnBody(LIVE, 'fineTuneCoaching');
  assert.strictEqual((fn.match(/multiline: true/g) || []).length, 2, 'both dialogs — the correction and the concept — are multi-line');
  const rest = /\.review-ft-btn\s*\{([^}]*)\}/.exec(LIVE);
  assert.ok(rest && /color:\s*var\(--accent\)/.test(rest[1]) && /border-color:\s*var\(--accent\)/.test(rest[1]), 'at rest: green text, green border');
  const hover = /\.review-ft-btn:hover:not\(:disabled\)\s*\{([^}]*)\}/.exec(LIVE);
  assert.ok(hover && /background:\s*var\(--accent\)/.test(hover[1]) && /color:\s*#000/.test(hover[1]), 'on hover: solid Scout green, black text — the login button\'s pair');
  const accent = /--accent:\s*(#[0-9a-fA-F]{6})/.exec(HTML)[1];
  const lin = (c) => { const v = parseInt(c, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(accent.slice(1, 3)) + 0.7152 * lin(accent.slice(3, 5)) + 0.0722 * lin(accent.slice(5, 7));
  const ratio = (L + 0.05) / 0.05;
  assert.ok(ratio >= 7, 'black on ' + accent + ' must clear AAA (7:1), measured ' + ratio.toFixed(2));
});
