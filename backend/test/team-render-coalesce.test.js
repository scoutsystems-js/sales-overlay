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
  ['renderTeamView()', 'renderTeamExpanded()', 'renderTeamNeedsWorkView()', 'renderTeamMembersView()']
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
  const renderTeamView = () => {
    calls.render++;
    nodes.length = 0;
    for (let i = 0; i < 11; i++) nodes.push(mkSection());   // 11 sections per render, as measured
  };
  const noop = () => {};
  const frames = [];
  const requestAnimationFrame = (f) => frames.push(f);

  const fn = new Function(
    'document', 'state', 'renderTeamView', 'renderTeamExpanded',
    'renderTeamNeedsWorkView', 'renderTeamMembersView', 'requestAnimationFrame', 'setTimeout',
    src + '; return scheduleTeamRender;'
  )(document, state, renderTeamView, noop, noop, noop, requestAnimationFrame, () => 0);

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
