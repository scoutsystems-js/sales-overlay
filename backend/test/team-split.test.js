/**
 * ⚠⚠ THE TEAM PAGE SPLIT (2026-08-31). One page carried gauges, a digest, three
 * graphs, rep cards, three score lists and two coaching panels. Five pages now:
 * Daily Digest (default landing) · Performance · Coaching · Objections · People.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = H.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

function panels() {
  const m = /var TEAM_PANELS = \[([\s\S]*?)\];/.exec(LIVE);
  assert.ok(m, 'the panel registry must exist');
  const out = [];
  m[1].replace(/key:\s*'([\w-]+)'[\s\S]*?page:\s*'([\w-]+)'/g, (_, k, p) => { out.push({ key: k, page: p }); });
  return out;
}

test('every panel is assigned to exactly one page', () => {
  const ps = panels();
  /* ⚠ 9 -> 8 on 2026-09-01: 'needswork' went with the Objection Handling Focus
     section (Justin — there is a whole Objections page in the sidebar and the
     card linked straight to it). A panel offered in the chooser that nothing
     gates in the render is a control that does nothing, and this guard's sibling
     below caught exactly that the moment the section came off. */
  assert.strictEqual(ps.length, 8, 'every panel must carry a page, got ' + ps.length);
  assert.strictEqual(new Set(ps.map(p => p.key)).size, 8, 'no duplicate keys');
  ps.forEach(p => assert.ok(/^team(-\w+)?$/.test(p.page), p.key + ' has no valid page'));
});

/* ⚠⚠ THE STORED SET IS A LIST OF THESE KEYS, so keeping the keys IS the
   migration: a panel a manager hid stays hidden where it now lives.
   Namespacing per page would have reset the set and silently un-hidden
   everything they chose to hide. */
test('⚠ the panel KEYS are unchanged — that is the Customize View migration', () => {
  const keys = panels().map(p => p.key).sort();
  /* ⚠ REMOVING a retired panel is not RENAMING a live one, and only the second
     would orphan a stored choice. A key whose section no longer exists is
     discarded on read — which is why the HIDDEN set is stored rather than the
     visible one. The eight that remain keep their names, which is the property. */
  assert.deepStrictEqual(keys,
    ['closing', 'digest', 'gauges', 'graphs', 'objection', 'overview', 'recs', 'reps'],
    'renaming a surviving key would orphan what a manager hid');
  assert.ok(!keys.includes('needswork'),
    'the retired panel must not linger in the chooser — it would toggle nothing');
  assert.ok(/scout_team_panels_v1/.test(LIVE), 'the storage key must not be namespaced per page');
});

test('⚠ the all-hidden note asks about THIS page, not every panel', () => {
  const at = LIVE.indexOf('function allPanelsHiddenNoteHtml');
  const body = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(body.length > 150 && body.length < 1200, 'slice must cover it: ' + body.length);
  assert.ok(/panelsForPage\(\)/.test(body), 'must scope to the current page');
  assert.ok(!/TEAM_PANELS\.some/.test(body),
    'asking about ALL panels leaves a page blank and silent when its own three are hidden');
});

/* ⚠⚠ PER DISPATCHER, NOT A COUNT OVER THE FILE. The first version asserted
   `state.view === '<v>'` appeared >= 2 times anywhere — and it was VACUOUS:
   the string also occurs in viewToHashPath, so deleting a whole dispatcher line
   still left two and the guard passed. Proven by restoring that exact defect.
   Slice each router and require the view inside BOTH. */
/* ⚠⚠⚠ THE THIRD DISPATCHER — THE ONE THAT SHIPPED BROKEN TO PRODUCTION.
   scheduleTeamRender() is what EVERY lane calls when its data arrives. It
   carried its OWN list of four views and `return`ed on the rest, so on
   Performance and Coaching the data landed and NOTHING REPAINTED: shells on
   screen, content never drawn. Justin saw empty cards.
   ⚠ The guard written the day before covered the two dispatchers I KNEW about.
   A third existed. So this asserts the SHAPE — the coalescer must not hold a
   view list of its own — rather than enumerating dispatchers I can think of. */
