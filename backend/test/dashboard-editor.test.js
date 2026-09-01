'use strict';
/**
 * THE DASHBOARD EDITOR — block 3.
 *
 * ⚠⚠ WHAT THESE GUARDS EXIST FOR, AND IT IS NOT "the editor works". Three of
 * them pin properties that were WRONG in this block's own first attempt:
 *
 *   1. the second step must offer only what viewsFor() returns — a hand-written
 *      list is how a gauge comes to be offered for a metric with no target, and
 *      the derivation IS the honesty rule;
 *   2. the picker must be mounted on <body> — inside #content it is DESTROYED
 *      UNDER THE POINTER by any of eight lanes landing mid-choice;
 *   3. every class the editor renders must have a CSS rule — `.review-kb-btn`
 *      sat as a grey browser button on a near-black page for three days, and a
 *      stylesheet grep could not find it because the ARCHIVED rule matched.
 *
 * ⚠ AND ONE PINS A DEFECT THIS BLOCK ACTUALLY SHIPPED AND FIXED: dropping
 * `team-dashboard` out of TEAM_PAGES to let the menu synthesise it makes
 * isTeamView FALSE for it, which means a lane's data arrives and NOTHING
 * REPAINTS. Empty cards, in production, exactly as Performance and Coaching
 * shipped once.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ LINE COMMENTS FIRST, THEN BLOCK. A `/*` inside a `//` line is a FALSE
   OPENER that pairs with the next real closer and swallows everything between —
   this file is 43% comment, so the order is load-bearing. */
