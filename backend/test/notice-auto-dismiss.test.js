/**
 * FLASH NOTICES AUTO-DISMISS — BUT ONLY THE SUCCESS ONES.
 *
 * Justin, 2026-08-19: "once a provider is connected the pop-ups at the top go
 * away." The connect CARDS were already connection-conditional; the thing that
 * lingered was the sync notice, which had no timer.
 *
 * ⚠⚠ THE SPLIT IS THE DESIGN, NOT A DEFAULT:
 *   success  → the information is already on screen (the calls appeared)
 *   warn/err → the text exists NOWHERE ELSE and is the only actionable thing
 * The second case is literally the Zoom "no cloud recordings found yet" message
 * — the one panel standing between "Scout is broken" and "check this setting".
 * Auto-dismissing that would re-create the silent-empty-sync failure by hand.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function armFn() {
  const at = LIVE.indexOf('function armNoticeAutoDismiss()');
  assert.ok(at !== -1, 'stale anchor — armNoticeAutoDismiss is gone');
  const end = LIVE.indexOf('\n  }', at);
  const fn = LIVE.slice(at, end + 4);
  assert.ok(fn.length > 200 && fn.length < 1500, 'slice suspicious: ' + fn.length);
  return fn;
}

test('⚠⚠ ONLY success auto-dismisses — warn and error must persist', () => {
  const fn = armFn();
  assert.ok(/kind !== 'success'/.test(fn),
    'the guard must return early for anything that is not success');
  assert.ok(!/kind === 'warn'|kind === 'error'/.test(fn),
    'warn/error must never be armed for dismissal');
});

test('⚠ the timer is armed by notice IDENTITY, so re-renders cannot extend it', () => {
  const fn = armFn();
  assert.ok(/_noticeArmed === n/.test(fn),
    're-render safety: arming must be a no-op when the same notice is already armed');
  assert.ok(/clearTimeout\(_noticeTimer\)/.test(fn),
    'a NEW notice must cancel the previous timer, or it dismisses the wrong one');
});

test('⚠ the timer only clears the notice it was armed for', () => {
  const fn = armFn();
  assert.ok(/state\.fathomNotice === n/.test(fn) && /state\.zoomNotice === n/.test(fn),
    'on fire, it must confirm the notice is still the one armed — otherwise a '
    + 'newer notice gets cleared early');
});

test('the duration is a named constant, stated in one place', () => {
  const m = LIVE.match(/var NOTICE_AUTO_DISMISS_MS = (\d+);/);
  assert.ok(m, 'the duration must be a named constant, not an inline number');
  const ms = Number(m[1]);
  assert.ok(ms >= 4000 && ms <= 10000,
    'long enough to look back after a sync, short enough not to linger: got ' + ms);
});

test('⚠ both notice channels arm the shared timer — neither is left un-dismissing', () => {
  ['renderFathomNoticeHtml', 'renderZoomNoticeHtml'].forEach((fn) => {
    const at = LIVE.indexOf('function ' + fn + '()');
    assert.ok(at !== -1, 'stale anchor — ' + fn);
    const body = LIVE.slice(at, at + 400);
    assert.ok(/armNoticeAutoDismiss\(\)/.test(body), fn + ' must arm the timer');
  });
});

test('⚠ manual dismissal still exists — auto-dismiss ADDS to it, never replaces it', () => {
  assert.ok(/function dismissFathomNotice/.test(LIVE) && /function dismissZoomNotice/.test(LIVE),
    'both manual dismiss handlers must survive');
  assert.ok((LIVE.match(/fathom-notice-dismiss/g) || []).length >= 2,
    'the × button must remain on both channels — a warn/error has no other exit');
});