test('⚠⚠⚠ the render coalescer holds NO view list of its own', () => {
  const at = LIVE.indexOf('function scheduleTeamRender');
  assert.ok(at !== -1, 'stale anchor — the coalescer is gone');
  const body = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(body.length > 200 && body.length < 2000, 'slice must cover it: ' + body.length);

  assert.ok(/isTeamView\(state\.view\)/.test(body),
    'the coalescer must ask ONE shared predicate whether this is a team page');
  assert.ok(/renderTeamSurface\(\)/.test(body),
    'and route through the one team dispatcher');
  const named = (body.match(/state\.view === '/g) || []).length;
  assert.strictEqual(named, 0,
    'the coalescer names ' + named + ' view(s) directly — a third copy of the list, '
    + 'and a page missing from it repaints NEVER while looking merely slow');
});

/* ⚠ isTeamView IS DERIVED FROM TEAM_PAGES, not hand-written, so adding a sixth
   page cannot leave the coalescer or the nav behind. Executed, because a text
   check cannot see the list going stale. */
test('⚠⚠ isTeamView covers every page in the dropdown, and says no to others', () => {
  const at = H.indexOf('var TEAM_PAGES');
  const src = H.slice(at, H.indexOf('function teamPageSelectHtml', at));
  assert.ok(src.length > 200 && src.length < 3000, 'slice must cover it: ' + src.length);
  const is = new Function(src + '; return isTeamView;')();

  const pages = [...H.matchAll(/\{ view: '([a-z-]+)',\s+label:/g)].map(m => m[1]);
  assert.strictEqual(pages.length, 5, 'expected five pages, found ' + pages.length);
  pages.forEach(v => assert.ok(is(v), v + ' is in the dropdown but isTeamView says no'));
  ['team-expanded', 'team-needs-work'].forEach(v =>
    assert.ok(is(v), v + ' is a team sub-view and must still repaint'));
  ['overview', 'kb', 'eod', 'call-library', 'account'].forEach(v =>
    assert.ok(!is(v), v + ' is not a team page — the coalescer must not repaint it'));
});

/* ⚠ THE NAV'S ACTIVE STATE READS THE SAME LIST. It had gone stale in exactly
   the same way and lost its underline on Performance and Coaching. */
test('⚠ the Team tab stays underlined on every team page', () => {
  const at = LIVE.indexOf('function updateNavActiveStates');
  const body = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(body.length > 300 && body.length < 3000, 'slice must cover it: ' + body.length);
  assert.ok(/navTeam\.classList\.toggle\('nav-active', isTeamView\(state\.view\)\)/.test(body),
    'the nav must use the shared predicate, not its own list of team views');
});

/* ⚠ THE LANE EVERY REP CARD READS. The split dropped this kick entirely — no
   renderer asked for it — so each card's one-line summary was blank forever. */
test('⚠ the page whose cards read teamWhy actually kicks that lane', () => {
  const at = LIVE.indexOf('function renderTeamPerformance');
  const body = LIVE.slice(at, LIVE.indexOf('content.innerHTML', at));
  assert.ok(body.length > 200 && body.length < 2500, 'slice must cover it: ' + body.length);
  assert.ok(/loadTeam\('why'\)/.test(body), 'rep cards read state.teamWhy — the lane must be kicked');
  // every lane a page's panels read must be kicked BY that page
  ['overview', 'repSeries', 'teamAverages', 'why'].forEach(l =>
    assert.ok(body.indexOf("loadTeam('" + l + "')") !== -1, 'Performance must kick ' + l));
});

test('⚠⚠ BOTH dispatchers carry all five pages', () => {
  const ROUTERS = ['function render()', 'function renderTeamSurface()'];
  const bodies = ROUTERS.map((sig) => {
    const at = LIVE.indexOf(sig);
    assert.ok(at !== -1, 'stale anchor — ' + sig + ' is gone');
    const body = LIVE.slice(at, LIVE.indexOf('\n  }', at));
    assert.ok(body.length > 200 && body.length < 6000, sig + ' slice: ' + body.length);
    return [sig, body];
  });
  ['team', 'team-performance', 'team-coaching', 'team-objections', 'team-members'].forEach((v) => {
    bodies.forEach(([sig, body]) => {
      assert.ok(body.indexOf("state.view === '" + v + "'") !== -1,
        v + ' is not dispatched in ' + sig + ' — the multiple-dispatch trap');
    });
  });
  assert.ok(!/renderTeamView\(\)/.test(LIVE), 'the pre-split entry point must be fully unwired');
});

/* ⚠⚠ THE HASH HAS TWO SIDES AND ONLY ONE FAILS LOUDLY. TEAM_HASH is the READ
   side; viewToHashPath is the WRITE side. The first version checked only the
   read side, so deleting both new write cases — the real bug found in this
   block, where the URL stopped naming the page and a refresh lost it — left it
   GREEN. Assert the ROUND TRIP: what a page writes must read back to it. */
test('every page round-trips through the hash — written, then read back', () => {
  const read = /var TEAM_HASH = \{([\s\S]*?)\};/.exec(LIVE);
  assert.ok(read, 'stale anchor — TEAM_HASH is gone');
  const at = LIVE.indexOf('function viewToHashPath');
  const write = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(write.length > 500 && write.length < 4000, 'write-side slice: ' + write.length);

  ['team', 'team-performance', 'team-coaching', 'team-objections', 'team-members'].forEach((v) => {
    const m = new RegExp("state\\.view === '" + v + "'\\)\\s*return '([a-z-]+)'").exec(write);
    assert.ok(m, v + ' has no WRITE case — it would emit an empty hash and a refresh would lose it');
    const slug = m[1];
    assert.ok(new RegExp("'" + slug + "':\\s*'" + v + "'").test(read[1]),
      '#' + slug + ' is written for ' + v + ' but does not read back to it');
  });
  // ⚠ a bookmark is a link too: the retired path must still route in.
  assert.ok(/'team':\s*'team'/.test(read[1]), 'the legacy #team must still route');
});

/* ⚠ teamRangePage() reads state.view, so parsing the range BEFORE the view is
   assigned would seed the range of the page you were on before navigating. */
test('the hash assigns the view BEFORE seeding that page\'s range', () => {
  const at = LIVE.indexOf('var TEAM_HASH');
  const blk = LIVE.slice(at, at + 1600);
  const v = blk.indexOf('state.view = TEAM_HASH[base]');
  const r = blk.indexOf('state.teamRanges[teamRangePage()] = hashed');
  assert.ok(v !== -1 && r !== -1 && r > v, 'view must be assigned first');
});

/* ⚠⚠ EXECUTED, NOT GREPPED. A text assertion that TEAM_RANGE_PAGE has entries
   cannot see teamRangePage() collapsed to a constant — the single-shared-range
   bug the split exists to remove. Proven: that mutation tripped NOTHING until
   this test ran the real function. Different pages must resolve to different
   range keys, or five pages silently share one window again. */
/* ⚠⚠ THE CAPTION WENT, THE MACHINERY STAYED — CONVERTED 2026-09-01, AND THE
   TRADE IS RECORDED RATHER THAN LOST. This test used to require an on-screen
   line reading "These dates apply to Coaching. Each page keeps its own." It was
   removed in the caption pass: it explained OUR OWN STATE MODEL, which is not
   something a reader can act on.

   ⚠ SAYING WHAT THAT COST, PLAINLY, BECAUSE THE ORIGINAL REASONING WAS SOUND:
   five pages each own a window, so a manager who picks 90 days on one page and
   arrives at another finds it back on 7. That is correct behaviour and it is now
   UNEXPLAINED. The picker sits in each page's own controls row under that page's
   own heading, which is the argument that it needs no caption — but proximity is
   weaker than a sentence, and the surprise happens on ARRIVAL at the second page,
   where proximity says nothing. If this ever reads as a bug, the honest fixes are
   a shared range or an explanation, NOT a quieter version of the old apology.

   ⚠ WHAT REMAINS PINNED IS THE PART A READER CANNOT SEE AND CANNOT WORK AROUND:
   that each page genuinely resolves to its OWN range key. teamPageForView still
   has six call sites doing exactly that, so the executed check below is the live
   mechanism, not a leftover from the caption. */
test('⚠ each page resolves to its OWN range, and the drilldown rides coaching\'s', () => {

  /* ⚠ EXECUTED: a text check cannot see the label resolving to the wrong page.
     ⚠⚠ FROM THE RAW SOURCE, NOT `LIVE`. The comment stripper exists for TEXT
     matching; running its output can throw, because filtering comment LINES can
     leave a block delimiter unpaired. Comments are harmless to new Function. */
  const src = H.slice(H.indexOf('var TEAM_PAGES'), H.indexOf('function teamPageSelectHtml'));
  assert.ok(src.length > 200 && src.length < 2500, 'slice must cover it: ' + src.length);
  const label = new Function('state', src +
    '; return (TEAM_PAGES.filter(function (p) { return p.view === teamPageForView(state.view); })[0] || {}).label;');
  assert.strictEqual(label({ view: 'team-performance' }), 'Performance');
  assert.strictEqual(label({ view: 'team-coaching' }), 'Coaching');
  assert.strictEqual(label({ view: 'team-objections' }), 'Objections');
  // the drilldown rides coaching's window, so it must SAY coaching
  assert.strictEqual(label({ view: 'team-expanded' }), 'Coaching');
});

/* ⚠⚠ REGRESSION — FOUND ON THE REAL PAGE, NOT BY READING. People renders the
   shared controls row, so before this its picker resolved through the
   `|| 'performance'` fallback and SILENTLY MOVED PERFORMANCE'S WINDOW, while
   the caption said "These dates apply to People". Any page that renders a
   picker must own a key; a page that shares one is the carrier bug again. */
test('⚠⚠ every page with a picker owns its OWN range key — no page moves another\'s', () => {
  const at = H.indexOf('var TEAM_RANGE_PAGE');
  const src = H.slice(at, H.indexOf('function teamRange()', at));
  const pageFor = new Function('state', src + '; return teamRangePage();');

  // the pages that render a date picker, and the renderer each one goes through
  const WITH_PICKER = [
    ['team-performance', 'function renderTeamPerformance', 'teamControlsHtml()'],
    ['team-coaching',    'function renderTeamCoaching',    'teamControlsHtml()'],
    ['team-members',     'function renderTeamMembersView', 'teamControlsHtml()'],
    ['team-objections',  'function renderTeamObjectionsView', 'objDrillControlsHtml()'],
  ];
  const keys = {};
  WITH_PICKER.forEach(([view, sig, control]) => {
    const fnAt = LIVE.indexOf(sig);
    assert.ok(fnAt !== -1, 'stale anchor — ' + sig + ' is gone');
    const body = LIVE.slice(fnAt, LIVE.indexOf('\n  }', fnAt));
    assert.ok(body.indexOf(control) !== -1,
      sig + ' no longer renders ' + control + ' — this list is stale, re-derive it');
    const k = pageFor({ view });
    assert.ok(!keys[k], view + ' shares the "' + k + '" window with ' + keys[k]
      + ' — its picker would silently move the other page');
    keys[k] = view;
  });
  assert.strictEqual(Object.keys(keys).length, WITH_PICKER.length,
    'every picker page must resolve to a distinct key');
});

test('⚠⚠ teamRangePage() really READS the view — run it, do not grep it', () => {
  /* ⚠⚠ RAW SOURCE, NOT `LIVE` — the SECOND time this bit in one file. The
     comment stripper is for TEXT matching; feeding its output to new Function
     throws the moment a comment is added inside the sliced region, which is
     exactly what happened here. Comments are harmless to new Function. */
  const at = H.indexOf('var TEAM_RANGE_PAGE');
  const src = H.slice(at, H.indexOf('function teamRange()', at));
  assert.ok(src.length > 200 && src.length < 1800, 'slice must cover it: ' + src.length);
  const pageFor = new Function('state', src + '; return teamRangePage();');

  const seen = {};
  [['team-performance', 'performance'], ['team-coaching', 'coaching'],
   ['team-objections', 'objections']].forEach(([view, want]) => {
    const got = pageFor({ view });
    assert.strictEqual(got, want, view + ' must own the "' + want + '" range, got "' + got + '"');
    seen[got] = true;
  });
  assert.strictEqual(Object.keys(seen).length, 3,
    'three pages resolved to fewer than three range keys — they are sharing a window');
  // ⚠ the expanded drilldown deliberately RIDES coaching's window, not its own.
  assert.strictEqual(pageFor({ view: 'team-expanded' }), 'coaching',
    'the drilldown must stay on the window of the page it was opened from');
});

test('⚠ each page owns its own range — one shared window is the carrier bug', () => {
  assert.ok(/teamRanges\[teamRangePage\(\)\]/.test(LIVE), 'the setter must be page-keyed');
  assert.ok(!/state\.teamRange\b(?!s)/.test(LIVE), 'the single shared range must be gone');
  const m = /var TEAM_RANGE_PAGE = \{([\s\S]*?)\};/.exec(LIVE);
  assert.ok(m, 'the page->range map must exist');
  ['team-performance', 'team-coaching', 'team-objections'].forEach((v) =>
    assert.ok(new RegExp("'" + v + "'").test(m[1]), v + ' must own a range'));
});

test('⚠ Daily Digest has no date picker — nothing on it answers to one', () => {
  const at = LIVE.indexOf('function renderTeamDigest');
  const body = LIVE.slice(at, LIVE.indexOf('allPanelsHiddenNoteHtml();', at));
  assert.ok(body.length > 200 && body.length < 2500, 'slice must cover it: ' + body.length);
  assert.ok(!/teamControlsHtml\(\)/.test(body), 'a picker here would drive nothing');
  assert.ok(/teamDigestHtml\(\)/.test(body), 'the digest is the page');
});

/* ⚠⚠ CONVERTED 2026-08-31 — THE DROPDOWN MOVED INTO THE NAV'S "Team" TAB
   (Justin: he disliked its placement on the company card). The SUBJECT of this
   test survives exactly: there must be ONE page control, in ONE place. Only its
   home changed. The old <select> builder is kept but is now DEAD — asserted
   below, so a second copy cannot be quietly revived on the card. */
test('⚠⚠ the page dropdown is the NAV TAB, and there is exactly one of it', () => {
  // it is gone from the company card
  const hAt = LIVE.indexOf('function teamHeaderHtml');
  const header = LIVE.slice(hAt, LIVE.indexOf('\n  }', LIVE.indexOf('return ', hAt)));
  assert.ok(!/teamPageSelectHtml\(\)/.test(header),
    'the card must not carry a second page control');

  // the retired <select> builder has no call sites at all
  // ⚠ the DEFINITION matches this pattern too, so count only invocations
  const invocations = (LIVE.match(/(?<!function )teamPageSelectHtml\(\)/g) || []).length;
  assert.strictEqual(invocations, 0,
    'the retired builder must have no call sites — a live-looking builder nothing '
    + 'calls is the orphaned-strip shape');
  assert.strictEqual((LIVE.match(/function teamPageSelectHtml/g) || []).length, 1,
    'and it is KEPT, archived, as the markup to restore if the nav menu is reverted');

  // the nav tab is the control, and it lists every page from the one list
  assert.ok(/id="navTeamWrap"/.test(LIVE), 'the Team tab must anchor the menu');
  assert.ok(/onclick="navTeamClick\(event\)/.test(LIVE), 'the tab opens it');
  const mAt = LIVE.indexOf('function navTeamMenuHtml');
  const menu = LIVE.slice(mAt, LIVE.indexOf('\n  }', mAt));
  assert.ok(menu.length > 200 && menu.length < 1800, 'menu slice: ' + menu.length);
  assert.ok(/TEAM_PAGES\.map/.test(menu),
    'the menu must render from TEAM_PAGES — never a second copy of the page names');
});

/* ⚠⚠ THE MENU MUST BE ABLE TO ESCAPE THE PAGE. The nav tied with
   .page-header at z-index 50, and at equal z-index the LATER element wins — so
   the company card painted over the nav. Harmless while the nav held only
   links; the moment the Team tab became a dropdown, two of its five items
   rendered BEHIND the card's <h1>. The menu's own z-index is scoped INSIDE the
   nav's stacking context and cannot rescue it. Found by LOOKING — every
   measurement passed. */
test('⚠⚠ the nav outranks page content, and still yields to modals', () => {
  const z = (sel) => {
    const at = LIVE.indexOf(sel + ' {');
    assert.ok(at !== -1, 'stale anchor — ' + sel + ' is gone');
    const rule = LIVE.slice(at, LIVE.indexOf('}', at));
    const m = /z-index:\s*(\d+)/.exec(rule);
    assert.ok(m, sel + ' must declare a z-index');
    return parseInt(m[1], 10);
  };
  const bar = z('.top-bar'), header = z('.page-header'), modal = z('.support-modal');
  assert.ok(bar > header,
    'the nav (' + bar + ') must outrank .page-header (' + header + ') or a menu '
    + 'opened from it renders behind the page');
  assert.ok(bar < modal,
    'but stay below modals (' + modal + '), which must cover the nav');
});

/* ⚠ COSMETICS ARE THE CONSTRAINT HERE, NOT A PREFERENCE (Justin: "do not change
   its cosmetics"). The tab keeps its class, and the ONLY addition is the caret.
   Measured: the tab is 33px -> 41px, the nav's clearance at 1440 is 108px, and
   the point where the two nav groups touch moves 1324px -> 1334px. */
test('⚠ the Team tab keeps every cosmetic property — only a caret is added', () => {
  // ⚠ ANCHOR ON THE ELEMENT, NOT A FIXED WINDOW. A 500-char slice stopped
  //   reaching the caret the moment a comment was added above the tag.
  const at = LIVE.indexOf('<a class="nav-link" id="navTeam"');
  assert.ok(at !== -1, 'stale anchor — the Team tab is gone');
  const block = LIVE.slice(at, LIVE.indexOf('</a>', at) + 4);
  assert.ok(block.length > 80 && block.length < 500, 'tag slice: ' + block.length);
  assert.ok(/class="nav-link" id="navTeam"/.test(block),
    'the tab must keep the shared nav-link class — its type, size, weight, colour, '
    + 'spacing and active underline all come from it');
  assert.ok(/<span class="nav-caret">/.test(block), 'the caret is the one addition');

  /* ⚠⚠ KEYBOARD ACCESS IS REQUIRED, NOT OPTIONAL. Every tab in this nav is an
     <a> with NO href, so none of them is focusable — pre-existing, and fine for
     a plain link. For a MENU it is not: without tabindex, Escape has nothing to
     return focus to and the control cannot be opened from the keyboard at all.
     Proven by measuring it: focus return failed before this was added. */
  assert.ok(/tabindex="0"/.test(block), 'the menu tab must be reachable by keyboard');
  assert.ok(/onkeydown="navTeamButtonKeydown/.test(block), 'and openable from it');
  assert.ok(/aria-haspopup="true"/.test(block) && /aria-expanded=/.test(block),
    'and it must announce itself as a menu');
  // the wrapper must add no box of its own
  // ⚠ SLICE TO THE RULE'S OWN CLOSING BRACE. A fixed-length slice ran into the
  //   NEXT rule (.nav-caret, which legitimately has margin and font-size) and
  //   reported the wrapper as changing the box — scope wider than the claim.
  const cAt = LIVE.indexOf('.nav-team-wrap {');
  const css = LIVE.slice(cAt, LIVE.indexOf('}', cAt) + 1);
  assert.ok(css.length > 20 && css.length < 160, 'rule slice: ' + css.length);
  assert.ok(/position: relative/.test(css), 'the wrapper must anchor the menu');
  assert.ok(!/padding|margin|font-size|font-weight|color/.test(css),
    'and must not change the tab\'s box: ' + css);
});

/* ⚠⚠ ONE NAME EVERYWHERE (Justin, mid-block 2026-08-31). Page ① is "Daily
   Digest" — it names what is on the page rather than when to read it — and the
   same name has to appear in the dropdown, the heading, the hash and any link.
   A page called one thing in the control and another in the address bar is the
   two-things-answering-one-question defect in a new place. */
test('page ① is called "Daily Digest" in the dropdown, the heading and the hash', () => {
  assert.ok(/label: 'Daily Digest'/.test(LIVE), 'the dropdown must say it');
  assert.ok(/<h2>Daily Digest<\/h2>/.test(LIVE), 'the heading must say the same');
  assert.ok(/return 'team-digest'/.test(LIVE), 'and the URL must too');
  assert.ok(!/Today'/.test(LIVE.slice(LIVE.indexOf('var TEAM_PAGES'), LIVE.indexOf('var TEAM_PAGES') + 400)),
    'the retired label must not linger in the page list');
  assert.ok(!/Manager Daily Digest/.test(LIVE), 'and not a near-duplicate of it either');
});

test('⚠ #team still routes in — a bookmark is a link too', () => {
  const m = /var TEAM_HASH = \{([\s\S]*?)\};/.exec(LIVE);
  assert.ok(/'team-digest': 'team'/.test(m[1]), 'the new name must route');
  assert.ok(/'team': 'team'/.test(m[1]), 'and the old one must keep working');
});
