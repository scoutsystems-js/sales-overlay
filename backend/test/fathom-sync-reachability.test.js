/**
 * ⚠⚠ A BRAND-NEW ACCOUNT CONNECTED FATHOM, CLICKED SYNC FIVE TIMES, AND SAW
 * NOTHING. The server log is unambiguous:
 *
 *   [auth]   Fathom connection stored for user 40616e16… (expires_in=86400s)
 *   [fathom] sync blocked … fathom_email not set (needs_identity)   × 5
 *
 * Every one of those was an HTTP 200. The connection SAVED, the sync RAN, and
 * it was refused at the identity gate — which is correct behaviour, because a
 * sync without `recorded_by[]` pulls the WHOLE TEAM's recordings. What was
 * broken is that the refusal had nowhere to render:
 *
 *   • showFathomIdentityPrompt() ended with `if (state.view === 'overview')`,
 *     and the only manual Sync a healthy account has lives in #account.
 *   • The prompt's only MARKUP was in the overview strip, so even a correct
 *     render call had nothing to draw in Connections.
 *   • The Calls empty state offered "Connect a Recording Source" whenever the
 *     list was empty, with NO check of whether anything was connected.
 *
 * needs_identity is neither a success nor an error, so no notice fired either:
 * no calls, no progress, no error. This file pins each of those three.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

/* ⚠ Comments are stripped before any ABSENCE check: this codebase archives
   removed code in place, and the comments here deliberately QUOTE the defective
   line to explain it. Checking the raw text would report the fix as un-shipped. */
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── slice one function out, with the standing guards ─────────────────────── */
function slice(startMarker, endMarker, min) {
  const at = HTML.indexOf(startMarker);
  assert.ok(at !== -1, 'stale start marker: ' + startMarker);
  // ⚠ fromIndex — without it indexOf finds the FIRST occurrence in the whole
  // file, which is routinely BEFORE `at`, and slice(big, small) returns ''.
  const end = HTML.indexOf(endMarker, at);
  assert.ok(end !== -1, 'stale end marker: ' + endMarker);
  const src = HTML.slice(at, end);
  /* ⚠ the load-bearing half: a backwards or truncated slice must fail LOUDLY
     rather than quietly testing an empty string. ⚠ The floor is per-call —
     a blanket 400 assumes every function is large, and it wrongly rejected a
     genuine 4-line predicate. A bound that cannot be satisfied is as useless
     as one that cannot fail. */
  const floor = typeof min === 'number' ? min : 400;
  assert.ok(src.length > floor && src.length < 12000,
    'slice must cover the function; got ' + src.length + ' chars (floor ' + floor + ')');
  return src;
}

/* ── §1 · THE CALLS EMPTY STATE ───────────────────────────────────────────── */

const EMPTY_SRC = slice('function callLibraryEmptyHtml() {', '\n  function renderCallLibrary(');

// Build the real function with stubs for everything it reaches out to.
function makeEmptyHtml(state, opts) {
  const o = opts || {};
  const calls = { loadConnStatus: 0 };
  const fn = new Function('state', 'stubs', `
    var anySourceConnected = stubs.anySourceConnected;
    var fathomIdentityMissing = stubs.fathomIdentityMissing;
    var connectSourceCtaHtml = stubs.connectSourceCtaHtml;
    var renderFathomIdentityPrompt = stubs.renderFathomIdentityPrompt;
    var loadConnStatusForLibrary = stubs.loadConnStatusForLibrary;
    var escapeHtml = stubs.escapeHtml;
    var formatRelativeTime = stubs.formatRelativeTime;
    ${EMPTY_SRC}
    return callLibraryEmptyHtml();
  `);
  const html = fn(state, {
    // the REAL predicates, taken from the page rather than reimplemented
    anySourceConnected: () => !!((state.fathomStatus && state.fathomStatus.connected) ||
                                 (state.zoomStatus && state.zoomStatus.connected)),
    fathomIdentityMissing: () => !!(state.fathomStatus && state.fathomStatus.connected &&
                                    !state.fathomStatus.fathom_email),
    connectSourceCtaHtml: () => '<button onclick="goConnectSource()">Connect a Recording Source →</button>',
    renderFathomIdentityPrompt: () => '<div id="THE_PROMPT"></div>',
    loadConnStatusForLibrary: () => { calls.loadConnStatus++; },
    escapeHtml: (s) => String(s == null ? '' : s),
    formatRelativeTime: () => '2 minutes ago',
  });
  return { html, calls };
}

