// 3d-3 — the single close-rate display helper, extracted from the LIVE page
// source and executed. Same pattern as tile-metrics-mirror / prospect tests.
//
// Guards two things that have already gone wrong once each in this project:
//   • DEFINITION DRIFT — the rate previously lived in three places as
//     "closed/(closed+lost), decided calls only". Every site must now route
//     through ONE helper.
//   • MISSING COUNTS — the house rule is that a rate always renders with its
//     raw counts; a bare percentage hides the sample size.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function extract() {
  const start = html.indexOf('function closeRateDisplay(o) {');
  const end = html.indexOf('function renderKbList(', start);
  assert.ok(start !== -1 && end > start, 'closeRateDisplay not found in dashboard.html');
  return new Function(html.slice(start, end) + '\n return closeRateDisplay;')();
}

test('renders the percentage with raw counts beneath', () => {
  const f = extract();
  const r = f({ prospect_close_rate: 40, prospect_close_wins: 19, prospect_close_total: 47 });
  assert.strictEqual(r.value, '40%');
  assert.strictEqual(r.sub, '19 of 47 prospects');
});

test('says "prospects", never "decided calls"', () => {
  const f = extract();
  const r = f({ prospect_close_rate: 50, prospect_close_wins: 1, prospect_close_total: 2 });
  assert.ok(/prospects/.test(r.sub));
  assert.ok(!/decided/i.test(r.sub));
});

test('degrades to an em dash when there are no prospects — never 0%', () => {
  // "No prospects yet" is not a 0% close rate; rendering 0% would be a lie
  // about performance.
  const f = extract();
  for (const o of [{}, null, { prospect_close_rate: null, prospect_close_total: 0 }]) {
    assert.strictEqual(f(o).value, '—');
  }
});

test('0% with real prospects IS rendered (an all-open closer is 0%, not unknown)', () => {
  const f = extract();
  const r = f({ prospect_close_rate: 0, prospect_close_wins: 0, prospect_close_total: 12 });
  assert.strictEqual(r.value, '0%');
  assert.strictEqual(r.sub, '0 of 12 prospects');
});

// Comments may legitimately DESCRIBE the retired formula (the helper's own
// header explains what it replaced). Only USER-VISIBLE strings matter, so strip
// comment lines before asserting.
const visible = html.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('the retired per-call phrasing is gone from user-visible text', () => {
  assert.strictEqual(visible.indexOf('of decided calls'), -1,
    'the old decided-calls phrasing still renders — every site must use closeRateDisplay');
  assert.ok(!/closed \/ \(closed \+ lost\)/.test(visible),
    'the old decided-only formula is still shown in the UI');
});

test('every close-rate render site routes through the helper', () => {
  // If a site is added that formats close_rate itself, definition drift is back.
  // Negative lookbehind so prospect_close_rate (the NEW field) is not a stray.
  const strays = visible.match(/(?<!prospect_)close_rate\s*==\s*null\s*\?/g) || [];
  assert.strictEqual(strays.length, 0,
    'found ' + strays.length + ' site(s) formatting close_rate directly instead of via closeRateDisplay');
});
