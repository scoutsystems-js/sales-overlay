/**
 * THE SIX REFINEMENTS TO THE OBJECTION DRILLDOWN (Justin, 2026-08-22).
 *
 * ⚠ These are mostly ABSENCE assertions — a control removed, a fill removed, a
 * destination changed. Absence assertions are the easiest tests in the codebase
 * to write and have mean nothing: `assert(!found)` passes trivially against an
 * empty or mis-read string. So every one here is paired with a presence check
 * on the surviving host, and the whole file was run against the un-edited page
 * first to confirm each assertion fails.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ LINE comments before BLOCK comments. This file archives removed code in
   place and explains its own rules in prose, so a raw match reports the
   explanation as the code — and a `/*` inside a `//` line is a false opener
   that swallows everything to the next close delimiter. */
const LIVE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function slice(name, endMarker) {
  const at = LIVE.indexOf(name);
  assert.ok(at > -1, 'stale anchor: ' + name);
  const end = LIVE.indexOf(endMarker, at);   // fromIndex ALWAYS
  assert.ok(end > at, 'end marker for ' + name + ' not found after it');
  const src = LIVE.slice(at, end + endMarker.length);
  assert.ok(src.length > 60 && src.length < 9000, name + ' slice length ' + src.length);
  return src;
}

/* ── 1 · every objection entry point on the TEAM view lands on the drilldown ─ */

test('⚠⚠ BOTH team-view objection entry points now open the drilldown', () => {
  // the "Objection Handling Focus" card
  const card = slice('function openTeamNeedsWork', '\n  }');
  assert.ok(card.indexOf('openTeamObjections()') !== -1,
    'the focus card must open the drilldown');

  // the team-averages objection gauge
  const gauge = slice('function openAvgObjections', '\n  }');
  assert.ok(gauge.indexOf("setView('team-objections')") !== -1,
    'the objection gauge must open the drilldown');

  /* ⚠ AND THE LANES IT CLEARS MUST MATCH WHERE IT LANDS. This function narrows
     the range to the gauge's fixed 7 days; if it cleared the OLD destination's
     lane, the drilldown would render the previous range's grid under a freshly
     narrowed window — the destination disagreeing with the click that opened
     it, silently. */
  ['teamObjections', 'teamObjSummary'].forEach((k) => {
    assert.ok(new RegExp('state\\.' + k + '\\s*=\\s*null').test(gauge),
      'openAvgObjections must clear ' + k + ' — it changes the range on the way in');
  });
  assert.strictEqual(gauge.indexOf('state.teamNeedsWork = null'), -1,
    'and must no longer clear the lane of a page it does not open');
});

test('⚠⚠ THE PERSONAL SURFACES ARE DELIBERATELY NOT RETARGETED — the drilldown is manager-only', () => {
  /* Justin's ruling is scoped to Team view. The drilldown is gated to
     manager+owner server-side, so pointing a closer's own objection controls at
     it would 403 every closer on the platform — turning a routing tidy-up into
     an outage for the people the personal pages exist for. */
  const glance = slice('Objection handle rate', ');');
  assert.ok(glance.indexOf('goObjections()') !== -1,
    'the personal glance tile must still open the personal objections page');

  const personalCard = LIVE.indexOf('onclick="openNeedsWork()"');
  assert.ok(personalCard > -1, 'the personal what-needs-work card must keep its own destination');
});

/* ── 2 · the old panel is NOT archived — something is lost ─────────────────── */

test('⚠⚠ team-needs-work SURVIVES: it carries three things the drilldown does not', () => {
  /* Reported rather than archived, per the block's own instruction. The
     drilldown buckets by the STORED objection_category (4 values); this panel
     buckets by an LLM surface-label taxonomy, excludes disqualifications and
     logistical barriers from the rate, SAYS SO in a context line, and makes
     each bucket clickable through to the calls. None of that exists on the new
     page, so removing this would lose it. */
  assert.ok(LIVE.indexOf('function renderTeamNeedsWorkView') > -1, 'the view must still exist');
  assert.ok(LIVE.indexOf('not counted as coachable objections') > -1,
    'the disqualification / logistical context line is the specific thing with no equivalent');
  assert.ok(LIVE.indexOf('openBucketEvidence') > -1, 'bucket → per-call evidence must survive');

  // the card stays on the team view too — it is the only place that line renders there
  assert.ok(LIVE.indexOf('nwContextLineHtml(d)') > -1,
    'the team card must keep the context line; retargeting its click does not remove it');
});

/* ── 3 + 6 · controls moved INTO the card; two buttons gone from this page ── */

