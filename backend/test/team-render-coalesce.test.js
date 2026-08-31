/**
 * ⚠⚠ THE TEAM PAGE BLINKED 4-5 TIMES, AND IT WAS NEVER ONE LOAD.
 *
 * MEASURED against the real document with genuine Chart.js before any fix:
 * ONE visit to the team page produced NINE full renders and created NINETY-NINE
 * `.fade-in` sections. renderTeamView() kicks eight independent lanes and each
 * one called renderTeamView() again on arrival, and that function assigns
 * content.innerHTML — a full DOM replacement whose sections each replay a 0.4s
 * entrance animation.
 *
 * Renders landing in the same frame read as one flash, which is why nine
 * renders looked like about five (arrivals clustered at 305/306/307, then
 * 1305/1333, then 2305/2321) — exactly Josh's "4-5 times".
 *
 * ⚠ COVERING IT WITH A LONGER WELCOME ANIMATION WOULD HAVE HIDDEN A DEFECT,
 * and could not even have hidden it: four of these lanes are Claude syntheses
 * taking tens of seconds on a cache miss, landing long after any overlay.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// ⚠ LINE COMMENTS FIRST — a `/*` inside a `//` line is a false opener.
const LIVE = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠ no lane may re-render the page directly — that WAS the defect', () => {
  const at = LIVE.indexOf('async function loadTeam(');
  assert.ok(at > 0, 'loadTeam anchor is stale');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 400 && fn.length < 4000, 'slice suspicious: ' + fn.length);

  assert.ok(/scheduleTeamRender\(\)/.test(fn), 'lane completion must go through the coalescer');
  ['renderTeamDigest()', 'renderTeamExpanded()', 'renderTeamNeedsWorkView()', 'renderTeamMembersView()']
    .forEach((call) => {
      assert.ok(fn.indexOf(call) === -1,
        'loadTeam must not call ' + call + ' directly — eight lanes doing that '
        + 'is what produced nine renders and 99 fade-in replays');
    });
});

test('the coalescer exists, dedupes, and defers to a frame', () => {
  const at = LIVE.indexOf('function scheduleTeamRender()');
  assert.ok(at > 0, 'scheduleTeamRender is missing');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 300 && fn.length < 3000, 'slice suspicious: ' + fn.length);
  assert.ok(/if \(teamRenderQueued\) return;/.test(fn), 'a queued-flag guard is what coalesces');
  assert.ok(/requestAnimationFrame/.test(fn), 'must defer to a frame, not render synchronously');
  assert.ok(/setTimeout\(run, 16\)/.test(fn), 'and fall back where rAF is unavailable');
});

/**
 * ⚠ EXECUTES THE REAL FUNCTION rather than reading it. Extraction + stubs, the
 * same discipline as the render probes elsewhere in this suite.
 */
function loadCoalescer(opts) {
  const at = LIVE.indexOf('  var teamRenderQueued = false;');
  const end = LIVE.indexOf('\n  }', LIVE.indexOf('setTimeout(run, 16)', at)) + 4;
  const src = LIVE.slice(at, end);
  assert.ok(src.length > 300 && src.length < 3000, 'slice suspicious: ' + src.length);

  const calls = { render: 0, fadeStripped: 0 };
  const nodes = [];
  const content = {
    querySelectorAll: () => nodes.slice(),
  };
  const document = { getElementById: (id) => (id === 'content' ? content : null) };
  const state = { view: opts.view || 'team' };
  const mkSection = () => ({ classList: { remove: (c) => { if (c === 'fade-in') calls.fadeStripped++; } } });
  const renderTeamSurface = () => {
    calls.render++;
    nodes.length = 0;
    for (let i = 0; i < 11; i++) nodes.push(mkSection());   // 11 sections per render, as measured
  };
  const noop = () => {};
  const frames = [];
  const requestAnimationFrame = (f) => frames.push(f);

  const fn = new Function(
    'document', 'state', 'renderTeamSurface', 'renderTeamExpanded',
    'renderTeamNeedsWorkView', 'renderTeamMembersView', 'requestAnimationFrame', 'setTimeout',
    src + '; return scheduleTeamRender;'
  )(document, state, renderTeamSurface, noop, noop, noop, requestAnimationFrame, () => 0);

  return { fn, calls, frames, flush: () => { const f = frames.splice(0); f.forEach((x) => x()); } };
}

