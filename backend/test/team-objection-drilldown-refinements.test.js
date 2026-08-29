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

/* ── 2 · CONVERTED 2026-08-29 — the old panel is now RETIRED ──────────────── */

test('⚠⚠ team-needs-work is RETIRED, and nothing it carried was lost', () => {
  /* ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and it was right at the time: the
     view survived precisely because it carried things the drilldown did not.
     Justin ruled it retired on 2026-08-29, and measuring first showed TWO of
     the three named differences had ALREADY moved to the drilldown, while the
     third was never unique to it. So the SUBJECT of this test — nothing is lost
     — outlives the scaffolding, and only the vehicle inverts.

     The removal itself is guarded in test/objections-panel-retired.js. */
  assert.strictEqual(LIVE.indexOf('function renderTeamNeedsWorkView'), -1,
    'the view must no longer have a live render path');

  /* the two that MOVED */
  assert.ok(LIVE.indexOf('Handle rate by objection type') > -1,
    'the sales-language taxonomy must still render — it is in the drilldown now');
  const lane = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'team-objections.js'), 'utf8');
  assert.ok(/excluded:/.test(lane) && /strict:/.test(lane),
    'the true-objection denominator and its exclusion counts live in the drilldown lane');

  /* the one that was never unique: it is SHARED with the live personal page */
  assert.ok(LIVE.indexOf('openBucketEvidence') > -1, 'bucket → per-call evidence must survive');
  assert.ok(LIVE.indexOf('needsWorkDetailBodyHtml(state.needsWork)') > -1,
    'and stay reachable from the personal rep page, which shares that renderer');

  // the team card stays — it is the only place that context line renders there
  assert.ok(LIVE.indexOf('nwContextLineHtml(d)') > -1,
    'the team card must keep the context line');
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

  // ⚠ CONVERTED 2026-08-26, NOT DELETED. The picker moved to the company card at
  // the top of the page, which THIS VIEW ALSO RENDERS — keeping it here too would
  // put two pickers on the drilldown. What this test protects is unchanged: the
  // controls live in the card and carry the calendar; only the picker line moved.
  const ctrl = slice('function objDrillControlsHtml', '\n  }');
  assert.strictEqual(ctrl.indexOf('teamSelectHtml()'), -1,
    'the drilldown must NOT render its own picker — the company card above it does');
  assert.ok(ctrl.indexOf("datePickerHtml('team')") !== -1, 'the SAME date picker id as the team page');
  assert.ok(ctrl.indexOf('ensureTeamPicker()') !== -1, 'registered, or the calendar has no setter');
  ['manageMembersBtnHtml', 'customizeViewHtml'].forEach((b) => {
    assert.strictEqual(ctrl.indexOf(b), -1, b + ' belongs on the team page, not here');
  });
});

