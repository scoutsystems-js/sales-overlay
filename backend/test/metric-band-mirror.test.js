/* The band — one definition, and the two client mirrors that cannot drift from
   it. See CLAUDE.md 2026-09-01. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const B = require('../lib/metric-band.js');
const TA = require('../lib/team-averages.js');
const C = require('../lib/widget-catalog.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// line comments FIRST, then block: a `/*` inside a `//` line is a false opener.
const CODE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠⚠ ONE band definition — neither consumer redeclares the edges', () => {
  /* ⚠ THE WHOLE REASON THIS MODULE EXISTS. `lib/team-averages.js` (the gauge) and
     `lib/widget-catalog.js` (the cards and the ranked list) each declared call
     time's DIRECTION separately. They agreed, which is exactly how a shared
     carrier failure hides until one of them moves — so the band lives in one
     place and both import it. */
  const ta = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-averages.js'), 'utf8');
  const wc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'widget-catalog.js'), 'utf8');
  [['team-averages', ta], ['widget-catalog', wc]].forEach(([name, src]) => {
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/require\(['"]\.\/metric-band(\.js)?['"]\)/.test(code),
      name + ' must IMPORT the band, not declare one');
    assert.ok(!/good:\s*\[\s*\d+\s*,\s*\d+\s*\]/.test(code),
      name + ' declares band edges of its own — that is the second copy this file exists to prevent');
  });
  // and the two banded metrics agree across both consumers
  assert.deepStrictEqual(TA.METRICS.calltime.band, B.bandFor('avg_call_time'));
  assert.deepStrictEqual(C._publicMetric(C.byKey('avg_call_time')).band, B.bandFor('avg_call_time'));
  assert.deepStrictEqual(C._publicMetric(C.byKey('time_to_price')).band, B.bandFor('time_to_price'));
});

test('⚠⚠ the client mirrors classify() exactly — same verdict on every edge case', () => {
  const a = HTML.indexOf('  function avgBand');
  /* ⚠ THE SLICE EXCLUDES THE CLOSING BRACE — indexOf returns its position, so the
     function is cut one character short and new Function throws. Append it. */
  const src = HTML.slice(a, HTML.indexOf('\n  }', a)) + '\n  }';
  assert.ok(src.length > 300 && src.length < 2000, 'slice: ' + src.length);
  /* ⚠ EVERY FREE IDENTIFIER MUST BE SUPPLIED, or a scope error masquerades as a
     verdict — the legacy branch reads AVG_LOWER_IS_BETTER and the banded one does
     not, so 12 of 13 cases passed while the control threw. Read the constant from
     the page rather than retyping it. */
  const DIR = (HTML.match(/var AVG_LOWER_IS_BETTER = '([a-z_]+)'/) || [])[1];
  assert.strictEqual(DIR, 'lower_is_better', 'stale anchor — AVG_LOWER_IS_BETTER');
  const avgBand = new Function('AVG_LOWER_IS_BETTER', src + '; return avgBand;')(DIR);

  const sweet = B.bandFor('avg_call_time');
  /* ⚠ THE EDGES THEMSELVES ARE THE CASES THAT MATTER — an off-by-one at 35, 45,
     20 or 60 is exactly the drift a mirror exists to catch. */
  [0, 19.9, 20, 27, 34.9, 35, 40, 45, 45.1, 59.9, 60, 60.1, 90].forEach((v) => {
    assert.strictEqual(avgBand(v, 60, 'lower_is_better', sweet), B.classify(v, sweet),
      'client and server disagree at ' + v);
  });
  // and with NO band the client must still behave exactly as it did before
  assert.strictEqual(avgBand(50, 60, 'lower_is_better'), 'good');
  assert.strictEqual(avgBand(95, 60, 'lower_is_better'), 'bad');
});

