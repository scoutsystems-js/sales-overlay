/**
 * ADD-TO-KB CONTROLS REMOVED — Justin's ruling 2026-08-18.
 * "Even kill the live one if it does so automatically."
 *
 * Both manual Add-to-KB controls are gone from the render path:
 *   A. the section drilldown's "+ Save"      (.sec-kb-btn)  — was already DEAD
 *      (canSave = !state.viewingUserId, never true after boot)
 *   B. the call-review section-card "+ Add to KB" (.review-kb-btn) — was LIVE
 *
 * Evidence behind the ruling, measured 2026-08-18 on production:
 *   knowledge_base WHERE metadata->>'category' = 'call_moment'
 *     auto_closed_call · personal   313    2026-08-03 → 2026-08-17
 *     manual_add                      0
 * Two weeks live on the review page, not a single click. Auto-harvest
 * (lib/kb-harvest.js, Phase 7b) already captures the good moments.
 *
 * ⚠⚠ THE ROUTES STAY MOUNTED, AND THAT IS A RULING — NOT AN OVERSIGHT.
 * POST /kb/from-highlight is a THIN WRAPPER over buildMomentRow + insertMoment,
 * the same insert auto-harvest calls, and its tests are what pin KB RULING 1
 * (harvested material is category 'learned_pattern' + metadata 'call_moment', so
 * two independent filters keep it out of the grader). Deleting the route to tidy
 * up would delete the enforcement of a ruling — a far worse trade than an unused
 * endpoint. Justin, 2026-08-18.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'web', 'dashboard.html');
const HTML = fs.readFileSync(WEB, 'utf8');

// ⚠ Comments stripped FIRST. This codebase archives replaced code in place, so
// every removed control still exists verbatim inside a /* */ block. Matching the
// raw file would report the removal as un-shipped. Same discipline the Title Case
// guard uses, and the same one the deploy-verification rule requires.
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/* ⚠⚠ CONVERTED 2026-08-29 — ONE OF THE TWO CONTROLS IS BACK, AND THE
   DISTINCTION IS THE WHOLE POINT.

   The 2026-08-18 removal deleted TWO things:
     A — the drilldown "+ Save", a REP button that duplicated auto-harvest.
         313 moments filed automatically, ZERO added by hand. STILL REMOVED.
     B — the call-review "+ Add to KB". Restored 2026-08-29 as a MANAGER
         control (managers and above), because a manager marking the standard
         is the CORRECTION mechanism, not a duplicate of auto-harvest — and
         there was no way to do it at all.

   ⚠ So this file no longer asserts "both are gone". It asserts A is gone and B
   is MANAGER-GATED, which is a narrower and truer claim. The rep-duplication
   ruling is untouched. */
const GONE = [
  'sec-kb-btn',            // A: the drilldown button class
  'sec-saved',             // A: its saved badge
  'addSectionMomentToKb',  // A: its handler
  'saved_to_kb',           // A: the server-marked saved flag it read
  'addToKb',               // B's old PER-CALL-SITE opt — the gate is role-based now
];

/* B's markers, which must be present AND gated. */
const RESTORED = ['review-kb-btn', 'addMomentToKb', 'loadSavedMoments', 'savedMomentIds'];

test('the REP control (A) is still gone from the render path', () => {
  const survivors = GONE.filter((s) => LIVE.indexOf(s) !== -1);
  assert.deepStrictEqual(survivors, [],
    'still live in dashboard.html: ' + JSON.stringify(survivors));
});

test('⚠ the MANAGER control (B) is back — and gated on role, not on a call site', () => {
  RESTORED.forEach((m) => assert.ok(LIVE.indexOf(m) !== -1, m + ' should be live again'));
  assert.ok(/function canMarkStandard\(\)/.test(LIVE), 'the role gate must exist');
  assert.ok(/r === 'manager' \|\| r === 'owner'/.test(LIVE), 'managers and above only');
  /* ⚠ Last time B was switched on per call site and reached only ONE of the two
     surfaces highlightEntryHtml renders — the section cards, never the Call
     Highlights timeline, which is the surface the feature was described from. */
  assert.ok(/if \(canMarkStandard\(\) && h\.id\)/.test(LIVE),
    'the gate must be inside the shared row renderer');
});

test('⚠ NON-VACUITY — the matcher actually catches a reintroduced control', () => {
  // A negative assertion passes trivially against an empty or mis-read string.
  // Prove the check fires by putting one back.
  assert.ok(LIVE.length > 100000, 'LIVE looks truncated: ' + LIVE.length);
  const broken = LIVE + '\n<button class="sec-kb-btn" onclick="addSectionMomentToKb(1)">+ Save</button>';
  const found = GONE.filter((s) => broken.indexOf(s) !== -1);
  assert.ok(found.indexOf('sec-kb-btn') !== -1 && found.indexOf('addSectionMomentToKb') !== -1,
    'the matcher must see a reintroduced REP button, or this proves nothing');
});