const LIVE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = (HTML.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('')
  .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/* ⚠ SLICE WITH fromIndex AND ASSERT THE LENGTH. Without fromIndex the end
   marker is found EARLIER in the file, slice() runs backwards and returns '' —
   and every negative assertion below would then pass over an empty string. */
function fn(name, min, max) {
  const at = LIVE.indexOf('function ' + name);
  assert.ok(at !== -1, 'no such function: ' + name);
  const body = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(body.length > min && body.length < max,
    name + ' slice must cover it: ' + body.length);
  return body;
}

// ───────────────────────────────────────────────────────────── the honesty rule

test('⚠⚠ step two offers ONLY viewsFor() — never a hand-written list', () => {
  const body = fn('dashRenderPicker', 800, 4000);
  assert.ok(/m\.views\.map/.test(body),
    'the view list must come from the metric the SERVER sent, not from a literal here');
  /* ⚠ NON-VACUITY BY EXCLUSION: if a literal list of views existed here it
     would name them, so assert none of the five is written out as a choice. */
  ['\'gauge\'', '\'trend\'', '\'by_rep\'', '\'breakdown\''].forEach((v) => {
    assert.ok(!new RegExp('\\[[^\\]]*' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(body),
      'step two must not carry its own array of views: ' + v);
  });
});

test('⚠ a crafted click cannot add a view the server did not offer', () => {
  const body = fn('dashPickView', 200, 1600);
  assert.ok(/m\.views\.indexOf\(view\) === -1\) return/.test(body),
    'the client must re-check the server list before pushing a card');
});

test('⚠⚠ a card STRETCHES, it never changes KIND', () => {
  const resize = fn('dashResizeCard', 100, 700);
  assert.ok(!/\.view\s*=/.test(resize), 'resizing must not write view');
  assert.ok(/c\.w = /.test(resize) && /c\.h = /.test(resize), 'it writes w and h');

  // and the same for the pointer path, which is the one a manager actually uses
  const bind = fn('dashBindDragHandles', 1500, 6000);
  const resizeArm = bind.slice(bind.indexOf('dash-card-handle'));
  assert.ok(resizeArm.length > 400, 'resize arm slice: ' + resizeArm.length);
  assert.ok(!/\.view\s*=/.test(resizeArm), 'the drag-resize must not write view either');
  assert.ok(/card\.w = w/.test(resizeArm), 'it writes only the span');
});

// ───────────────────────────────────────────────────────── the working copy

test('⚠ Cancel restores because the live layout was never mutated', () => {
  const enter = fn('dashEnterEdit', 150, 900);
  assert.ok(/JSON\.parse\(JSON\.stringify\(/.test(enter),
    'edit mode must take a COPY — a discard has to be right once, replaying moves '
    + 'backwards has to be right about every step');
  const cancel = fn('dashCancelEdit', 200, 1500);
  assert.ok(/state\.dashEdit = null/.test(cancel), 'cancel discards the copy');
  assert.ok(/await scoutConfirm/.test(cancel),
    'a dirty cancel must confirm — and `await`, because a promise is always truthy');
});

// ─────────────────────────────────────────────────── the picker's mount point

test('⚠⚠ the picker is mounted on <body>, NOT inside #content', () => {
  const ensure = fn('dashEnsurePicker', 400, 3000);
  assert.ok(/document\.body\.appendChild\(m\)/.test(ensure),
    'eight lanes reassign content.innerHTML; a picker inside it is destroyed under the pointer');
  assert.ok(!/getElementById\('content'\)/.test(ensure), 'and never into #content');
  assert.ok(/if \(m\) return m/.test(ensure), 'created once — one node per open is a leak');
  assert.ok(/ev\.target === m/.test(ensure),
    'a backdrop click closes by TARGET, not by propagation — phase ordering defeated '
    + 'the rep dropdown once');
});

// ──────────────────────────────────────────────────── nothing is unstyled

test('⚠⚠ EVERY class the editor renders has a CSS rule of its own', () => {
  /* `.review-kb-btn` rendered as a grey browser button on a near-black page for
     three days because its rule was archived with a removal and the control came
     back without it. Measured on this editor before the rule block was written:
     35 of 40 classes had no rule at all. */
  const NAMES = [
    'dash-bar', 'dash-bar-btn', 'dash-bar-primary', 'dash-bar-name', 'dash-bar-link',
    'dash-bar-actions', 'dash-grid', 'dash-grid-edit', 'dash-card', 'dash-card-edit',
    'dash-card-title', 'dash-card-note', 'dash-card-remove', 'dash-card-handle',
    'dash-card-dragging', 'dash-card-over', 'dash-dropped', 'dash-empty',
    'dash-empty-title', 'dash-empty-sub', 'dash-picker-backdrop', 'dash-picker',
    'dash-picker-head', 'dash-picker-title', 'dash-picker-x', 'dash-picker-body',
    'dash-pick-group', 'dash-pick-list', 'dash-pick-item', 'dash-pick-back',
    'dash-pick-absent', 'dash-toast', 'dash-pin-badge', 'dash-default-badge',
    'dash-board-select', 'dash-edit-hint', 'dash-card-empty', 'dash-gauge',
    'dash-list', 'dash-list-row', 'dash-list-other',
  ];
  const missing = NAMES.filter((n) => !new RegExp('\\.' + n + '(?![-\\w])').test(CSS));
  assert.deepStrictEqual(missing, [],
    'these render with browser defaults on a near-black page: ' + missing.join(', '));
  // ⚠ and the CSS must be found in the STYLE blocks, not anywhere in the file —
  // a sanity companion, or the check above passes over an empty string.
  assert.ok(CSS.length > 20000, 'CSS slice: ' + CSS.length);
});

test('⚠ the picker sits BELOW the confirm modal, so a confirm from it is never hidden', () => {
  const back = CSS.slice(CSS.indexOf('.dash-picker-backdrop {'));
  assert.ok(back.length > 100, 'slice: ' + back.length);
  const z = /z-index:\s*(\d+)/.exec(back);
  assert.ok(z, 'the backdrop must declare a z-index');
  assert.ok(Number(z[1]) < 9999,
    'scout-modal is 9999 — equal or higher and a confirm raised from the picker '
    + 'draws behind it, which is the nav/page-header tie all over again');
});

// ───────────────────────────────────────────────── the dropdown entry (e)+(f)

test('⚠⚠ the pinned board is TOP of the Team menu, and Customize otherwise', () => {
  const src = HTML.slice(HTML.indexOf('var TEAM_PAGES'), HTML.indexOf('function teamPageSelectHtml'));
  /* ⚠ CEILING RAISED with its cause: the helper gained the comment explaining
     why the label names the board it OPENS rather than requiring a pin. */
  assert.ok(src.length > 200 && src.length < 5400, 'slice: ' + src.length);
  const make = new Function('state', src + '; return teamPagesWithBoard;');

  const noLane = make({ teamDashboard: null })().map((p) => p.label);
  assert.strictEqual(noLane[noLane.length - 1], 'Customize',
    'with no board the entry is last, and is a way IN rather than a name');

  const pinned = make({ teamDashboard: { board: { name: 'Morning board', pinned: true } } })();
  assert.strictEqual(pinned[0].label, 'Morning board', 'a pinned board goes to the TOP');
  assert.strictEqual(pinned[0].view, 'team-dashboard');
  assert.strictEqual(pinned.length, noLane.length, 'it REPLACES the entry, never adds one');

  /* ⚠⚠ CONVERTED 2026-09-01 — JUSTIN HIT THIS AS A BUG. He saved and renamed a
     board and the dropdown still read "Customize", so he concluded the save had
     not worked. IT HAD: the row was in the database, named, with its cards. The
     entry required `pinned` for its LABEL while the server returns boards[0]
     ordered pinned-first then most-recent — so the entry ALWAYS opened that
     board and refused to say its name.
     ⚠ THE POSITION STILL FOLLOWS THE PIN, which is what was specified, and there
     is still exactly ONE entry. Only the label stopped requiring a pin. */
  const unpinned = make({ teamDashboard: { board: { name: 'Morning board', pinned: false } } })();
  assert.strictEqual(unpinned[unpinned.length - 1].label, 'Morning board',
    'an unpinned board still LENDS ITS NAME — the entry opens it, so it names it');
  assert.strictEqual(unpinned[0].label, 'Daily Digest',
    'but it does NOT take the top slot — position follows the pin, as specified');
  assert.strictEqual(unpinned.length, noLane.length, 'and it still REPLACES, never adds');

  /* ⚠ NEVER A GUESS AT A NAME. The nav renders on every page in the product,
     including ones with no business asking the server about dashboards. */
  const erred = make({ teamDashboard: { _error: 'boom' } })().map((p) => p.label);
  assert.ok(erred.includes('Customize'), 'an errored lane falls back to the plain entry');
});

test('⚠⚠ team-dashboard is a TEAM VIEW — or its data arrives and nothing repaints', () => {
  const src = HTML.slice(HTML.indexOf('var TEAM_PAGES'), HTML.indexOf('function teamPageSelectHtml'));
  const is = new Function(src + '; return isTeamView;')();
  assert.ok(is('team-dashboard'),
    'my first attempt had the MENU synthesise this entry and dropped the view from '
    + 'every list — which makes this false, and a false here means the coalescer '
    + 'returns early and the page renders shells forever');
});

// ─────────────────────────────────────────── nothing internal reaches the wire

test('⚠⚠ the catalog payload carries NO engineering notes', () => {
  const cat = require('../lib/widget-catalog.js');
  const wire = JSON.stringify({ groups: cat.grouped(), unavailable: cat.unavailable() });
  /* The CATALOG entries carry `measured` and `note` — "USE close_score_earned,
     NEVER close_score", "migration 027", row counts. They render nowhere, which
     is exactly the problem: that is one innerHTML from being on screen, and the
     customer-language ruling is about what a customer CAN see. */
  /* ⚠⚠ THE FIELD FORM, NOT THE BARE WORD. This banned `measured` as a string and
     duly fired on a customer-facing DESCRIPTION containing the ordinary English
     word — the claim is about a FIELD carrying engineering notes, and the scope
     was every occurrence anywhere. `"measured":` cannot appear in prose. */
  ['"measured"', '"note"', 'close_score', 'migration', 'transcript_stored', 'prompt_version']
    .forEach((w) => assert.ok(!wire.includes(w), 'internal text on the wire: ' + w));
  /* ⚠ AND THE DESCRIPTIONS ARE CUSTOMER PROSE, so they are held to the customer
     -language rule rather than merely being allowed through. */
  cat.grouped().forEach((g) => g.metrics.forEach((m) => {
    assert.ok(m.description && m.description.length > 20,
      m.key + ' has no description — the description is what makes a metric placeable');
    ['chunk', 'embedding', 'cache', 'query', 'column', 'null', 'row '].forEach((w) => {
      assert.ok(m.description.toLowerCase().indexOf(w) === -1,
        m.key + ' description uses mechanism vocabulary: ' + w);
    });
  }));
  // sanity: the payload is not empty, or the assertions above pass over nothing
  assert.ok(cat.grouped().length >= 3 && wire.length > 800, 'wire: ' + wire.length);
  // and every offered metric still carries what the picker needs
  cat.grouped().forEach((g) => g.metrics.forEach((m) => {
    assert.ok(m.key && m.label && Array.isArray(m.views) && m.views.length,
      'the picker needs key, label and views: ' + JSON.stringify(m));
  }));
});

/* ⚠⚠ CONVERTED 2026-09-01 BY RULING, NOT WEAKENED. This asserted that the
   picker NAMES the metrics it cannot offer — "tell them rather than let them
   wonder", which is sound for a metric a manager might EXPECT and wrong for six
   they have never heard of. Justin: a picker that lists what it cannot do
   spends a manager's attention on things they cannot have.
   ⚠ THE SUBJECT THAT SURVIVES IS THE RECORD: the catalog still knows what is
   unavailable and why — that is what it would take to build them. What changed
   is that it is neither SENT nor SHOWN. */
test('⚠⚠ the unavailable list is NOT sent and NOT shown — but the catalog keeps it', () => {
  const cat = require('../lib/widget-catalog.js');

  // the record survives, with its reasons — the positive companion, without
  // which the three absence assertions below could pass over nothing
  const un = cat.unavailable();
  assert.ok(un.length >= 3, 'the catalog must still record what it cannot offer: ' + un.length);
  un.forEach((u) => assert.ok(u.reason === 'no_data' || u.reason === 'no_card',
    'and why, in a closed vocabulary: ' + u.reason));

  // it is not on the wire
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  const at = routes.indexOf("router.get('/catalog'");
  /* ⚠ `'});'` FIRST MATCHES INSIDE `catalogGrouped() });`, so slicing to it stops
     one character short of the payload and the assertion below never sees it.
     Anchor on the handler's own closing line, and assert the length — a slice
     that is too short tests a fragment, and a backwards one tests ''. */
  const route = routes.slice(at, routes.indexOf('\n});', at));
  assert.ok(route.length > 60 && route.length < 400, 'route slice: ' + route.length);
  assert.ok(/res\.json\(\{ groups: catalogGrouped\(\) \}\)/.test(route),
    'the payload is groups only');
  assert.ok(!/unavailable/.test(route),
    'a payload nothing renders is one innerHTML from being back on screen — dropping '
    + 'it from the WIRE is what makes the ruling structural');

  // and it is not in the picker
  assert.ok(!/Scout cannot measure this across your team yet/.test(LIVE),
    'the no-data sentence must be gone');
  assert.ok(!/there is no card that can show it yet/.test(LIVE),
    'and so must the no-card one');
  assert.ok(!/Not available yet/.test(LIVE), 'and the section heading');

  /* ⚠ STEP TWO'S EXPLANATIONS ARE A DIFFERENT THING AND MUST SURVIVE. "No gauge
     — this metric has no target to point at" is about a metric the manager has
     ALREADY CHOSEN, so it explains a gap they are looking at rather than
     advertising something they cannot have. */
  /* ⚠⚠ THE DASH MATCHES EITHER FORM, AND THAT IS THE POINT. This read
     `\\u2014` — the ESCAPE, which is what the file happened to contain — and it
     went red when the copy was rewritten with a literal em dash. Both render
     the identical sentence to a customer, so the guard was pinned to an
     ENCODING while its claim is about the WORDS. (The file's own convention is
     the literal: 1095 against 16.) Same family as pinning a literal value that
     goes stale on the very change it polices. */
  const DASH = '(?:\\\\u2014|\\u2014)';
  assert.ok(new RegExp('No gauge ' + DASH + ' this metric has no target to point at').test(LIVE),
    'a missing VIEW on a chosen metric is still explained');
  /* ⚠ THE COPY MOVED WITH THE GROUPING: step two is now split into "Over time"
     and "Right now", so the absence reads "No line graph" — the word a manager
     used. The SUBJECT is unchanged: a missing view on a CHOSEN metric is still
     explained where the choice is made. */
  assert.ok(new RegExp('No line graph ' + DASH + ' Scout does not keep a history for this one').test(LIVE),
    'both of them');
  assert.ok(/dash-pick-sub">Over time/.test(LIVE) && /dash-pick-sub">Right now/.test(LIVE),
    'and step two must SAY which views move and which are a snapshot — that is the '
    + 'distinction Justin could not see when he ruled that a graph is metric x time');
});

// ────────────────────────────────────────────────── the cap, and the empty board

test('⚠ the ten-board cap reads as words, and the client shows the server\'s', () => {
  const save = fn('dashSaveEdit', 500, 3000);
  assert.ok(/j\.error \|\| 'Could not save your board\.'/.test(save),
    'the server message is shown verbatim — rewriting it here is a second copy of the rule');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  assert.ok(/You already have/.test(routes), 'and the server states it in words, not as a 23505');
});

test('⚠⚠ an empty board says what it is FOR — it is not a blank grid with a plus', () => {
  const body = fn('dashEmptyHtml', 200, 1500);
  assert.ok(/This board is empty/.test(body), 'it says it is empty');
  assert.ok(/dash-bar-primary/.test(body), 'and offers ONE obvious primary action');
  const nb = fn('dashNewBoard', 80, 700);
  assert.ok(/state\.dashEdit = \{/.test(nb),
    'a new board opens straight into EDIT mode — landing in view mode is an empty '
    + 'page with no way to put anything on it');
});

test('⚠ the charts read the WORKING COPY while editing, not the saved board', () => {
  const body = fn('drawDashboardCharts', 300, 2000);
  assert.ok(/state\.dashEdit \|\| state\.teamDashboard/.test(body),
    'reading the saved board mid-edit draws the cards the manager had BEFORE their '
    + 'edits — right-looking, wrong data');
});
