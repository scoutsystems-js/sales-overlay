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
  assert.strictEqual(ps.length, 9, 'all nine panels must carry a page, got ' + ps.length);
  assert.strictEqual(new Set(ps.map(p => p.key)).size, 9, 'no duplicate keys');
  ps.forEach(p => assert.ok(/^team(-\w+)?$/.test(p.page), p.key + ' has no valid page'));
});

/* ⚠⚠ THE STORED SET IS A LIST OF THESE KEYS, so keeping the keys IS the
   migration: a panel a manager hid stays hidden where it now lives.
   Namespacing per page would have reset the set and silently un-hidden
   everything they chose to hide. */
test('⚠ the panel KEYS are unchanged — that is the Customize View migration', () => {
  const keys = panels().map(p => p.key).sort();
  assert.deepStrictEqual(keys,
    ['closing', 'digest', 'gauges', 'graphs', 'needswork', 'objection', 'overview', 'recs', 'reps'],
    'renaming a key would orphan what a manager hid');
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
/* ⚠⚠ EACH PAGE SAYS WHICH WINDOW IT SHOWS. Five pages each own a range, so a
   manager who picks 90 days on one and moves to another finds it back on 7 —
   correct, and inexplicable without this. The label is resolved from the SAME
   TEAM_PAGES list the dropdown renders from, so the control and the caption can
   never disagree about what the page is called. */
test('⚠ the date range says WHICH PAGE it governs, from the dropdown\'s own list', () => {
  const at = LIVE.indexOf('function teamControlsHtml');
  const body = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(body.length > 300 && body.length < 2000, 'slice must cover it: ' + body.length);
  assert.ok(/team-range-scope/.test(body), 'the controls row must name the range\'s scope');

  /* ⚠ THE DRILLDOWN CARRIES ITS OWN CONTROLS — the picker sits inside its card,
     not in the shared row — so it needs the caption explicitly or it is the one
     page with a per-page window that never says which page it governs. */
  const dAt = LIVE.indexOf('function objDrillControlsHtml');
  assert.ok(dAt !== -1, 'stale anchor — the drilldown controls are gone');
  const drill = LIVE.slice(dAt, LIVE.indexOf('\n  }', dAt));
  assert.ok(drill.length > 200 && drill.length < 1600, 'drill slice: ' + drill.length);
  assert.ok(/team-range-scope/.test(drill), 'the drilldown must name its range\'s scope too');
  assert.ok(/TEAM_PAGES\.filter/.test(drill),
    'and from the dropdown\'s own list — never a second copy of the page names');
  assert.ok(/TEAM_PAGES\.filter/.test(body),
    'the label must come from the dropdown\'s own list, not a second copy of the names');
  assert.ok(/teamPageForView\(state\.view\)/.test(body),
    'teamPageForView takes no default — calling it bare silently yields the fallback on every page');

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

test('the page dropdown has ONE definition and renders from the shared header', () => {
  assert.strictEqual((LIVE.match(/function teamPageSelectHtml/g) || []).length, 1);
  assert.strictEqual((LIVE.match(/teamPageSelectHtml\(\)/g) || []).length, 2,
    'one definition, one call site — a second copy has been built and left dead here before');
  const at = LIVE.indexOf('function teamHeaderHtml');
  const body = LIVE.slice(at, LIVE.indexOf('\n  }', LIVE.indexOf('return ', at)));
  assert.ok(/teamPageSelectHtml\(\)/.test(body), 'the dropdown rides the header every page renders');
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