test('⚠⚠ the drilldown renders its controls IN the card, and drops the team-only buttons', () => {
  const view = slice('function renderTeamObjectionsView', '\n  }');

  assert.ok(view.indexOf('objDrillControlsHtml()') !== -1, 'the in-card controls must be rendered');
  assert.strictEqual(view.indexOf('teamControlsHtml()'), -1,
    'the strip above the card must be gone — that is what removes Manage Members and Customize View');

  // ⚠ CUT-TOO-DEEP CHECK: the card and its contents must survive the move.
  ['teamObjGridHtml()', 'teamObjSummaryHtml()', 'teamObjFeedHtml()', 'teamHeaderHtml()'].forEach((m) => {
    assert.ok(view.indexOf(m) !== -1, m + ' must survive the toolbar move');
  });

  // and the controls must genuinely carry the picker + the calendar
  const ctrl = slice('function objDrillControlsHtml', '\n  }');
  assert.ok(ctrl.indexOf('teamSelectHtml()') !== -1, 'the team selector');
  assert.ok(ctrl.indexOf("datePickerHtml('team')") !== -1, 'the SAME date picker id as the team page');
  assert.ok(ctrl.indexOf('ensureTeamPicker()') !== -1, 'registered, or the calendar has no setter');
  ['manageMembersBtnHtml', 'customizeViewSoonHtml'].forEach((b) => {
    assert.strictEqual(ctrl.indexOf(b), -1, b + ' belongs on the team page, not here');
  });
});

test('⚠ the buttons still exist on the MAIN team controls row', () => {
  // removing them from one page must not remove them from the app
  const main = slice('function teamControlsHtml', '\n  }');
  ['manageMembersBtnHtml()', 'customizeViewSoonHtml()', 'summaryBtnHtml()'].forEach((b) => {
    assert.ok(main.indexOf(b) !== -1, b + ' must remain on the team page');
  });
});

/* ── 4 · the picker is REUSED, not reimplemented ───────────────────────────── */

test('⚠⚠ ONE team-selector definition in the whole page', () => {
  const selects = (LIVE.match(/onchange="pickTeam/g) || []).length;
  assert.strictEqual(selects, 1,
    'found ' + selects + ' team selectors. A second copy is how the two drift — a different '
    + 'label, a different handler, a selection that persists on one page and not the other, '
    + 'and nothing reports it because both render a perfectly good dropdown.');

  // it is a function both callers use, not markup pasted twice
  assert.ok(LIVE.indexOf('function teamSelectHtml') > -1, 'extracted into a function');
  const callers = (LIVE.match(/teamSelectHtml\(\)/g) || []).length;
  assert.ok(callers >= 3, 'expected the definition plus both call sites; found ' + callers);
});

/* ── 5 · the team average ──────────────────────────────────────────────────── */

test('⚠⚠ THE TEAM AVERAGE NEEDS TWO CLOSERS, AND SAYS SO WHEN IT HAS ONE', () => {
  const grid = slice('function teamObjGridHtml', '\n  }');
  assert.ok(/MIN_CLOSERS_FOR_TEAM_AVG/.test(grid), 'the floor must be a named constant');
  assert.ok(grid.indexOf('obj-grid-avg') !== -1, 'the average row must exist at all');

  /* ⚠ WITH ONE CLOSER THE AVERAGE IS THAT CLOSER'S OWN ROW, DIGIT FOR DIGIT.
     Rendering it would imply a comparison that does not exist; omitting it
     silently would be indistinguishable from a broken row. So it is omitted
     WITH A REASON. */
  assert.ok(/at least two closers/i.test(grid),
    'the one-closer branch must state why the average is absent');

  // pooled, from the same filtered rows as the grid — never a mean of rates
  assert.ok(grid.indexOf('d.category_totals') !== -1,
    'the average must come from the server\'s pooled per-category totals');
});

test('⚠ the average row is not clickable, and shares the grid\'s cell renderer', () => {
  const grid = slice('function teamObjGridHtml', '\n  }');
  assert.ok(grid.indexOf('function cellHtml') !== -1,
    'one cell renderer for both, or the roundings drift while sitting in the same column');
  // the average passes clickable=false
  assert.ok(/cellHtml\(ct\[k\], false, k\)/.test(grid),
    'average cells must not carry the category filter — clicking an aggregate would apply '
    + 'somebody else\'s filter');
});

/* ── 7 · the labels lose their boxes, keep their words and colour ──────────── */

test('⚠⚠ MOMENT-CARD LABELS HAVE NO FILL, AND THE RULE IS SCOPED TO THAT CARD', () => {
  const at = LIVE.indexOf('.obj-card-head .badge');
  assert.ok(at > -1, 'the un-filling rule must exist');
  const rule = LIVE.slice(at, LIVE.indexOf('}', at) + 1);
  assert.ok(/background:\s*none/.test(rule), 'the fill must be removed');

  /* ⚠ SCOPED, DELIBERATELY. .badge and .scope-pill are used across the app —
     call-library status, billing status, KB scope. Stripping their fill globally
     would turn a note about one feed into a site-wide restyle. */
  assert.ok(rule.indexOf('.obj-card-head') !== -1, 'the rule must be scoped to the moment card');

  // the global definitions must be untouched
  assert.ok(/\.badge-win\s*\{\s*background:\s*rgba\(9, 224, 70, 0\.12\)/.test(LIVE),
    'the global badge fills must survive — other surfaces still use them');
  assert.ok(/\.scope-pill\s*\{[\s\S]*?background:\s*rgba\(var\(--accent-rgb\), 0\.10\)/.test(LIVE),
    'the global scope-pill fill must survive');

  // the words and their colours must remain
  assert.ok(/\.badge-fu\s*\{[^}]*color:\s*var\(--mid\)/.test(LIVE), 'PARTIAL keeps its amber');
  assert.ok(/\.badge\s*\{[\s\S]*?text-transform:\s*uppercase/.test(LIVE),
    'uppercase + spacing are what keep them scannable once the box is gone');
});