test('⚠⚠ EIGHT LANES ARRIVING IN ONE FRAME PRODUCE ONE RENDER, NOT EIGHT', () => {
  const h = loadCoalescer({});
  for (let i = 0; i < 8; i++) h.fn();          // all eight lanes resolve together
  assert.strictEqual(h.frames.length, 1, 'only one frame callback may be queued');
  h.flush();
  assert.strictEqual(h.calls.render, 1,
    'eight same-frame arrivals must collapse to a single render — this is the '
    + 'measured 9-renders-per-visit defect');
});

test('a LATER arrival still renders — coalescing must not swallow real updates', () => {
  const h = loadCoalescer({});
  h.fn(); h.flush();
  h.fn(); h.flush();                            // a lane that landed seconds later
  assert.strictEqual(h.calls.render, 2,
    'data arriving later is a genuine update and must still paint');
});

test('⚠ the entrance animation is stripped on a data-arrival render', () => {
  const h = loadCoalescer({});
  h.fn(); h.flush();
  assert.strictEqual(h.calls.fadeStripped, 11,
    'every section created by a lane-triggered render must lose .fade-in, or '
    + 'the whole page flashes from opacity 0 again — that IS the blink');
});

test('a view the coalescer does not own is left alone', () => {
  const h = loadCoalescer({ view: 'overview' });
  h.fn(); h.flush();
  assert.strictEqual(h.calls.render, 0, 'coaching renders through its own path');
  assert.strictEqual(h.calls.fadeStripped, 0,
    'and its entrance animation must not be stripped as a side effect');
});

// ── the GRAPHS had their own repeat underneath the section renders ─────────
/**
 * ⚠⚠ MEASURED BEFORE THE FIX, against the real document with genuine Chart.js:
 * one visit destroyed and rebuilt each of the three graphs FOUR times —
 * 15 Chart constructions and 12 destructions across the five lane-arrival
 * groups. After: 3 constructions, 0 destructions, 12 in-place updates.
 *
 * ⚠ THE REBUILD WAS FORCED, NOT CHOSEN. Chart.js binds to a canvas NODE, and
 * the canvas used to be emitted inside the innerHTML string — so every render
 * replaced it and orphaned the instance. destroy-and-recreate was the only
 * thing that COULD work. Preserving the node is what makes update() reachable.
 */
test('⚠⚠ the canvas is NOT part of the innerHTML string — that is what forced the rebuild', () => {
  const at = LIVE.indexOf('function repGraphBodyHtml');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 150 && fn.length < 2000, 'slice suspicious: ' + fn.length);
  assert.ok(!/<canvas/.test(fn),
    'emitting <canvas> in the markup means every render replaces the node and '
    + 'orphans the Chart instance — the flash follows by construction');
  assert.ok(/rep-graph-slot/.test(fn) && /data-canvas="/.test(fn),
    'the markup must emit a slot the preserved host is mounted into');
});

test('the canvas host is preserved across renders, and created once per id', () => {
  assert.ok(/var repGraphHosts = \{\};/.test(LIVE), 'the host registry must exist');
  const at = LIVE.indexOf('function repGraphHostFor');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 150 && fn.length < 1500, 'slice suspicious: ' + fn.length);
  assert.ok(/if \(!repGraphHosts\[canvasId\]\)/.test(fn), 'created once, then reused');
  assert.ok(/createElement\('canvas'\)/.test(fn), 'the canvas is a real node, not markup');
});