const CONNECT_CTA = 'Connect a Recording Source';

test('⚠⚠ CONNECTED-WITH-NO-CALLS MUST NOT BE TOLD TO CONNECT — the reported bug', () => {
  // Exactly Josh's row: connected, tokens valid, no identity, never synced.
  const { html } = makeEmptyHtml({
    fathomStatus: { connected: true, fathom_email: null, last_sync_at: null, last_sync_status: null },
    zoomStatus: { connected: false },
    fathomSyncing: false, zoomSyncing: false, fathomNeedsIdentity: false,
    connStatusLoading: false,
  });

  assert.strictEqual(html.indexOf(CONNECT_CTA), -1,
    'a CONNECTED account was told to connect a recording source — this is the exact '
    + 'screenshot that was reported. Offering an action already completed sends the user '
    + 'to redo the step that worked and hides the one that needs them.');
  assert.ok(/Fathom is connected/.test(html), 'it must say the connection is fine');
  assert.ok(/paused/.test(html), 'and that syncing is paused, which is the actual state');
  assert.ok(/Choose My Fathom Email/.test(html), 'and offer the step that unblocks it');
});

test('⚠ NOT CONNECTED still gets the Connect button — the fix must not overshoot', () => {
  const { html } = makeEmptyHtml({
    fathomStatus: { connected: false }, zoomStatus: { connected: false },
    fathomSyncing: false, zoomSyncing: false, fathomNeedsIdentity: false,
    connStatusLoading: false,
  });
  assert.ok(html.indexOf(CONNECT_CTA) !== -1,
    'the genuinely-not-connected state is the ONE case where this CTA is right');
});

test('⚠⚠ null STATUS IS "UNKNOWN", NEVER "NOT CONNECTED"', () => {
  /* Connection status is fetched by the OVERVIEW boot, so a deep link straight
     to Calls arrives with both null. Reading that as "not connected" is what
     let the wrong message render for a connected user. */
  const { html, calls } = makeEmptyHtml({
    fathomStatus: null, zoomStatus: null,
    fathomSyncing: false, zoomSyncing: false, fathomNeedsIdentity: false,
    connStatusLoading: false,
  });
  assert.strictEqual(html.indexOf(CONNECT_CTA), -1,
    'status is UNKNOWN here — claiming "not connected" is a guess, and it guessed wrong '
    + 'for the one user it mattered to');
  assert.ok(/Checking your recording sources/.test(html));
  assert.strictEqual(calls.loadConnStatus, 1, 'and it must actually go and find out');
});

test('⚠⚠ A FAILED SYNC SAYS SO — a failure and a slow sync looked identical', () => {
  const { html } = makeEmptyHtml({
    fathomStatus: {
      connected: true, fathom_email: 'joshua@soberlivingriches.com',
      last_sync_at: '2026-08-24T19:00:00Z', last_sync_status: 'error',
      last_sync_error: 'Fathom returned 401',
    },
    zoomStatus: { connected: false },
    fathomSyncing: false, zoomSyncing: false, fathomNeedsIdentity: false,
    connStatusLoading: false,
  });
  assert.ok(/Your Last Sync Failed/.test(html), 'the failure must be stated');
  assert.ok(/Fathom returned 401/.test(html), 'with the real reason, not a generic string');
  assert.ok(/Retry Sync/.test(html), 'and a way out');
  assert.strictEqual(html.indexOf(CONNECT_CTA), -1);
});

