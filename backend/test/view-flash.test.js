/**
 * DEEP-LINKED VIEWS MUST NOT FLASH THE OVERVIEW (2026-08-20).
 *
 * ⚠⚠ THE MECHANISM, MEASURED — AND IT IS NOT A VIEW-RESOLUTION RACE.
 * Refreshing on #team painted "Coaching Review" with empty skeletons for
 * ~3 SECONDS before Team appeared. The obvious theory is that something renders
 * with the default view before the hash is applied. Instrumented on the real
 * page, that is false:
 *
 *     t=2038ms  applyHashToState ->  state.view ALREADY 'team'
 *     t=2038ms  renderOverview   CALLED WITH state.view='team'   <- the defect
 *     t=5050ms  render()         state.view='team'  -> Team paints
 *
 * state.view is NEVER wrong. The overview's data-loader calls
 * renderOverview(true) UNCONDITIONALLY at boot, so it paints its own skeleton
 * over whatever view is correctly set. The tell: document.body.dataset.view was
 * UNSET while "Coaching Review" was on screen, because only render() sets that
 * attribute — the fingerprint of a renderer invoked outside the dispatch.
 *
 * ⚠ IT IS GENERAL, NOT TEAM-SPECIFIC. Same probe on #eod:
 *     t=2637ms  renderOverview CALLED WITH state.view='eod'
 * So #team, #eod, #calls and #kb all flash. A team-only fix is the wrong shape.
 *
 * ⚠ The codebase already knows the rule: 25+ other renderOverview( call sites
 * carry `if (state.view === 'overview')`. This is the one omission, in the one
 * path that runs at boot for every view.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// ⚠ strip comments — this file archives removed code in place AND discusses the
// rule in prose, so a raw scan finds the documentation of the guard.
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every call to renderOverview( that is not its own definition. */
function callSites() {
  return LIVE.split('\n').map((l, i) => ({ line: i + 1, text: l }))
    .filter((o) => /renderOverview\s*\(/.test(o.text) && !/function\s+renderOverview/.test(o.text));
}

test('⚠⚠ the BOOT skeleton paint is guarded by the active view', () => {
  // The boot loader's own paint. Identified by its distinctive loading argument.
  const boot = callSites().filter((o) => /renderOverview\(\s*true\b/.test(o.text));
  assert.ok(boot.length >= 1, 'stale anchor — the boot skeleton call moved');
  boot.forEach((o) => {
    assert.ok(/state\.view\s*===\s*'overview'/.test(o.text),
      'line ' + o.line + ': renderOverview(true) runs at boot for EVERY view. '
      + 'Unguarded it paints the Coaching Review skeleton over #team/#eod/#calls/#kb '
      + 'for ~3 seconds. Guard it like the other 25 call sites.');
  });
});

test('⚠ no renderOverview call may run without knowing the view', () => {
  // The general form. Exceptions must be justified in the allowlist below.
  /* ⚠ ALLOWLISTED BY ENCLOSING FUNCTION, NOT BY TEXT ON THE SAME LINE — the
     first version matched the function NAME against the call line, and the call
     is a bare `renderOverview(false);` with the name several lines above, so the
     allowlist could never match and the test reported a real exemption as a
     violation. These two are controls that EXIST ONLY ON THE OVERVIEW, so they
     cannot fire on another view; guarding them would be noise. */
  const ALLOWED_BARE = ['toggleOverviewSection', 'cycleSectionRank'];
  const lines = LIVE.split('\n');
  function enclosingFn(lineNo) {
    for (let i = lineNo - 1; i >= 0 && i > lineNo - 400; i--) {
      const m = lines[i].match(/function\s+([A-Za-z0-9_]+)/);
      if (m) return m[1];
    }
    return null;
  }
  const bare = callSites().filter((o) => !/state\.view\s*===\s*'overview'/.test(o.text))
    .filter((o) => ALLOWED_BARE.indexOf(enclosingFn(o.line)) === -1);
  assert.deepStrictEqual(bare.map((o) => o.line), [],
    'unguarded renderOverview call(s) at these lines — each paints the overview '
    + 'regardless of which view the user is on');
});