test('⚠ the buttons still exist on the MAIN team controls row', () => {
  // removing them from one page must not remove them from the app
  const main = slice('function teamControlsHtml', '\n  }');
  ['manageMembersBtnHtml()', 'customizeViewHtml()', 'summaryBtnHtml()'].forEach((b) => {
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

  // it is a function, not markup pasted twice
  assert.ok(LIVE.indexOf('function teamSelectHtml') > -1, 'extracted into a function');
  // ⚠ CONVERTED 2026-08-26: there is now exactly ONE call site (the company card),
  // down from two. The rule this test exists for — never a second COPY — is
  // strictly better served by one caller than by two, so the floor became a ceiling.
  const callers = (LIVE.match(/teamSelectHtml\(\)/g) || []).length;
  assert.strictEqual(callers, 2, 'expected the definition plus a single call site; found ' + callers);
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

  /* ⚠ POOLED CLIENT-SIDE FROM THE VISIBLE ROWS, NOT from the server's board
     totals. It used to read d.category_totals; once a rep can be hidden that is
     an average of people who are not on screen, so a reader adding up the rows
     would get a different number. Pooling here keeps the average an accounting
     of exactly the rows above it. */
  assert.ok(/var pool = function/.test(grid), 'the average must be pooled from the visible rows');
  assert.strictEqual(grid.indexOf('d.category_totals'), -1,
    'the server board totals must not drive a row that sits above a FILTERED grid');
  /* ⚠ NOT asserting the explanatory comment — LIVE strips comments, so a check
     on prose can never pass. Assert the ARITHMETIC instead: pooling sums the
     numerators and denominators, a mean of rates would divide per row. */
  assert.ok(/acc\.total \+= /.test(grid) && /acc\.handled \+= /.test(grid),
    'the average must SUM counts (pooled), not average per-closer rates');
});

test('⚠ the average row is not clickable, and shares the grid\'s cell renderer', () => {
  const grid = slice('function teamObjGridHtml', '\n  }');
  assert.ok(grid.indexOf('function cellHtml') !== -1,
    'one cell renderer for both, or the roundings drift while sitting in the same column');
  // the average passes clickable=false at every call site
  /* ⚠ `[^)]*` cannot span the nested parens in cellHtml(pool(function(g){...}), false, k)
     — it matched 1 of 3 and reported a real property as broken. Match the
     argument itself. */
  var avgCalls = grid.match(/,\s*false\s*,/g) || [];
  assert.ok(avgCalls.length >= 2,
    'the average row must build its cells with clickable=false — clicking an aggregate '
    + 'would apply somebody else\'s filter. Found ' + avgCalls.length + ' non-clickable cell calls.');
  assert.ok(/cellHtml\(g\.by_category\[k\], true, k\)/.test(grid),
    'and the CLOSER rows must still be clickable, or this passes by making nothing clickable');
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

/* ── the rep filter, reused on the drilldown ───────────────────────────────── */

test('⚠⚠ THE REP FILTER IS THE SAME CONTROL — one definition, two surfaces', () => {
  /* It began as a chart-legend control: the roster came from live Chart.js
     datasets and applying it toggled dataset visibility. The drilldown has no
     charts, so a straight lift would have rendered NOTHING (empty roster ->
     repFilterHtml returns ''). The control is reused whole and only its two
     chart-coupled ends are parameterised. */
  const defs = (LIVE.match(/function repFilterHtml\b/g) || []).length;
  assert.strictEqual(defs, 1, 'exactly one rep-filter implementation; found ' + defs);

  const roster = slice('function repFilterRoster', '\n  }');
  assert.ok(roster.indexOf('objDrillRoster()') !== -1,
    'the roster must fall back to the drilldown when no charts are live');
  assert.ok(roster.indexOf('eachLiveToggleChart') !== -1,
    'and must still read the charts on the team page — otherwise the graphs lose their filter');

  const ctrl = slice('function objDrillControlsHtml', '\n  }');
  assert.ok(ctrl.indexOf('repFilterHtml()') !== -1, 'the drilldown must mount the control');
  assert.ok(ctrl.indexOf('repFilterHost') !== -1, 'into the same host the renderer writes to');
});

test('⚠⚠ FILTERING HIDES THE REP FROM THE GRID *AND* THE MOMENTS', () => {
  /* Filtering one and not the other leaves a manager reading a hidden rep's
     calls under a table that does not contain them — two halves of one screen
     disagreeing about who is on it. */
  const grid = slice('function teamObjGridHtml', '\n  }');
  assert.ok(/hiddenReps\[g\.user_id\]/.test(grid), 'the grid must drop hidden closers');
  const feed = slice('function teamObjFeedHtml', '\n  }');
  assert.ok(/hiddenReps\[i\.closer\.user_id\]/.test(feed), 'the feed must drop their moments too');

  /* ⚠ AND THE SUMMARY — there are THREE surfaces on this screen, not two. Found
     by looking at a refreshed page: the grid said "all closers hidden" and the
     Why panel went on coaching about him directly underneath. */
  const summary = slice('function teamObjSummaryHtml', '\n  }');
  assert.ok(/hiddenReps\[c\.user_id\]/.test(summary), 'the coaching summary must drop hidden closers');
  assert.ok(/rep filter/i.test(summary), 'and say why when everyone is hidden');

  // ⚠ and hiding EVERYONE must not borrow the empty-range wording — that sends
  // a manager looking for missing data they filtered out themselves.
  assert.ok(/all closers hidden/i.test(grid), 'the all-hidden state must say it is a filter');
  assert.ok(/rep filter/i.test(feed), 'and the feed must point at the control that caused it');
});

test('⚠⚠ THE SELECTION SURVIVES A REFRESH — read AFTER the team is known', () => {
  const view = slice('function renderTeamObjectionsView', '\n  }');
  assert.ok(view.indexOf('loadRepFilter()') !== -1,
    'a refresh straight onto this page must read the saved selection — loadRepFilter '
    + 'otherwise only runs on a team switch or a range change');
  assert.ok(view.indexOf('repFilterStoreKey()') !== -1,
    'and it must be keyed per team, so one team\'s hidden set cannot leak into another');

  /* ⚠ THE GUARD MUST NOT BE A TRUTHINESS TEST. repLineHidden initialises to {},
     which is TRUTHY, so `if (!state.repLineHidden) load()` can never fire —
     that exact guard already shipped once and silently lost the selection on
     every refresh. */
  assert.ok(/state\.repFilterLoadedKey !== rfKey/.test(view),
    'the load must be guarded by an explicit key marker, never by !repLineHidden');
  assert.strictEqual(/if \(!state\.repLineHidden\)\s*loadRepFilter/.test(view), false,
    'the truthiness guard must not come back');
});

test('⚠ applying the filter RE-RENDERS the drilldown — its grid is markup, not a chart', () => {
  const apply = slice('function applyRepFilter', '\n  }');
  assert.ok(apply.indexOf('renderTeamObjectionsView()') !== -1,
    'the chart loop is a no-op with no charts, so nothing would change on screen');
  assert.ok(apply.indexOf('eachLiveToggleChart') !== -1, 'and the chart path must survive');
});

/* ── the strict standard, as rendered ──────────────────────────────────────── */

test('⚠⚠ THE EXCLUSION LINE RENDERS, AND A MISSING CLASSIFIER IS SAID OUT LOUD', () => {
  const grid = slice('function teamObjGridHtml', '\n  }');
  assert.ok(/not counted as coachable objections/.test(grid),
    'the drilldown must print the exclusion line in the old panel\'s words');
  assert.ok(/d\.excluded/.test(grid), 'from the server\'s counts');

  /* ⚠ WITHOUT THE EXCLUSION THE RATE READS *HIGHER* THAN THE TRUTH — the
     direction that flatters, and the one nobody questions. So an unavailable
     classifier must be stated, never silently served as the standard. */
  assert.ok(/d\.strict === false/.test(grid), 'the loose case must be detected');
  assert.ok(/not the usual standard/i.test(grid), 'and labelled on screen');
});

test('⚠ the moment card prefers the sales-language label over the stored category', () => {
  const card = slice('var chipText', ';');
  assert.ok(card.indexOf('f.bucket_label') !== -1, 'the classifier label leads');
  assert.ok(card.indexOf('f.category') !== -1,
    'with the stored category as a fallback, so the chip never disappears');
});

/* ── the old panel, archived ───────────────────────────────────────────────── */

test('⚠⚠ #team-needs-work CANNOT REACH THE ARCHIVED PAGE — from ANY entry point', () => {
  /* ⚠⚠ THIS GUARD USED TO SLICE renderTeamSurface ALONE, AND IT PASSED WHILE
     THE OLD PAGE WAS STILL RENDERING ON PRODUCTION. The view is dispatched from
     THREE places — render(), renderTeamSurface() and scheduleTeamRender() — and
     boot goes through render(). A guard whose scope is one function reports
     success over the two it never looked at.

     So it now asserts the PROPERTY instead: the archived name is normalised at
     both places a view can be SET, and therefore no dispatcher can ever see it. */
  assert.ok(/ARCHIVED_VIEWS\s*=\s*\{[^}]*'team-needs-work'\s*:\s*'team-objections'/.test(LIVE),
    'setView must normalise the archived view name');

  const teamHash = slice('var TEAM_HASH', '};');
  assert.ok(/'team-needs-work':\s*'team-objections'/.test(teamHash),
    'and the HASH path must too — it assigns state.view directly, not through setView, '
    + 'so normalising in setView alone leaves a refresh or a pasted URL still opening it');

  // ⚠ NON-VACUITY: the drilldown's own hash must still map to itself, or this
  // passes by mapping everything to one place.
  assert.ok(/'team-objections':\s*'team-objections'/.test(teamHash), 'the drilldown still routes normally');
});

test('⚠⚠ IT WAS ONLY SAFE TO ARCHIVE BECAUSE THE DRILLDOWN GAINED THE LAST MISSING PIECE', () => {
  /* Rates per SALES-LANGUAGE bucket — "Spouse / partner approval", "Needs time
     / think it over" — were the one thing the old panel had and this one did
     not. Archiving before adding them would have lost them. */
  const grid = slice('function teamObjGridHtml', '\n  }');
  assert.ok(grid.indexOf('Handle rate by objection type') !== -1, 'the bucket list must render');
  assert.ok(grid.indexOf('d.bucket_rates') !== -1, 'from the server, not tallied from the capped feed');

  /* ⚠ AND POOLED OVER THE VISIBLE CLOSERS — the server sends per-closer counts
     precisely so the rep filter reaches this list too, rather than it quietly
     describing people who are filtered out. */
  assert.ok(/b\.by_closer/.test(grid), 'pooled per visible closer');

  // weakest first on the EXACT ratio — rounding first makes a stable wrong winner
  assert.ok(/ea === eb \?/.test(grid), 'sorted on the exact ratio, not the rounded rate');
});

test('⚠ the PERSONAL needs-work view is untouched — it shares the detail renderer', () => {
  /* needsWorkDetailBodyHtml is used by BOTH the archived team page and the
     personal one. Removing the team view must not take the shared renderer with
     it, or a closer's own What-needs-work page dies for a change about the team. */
  assert.ok(LIVE.indexOf('function needsWorkDetailBodyHtml') > -1, 'the shared renderer must survive');
  assert.ok(LIVE.indexOf('onclick="openNeedsWork()"') > -1, 'and the personal entry point');
  assert.ok(/state\.view === 'needs-work'/.test(LIVE) || LIVE.indexOf('renderNeedsWorkView') > -1,
    'the personal view must still be routable');
});