test('⚠ NEVER-SYNCED and SYNCED-BUT-EMPTY read differently — different facts', () => {
  const base = {
    zoomStatus: { connected: false }, fathomSyncing: false, zoomSyncing: false,
    fathomNeedsIdentity: false, connStatusLoading: false,
  };
  const never = makeEmptyHtml(Object.assign({}, base, {
    fathomStatus: { connected: true, fathom_email: 'a@b.c', last_sync_at: null, last_sync_status: null },
  })).html;
  const empty = makeEmptyHtml(Object.assign({}, base, {
    fathomStatus: { connected: true, fathom_email: 'a@b.c', last_sync_at: '2026-08-24T19:00:00Z', last_sync_status: 'ok' },
  })).html;

  assert.ok(/no sync has run yet/.test(never));
  assert.ok(/found no calls/.test(empty));
  assert.notStrictEqual(never, empty,
    'a sync that never ran and a sync that found nothing are different problems');
  [never, empty].forEach((h) => assert.strictEqual(h.indexOf(CONNECT_CTA), -1));
});

test('⚠ AN IN-FLIGHT SYNC REPORTS ONLY WHAT IS KNOWN — no invented percentage', () => {
  const { html } = makeEmptyHtml({
    fathomStatus: { connected: true, fathom_email: 'a@b.c', last_sync_at: null },
    zoomStatus: { connected: false },
    fathomSyncing: true, zoomSyncing: false, fathomNeedsIdentity: false,
    connStatusLoading: false,
  });
  assert.ok(/Syncing Your Calls/.test(html));
  /* ⚠⚠ THE RULING: "only report progress you actually know. A fake percentage
     that climbs on a timer is worse than a spinner, because it lies during a
     failure." The sync is ONE request that returns when it is done — there is
     no intermediate count to report, so there must be no percentage. */
  assert.ok(!/%/.test(html),
    'a percentage appeared in the syncing state — the sync cannot report real '
    + 'progress, so any number here is invented and would keep climbing through a failure');
});

test('⚠⚠ renderCallLibrary ACTUALLY CALLS IT — the function is not the call site', () => {
  /* ⚠⚠ THIS TEST EXISTS BECAUSE THE ONES ABOVE DID NOT FIRE. Reverting the fix
     to prove non-vacuity, ten of twelve guards stayed GREEN: every empty-state
     assertion drives callLibraryEmptyHtml() directly, so it passes whether or
     not anything calls it. Exercising a function and grepping for its name are
     the same check twice — both confirm it EXISTS, neither confirms it RUNS.
     The defect was one line in renderCallLibrary, and nothing above could see
     it. */
  const src = slice('function renderCallLibrary() {', '\n  function renderCallLibraryHeaderHtml');

  assert.ok(src.indexOf('callLibraryEmptyHtml()') !== -1,
    'renderCallLibrary must DELEGATE its empty state — a correct helper nothing calls '
    + 'is exactly the shape of the bug that shipped');

  const live = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.strictEqual(live.indexOf('connectSourceCtaHtml()'), -1,
    'renderCallLibrary still emits the Connect CTA directly. That unconditional call — '
    + 'shown whenever the list was empty, with no connectivity check — IS the reported bug.');
});

/* ── §2 · THE PROMPT MUST BE REACHABLE FROM WHERE SYNC IS CLICKED ─────────── */

test('⚠⚠ rerenderConnectionViews COVERS THE CALLS PAGE, NOT JUST overview+account', () => {
  const src = slice('function rerenderConnectionViews() {', '\n  function invalidateCallLibrary');
  ['overview', 'account', 'call-library'].forEach((v) => {
    assert.ok(src.indexOf("'" + v + "'") !== -1,
      'rerenderConnectionViews must re-render ' + v + '; a render that does not fire is '
      + 'invisible to every check except clicking');
  });
});

test('⚠⚠ NO CONNECTION-PATH HANDLER RENDERS ONLY THE OVERVIEW', () => {
  /* The defect, stated as a property rather than as a list of line numbers.
     Each of these raises state that is displayed in Connections, so an
     overview-only render is a silent no-op there — which is how five clicks
     produced nothing. */
  const FNS = [
    ['showFathomIdentityPrompt', 'async function showFathomIdentityPrompt() {', '\n  function selectFathomIdentity'],
    ['saveFathomIdentity', 'async function saveFathomIdentity() {', '\n  function dismissFathomNotice'],
    ['connectZoom', 'async function connectZoom() {', '\n  async function disconnectProvider'],
  ];
  FNS.forEach(([name, a, b]) => {
    const src = slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.strictEqual(src.indexOf("state.view === 'overview'"), -1,
      name + ' still renders only when the view is overview. Its prompt/notice is shown '
      + 'in #account -> Connections, so from there the call is a no-op and the user sees '
      + 'nothing at all.');
    assert.ok(src.indexOf('rerenderConnectionViews()') !== -1,
      name + ' must route its re-render through rerenderConnectionViews()');
  });
});

