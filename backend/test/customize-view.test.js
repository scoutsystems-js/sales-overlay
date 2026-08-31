/**
 * CUSTOMIZE VIEW — a manager chooses which panels the team page shows.
 * Per USER (the 2026-08-20 ruling: customisation is per person by design, so
 * this needs no org entity).
 *
 * ⚠⚠ THE PROPERTY THAT MATTERS MOST IS WHICH SET IS STORED. Storing the VISIBLE
 * set would make every panel added later invisible to every existing manager,
 * silently and permanently — they never chose to hide it and nothing would tell
 * them it exists. Storing the HIDDEN set fails the other way: a new panel shows
 * up. Same asymmetry as opt-in survival for pivot state, and the test below
 * proves it by replaying storage written when the list was shorter.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

/* Drive the REAL functions. Extract by BRACE COUNTING, not by hunting a
   newline-brace: teamPanelVisible is a one-liner, so an indent-based end marker
   silently grabs the wrong span. The length assertion is what makes a bad
   extraction fail loudly instead of testing the empty string. */
function grab(name) {
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' is missing — anchor stale');
  let depth = 0, started = false, i = at;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
  }
  const src = HTML.slice(at, i);
  assert.ok(src.length > 40 && src.length < 8000, 'slice must cover ' + name + ': ' + src.length);
  assert.ok(started && depth === 0, 'unbalanced slice for ' + name);
  return src;
}

/* ⚠ END THE SLICE AT A LINE BOUNDARY. Cutting a fixed number of characters
   past the key landed inside the NEXT comment block, so the assembled source
   carried an unterminated comment and every test failed with a SyntaxError
   that said nothing about the real cause. */
function registrySrc() {
  const from = HTML.indexOf('  var TEAM_PANELS = [');
  const keyAt = HTML.indexOf('  var TEAM_PANELS_KEY', from);
  const to = HTML.indexOf('\n', keyAt);
  assert.ok(from > 0 && keyAt > from && to > keyAt, 'registry anchors are stale');
  const src = HTML.slice(from, to);
  assert.ok(src.length > 200, 'registry slice too short: ' + src.length);
  return src;
}

/* Every team render function concatenated — the split turned one page into
   five, so "the render" is the union of the pages that own panels. */
function renderPath() {
  return ['renderTeamDigest', 'renderTeamPerformance', 'renderTeamCoaching'].map(function (f) {
    const at = HTML.indexOf('function ' + f);
    if (at === -1) throw new Error('missing render function: ' + f);
    return HTML.slice(at, HTML.indexOf('\n  }', HTML.indexOf('allPanelsHiddenNoteHtml();', at)));
  }).join('\n');
}

function api(stored) {
  const store = {};
  if (stored !== undefined) store['scout_team_panels_v1'] = JSON.stringify(stored);
  const reg = registrySrc();
  const src = [
    reg,
    grab('teamPanelsHidden'),
    grab('teamPanelVisible'),
    grab('saveTeamPanels'),
    grab('teamPanelToggle'),
    grab('teamPanelsAll'),
    /* ⚠ grab() extracts FUNCTIONS. teamPageForView closes over a const map, so
       the map is pulled in verbatim beside it — a function lifted without the
       data it reads is a ReferenceError the syntax check cannot see. */
    (function () {
      const m = /var TEAM_PAGE_OF_VIEW = \{[\s\S]*?\};/.exec(HTML);
      assert.ok(m, 'TEAM_PAGE_OF_VIEW is missing — anchor stale');
      return m[0];
    })(),
    grab('teamPageForView'),
    grab('panelsForPage'),
    grab('allPanelsHiddenNoteHtml'),
    grab('customizeViewHtml'),
  ].join('\n');
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  const st = {};
  const fn = new Function('state', 'localStorage', 'escapeHtml', 'renderTeamSurface',
    src + '\nreturn { hidden: teamPanelsHidden, visible: teamPanelVisible, toggle: teamPanelToggle,'
        + ' all: teamPanelsAll, note: allPanelsHiddenNoteHtml, html: customizeViewHtml,'
        + ' PANELS: TEAM_PANELS, forPage: panelsForPage, store: () => store };');
  const out = fn(st, ls, String, () => {});
  /* ⚠ The rows only exist while the menu is OPEN — a closed menu renders the
     button alone, so a fixture that never opens it tests nothing about them. */
  out.open = () => { st.customizeOpen = true; };
  out.setView = (v) => { st.view = v; };
  return out;
}

test('by default every panel is visible and nothing is stored', () => {
  const a = api();
  assert.deepStrictEqual(a.hidden(), {});
  a.PANELS.forEach(p => assert.strictEqual(a.visible(p.key), true, p.key + ' must default to visible'));
  assert.strictEqual(a.note(), '', 'no note when nothing is hidden');
});