test('⚠ MOUNT RUNS BEFORE DRAW at BOTH call sites — ordering established, not described', () => {
  ['drawRepSeriesCharts();', 'function drawRepOwnChart()'].forEach((anchor) => {
    const at = LIVE.indexOf(anchor);
    assert.ok(at > 0, 'anchor is stale: ' + anchor);
  });
  // team view
  const teamDraw = LIVE.indexOf('drawRepSeriesCharts();');
  const teamMount = LIVE.lastIndexOf('mountRepGraphHosts();', teamDraw);
  assert.ok(teamMount > 0 && teamDraw - teamMount < 400,
    'the team view must mount its hosts immediately before drawing');
  // pivoted rep's own graph — parity
  const ownAt = LIVE.indexOf('function drawRepOwnChart()');
  const ownBody = LIVE.slice(ownAt, LIVE.indexOf('\n  }', ownAt) + 4);
  assert.ok(/mountRepGraphHosts\(\)/.test(ownBody),
    'PARITY: the pivoted rep graph is preserved too, or one graph still flashes '
    + 'and it reads as an intermittent bug rather than a missed call site');

  /**
   * ⚠⚠ AND IT MUST HAVE A SLOT TO MOUNT INTO. The line above PASSED VACUOUSLY
   * on first write: drawRepOwnChart called mountRepGraphHosts(), but
   * repOwnGraphHtml still emitted its own inline <canvas> with no
   * .rep-graph-slot anywhere — so the mount was a no-op and that graph kept
   * being destroyed and rebuilt while the other three no longer were. The
   * assertion described parity that did not exist. Caught by the render probe,
   * not by reading the code.
   */
  const ownHtmlAt = LIVE.indexOf('function repOwnGraphHtml');
  const ownHtml = LIVE.slice(ownHtmlAt, LIVE.indexOf('\n  }', ownHtmlAt) + 4);
  assert.ok(ownHtml.length > 200 && ownHtml.length < 2500, 'slice suspicious: ' + ownHtml.length);
  assert.ok(!/<canvas/.test(ownHtml),
    'the rep-own graph must emit a SLOT, not a canvas — an inline canvas is '
    + 'replaced on every render and the mount call above becomes decorative');
  assert.ok(/data-canvas="repOwnChart"/.test(ownHtml), 'and the slot must name its canvas');
});

test('⚠⚠ an existing chart is UPDATED, not destroyed — and without animation', () => {
  const at = LIVE.indexOf('var existing = repCharts[canvasId];');
  assert.ok(at > 0, 'the update path is missing');
  const fn = LIVE.slice(at, LIVE.indexOf('repCharts[canvasId] = new Chart', at));
  assert.ok(fn.length > 150 && fn.length < 1500, 'slice suspicious: ' + fn.length);
  assert.ok(/existing\.canvas === ctx/.test(fn),
    'guard on canvas identity — never update a chart bound to a dead canvas');
  assert.ok(/existing\.update\('none'\)/.test(fn),
    "update('none') — the default ANIMATES the transition, which is just a "
    + 'slower version of the flash');
  assert.ok(/data\.datasets = datasets/.test(fn), 'new data must reach the instance');
});

/**
 * ⚠ THE PARITY RULE, ASSERTED: a graph that stops flashing but drops the hidden
 * set on every data arrival is a WORSE bug than the one being fixed.
 */
test('⚠ the hidden set and the fixed average survive an update by construction', () => {
  const at = LIVE.indexOf('function repSeriesChart');
  const fn = LIVE.slice(at, LIVE.indexOf('repCharts[canvasId] = new Chart', at));
  assert.ok(fn.length > 1000 && fn.length < 8000, 'slice suspicious: ' + fn.length);
  // datasets are rebuilt from state on every pass, so the update carries them
  assert.ok(/hidden: !!\(toggleable && state\.repLineHidden/.test(fn),
    'hidden must be derived from state, keyed by user_id — not read off the '
    + 'old chart, which the update replaces');
  assert.ok(/_fixed: true/.test(fn), 'the team average must stay non-toggleable');
  assert.ok(/_userId: toggleable \? r\.user_id : null/.test(fn),
    'the toggle identity travels on the dataset, so an update cannot lose it');
});
