/**
 * SYNC NOW MOVES TO #account → CONNECTIONS, THEN THE HEALTHY CARDS GO
 * (Justin's ruling 2026-08-20).
 *
 * ⚠⚠ THE ORDER IS THE WHOLE POINT AND IT IS WHY THIS BLOCK STOPPED LAST TIME.
 * `syncFathomNow()` had exactly three call sites and TWO of them are
 * unreachable on a healthy account:
 *   renderFathomStripConnected  the healthy card Justin wants gone
 *   renderFathomStripError      only renders when the connection is FAILING
 *   getStartedCardHtml          returns '' once connected && analyzed
 * So removing the healthy card removes a working account's ONLY access to
 * manual sync, and Connections had none of it. Build first, remove second.
 *
 * ⚠ THE ERROR STRIP STAYS. A failing connection must still surface on the
 * dashboard — standing ruling, red on every screen. Asserted below so a future
 * tidy-up cannot take it with the healthy one.
 *
 * ⚠ ZOOM HAS NO ERROR STRIP TO PRESERVE. Its section is connected /
 * not-connected only; there is no `last_sync_status === 'error'` branch. That
 * asymmetry is real, not an oversight in these tests.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ line comments BEFORE block comments — a `/*` inside a `//` is a false
   opener that can swallow hundreds of lines and make present code look absent. */
const LIVE = RAW.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fnBody(name, min, max) {
  const at = LIVE.indexOf('function ' + name);
  assert.ok(at > -1, name + ' must exist');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(fn.length > min && fn.length < max,
    'slice must cover ' + name + ', got ' + fn.length);
  return fn;
}

test('⚠⚠ Connections offers Sync Now for BOTH providers', () => {
  const row = fnBody('connectionRowHtml', 200, 6000);
  assert.ok(/syncProviderNow\(/.test(row),
    'the connected row must offer a sync action — without it, removing the ' +
    'dashboard card leaves a healthy account with no way to sync at all');
  // ⚠ it must sit in the CONNECTED branch, never beside "Connect"
  const connectIdx = row.indexOf('>Connect<');
  const syncIdx = row.indexOf('syncProviderNow(');
  assert.ok(syncIdx > connectIdx,
    'Sync Now belongs in the connected branch, not next to Connect');
});

test('⚠⚠ the dispatcher routes each provider to its OWN sync function', () => {
  const d = fnBody('syncProviderNow', 60, 1200);
  assert.ok(/syncFathomNow\(\)/.test(d), 'fathom path');
  assert.ok(/syncZoomNow\(\)/.test(d), 'zoom path — Zoom POSTs /zoom/sync, ' +
    'Fathom GETs /fathom/sync, so one shared handler would be wrong');
});

test('⚠⚠ IN-PROGRESS FEEDBACK IS NOT GATED TO overview — that is the integration bug', () => {
  /* Both sync functions opened with `if (state.view === 'overview')
     renderOverview(false);`. Clicked from #account that is a NO-OP, so the
     button would look dead for the whole request while the sync really ran.
     ⚠ The COMPLETION path was already correct — rerenderConnectionViews()
     handles overview AND account — so only the opening render was wrong, and
     reading the code would show a re-render that simply does not fire here. */
  ['syncFathomNow', 'syncZoomNow'].forEach((name) => {
    const fn = fnBody(name, 200, 6000);
    assert.ok(!/state\.view === 'overview'\) renderOverview/.test(fn),
      name + ' must not gate its in-progress render to the overview view');
    assert.ok(/rerenderConnectionViews\(\)/.test(fn),
      name + ' must re-render whichever connection view is showing');
  });
});

test('⚠⚠ the HEALTHY connected cards are gone from the render path', () => {
  const f = fnBody('renderFathomSectionHtml', 200, 4000);
  assert.ok(!/renderFathomStripConnected\(/.test(f),
    'the healthy Fathom card must no longer be dispatched');
  const z = fnBody('renderZoomSectionHtml', 200, 4000);
  assert.ok(!/Zoom connected/.test(z),
    'the healthy Zoom card must no longer be dispatched');
});

test('⚠⚠ the FATHOM ERROR STRIP SURVIVES — a failing connection must still show', () => {
  const f = fnBody('renderFathomSectionHtml', 200, 4000);
  assert.ok(/renderFathomStripError\(/.test(f),
    'the error strip must still be dispatched — standing ruling, red on every screen');
  assert.ok(LIVE.indexOf('function renderFathomStripError') > -1,
    'and the function itself must survive');
  // and its Retry Sync must still be wired
  const err = fnBody('renderFathomStripError', 100, 3000);
  assert.ok(/syncFathomNow\(\)/.test(err), 'Retry Sync must still fire a sync');
});

test('⚠ the OTHER states survive too — connect card, identity prompt, syncing', () => {
  const f = fnBody('renderFathomSectionHtml', 200, 4000);
  ['renderFathomConnectCard', 'renderFathomIdentityPrompt', 'renderFathomStripSyncing']
    .forEach((n) => assert.ok(f.indexOf(n) > -1, n + ' branch must survive'));
});

test('⚠⚠ NON-VACUITY — the removal assertions fail if a healthy card comes back', () => {
  // An absence assertion is the easiest test here to write and have mean
  // nothing. Prove each matcher fires against the defect it names.
  const broken = fnBody('renderFathomSectionHtml', 200, 4000)
    + '\n      inner = renderFathomStripConnected(state.fathomStatus);';
  assert.ok(/renderFathomStripConnected\(/.test(broken),
    'the matcher must detect a reintroduced healthy card');
  const zbroken = fnBody('renderZoomSectionHtml', 200, 4000) + '\nZoom connected';
  assert.ok(/Zoom connected/.test(zbroken),
    'the Zoom matcher must detect a reintroduced healthy card');
});