test('toggling hides one panel and leaves the rest alone', () => {
  const a = api();
  a.toggle('digest');
  assert.strictEqual(a.visible('digest'), false);
  assert.strictEqual(a.visible('gauges'), true);
  a.toggle('digest');
  assert.strictEqual(a.visible('digest'), true, 'toggling again restores it');
});

test('⚠⚠ the STORED set is the HIDDEN one, so a NEW panel is visible by default', () => {
  /* Replay storage written when the list was shorter: only 'digest' was hidden.
     Every panel added since must still show. If the visible set were stored,
     each of these would be silently absent for this manager forever. */
  const a = api(['digest']);
  assert.strictEqual(a.visible('digest'), false, 'the explicit choice survives');
  a.PANELS.filter(p => p.key !== 'digest')
    .forEach(p => assert.strictEqual(a.visible(p.key), true, p.key + ' must be visible by default'));
});

test('unknown keys in storage are discarded, not carried', () => {
  const a = api(['digest', 'a_panel_that_was_removed', '']);
  assert.deepStrictEqual(Object.keys(a.hidden()), ['digest']);
});

test('unreadable storage means nothing hidden, and never throws', () => {
  const store = { 'scout_team_panels_v1': '{not json' };
  const fn = new Function('state', 'localStorage', 'escapeHtml', 'renderTeamSurface',
    registrySrc()
    + grab('teamPanelsHidden') + '\nreturn teamPanelsHidden;');
  const hidden = fn({}, { getItem: k => store[k], setItem: () => {} }, String, () => {});
  assert.doesNotThrow(() => hidden());
  assert.deepStrictEqual(hidden(), {});
});

test('hide-all says so on screen rather than leaving a bare toolbar', () => {
  const a = api();
  /* ⚠ THE NOTE IS NOW PER PAGE (the split): it asks whether every panel on THIS
     page is hidden, so the fixture has to say which page it is on. Before the
     split there was one page and the question had no subject to name. */
  a.setView('team-performance');
  a.all(false);
  a.PANELS.forEach(p => assert.strictEqual(a.visible(p.key), false));
  const note = a.note();
  assert.match(note, /Every panel/i, 'an empty page must explain itself');
  assert.match(note, /Customize View/, 'and must say how to undo it');
  a.all(true);
  assert.strictEqual(a.note(), '');
});

test('the button counts what is shown, and rows stay listed when hidden', () => {
  const a = api(['digest', 'reps']);
  a.open();
  const html = a.html();
  assert.match(html, new RegExp((a.PANELS.length - 2) + ' of ' + a.PANELS.length + ' panels'));
  /* ⚠ a hidden panel must still appear as a row — removing it would make
     absent and excluded look alike. */
  a.PANELS.forEach(p => assert.ok(html.indexOf(p.label) !== -1, p.label + ' must stay in the list'));
});

/* ── what must NOT be hideable ──────────────────────────────────────────── */

test('⚠ the controls row and the unconnected badge are NOT hideable', () => {
  const a = api();
  const keys = a.PANELS.map(p => p.key);
  assert.ok(keys.indexOf('controls') === -1, 'hiding the controls row would strand the manager');
  assert.ok(keys.indexOf('unconnected') === -1, 'an alert you can permanently switch off is not an alert');

  /* ⚠ THE RENDER PATH IS THREE FUNCTIONS SINCE THE SPLIT. The subject is
     unchanged — neither the controls row nor the badge may be hideable — but
     they now live on the pages that own them: the badge is an exception surface
     and sits on Daily Digest, the controls row on the two picker-driven pages. */
  const body = renderPath();
  assert.ok(body.length > 1500, 'render path slice too short: ' + body.length);
  assert.ok(/\+ teamControlsHtml\(\)/.test(body), 'the controls row must render unconditionally');
  assert.ok(/\+ unconnectedBadgeHtml\(\)/.test(body), 'the badge must render unconditionally');
});

test('every registered panel is actually gated in the render', () => {
  const body = renderPath();
  const a = api();
  a.PANELS.forEach(p => {
    assert.ok(body.indexOf("teamPanelVisible('" + p.key + "')") !== -1,
      p.key + ' is offered in the menu but not gated in the render — the toggle would do nothing');
  });
});

test('the inert coming-soon marker is gone and the real control took its place', () => {
  assert.strictEqual(HTML.indexOf('customizeViewSoonHtml'), -1, 'the placeholder must not survive');
  assert.ok(/\+ summaryBtnHtml\(\) \+ customizeViewHtml\(\)/.test(HTML),
    'the real control must sit where the marker promised');
});
