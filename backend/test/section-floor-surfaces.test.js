'use strict';
/* THE FLOOR ON EVERY SURFACE THAT NAMES A WEAKEST OR STRONGEST AREA (Justin, 2026-09-11; H774).
   The Team → Coaching panel got the rep page's floor in H768. Two surfaces still ranked from the LEGACY
   section columns with no floor at all — one graded call lit a bar: the rep card's lit weakest bar
   (team-analytics.weakest_section → rep-card-metrics.weakestSection) and the Coach Summary's
   strongest/weakest badges (session-analytics.computeCallAnalytics). Justin ruled: the same floor
   under them. THE TRAP: it is a DIFFERENT POPULATION — the legacy columns count every analysed call,
   the panel counts stage records — so the floor is the count that belongs to the number being ranked:
   MIN_CALLS_TO_RANK legacy-analysed calls in that section for a legacy-ranked bar. The bar is never
   made to wait on stage records and never repointed at the stage population (that is a different
   change and not ruled). Below the floor the surface says what it is based on in the words already in
   use — THIN_LABEL and the ranking's own reason — never a third sentence. rankSections decides on
   every surface; a caller that omits the counts is BELOW the floor (null), never above it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const RC = require('../lib/rep-card-metrics');
const SR = require('../lib/section-ranking');
const TA = require('../lib/team-analytics');
const SA = require('../lib/session-analytics');

const F = SR.MIN_CALLS_TO_RANK;
const live = stripComments(fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'));

test('the floor is the one floor (MIN_CALLS_TO_RANK = _MIN_ANALYZED), and it is at least ten', () => {
  assert.equal(F, require('../lib/team-needs-work')._MIN_ANALYZED);
  assert.ok(F >= 10, 'the floor is ' + F);
});

test('weakestSection ranks only sections at or above the floor, counted in the population being ranked', () => {
  const sections = { intro: 57, discovery: 47, pitch: 65, objection: 64, close: 57 };
  assert.deepEqual(RC.weakestSection(sections, { intro: F, discovery: F, pitch: F, objection: F, close: F }), { section: 'discovery', score: 47 });
  assert.deepEqual(RC.weakestSection(sections, { intro: F, discovery: F - 1, pitch: F, objection: F, close: F }), { section: 'intro', score: 57 }, 'discovery is under the floor: it holds no position');
  assert.equal(RC.weakestSection(sections, { intro: F - 1, discovery: F - 1, pitch: F - 1, objection: F - 1, close: F - 1 }), null, 'nothing at the floor: nothing is named');
  assert.equal(RC.weakestSection(sections, { intro: 1, discovery: 1, pitch: 1, objection: 1, close: 1 }), null, 'one graded call lights no bar');
  assert.equal(RC.weakestSection(sections), null, 'no counts = below the floor, never above it');
  assert.equal(RC.weakestSection(sections, {}), null);
});

test('below the floor the note is THIN_LABEL and the ranking\'s own reason — the same words the rep page uses', () => {
  const sections = { intro: 57, discovery: 47, pitch: 65, objection: null, close: 57 };
  const note = RC.sectionFloorNote(sections, { intro: 4, discovery: 4, pitch: 3, objection: 0, close: 4 });
  assert.equal(note.label, SR.THIN_LABEL);
  assert.equal(note.reason, SR.rankSections({ intro: { mean: 57, n: 4 } }).filter(x => x.section === 'intro')[0].reason, 'the reason is rankSections\'s, for the section with the most graded calls');
  assert.match(note.reason, /only 4 calls graded in this period/);
  assert.equal(RC.sectionFloorNote(sections, { intro: F, discovery: F, pitch: F, objection: 0, close: F }), null, 'at the floor there is no note');
  assert.equal(RC.sectionFloorNote({ intro: null, discovery: null, pitch: null, objection: null, close: null }, { intro: 0, discovery: 0, pitch: 0, objection: 0, close: 0 }), null, 'nothing graded at all: the card says "No scored sections yet", not the floor note');
});

/* A fake wire in the shape lane-parallel uses: rows filtered by .in()/.eq() only. */
function fakeAdmin(tables) {
  return { from(table) { const rows = tables[table] || []; const f = { in: [], eq: [] };
    const chain = { select() { return chain; }, not() { return chain; }, is() { return chain; }, gte() { return chain; }, lte() { return chain; }, order() { return chain; }, range() { return chain; }, limit() { return chain; }, maybeSingle() { return chain; }, lt() { return chain; },
      in(col, vals) { f.in.push([col, vals]); return chain; }, eq(col, val) { f.eq.push([col, val]); return chain; },
      then(resolve) { let out = rows.slice(); f.in.forEach(([c, v]) => { out = out.filter(r => v.indexOf(r[c]) !== -1); }); f.eq.forEach(([c, v]) => { out = out.filter(r => r[c] === v); }); resolve({ data: out, error: null }); } };
    return chain; } };
}
function calls(user, n, scores) {
  const C = [], A = [];
  for (let i = 1; i <= n; i++) { const id = user + '-c' + i;
    C.push({ id, user_id: user, fathom_call_id: id, call_date: '2026-09-0' + ((i % 9) + 1) + 'T10:00:00Z', duration_seconds: 1800, prospect_id: user + '-p' + i });
    A.push(Object.assign({ fathom_call_id: id, status: 'done', analyzed_at: '2026-09-09T12:00:00Z', overall_score: 70, outcome: 'lost', close_score_earned: scores.close }, Object.fromEntries(SR.SECTION_ORDER.map(s => [s + '_score', scores[s]])))); }
  return { C, A };
}
const FROM = '2026-09-01T00:00:00.000Z', TO = '2026-09-10T23:59:59.999Z';

