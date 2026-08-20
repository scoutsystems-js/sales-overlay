/**
 * NAV TABS FOR THE FOUR UNBUILT PAGES — "coming soon" and INERT.
 * Follow Up Strategy · Scout AI · Marketing Insights · Reps (manager rep-picker)
 *
 * ⚠⚠ "INERT" IS A STRUCTURAL PROPERTY, NOT A STYLE. They are <span>, not <a>:
 * no href to navigate, not in the tab order, no link semantics announced, and
 * no :hover affordance unless one is written. Styling an <a> to LOOK disabled
 * leaves every one of those behaviours intact — it would still focus, still
 * announce as a link, and still be activated by Enter from the keyboard. A
 * disabled-looking control that still works is worse than no control.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const LABELS = ['Follow Up Strategy', 'Scout AI', 'Marketing Insights', 'Reps'];

function navBlock() {
  const at = LIVE.indexOf('<div class="top-bar-left">');
  assert.ok(at !== -1, 'stale anchor — the nav block moved');
  const block = LIVE.slice(at, LIVE.indexOf('<div class="top-bar-right">', at));
  assert.ok(block.length > 400 && block.length < 4000, 'slice suspicious: ' + block.length);
  return block;
}

test('all four tabs are present in the nav', () => {
  const nav = navBlock();
  LABELS.forEach((l) => assert.ok(nav.indexOf('>' + l + '<') !== -1, 'missing tab: ' + l));
});

test('⚠⚠ each is a <span>, never an <a> — the only real definition of inert', () => {
  const nav = navBlock();
  LABELS.forEach((label) => {
    // ⚠ anchor on the TEXT NODE, not the bare label: "Reps" also occurs inside
    // id="navReps"/"navRepsSep", so indexOf(label) matched an ATTRIBUTE and the
    // walk-back landed on the wrong tag. The check was wrong, not the markup.
    const at = nav.indexOf('>' + label + '<');
    // walk back to the opening tag that contains this label
    const open = nav.lastIndexOf('<', at);
    const tag = nav.slice(open, at);
    assert.ok(/^<span/.test(tag), label + ' must be a <span>, got: ' + tag.slice(0, 40));
    assert.ok(!/href/.test(tag), label + ' must have no href');
    assert.ok(!/onclick/.test(tag), label + ' must have no click handler');
    assert.ok(!/tabindex/.test(tag), label + ' must not be made focusable');
    assert.ok(/aria-disabled="true"/.test(tag), label + ' must announce as disabled');
  });
});

test('⚠ no route exists for any of them — a tab must not become reachable by hash', () => {
  ['follow-up-strategy', 'scout-ai', 'marketing-insights', 'rep-picker'].forEach((slug) => {
    assert.ok(LIVE.indexOf("'" + slug + "'") === -1,
      'a route appeared for ' + slug + ' — these are inert until the page exists');
  });
});

test('⚠⚠ the manager-only tabs ride the SAME gate as Team, and start hidden', () => {
  const nav = navBlock();
  ['navMkt', 'navReps', 'navMktSep', 'navRepsSep'].forEach((id) => {
    const at = nav.indexOf('id="' + id + '"');
    assert.ok(at !== -1, 'missing element: ' + id);
    const tag = nav.slice(nav.lastIndexOf('<', at), nav.indexOf('>', at));
    assert.ok(/display:none/.test(tag), id + ' must be hidden by default — a tab '
      + 'must never advertise a page its viewer cannot open');
  });
  // and revealed only inside the manager/owner branch
  const gate = LIVE.indexOf("state.me.role === 'manager' || state.me.role === 'owner'");
  assert.ok(gate !== -1, 'stale anchor — the manager gate moved');
  const branch = LIVE.slice(gate, gate + 900);
  ['navMkt', 'navMktSep', 'navReps', 'navRepsSep'].forEach((id) => {
    assert.ok(branch.indexOf(id) !== -1, id + ' must be revealed by the manager gate');
  });
});

test('⚠ Follow Up Strategy and Scout AI are NOT manager-gated', () => {
  const nav = navBlock();
  ['Follow Up Strategy', 'Scout AI'].forEach((label) => {
    const at = nav.indexOf('>' + label + '<');
    const tag = nav.slice(nav.lastIndexOf('<', at), at);
    assert.ok(!/display:none/.test(tag), label + ' is for all users and must render immediately');
  });
});

test('⚠ every new tab carries its own separator — nothing generates them', () => {
  const nav = navBlock();
  // the nav is hand-written markup; the (ff) note records that a missing "·"
  // has shipped before precisely because nothing adds one automatically.
  const seps = (nav.match(/class="sep/g) || []).length;
  const links = (nav.match(/class="nav-link/g) || []).length;
  assert.ok(seps >= links - 1,
    'a nav link was added without its separator (' + links + ' links, ' + seps + ' seps)');
});

test('⚠ dimming is by OPACITY, never a grey colour', () => {
  const at = LIVE.indexOf('.top-bar-left .nav-soon {');
  assert.ok(at !== -1, 'stale anchor — .nav-soon rule');
  const rule = LIVE.slice(at, LIVE.indexOf('}', at));
  assert.ok(/opacity:/.test(rule), 'must dim with opacity');
  assert.ok(!/color:\s*#/.test(rule),
    'a grey hex here is the no-grey rule wearing a different name — opacity as a '
    + 'depth cue is allowed, a low-contrast text colour is not');
  assert.ok(/cursor:\s*default/.test(rule), 'must not present a clickable cursor');
});