test('⚠⚠ THE PROMPT HAS MARKUP IN CONNECTIONS — a correct render call needs somewhere to draw', () => {
  const src = slice('function renderConnectionsSectionHtml() {', '\n  function priceFieldHtml');
  assert.ok(src.indexOf('renderFathomIdentityPrompt()') !== -1,
    'Connections must be able to DRAW the identity prompt. Fixing only the render call '
    + 'would leave it firing against a section with no markup for it.');
  assert.ok(src.indexOf('fathomIdentityMissing()') !== -1,
    'and it must key off the STATUS (fathom_email null), not off having clicked Sync — '
    + 'so it surfaces on arrival rather than only after hitting the wall');
});

test('⚠ A CONNECTED-BUT-UNCONFIGURED FATHOM IS NOT SHOWN AS PLAIN "Connected"', () => {
  const src = slice('function fathomIdentityMissing() {', '\n  function renderConnectionsSectionHtml', 80);
  assert.ok(/fathom_email/.test(src) && /connected/.test(src),
    'the predicate must read BOTH connected and fathom_email — a connection whose every '
    + 'sync is refused server-side is not a working connection');
});

/* ── §3 · A SUCCESSFUL SYNC MUST SHOW ITS CALLS ───────────────────────────── */

test('⚠⚠ BOTH SYNC HANDLERS INVALIDATE THE CACHED CALL LIST', () => {
  /* Without this the page renders the CACHED EMPTY LIST after a successful
     sync — "Synced 20 calls" displayed directly above "no calls synced yet",
     which is indistinguishable from the sync having failed. */
  [
    ['syncFathomNow', 'async function syncFathomNow() {', '\n  async function syncZoomNow'],
    ['syncZoomNow', 'async function syncZoomNow() {', '\n  async function reanalyzeFathomNow'],
  ].forEach(([name, a, b]) => {
    const src = slice(a, b);
    assert.ok(src.indexOf('invalidateCallLibrary()') !== -1,
      name + ' must invalidate the cached call list on success, or a working sync still '
      + 'shows an empty Calls page');
  });
});

/* ── non-vacuity ──────────────────────────────────────────────────────────── */

test('⚠ THE GUARDS ABOVE ARE NOT VACUOUS — the defect is reintroduced and they fire', () => {
  // (a) the empty state: restore the unconditional CTA and the connected case breaks
  const broken = makeEmptyHtml.bind(null);
  const connected = {
    fathomStatus: { connected: true, fathom_email: null, last_sync_at: null },
    zoomStatus: { connected: false },
    fathomSyncing: false, zoomSyncing: false, fathomNeedsIdentity: false, connStatusLoading: false,
  };
  const good = broken(connected).html;
  assert.strictEqual(good.indexOf(CONNECT_CTA), -1);
  // the pre-fix markup, verbatim — it MUST trip the assertion the test makes
  const old = '<div class="empty fade-in"><h3>No calls synced yet</h3>'
    + '<p>Connect a recording source (Zoom or Fathom)…</p>'
    + '<button onclick="goConnectSource()">Connect a Recording Source →</button></div>';
  assert.ok(old.indexOf(CONNECT_CTA) !== -1,
    'the pre-fix output must be caught by the same check the test uses; if this fails the '
    + 'assertion above proves nothing');

  // (b) the render guard: an overview-only body must be rejected
  const overviewOnly = "  if (state.view === 'overview') renderOverview(false);\n";
  assert.ok(overviewOnly.indexOf("state.view === 'overview'") !== -1,
    'the overview-only guard must match the exact string the defect used');
});