test('computeTeamAnalytics: a rep under the floor carries no weakest section and the note; a rep at the floor carries the pick', async () => {
  const thin = calls('thin', F - 1, { intro: 60, discovery: 40, pitch: 70, objection: 65, close: 55 });
  const full = calls('full', F, { intro: 60, discovery: 40, pitch: 70, objection: 65, close: 55 });
  const admin = fakeAdmin({ fathom_calls: thin.C.concat(full.C), call_analyses: thin.A.concat(full.A), call_highlights: [], user_profiles: [{ user_id: 'thin', first_name: 'Thin', active: true }, { user_id: 'full', first_name: 'Full', active: true }], prospects: [], fathom_connections: [], call_connections: [] });
  const out = await TA.computeTeamAnalytics(admin, ['thin', 'full'], FROM, TO, {});
  const byId = Object.fromEntries(out.per_rep.map(r => [r.user_id, r]));
  assert.equal(byId.thin.calls_analyzed, F - 1);
  assert.equal(byId.thin.weakest_section, null, 'under the floor: no bar is lit');
  assert.deepEqual(byId.thin.weakest_section_note, { label: SR.THIN_LABEL, reason: 'only ' + (F - 1) + ' calls graded in this period' });
  assert.deepEqual(byId.full.weakest_section, { section: 'discovery', score: 40 });
  assert.equal(byId.full.weakest_section_note, null);
  assert.equal(byId.thin.sections.discovery, 40, 'the bars themselves still draw — the floor governs the JUDGEMENT, not the numbers');
});

test('computeCallAnalytics (the Coach Summary): under the floor no badge and the note; at the floor weakest and strongest', async () => {
  const thin = calls('me', F - 1, { intro: 60, discovery: 40, pitch: 70, objection: 65, close: 55 });
  let admin = fakeAdmin({ fathom_calls: thin.C, call_analyses: thin.A, call_highlights: [], prospects: [] });
  let out = await SA.computeCallAnalytics(admin, 'me', FROM, TO);
  assert.equal(out.calls.analyzed, F - 1);
  assert.equal(out.weakest_section, null); assert.equal(out.strongest_section, null);
  assert.deepEqual(out.section_ranking_note, { label: SR.THIN_LABEL, reason: 'only ' + (F - 1) + ' calls graded in this period' });
  assert.equal(out.sections.discovery.avg, 40, 'the averages still show');
  const full = calls('me', F, { intro: 60, discovery: 40, pitch: 70, objection: 65, close: 55 });
  admin = fakeAdmin({ fathom_calls: full.C, call_analyses: full.A, call_highlights: [], prospects: [] });
  out = await SA.computeCallAnalytics(admin, 'me', FROM, TO);
  assert.equal(out.weakest_section, 'discovery'); assert.equal(out.strongest_section, 'pitch'); assert.equal(out.section_ranking_note, null);
});

