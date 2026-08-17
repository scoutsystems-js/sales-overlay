/**
 * Bug: clicking a call-summary section showed the FAILURE copy during a normal
 * load — and not for a frame. It stayed for the whole request.
 *
 * ⚠ ROOT CAUSE, and why renaming the string would have been the wrong fix:
 * "not loaded yet" and "load failed" were the SAME condition (`!sectionData`).
 * `goSection` called `setView` — which renders immediately — while
 * `sectionLoading` was still false, because `loadSectionBreakdown` only sets the
 * flag once it starts. So the first paint fell into the failure branch and sat
 * there until the fetch resolved.
 *
 * Renaming the failure copy to "Loading" would have hidden a REAL failure behind
 * a spinner forever. The fix separates the three states instead.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const RAW = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
const SCRIPT = RAW.replace(/\n\s*init\(\);\s*$/, '\n');

function sandbox(fetchImpl) {
  let assigned = '';
  const contentEl = {
    get innerHTML() { return assigned; },
    set innerHTML(v) { assigned = String(v); },
    insertAdjacentHTML(_p, v) { assigned += String(v); },
  };
  const doc = {
    getElementById: (id) => (id === 'content' ? contentEl : null),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {}, classList: { add() {}, remove() {} }, dataset: {} }, documentElement: { style: {} },
  };
  const win = {
    location: { hash: '', search: '', pathname: '/dashboard', replace() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, setTimeout(f) { return 0; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), history: { replaceState() {}, pushState() {} },
    scrollTo() {}, Chart: function () { this.destroy = function () {}; },
  };
  const api = new Function('document', 'window', 'Chart', 'localStorage', 'fetch', 'console',
    SCRIPT + '\n;return { state, goSection, renderSectionView, loadSectionBreakdown };')(
    doc, win, win.Chart, win.localStorage, fetchImpl, { log() {}, warn() {}, error() {} });
  return { api, html: () => assigned };
}

const BASE = {
  me: { user_id: 'u1', role: 'user' }, viewingUserId: null,
  dateRange: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-14T23:59:59.999Z' },
};

test('THE BUG: clicking a section must NOT show the failure copy', () => {
  // A fetch that never resolves == the whole time the request is in flight.
  const { api, html } = sandbox(() => new Promise(() => {}));
  Object.assign(api.state, BASE);
  api.goSection('discovery');
  const out = html();
  assert.strictEqual(out.indexOf('Could not load this section'), -1,
    'the failure copy must never appear during a normal load');
  assert.ok(out.indexOf('Loading…..') !== -1, 'it shows the loading state instead: ' + out.slice(0, 300));
});

test('the loading flag is set BEFORE the first render, not after', () => {
  // This is the actual defect. setView renders immediately; the flag used to be
  // set later, inside loadSectionBreakdown.
  const { api } = sandbox(() => new Promise(() => {}));
  Object.assign(api.state, BASE);
  api.goSection('discovery');
  assert.strictEqual(api.state.sectionLoading, true);
  assert.strictEqual(api.state.sectionData, null);
  assert.strictEqual(api.state.sectionError, null, 'a fresh load carries no error');
});

test('A GENUINE FAILURE still says so — the copy was not renamed away', () => {
  const { api, html } = sandbox(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
  Object.assign(api.state, BASE);
  return api.loadSectionBreakdown('discovery').then(() => {
    api.state.view = 'section'; api.state.selectedSection = 'discovery';
    api.renderSectionView();
    const out = html();
    assert.ok(out.indexOf('Could not load this section') !== -1, 'a real failure must still be reported');
    assert.ok(out.indexOf('HTTP 500') !== -1, 'and should say what went wrong');
  });
});

test('a network throw is reported as a failure, not as endless loading', () => {
  const { api, html } = sandbox(() => Promise.reject(new Error('offline')));
  Object.assign(api.state, BASE);
  return api.loadSectionBreakdown('discovery').then(() => {
    api.state.view = 'section'; api.state.selectedSection = 'discovery';
    api.renderSectionView();
    assert.strictEqual(api.state.sectionLoading, false, 'the flag must clear even on a throw');
    assert.ok(html().indexOf('Could not load this section') !== -1);
    assert.ok(html().indexOf('offline') !== -1);
  });
});

test('the three states are genuinely distinct in the renderer', () => {
  // ⚠ indexOf the END marker FROM the start index. Without a fromIndex this
  // slice ran backwards ('var delta' occurs earlier in the file) and tested an
  // empty string — the fourth time that has happened in this codebase.
  const at = HTML.indexOf('function renderSectionView');
  const fn = HTML.slice(at, HTML.indexOf('var delta', at));
  assert.ok(fn.length > 200 && fn.length < 4000, 'slice must cover the function: ' + fn.length);
  assert.ok(/state\.sectionLoading/.test(fn), 'loading is checked first');
  assert.ok(/state\.sectionError/.test(fn), 'and failure is a separate state');
  assert.ok(fn.indexOf('Loading…..') !== -1, "Josh's wording");
});
