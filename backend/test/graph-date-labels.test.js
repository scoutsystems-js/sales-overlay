/**
 * ⚠⚠ THE AXIS SHOWED ONE DATE IN SEVEN AND READ AS HAVING NONE (2026-08-31).
 *
 * Monday-only labelling exists because Chart.js DROPS labels silently when they
 * collide — ~30 daily labels across ~1100px is ~36px each against ~48px needed,
 * so the axis stays tidy while you can no longer tell which day you are reading.
 * Explicit thinning is right for that case.
 *
 * ⚠ It was applied to EVERY daily range. The team default is SEVEN DAYS, and any
 * seven consecutive days contain exactly ONE Monday — so the axis rendered a
 * single label and Justin reported "no dates" three times.
 *
 * ⚠ THE RULE NOW ASKS WHETHER THERE IS ANYTHING TO THIN, using the same ~48px
 * the original reasoning already named. This drives the REAL callback out of the
 * shipped page, not a copy of it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function axisCallback() {
  const head = 'callback: function (val, i) {';
  const at = H.indexOf(head);
  assert.ok(at !== -1, 'the axis callback must exist');
  const end = H.indexOf('},', H.indexOf('return isMondayLabel(lab, i)', at));
  const body = H.slice(at + head.length, end);
  assert.ok(body.length > 400 && body.length < 3000, 'slice must cover the callback: ' + body.length);
  const mAt = H.indexOf('function isMondayLabel');
  const mSrc = H.slice(mAt, H.indexOf('\n  }', mAt) + 4);
  const px = Number(/var DATE_LABEL_MIN_PX = (\d+)/.exec(H)[1]);
  return function (labels, width, isDaily) {
    const fn = new Function('isDailyBuckets', 'DATE_LABEL_MIN_PX',
      mSrc + '\nreturn function(val,i){ ' + body + ' };');
    const cb = fn(isDaily, px);
    const ctx = { getLabelForValue: (v) => v, chart: { width: width, data: { labels: labels } } };
    return labels.map((l, i) => cb.call(ctx, l, i)).filter(Boolean);
  };
}
function days(n) {
  const base = Date.UTC(2026, 7, 31) - (n - 1) * 864e5, out = [];
  for (let k = 0; k < n; k++) {
    out.push(new Date(base + k * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  }
  return out;
}

test('⚠ the DEFAULT 7-day range labels every day — the reported bug', () => {
  const run = axisCallback();
  assert.strictEqual(run(days(7), 1100, true).length, 7,
    'seven days is 157px per label — there is nothing to thin');
});

test('a 30-day range still thins, because the labels genuinely collide', () => {
  const run = axisCallback();
  const shown = run(days(30), 1100, true);
  assert.ok(shown.length >= 4 && shown.length <= 6, 'thinned to weeks, got ' + shown.length);
  assert.ok(shown.length < 30, 'must not render all thirty at ~37px each');
});

test('a NARROW chart thins even at a short range — width is what matters, not day count', () => {
  const run = axisCallback();
  assert.ok(run(days(14), 400, true).length < 14, '29px per label must thin');
  assert.strictEqual(run(days(14), 1100, true).length, 14, '79px per label must not');
});

test('weekly buckets are untouched — they are spans, not dates', () => {
  const run = axisCallback();
  assert.deepStrictEqual(run(['x', 'y', 'z'], 1100, false), ['Week 1', 'Week 2', 'Week 3']);
});

test('⚠ autoSkip stays FALSE — silent dropping is the thing being prevented', () => {
  assert.ok(/autoSkip: false/.test(H), 'Chart.js must not thin invisibly');
});
