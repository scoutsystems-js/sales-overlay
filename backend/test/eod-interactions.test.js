'use strict';

/* Executed EOD interaction guards. These use the real inline page functions with
 * local state/fetch/clipboard doubles; no production request or account data is used. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));

function execute(name, scope, args = '') {
  const source = fnBody(LIVE, name);
  const definition = /\bawait\b/.test(source) ? source.replace('function ' + name, 'async function ' + name) : source;
  const proxy = new Proxy(scope, {
    has: (target, key) => !(key in globalThis) || key in target,
    get: (target, key) => key in target ? target[key] : globalThis[key]
  });
  return new Function('__s', 'with (__s) { ' + definition + '\nreturn ' + name + '(' + args + '); }')(proxy);
}

function loadedState() {
  return {
    view: 'eod', eodLoading: false, eodDate: '2026-09-13',
    eodData: { date: '2026-09-13', sync: { connected: true, complete: true }, follow_up_closes: 0, calls: [{
      call_id: 'call-1', recording_url: 'https://example.test/call-1', analysis_status: 'done',
      fields: { prospect_name: 'Jamie Ellis', outcome: 'closed', cash_collected: '500', summary: 'Asked for the sale.', payment_structure: 'paid_in_full' },
      edited: { prospect_name: false, cash_collected: false, summary: false, payment_structure: false }
    }] }
  };
}

test('EOD renderer keeps canonical outcome read-only and maps the real date controls', async () => {
  const state = loadedState();
  let painted = '';
  const scope = {
    state,
    document: { documentElement: { dataset: {} }, body: { dataset: {} }, getElementById: () => ({ set innerHTML(value) { painted = String(value); } }) },
    ensureEodPicker: () => {}, datePickerHtml: () => '<button class="dp" data-calendar="eod">Sep 13</button>',
    laneWaitHtml: () => '<div class="lane-wait"></div>', escapeHtml: (value) => String(value),
    eodDaySummary: () => '1 call · 1 closed · 0 follow up · 0 lost', eodSyncNoteHtml: () => '',
    eodOutcomeTone: () => 'good', eodOutcomeLabel: () => 'Closed - PIF', eodCashDisplay: (v) => String(v),
    formatRelativeTime: () => '', anySourceConnected: () => true, connectSourceCtaHtml: () => '',
    OUTCOME_LABELS: { follow_up: 'follow up' }, laneFailureCopy: () => 'failed', observeObservatoryLayout: () => {},
    registerDatePicker: () => {}, loadEod: () => {},
  };
  await execute('renderEodView', scope);
  assert.match(painted, /onclick="eodShiftDay\(-1\)"/);
  assert.match(painted, /data-calendar="eod"/);
  assert.match(painted, /onclick="eodShiftDay\(1\)"/);
  assert.match(painted, /onclick="eodToday\(\)"/);
  assert.match(painted, /onclick="eodCopyForSlack\(\)"/);
  assert.match(painted, /<div class="eod-static"><span class="eod-chip/);
  assert.doesNotMatch(painted, /<div class="eod-row"><div class="eod-label">Outcome<\/div><input/);
});

test('EOD blank edit is sent as an intentional override and updates local edited state', async () => {
  const state = loadedState();
  const requests = [];
  const el = { value: '', classList: { add() {} } };
  const scope = {
    state, fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200 }; },
    authHeader: () => ({ Authorization: 'test' }), alert: () => {}, el,
  };
  scope.el = el;
  const renderScope = {
    state, document: { documentElement: { dataset: {} }, body: { dataset: {} }, getElementById: () => ({ set innerHTML(value) { renderScope.painted = String(value); } }) },
    ensureEodPicker: () => {}, datePickerHtml: () => '<button class="dp">Sep 13</button>', laneWaitHtml: () => '',
    escapeHtml: (value) => String(value), eodDaySummary: () => '1 call', eodSyncNoteHtml: () => '',
    eodOutcomeTone: () => 'good', eodOutcomeLabel: () => 'Closed - PIF', eodCashDisplay: (v) => String(v),
    formatRelativeTime: () => '', anySourceConnected: () => true, connectSourceCtaHtml: () => '',
    OUTCOME_LABELS: { follow_up: 'follow up' }, laneFailureCopy: () => 'failed', observeObservatoryLayout: () => {}, registerDatePicker: () => {}, loadEod: () => {}, painted: ''
  };
  await execute('renderEodView', renderScope);
  const onchange = /<textarea[^>]*onchange="([^"]+)"/.exec(renderScope.painted);
  assert.ok(onchange, 'Summary textarea must retain its real onchange handler');
  assert.match(onchange[1], /eodSaveField\('call-1', 'summary', this\)/);
  const bound = onchange[1].replace(/\bthis\b/g, 'el');
  await new Function('el', 'eodSaveField', 'return (' + bound + ');')(el, (...args) => execute('eodSaveField', scope, args.map((arg) => arg === el ? 'el' : JSON.stringify(arg)).join(', ')));
  assert.deepEqual(requests, [{ call_id: 'call-1', field: 'summary', value: '', confirm_merge: false }]);
  assert.equal(state.eodData.calls[0].fields.summary, '');
  assert.equal(state.eodData.calls[0].edited.summary, true);
});

test('EOD navigation changes one date and Slack copy uses the same day counts and fields', async () => {
  const state = loadedState();
  await execute('eodShiftDay', { state, eodSetDate: (date) => { state.eodDate = date; } }, '1');
  assert.equal(state.eodDate, '2026-09-14');

  let copied = '';
  const scope = {
    state: loadedState(),
    OUTCOME_LABELS: { follow_up: 'Open' },
    outcomeLabel: (outcome) => outcome === 'closed' ? 'Closed - PIF' : String(outcome || '—'),
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    document: { getElementById: () => ({ textContent: '' }) }, setTimeout: () => {},
  };
  const names = ['eodCashDisplay', 'eodDaySummary', 'eodOutcomeTone', 'eodOutcomeLabel', 'eodSlackText', 'eodCopyForSlack'];
  const definitions = names.map((name) => {
    const definition = fnBody(LIVE, name);
    return name === 'eodCopyForSlack'
      ? definition.replace(/^function eodCopyForSlack/, 'async function eodCopyForSlack')
      : definition;
  }).join('\n');
  const text = await new Function('__s', 'with (__s) { ' + definitions
    + '\nreturn (async function () { var generated = eodSlackText(); await eodCopyForSlack(); return generated; })(); }')(scope);
  assert.equal(copied, text, 'clipboard receives the real generated report text');
  assert.match(text, /^EOD Report — 2026-09-13\n1 call · 1 closed · 0 open · 0 lost/m, 'real copy uses the shared day count');
  assert.match(text, /Jamie Ellis\nOutcome: Closed - PIF\nCall: https:\/\/example\.test\/call-1\nCash collected: \$500\nSummary: Asked for the sale\./, 'real copy keeps the actual field order, link, cash, and summary');
});