/* THE PAGE, executed: the two renderers lifted from the live source. */
function pageFns() {
  const src = "var SECTION_LABEL = { intro: 'Intro', discovery: 'Discovery', pitch: 'Pitch', objection: 'Objection', close: 'Close' };\n"
    + "function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\"/g,'&quot;'); }\nfunction scoreColor() { return 'var(--text)'; }\n"
    + fnBody(live, 'repSectionBarsHtml') + '\n' + fnBody(live, 'renderCoachSummary2') + '\nreturn { repSectionBarsHtml: repSectionBarsHtml, renderCoachSummary2: renderCoachSummary2 };';
  return new Function(src)();
}

test('the rep card: under the floor no bar is lit and the caption is the note; at the floor the weakest is lit', () => {
  const P = pageFns();
  const sections = { intro: 60, discovery: 40, pitch: 70, objection: 65, close: 55 };
  const note = { label: SR.THIN_LABEL, reason: 'only 4 calls graded in this period' };
  const thin = P.repSectionBarsHtml(sections, null, note);
  assert.equal((thin.match(/class="rep-bar weak"/g) || []).length, 0, 'no lit bar under the floor');
  assert.equal((thin.match(/class="rep-bar"/g) || []).length, 5, 'the five bars still draw');
  assert.ok(thin.indexOf(SR.THIN_LABEL + ' · only 4 calls graded in this period') !== -1, 'the caption is the label and the reason: ' + thin.slice(thin.indexOf('rep-bars-cap')));
  assert.ok(thin.indexOf('weakest lit') === -1, 'the "weakest lit" caption is gone when nothing is lit');
  const full = P.repSectionBarsHtml(sections, { section: 'discovery', score: 40 }, null);
  assert.equal((full.match(/class="rep-bar weak"/g) || []).length, 1);
  assert.ok(full.indexOf('weakest lit') !== -1);
});

test('the Coach Summary: under the floor no badge and the note in the rep page\'s own markup; at the floor the badges', () => {
  const P = pageFns();
  const base = { calls: { analyzed: 4, total_in_range: 4 }, sections: { intro: { avg: 60, n: 4 }, discovery: { avg: 40, n: 4 }, pitch: { avg: 70, n: 4 }, objection: { avg: 65, n: 4 }, close: { avg: 55, n: 4 } } };
  const thin = P.renderCoachSummary2(Object.assign({}, base, { weakest_section: null, strongest_section: null, section_ranking_note: { label: SR.THIN_LABEL, reason: 'only 4 calls graded in this period' } }));
  assert.ok(!/badge-loss|badge-win/.test(thin), 'no weakest/strongest badge under the floor');
  assert.ok(thin.indexOf('<div class="srk-thin">' + SR.THIN_LABEL + '<span>only 4 calls graded in this period</span></div>') !== -1, 'the note, in the section-rank card\'s markup: ' + thin.slice(-300));
  const full = P.renderCoachSummary2(Object.assign({}, base, { weakest_section: 'discovery', strongest_section: 'pitch', section_ranking_note: null }));
  assert.ok(/badge-loss">weakest/.test(full) && /badge-win">strongest/.test(full));
  assert.ok(full.indexOf('srk-thin') === -1);
});

test('the call site passes the note to the bars (a note computed and not rendered is the plant this catches)', () => {
  assert.match(fnBody(live, 'repCardHtml'), /repSectionBarsHtml\(sections, r\.weakest_section, r\.weakest_section_note\)/);
});