test('⚠⚠⚠ every ranked row carries its SIDE — distance alone reproduces the defect', () => {
  /* ⚠⚠ A rep at 28.8 and one at 67.1 are both ~16 minutes outside the band and
     need OPPOSITE coaching — one is rushing, one is rambling. A list sorted by
     distance puts them ADJACENT. Without the side the band buys nothing over the
     direction it replaced, which is the whole point of the change. */
  const rank = CODE.slice(CODE.indexOf('function dashRepRanking'), CODE.indexOf('function dashRepNote'));
  assert.ok(rank.length > 400 && rank.length < 5000, 'slice: ' + rank.length);
  assert.ok(/x\.side = \(x\.v < sw\[0\]\) \? 'under'/.test(rank), 'the side must be computed per row');
  assert.ok(/b\.dist - a\.dist/.test(rank), 'a banded metric sorts by distance, furthest first');
  /* ⚠ INSIDE THE BAND IS A TIE, DELIBERATELY. There is no honest ordering between
     38 and 42 minutes, and inventing one is a verdict on a rep. */
  assert.ok(/: 0;/.test(rank), 'a value inside the band must have distance zero, so they tie');

  // BOTH ranked views render it — the bar is the worse case, not the milder one
  ['dashByRepHtml', 'dashBarRepHtml'].forEach((fn) => {
    const body = CODE.slice(CODE.indexOf('function ' + fn), CODE.indexOf('\n  }', CODE.indexOf('function ' + fn)));
    assert.ok(body.length > 200, fn + ' slice: ' + body.length);
    assert.ok(/dash-side/.test(body), fn + ' must state which side of the band each rep is on');
  });
  /* ⚠ AND THE BAR IS COLOURED BY THE BAND. Bar LENGTH encodes magnitude, and
     under a band magnitude is not goodness — a 67-minute bar is the longest and
     the worst. Without the colour the longest bar reads as the best rep. */
  const bar = CODE.slice(CODE.indexOf('function dashBarRepHtml'), CODE.indexOf('function dashBarCatHtml'));
  assert.ok(/dash-barh-fill--/.test(bar), 'the bar must be coloured by its band');
  assert.ok(/\.dash-barh-fill--good \{ background: var\(--good\)/.test(HTML)
    && /\.dash-barh-fill--out\s+\{ background: var\(--bad\)/.test(HTML),
    'and it must use the product\'s own semantic tokens, which is what they are for');
});

test('⚠⚠ the DIAL draws one notch per edge — one mark on a band marks a bar that does not exist', () => {
  const a = HTML.indexOf('  var AVG_SWEEP_DEG');
  const g = new Function(HTML.slice(a, HTML.indexOf('\n  function avgCardHtml')) + '; return avgGaugeSvg;')();
  const notches = (s) => (s.match(/class="avg-notch"/g) || []).length;
  const labels = (s) => [...s.matchAll(/avg-notch-label"[^>]*>([^<]*)</g)].map((m) => m[1]);

  const banded = g(44.4, 60, 90, 'good', B.bandFor('avg_call_time'));
  assert.strictEqual(notches(banded), 2, 'a band has two edges and gets two notches');
  assert.deepStrictEqual(labels(banded), ['35', '45'], 'each notch is labelled with its own edge');

  /* ⚠ AND A STALE FOUR-ARGUMENT CALL STILL WORKS. `sweet` was APPENDED to the
     signature rather than inserted — inserting a parameter anywhere but the end
     silently shifts every later argument into the wrong slot. */
  const legacy = g(24, 25, 50, 'good');
  assert.strictEqual(notches(legacy), 1, 'no band, one notch, exactly as before');
  assert.deepStrictEqual(labels(legacy), ['25']);
});

test('⚠⚠ the nav entry NAMES THE BOARD IT OPENS, pinned or not', () => {
  /* ⚠ Justin saved and renamed a board and the dropdown still read "Customize",
     so he concluded the save had failed. IT HAD NOT — the row was in the
     database, named, with its cards. The label required `pinned` while the
     server returns boards[0] (pinned first, else most recent), so the entry
     ALWAYS opened that board and refused to say its name. */
  const src = HTML.slice(HTML.indexOf('var TEAM_PAGES'), HTML.indexOf('function teamPageSelectHtml'));
  const make = new Function('state', src + '; return teamPagesWithBoard;');
  const un = make({ teamDashboard: { board: { name: 'Morning board', pinned: false } } })();
  assert.strictEqual(un[un.length - 1].label, 'Morning board', 'an unpinned board lends its name');
  assert.notStrictEqual(un[0].label, 'Morning board', 'but does not take the top slot');
  const pin = make({ teamDashboard: { board: { name: 'Morning board', pinned: true } } })();
  assert.strictEqual(pin[0].label, 'Morning board', 'a pinned board still goes to the top');
  // and with nothing loaded it is a way IN, never a guess at a name
  assert.ok(make({ teamDashboard: null })().map((p) => p.label).includes('Customize'));
});