test('the surfaces that HOSTED the buttons still render — only the buttons went', () => {
  // Removing a control must not take its host panel with it. Each of these is an
  // anchor whose absence would mean the deletion cut too deep.
  [
    'function sectionMomentHtml',   // A's host row (drilldown "What to fix")
    'function closerMomentHtml',    // A's host row (drilldown "What worked")
    'function sectionGroupHtml',    // the drilldown group wrapper
    'function highlightEntryHtml',  // B's host row
    'review-highlight-row1',        // the row the button sat in
    'function sectionBreakdown',    // the Part-1b two-group breakdown
  ].forEach(function (anchor) {
    assert.ok(LIVE.indexOf(anchor) !== -1, 'deletion cut too deep — missing: ' + anchor);
  });
});

// ── the routes and the write path are DELIBERATELY untouched ───────────────
test('⚠⚠ POST /kb/from-highlight and GET /kb/saved-moments STAY MOUNTED', () => {
  const kb = fs.readFileSync(path.join(__dirname, '..', 'routes', 'kb.js'), 'utf8');
  assert.ok(/router\.post\('\/from-highlight'/.test(kb),
    'from-highlight was removed — it is the wrapper whose tests pin KB ruling 1');
  assert.ok(/router\.get\('\/saved-moments\//.test(kb),
    'saved-moments was removed — leave it mounted, see the header of this file');
});

test('the auto-harvest write path is untouched — it is what replaces the buttons', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kb-entry.js'), 'utf8');
  const harvest = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kb-harvest.js'), 'utf8');
  assert.ok(/buildMomentRow/.test(entry) && /insertMoment/.test(entry));
  assert.ok(/buildMomentRow/.test(harvest) && /insertMoment/.test(harvest),
    'auto-harvest must still go through the shared insert');
});

/**
 * ⚠ THE CONSEQUENCE, RECORDED HERE SO IT IS FOUND RATHER THAN REDISCOVERED
 * (Justin's instruction, 2026-08-18):
 *
 * WITH THESE CONTROLS GONE THERE IS NO PATH FROM A REP'S CALL MOMENT INTO THE
 * TEAM KB.
 *
 *   • auto-harvest always writes scope 'personal' with uploaded_by = the rep
 *     (lib/kb-harvest.js — deliberate, it is what makes it idempotent with the
 *     old manual button by construction)
 *   • the visibility rule is  scope='personal' AND uploaded_by = p_user_id
 *     (lib/kb-scope.js) — so a MANAGER CANNOT SEE a rep's harvested rows in
 *     /kb/list at all
 *   • therefore the PATCH /kb/:source_label/scope promotion toggle can never
 *     reach them: you cannot re-scope a row you cannot see
 *
 * The deleted review-card button was the ONLY route (KB ruling 5: "a MANAGER
 * clicking Add-to-KB on a rep's call promotes into the TEAM KB — the button IS
 * the promotion path, no separate curation queue").
 *
 * Nothing is lost today: zero team-scoped call moments have ever existed. But
 * the CAPABILITY is gone, and a future session asking "how does a manager
 * promote a rep's moment?" should find this note rather than rediscover the gap.
 * Reopening it means either harvesting to team scope for managed reps, or giving
 * managers read visibility of their reps' personal call moments — both are
 * rulings, not tidy-ups.
 */
test('the manager→team gap is STILL real for AUTO-HARVESTED rows — B does not close it', () => {
  /* ⚠ B gives a manager a way to mark a moment FROM A CALL. It does NOT let
     them see, or promote, a row auto-harvest already wrote into a rep's
     personal KB — that remains unreachable, and the assertions below still
     hold. Two different paths; only one of them now exists. */
  const harvest = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kb-harvest.js'), 'utf8');
  const scope = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kb-scope.js'), 'utf8');
  const kbScope = require('../lib/kb-scope');

  assert.ok(/scope\s*:\s*'personal'/.test(harvest),
    'if auto-harvest ever stops writing personal scope, the note above needs revisiting');
  assert.ok(/scope\s*=\s*'personal'\s*AND\s*kb\.uploaded_by\s*=\s*p_user_id/.test(scope)
    || /'personal'/.test(scope), 'personal branch missing from the scope predicate');

  // The gap, asserted rather than described: a manager cannot see a rep's
  // harvested row, so the promotion toggle can never reach it.
  const repRow = { uploaded_by: 'rep-1', scope: 'personal', team_owner_id: null };
  const managerScope = { p_user_id: 'mgr-1', p_admin_id: 'mgr-1' };
  assert.strictEqual(kbScope.kbReadRowVisible(repRow, managerScope), false,
    'a manager seeing this row would mean the gap has been closed — update the note');
  assert.strictEqual(kbScope.kbReadRowVisible(repRow, { p_user_id: 'rep-1', p_admin_id: 'mgr-1' }), true,
    'the rep must still see their own harvested moments');
});
