'use strict';
/**
 * ⚠ D-9 (2026-09-03, H688): entering the EOD view directly threw — `renderEodView`
 * built its toolbar with `d.sync` BEFORE the null-lane branch, so a still-loading
 * lane (`state.eodData === null`) was a TypeError. Latent only because the nav's
 * path loads first. This EXECUTES the real renderer with the lane null, every
 * collaborator stubbed through a scope proxy, and asserts it paints the toolbar
 * and the waiting state instead of throwing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));

function run(state) {
  let painted = null;
  const scope = { state, document: { getElementById: () => ({ set innerHTML(v) { painted = v; }, get innerHTML() { return painted; } }) },
    laneWaitHtml: (which, copy) => '<div class="lane-wait">' + copy + '</div>', escapeHtml: (s) => String(s), datePickerHtml: () => '<span class="dp"></span>' };
  const proxy = new Proxy(scope, { has: (t, k) => !(k in globalThis) || k in t, get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => '' : undefined)) });
  const body = fnBody(LIVE, 'renderEodView');
  new Function('__s', 'with (__s) { ' + body + '\nrenderEodView(); }')(proxy);
  return painted;
}

test('⚠⚠ EXECUTED: a null EOD lane paints the toolbar and the waiting state — it does not throw', () => {
  const html = run({ eodData: null, eodLoading: true, eodDate: null, view: 'eod' });
  assert.ok(html && html.indexOf('eod-toolbar') !== -1, 'the toolbar painted');
  assert.ok(/lane-wait/.test(html), 'and the waiting state, in words');
});

test('the loaded lane still renders its sync note (the guard did not silence it)', () => {
  let called = 0;
  const painted = (() => {
    let out = null;
    const scope = { state: { eodData: { date: '2026-09-02', calls: [], sync: { connected: true } }, eodLoading: false, eodDate: '2026-09-02', view: 'eod' },
      document: { getElementById: () => ({ set innerHTML(v) { out = v; } }) }, laneWaitHtml: () => '', escapeHtml: (s) => String(s), datePickerHtml: () => '',
      eodSyncNoteHtml: (sync) => { called++; return '<i class="sync-note">' + (sync && sync.connected) + '</i>'; } };
    const proxy = new Proxy(scope, { has: (t, k) => !(k in globalThis) || k in t, get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => '' : undefined)) });
    new Function('__s', 'with (__s) { ' + fnBody(LIVE, 'renderEodView') + '\nrenderEodView(); }')(proxy);
    return out;
  })();
  assert.strictEqual(called, 1, 'the sync note was asked for once');
  assert.ok(/sync-note/.test(painted), 'and rendered');
});
