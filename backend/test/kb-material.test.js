/**
 * THE KNOWLEDGE BASE BEFORE THE ADVICE (H731) — the one retrieval every advice lane calls, EXECUTED against a
 * fake wire: team scoping (a lane running for team A never surfaces team B's material), the seeded starter
 * set excluded by ORIGIN (scope NULL and uploader NULL match no reader), and the empty case (nothing
 * relevant → hasMaterial false → the lane says nothing).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadKbMaterial, nothingToSay, NO_MATERIAL_COPY } = require('../lib/kb-material');

const P = {
  headA: { user_id: 'headA', managed_by: null, niche: 'Sober living', offer: 'Team A offer: done-for-you market research and the blueprint', qualifications: 'TEAM A: 10k saved, not living paycheck to paycheck', script_raw: null },
  repA:  { user_id: 'repA',  managed_by: 'headA', niche: null, offer: null, qualifications: null, script_raw: null },
  headB: { user_id: 'headB', managed_by: null, niche: 'Roofing', offer: 'Team B offer: roofing leads programme, long enough to count', qualifications: 'TEAM B: owns a truck', script_raw: null },
  repB:  { user_id: 'repB',  managed_by: 'headB', niche: null, offer: null, qualifications: null, script_raw: null },
  solo:  { user_id: 'solo',  managed_by: null, niche: null, offer: null, qualifications: null, script_raw: null },
};
const KB = [
  { id: 'nA', category: 'coaching_correction', scope: 'team', team_owner_id: 'headA', uploaded_by: 'headA', content: 'TEAM A NOTE: isolate first', metadata: { concept: 'TEAM A NOTE: isolate first' }, created_at: '2026-09-01' },
  { id: 'nB', category: 'coaching_correction', scope: 'team', team_owner_id: 'headB', uploaded_by: 'headB', content: 'TEAM B NOTE: never discount', metadata: { concept: 'TEAM B NOTE: never discount' }, created_at: '2026-09-01' },
  { id: 'seed1', category: 'objection_framework', scope: null, team_owner_id: null, uploaded_by: null, content: 'SEEDED: Permission close word track', metadata: {}, created_at: '2026-04-06' },
  { id: 'seed2', category: 'user_upload', scope: null, team_owner_id: null, uploaded_by: null, content: 'SEEDED UPLOAD-LOOKALIKE', metadata: { category: 'offer_document' }, created_at: '2026-04-06' },
  { id: 'gA', category: 'user_upload', scope: 'global', team_owner_id: null, uploaded_by: 'owner', content: 'GLOBAL WINNING CALL CHUNK', metadata: { category: 'winning_call' }, created_at: '2026-04-29' },
];
function fakeAdmin() {
  return { from(table) {
    const ch = { f: {}, _in: null, _isNull: {}, select() { return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, is(k, v) { ch._isNull[k] = v; return ch; }, not() { return ch; }, order() { return ch; }, limit() { return ch; },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles' ? (P[ch.f.user_id] ? Object.assign({}, P[ch.f.user_id]) : null) : null, error: null }); },
      then(res, rej) {
        let rows = [];
        if (table === 'knowledge_base') rows = KB.filter((r) => Object.keys(ch.f).every((k) => (k.indexOf('->>') !== -1 ? true : r[k] === ch.f[k])) && (!ch._in || (ch._in[0].indexOf('->>') !== -1 ? ch._in[1].indexOf((r.metadata || {}).category) !== -1 : ch._in[1].indexOf(r[ch._in[0]]) !== -1)) && Object.keys(ch._isNull).every((k) => (ch._isNull[k] === null ? r[k] == null : true)));
        else if (table === 'user_profiles') rows = Object.values(P).filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  } };
}

test('⚠⚠ a rep of team A gets team A\'s material — the head\'s qualifications and team A\'s note — and NOTHING of team B\'s', async () => {
  const m = await loadKbMaterial(fakeAdmin(), { userId: 'repA', lane: 'test' });
  assert.strictEqual(m.hasMaterial, true);
  assert.ok(/TEAM A: 10k saved/.test(m.contextText) && /Team A offer/.test(m.contextText));
  assert.ok(/TEAM A NOTE/.test(m.notes.text), 'the team\'s note: ' + m.notes.text);
  assert.ok(!/TEAM B|Team B|Roofing/.test(m.contextText + ' ' + m.notes.text), 'a team never sees another team\'s material');
  const b = await loadKbMaterial(fakeAdmin(), { userId: 'repB', lane: 'test' });
  assert.ok(/TEAM B: owns a truck/.test(b.contextText) && /TEAM B NOTE/.test(b.notes.text) && !/TEAM A|Sober living/.test(b.contextText + ' ' + b.notes.text));
});

test('⚠⚠ the seeded starter set is excluded by ORIGIN: scope NULL and uploader NULL reach no lane, even when a seeded row wears an upload-looking metadata category', async () => {
  const m = await loadKbMaterial(fakeAdmin(), { userId: 'repA', lane: 'test' });
  assert.ok(!/SEEDED/.test(m.contextText + ' ' + m.notes.text), 'seeded rows: ' + m.contextText.slice(0, 80));
  const solo = await loadKbMaterial(fakeAdmin(), { userId: 'solo', lane: 'test' });
  assert.ok(!/SEEDED/.test(solo.contextText + ' ' + solo.notes.text));
});

test('⚠⚠ nothing relevant → hasMaterial false and the one shape every surface draws; the global winning-call chunk alone is NOT enough to coach a team from (it is not their material)', async () => {
  const solo = await loadKbMaterial(fakeAdmin(), { userId: 'solo', lane: 'test', categories: ['script', 'offer_document', 'objection_framework', 'case_study'] });
  assert.strictEqual(solo.hasMaterial, false);
  assert.strictEqual(solo.contextText, ''); assert.strictEqual(solo.notes.text, '');
  const n = nothingToSay({ working: [], improve: [] });
  assert.strictEqual(n.available, true); assert.strictEqual(n.no_material, true); assert.strictEqual(n.copy, NO_MATERIAL_COPY);
  assert.ok(/nothing on file/.test(NO_MATERIAL_COPY) && /account page/.test(NO_MATERIAL_COPY), 'what happened and what to do, in words');
  assert.ok(!/cache|synthesis|lane|prompt|retriev/i.test(NO_MATERIAL_COPY), 'no internal words');
});

test('⚠ every advice lane calls the ONE retrieval before its prompt and returns the one shape when empty (pins on the wiring; the coaching lane is EXECUTED in test/coaching-kb-check.test.js)', () => {
  const fs = require('node:fs'); const path = require('node:path'); const { stripComments } = require('./helpers/strip-comments');
  const read = (f) => stripComments(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  const lanes = { 'lib/team-synthesis.js': 'RECS_LANE_VERSION = \'v14-', 'lib/performance-synthesis.js': 'SYNTH_RULE_VERSION = \'v9-', 'lib/team-objection-summary.js': 'PROMPT_VERSION = \'v16-', 'lib/team-digest.js': 'DIGEST_PROMPT_VERSION = \'v10-', 'lib/objection-synthesis.js': 'SYNTH_PROMPT_VERSION = \'v4-', 'lib/analysis-worker.js': 'ANALYSIS_PROMPT_VERSION = \'v46-' };
  Object.keys(lanes).forEach((f) => {
    const src = read(f);
    assert.ok(/loadKbMaterial\(admin, \{/.test(src), f + ' calls the one retrieval');
    assert.ok(src.indexOf(lanes[f]) !== -1, f + ' moved its version with the prompt: ' + lanes[f]);
    if (f !== 'lib/analysis-worker.js') assert.ok(/nothingToSay\(|no_material/.test(src), f + ' returns the one empty shape');
    const scope = (f === 'lib/analysis-worker.js') ? src.slice(src.indexOf('async function coachCallMoments(')) : src;   // the worker's grader calls sit earlier in the file — the order that matters is inside the coaching pass
    const callAt = scope.indexOf('loadKbMaterial(admin, {'); const promptAt = scope.search(/createWithUsage\(\{|await createWithUsage\(|createWithUsage\(\s*\{/);
    assert.ok(callAt !== -1 && (promptAt === -1 || callAt < promptAt), f + ': the retrieval precedes the model call');
  });
  const worker = read('lib/analysis-worker.js');
  assert.ok(/skipped: 'no_material'/.test(worker), 'the coaching pass says nothing when there is nothing');
  assert.ok(/graderParsed\.one_thing = null/.test(worker), 'one_thing withheld without material');
  assert.ok(!/use general best practice, and it will be labeled as such/.test(read('lib/objection-synthesis.js')), 'the generic fallback is gone');
});

test('⚠ the surfaces draw the one no-material shape in words (executed from the live source)', () => {
  const fs = require('node:fs'); const path = require('node:path'); const { stripComments, fnBody } = require('./helpers/strip-comments');
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const esc = (s) => String(s == null ? '' : s);
  const nm = new Function('escapeHtml', fnBody(LIVE, 'noMaterialHtml') + '\n return noMaterialHtml;')(esc);
  assert.ok(/nothing on file/.test(nm(NO_MATERIAL_COPY)) && /account page/.test(nm(NO_MATERIAL_COPY)));
  ['teamRecsHtml', 'teamObjSummaryHtml'].forEach((fn) => assert.ok(/no_material/.test(fnBody(LIVE, fn)) && /noMaterialHtml\(/.test(fnBody(LIVE, fn)), fn + ' draws it'));
  assert.ok(/no_material/.test(fnBody(LIVE, 'teamDigestHtml')) || /d\.no_material/.test(LIVE), 'the digest draws it');
  const sec = new Function('escapeHtml', 'OBJECTION_LABEL', fnBody(LIVE, 'objSynthSection') + '\n return objSynthSection;')(esc, { fear: 'Fear' });
  const html = sec({ category: 'fear', grounded: false, isolate: null, reframe: null, overcome: null });
  assert.ok(/no coaching is offered here/.test(html) && !/general best practice/.test(html.replace(/scope-pill">general best practice/, '')), 'a category with nothing behind it says so');
});
