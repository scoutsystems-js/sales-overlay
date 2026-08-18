/**
 * Stage 1 — the shared date-range picker. Nothing renders it yet.
 *
 * Extracted from the served markup and executed, per the standing rule: proving
 * a function works says nothing about whether its call site runs, so where
 * behaviour is stateful these tests drive the REAL action functions against a
 * DOM stub rather than reimplementing the logic.
 *
 * ⚠ THE TWO LABEL CONVENTIONS ARE DELIBERATELY DIFFERENT. This picker's label is
 * INCLUSIVE ("Aug 3 - Aug 10" = both days in range); the graph BUCKET labels are
 * EXCLUSIVE ("Aug 3 - Aug 9", then "Aug 10 - Aug 16") so adjacent buckets never
 * share a day. Both are correct for their own job. Tests below pin both so a
 * future "consistency" pass fails loudly instead of quietly breaking one.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const SRC = HTML.slice(HTML.indexOf('var MONTH_SHORT ='), HTML.indexOf('function moneyRound'));

// Build a fresh sandbox each time: the control keeps module-level UI state, and
// leaking it between tests would hide exactly the bugs these look for.
function sandbox() {
  const focused = [];
  const nodes = {};
  const doc = {
    getElementById(id) {
      if (!nodes[id]) nodes[id] = { id, outerHTML: '', focus() { focused.push(id); } };
      return nodes[id];
    },
    addEventListener() { /* outside-click binding; exercised in the browser probe */ },
    querySelector(sel) {
      const m = /#dp-([a-z0-9_]+) \[data-dp-focus/.exec(sel);
      return m ? { focus() { focused.push('cell:' + m[1]); } } : null;
    },
  };
  const api = new Function('document', 'escapeHtml', SRC + `
    ;return { registerDatePicker, datePickerHtml, datePickerToggle, datePickerNav,
              datePickerPick, datePickerEarliest, datePickerClose, datePickerKeydown,
              datePickerHover, bindDatePickerOutside, monthGridCells, rangeLabelInclusive, rangeToIso,
              resolvePick, ymd, dayLabel, addDays, PICKER_EARLIEST, PICKER_UI };`
  )(doc, (s) => String(s));
  return { api, focused, nodes };
}

// ── pure: the month grid ──────────────────────────────────────────────────

test('the grid is 6 rows x 7 cells, Monday-first, covering the whole month', () => {
  const { api } = sandbox();
  const rows = api.monthGridCells(2026, 7, null, null, null, null);   // Aug 2026
  assert.strictEqual(rows.length, 6);
  rows.forEach((r) => assert.strictEqual(r.length, 7));
  // Aug 1 2026 is a Saturday, so the first row starts Mon Jul 27.
  assert.strictEqual(rows[0][0].day, '2026-07-27');
  assert.strictEqual(rows[0][0].inMonth, false, 'lead-in days belong to the previous month');
  const inMonth = rows.flat().filter((c) => c.inMonth);
  assert.strictEqual(inMonth.length, 31, 'August has 31 days');
  assert.strictEqual(inMonth[0].day, '2026-08-01');
  assert.strictEqual(inMonth[30].day, '2026-08-31');
});

test('a selected range marks both edges and everything between', () => {
  const { api } = sandbox();
  const cells = api.monthGridCells(2026, 7, '2026-08-03', '2026-08-10', null, null).flat();
  const byDay = (d) => cells.find((c) => c.day === d);
  assert.ok(byDay('2026-08-03').isStart, 'start edge');
  assert.ok(byDay('2026-08-10').isEnd, 'end edge');
  assert.ok(byDay('2026-08-06').inRange, 'a day between is in range');
  assert.ok(!byDay('2026-08-06').isStart && !byDay('2026-08-06').isEnd);
  assert.ok(!byDay('2026-08-02').inRange, 'the day before is out');
  assert.ok(!byDay('2026-08-11').inRange, 'the day after is out');
});

test('a half-made selection previews against the hovered day, in both directions', () => {
  // Without this there is no feedback at all between the two clicks.
  const { api } = sandbox();
  const fwd = api.monthGridCells(2026, 7, null, null, '2026-08-05', '2026-08-09').flat();
  assert.ok(fwd.find((c) => c.day === '2026-08-07').inRange, 'hover after start previews forward');
  const back = api.monthGridCells(2026, 7, null, null, '2026-08-05', '2026-08-02').flat();
  assert.ok(back.find((c) => c.day === '2026-08-03').inRange, 'hover before start previews backward');
  assert.ok(back.find((c) => c.day === '2026-08-02').isStart, 'the earlier day becomes the start edge');
});

test('month boundaries and leap years come out right', () => {
  const { api } = sandbox();
  const feb = api.monthGridCells(2028, 1, null, null, null, null).flat().filter((c) => c.inMonth);
  assert.strictEqual(feb.length, 29, 'Feb 2028 is a leap February');
  const dec = api.monthGridCells(2026, 11, null, null, null, null).flat().filter((c) => c.inMonth);
  assert.strictEqual(dec[dec.length - 1].day, '2026-12-31');
});

// ── pure: labels and the inclusive window ─────────────────────────────────

test('THE PICKER LABEL IS INCLUSIVE — "Aug 3 - Aug 10" means both days are in', () => {
  const { api } = sandbox();
  assert.strictEqual(
    api.rangeLabelInclusive('2026-08-03T00:00:00.000Z', '2026-08-10T23:59:59.999Z'),
    'Aug 3 - Aug 10');
});

test('a single-day range reads as one day, not a span of itself', () => {
  const { api } = sandbox();
  assert.strictEqual(api.rangeLabelInclusive('2026-08-03T00:00:00.000Z', '2026-08-03T23:59:59.999Z'), 'Aug 3');
});

test('the inclusive label is BACKED BY THE WINDOW — the end day is fully covered', () => {
  // If `to` were midnight, every call on the final day would silently vanish
  // from the numbers while the label still claimed that day was included.
  const { api } = sandbox();
  const w = api.rangeToIso('2026-08-03', '2026-08-10');
  assert.strictEqual(w.from, '2026-08-03T00:00:00.000Z');
  assert.strictEqual(w.to, '2026-08-10T23:59:59.999Z');
  assert.ok(Date.parse('2026-08-10T18:30:00Z') <= Date.parse(w.to), 'an evening call on the end day is inside');
});

test('the YEAR appears only when the range crosses one', () => {
  // Found by exercising "Earliest" in a browser: it spans 20 months and read
  // "Jan 1 - Aug 16", which does not say which January.
  const { api } = sandbox();
  assert.strictEqual(
    api.rangeLabelInclusive('2025-01-01T00:00:00.000Z', '2026-08-16T23:59:59.999Z'),
    'Jan 1 2025 - Aug 16 2026');
  assert.strictEqual(
    api.rangeLabelInclusive('2026-08-03T00:00:00.000Z', '2026-08-10T23:59:59.999Z'),
    'Aug 3 - Aug 10', 'within one year the year would be noise');
});

test('CONVENTION GUARD: picker labels are inclusive, BUCKET labels stay exclusive', () => {
  // These two disagree on purpose. If someone "fixes" the inconsistency, this
  // fails and points at the reason.
  const { api } = sandbox();
  assert.strictEqual(api.rangeLabelInclusive('2026-08-03T00:00:00.000Z', '2026-08-10T23:59:59.999Z'),
    'Aug 3 - Aug 10', 'picker: end day INCLUDED');
  const { bucketRangeLabel } = require('../lib/team-analytics');
  assert.strictEqual(bucketRangeLabel(Date.parse('2026-08-03T00:00:00Z'), 'week'),
    'Aug 3 - Aug 9', 'bucket: end day EXCLUSIVE so adjacent buckets never share a day');
  assert.ok(HTML.indexOf('DO NOT HARMONISE THEM') !== -1, 'the reason must be documented beside the control');
});

// ── pure: pick resolution ─────────────────────────────────────────────────

test('first click sets a pending start and commits nothing', () => {
  const { api } = sandbox();
  const r = api.resolvePick(null, '2026-08-05');
  assert.strictEqual(r.pending, '2026-08-05');
  assert.strictEqual(r.range, null, 'one click is not a range');
});

test('AN END BEFORE THE START SWAPS rather than erroring after the fact', () => {
  const { api } = sandbox();
  const r = api.resolvePick('2026-08-10', '2026-08-03');
  assert.deepStrictEqual(r.range, { start: '2026-08-03', end: '2026-08-10' });
  assert.strictEqual(r.pending, null);
});

test('clicking the same day twice is a valid single-day range', () => {
  const { api } = sandbox();
  assert.deepStrictEqual(api.resolvePick('2026-08-05', '2026-08-05').range,
    { start: '2026-08-05', end: '2026-08-05' });
});

// ── stateful: the control never touches app state ─────────────────────────

test('THE CONTROL READS ITS RANGE THROUGH THE GETTER AND WRITES THROUGH THE SETTER', () => {
  // Justin's ruling: every view owns its own range, so the control must never
  // reach for a global. Two instances with different ranges prove independence.
  const { api } = sandbox();
  let teamSet = null, coachSet = null;
  api.registerDatePicker('team', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z' }),
    (f, t) => { teamSet = [f, t]; });
  api.registerDatePicker('coaching', () => ({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' }),
    (f, t) => { coachSet = [f, t]; });

  assert.ok(api.datePickerHtml('team').indexOf('Aug 1 - Aug 7') !== -1);
  assert.ok(api.datePickerHtml('coaching').indexOf('Jul 1 - Jul 31') !== -1, 'instances are independent');

  api.datePickerToggle('team');
  api.datePickerPick('team', '2026-08-03');
  api.datePickerPick('team', '2026-08-10');
  assert.deepStrictEqual(teamSet, ['2026-08-03T00:00:00.000Z', '2026-08-10T23:59:59.999Z']);
  assert.strictEqual(coachSet, null, 'the other instance must be untouched');
});

test('GUARD: the control source never references app state', () => {
  // The whole point of the getter/setter shape. A single `state.dateRange` in
  // here would silently re-couple every view to one shared range.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bstate\./.test(code), 'the picker must not read or write app state');
  assert.ok(!/loadTeam|reloadAll|renderTeamView|setDateRange|setTeamRange/.test(code),
    'the picker must not call a view directly — the setter is the only outlet');
});

test('no range yet degrades to a prompt rather than a fabricated date', () => {
  const { api } = sandbox();
  api.registerDatePicker('empty', () => null, () => {});
  assert.ok(api.datePickerHtml('empty').indexOf('Pick dates') !== -1);
});

// ── stateful: panel behaviour ─────────────────────────────────────────────

test('the panel opens on the current end date and closes on a completed pick', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z' }), () => {});
  assert.ok(api.datePickerHtml('t').indexOf('dp-panel') === -1, 'closed by default');
  api.datePickerToggle('t');
  assert.ok(api.datePickerHtml('t').indexOf('dp-panel') !== -1, 'open after toggle');
  assert.strictEqual(api.PICKER_UI.t.year, 2026);
  assert.strictEqual(api.PICKER_UI.t.month, 7, 'opens on the month of the current end date');
  api.datePickerPick('t', '2026-08-03');
  assert.ok(api.datePickerHtml('t').indexOf('dp-panel') !== -1, 'stays open between the two clicks');
  api.datePickerPick('t', '2026-08-05');
  assert.ok(api.datePickerHtml('t').indexOf('dp-panel') === -1, 'closes once the range is complete');
});

test('month navigation crosses the year boundary in both directions', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-15T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  api.datePickerNav('t', -1);
  assert.strictEqual(api.PICKER_UI.t.month, 11);
  assert.strictEqual(api.PICKER_UI.t.year, 2025);
  api.datePickerNav('t', 1); api.datePickerNav('t', 1);
  assert.strictEqual(api.PICKER_UI.t.month, 1);
  assert.strictEqual(api.PICKER_UI.t.year, 2026);
});

test('"Earliest" is one click to all-time and closes the panel', () => {
  const { api } = sandbox();
  let got = null;
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z' }),
    (f, t) => { got = [f, t]; });
  api.datePickerToggle('t');
  api.datePickerEarliest('t');
  assert.ok(got, 'the setter must fire');
  assert.strictEqual(got[0], api.PICKER_EARLIEST + 'T00:00:00.000Z');
  assert.ok(got[1].endsWith('T23:59:59.999Z'), 'through the end of today');
  assert.strictEqual(api.PICKER_UI.t.open, false);
});

test('a half-made selection is discarded when the panel closes', () => {
  // Leaving a dangling pending start would make the NEXT open behave oddly.
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  api.datePickerPick('t', '2026-08-03');
  assert.strictEqual(api.PICKER_UI.t.pending, '2026-08-03');
  api.datePickerClose('t');
  assert.strictEqual(api.PICKER_UI.t.pending, null);
});

// ── stateful: keyboard and focus ──────────────────────────────────────────

test('arrow keys move focus by day and by week, following the month', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-15T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-15', 'focus starts on the end date');
  const key = (k) => api.datePickerKeydown('t', { key: k, preventDefault() {} });
  key('ArrowRight'); assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-16');
  key('ArrowLeft');  assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-15');
  key('ArrowDown');  assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-22');
  key('ArrowUp');    assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-15');
});

test('focus moving past a month edge pages the calendar with it', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  api.datePickerKeydown('t', { key: 'ArrowRight', preventDefault() {} });
  assert.strictEqual(api.PICKER_UI.t.focus, '2026-09-01');
  assert.strictEqual(api.PICKER_UI.t.month, 8, 'the visible month follows focus into September');
});

test('Enter picks the focused day; Escape closes without committing', () => {
  const { api } = sandbox();
  let got = null;
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T23:59:59.999Z' }),
    (f, t) => { got = [f, t]; });
  api.datePickerToggle('t');
  api.datePickerKeydown('t', { key: 'Enter', preventDefault() {} });      // start = Aug 10
  assert.strictEqual(got, null, 'one Enter is not a range');
  api.datePickerKeydown('t', { key: 'ArrowDown', preventDefault() {} });  // Aug 17
  api.datePickerKeydown('t', { key: 'Enter', preventDefault() {} });
  assert.deepStrictEqual(got, ['2026-08-10T00:00:00.000Z', '2026-08-17T23:59:59.999Z']);

  got = null;
  api.datePickerToggle('t');
  api.datePickerKeydown('t', { key: 'Escape', preventDefault() {} });
  assert.strictEqual(api.PICKER_UI.t.open, false);
  assert.strictEqual(got, null, 'Escape must not commit a range');
});

test('PageUp/PageDown and Home/End move as expected', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-12T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  const key = (k) => api.datePickerKeydown('t', { key: k, preventDefault() {} });
  key('Home'); assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-10', 'Monday of that week');
  key('End');  assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-16', 'Sunday of that week');
  key('PageUp');   assert.strictEqual(api.PICKER_UI.t.focus, '2026-07-19');
  key('PageDown'); assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-16');
});

test('an unhandled key is left alone for the browser', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-12T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  let prevented = false;
  api.datePickerKeydown('t', { key: 'Tab', preventDefault() { prevented = true; } });
  assert.strictEqual(prevented, false, 'Tab must stay the browser\'s to handle');
  assert.strictEqual(api.PICKER_UI.t.focus, '2026-08-12', 'and must not move day focus');
});

test('focus goes to the grid on open and back to the trigger on close', () => {
  const { api, focused } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-12T23:59:59.999Z' }), () => {});
  api.datePickerToggle('t');
  assert.ok(focused.indexOf('cell:t') !== -1, 'the focused day receives focus when the panel opens');
  api.datePickerClose('t');
  assert.ok(focused.indexOf('dp-btn-t') !== -1, 'focus returns to the trigger button on close');
});

test('the trigger reports its expanded state and the panel is a labelled dialog', () => {
  const { api } = sandbox();
  api.registerDatePicker('t', () => ({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-12T23:59:59.999Z' }), () => {});
  assert.ok(/aria-expanded="false"/.test(api.datePickerHtml('t')));
  api.datePickerToggle('t');
  const open = api.datePickerHtml('t');
  assert.ok(/aria-expanded="true"/.test(open));
  assert.ok(/role="dialog"/.test(open) && /aria-label="Choose a date range"/.test(open));
  assert.ok(/tabindex="0"/.test(open), 'roving tabindex: exactly the focused cell is tabbable');
  assert.strictEqual((open.match(/tabindex="0"/g) || []).length, 1);
});

test('team and coaching each mount their own instance', () => {
  const rendered = HTML.replace(SRC, '');
  const teamHeader = HTML.slice(HTML.indexOf('function teamHeaderHtml'), HTML.indexOf('function teamAggregateHtml'));
  assert.ok(/datePickerHtml\('team'\)/.test(teamHeader) && /ensureTeamPicker\(\)/.test(teamHeader));
  assert.ok(/datePickerHtml\('coaching'\)/.test(rendered) && /ensureCoachingPicker\(\)/.test(rendered));
  // The full instance list is asserted by the stage-4 test below.
});

test('STAGE 3: the preset buttons are gone from BOTH headers', () => {
  const rendered = HTML.replace(SRC, '');
  const live = rendered.replace(/\/\*[\s\S]*?\*\//g, '');   // ignore commented-out archives
  assert.ok(!/onclick="setDateRange\(/.test(live), 'coaching presets must be gone from the render path');
  assert.ok(!/onclick="setTeamRange\(/.test(live), 'team presets must be gone from the render path');
  // And the archived originals are kept, per the standing convention.
  assert.ok(/REMOVED 2026-08-16/.test(rendered));
});

test('THE TWO RANGES ARE SEPARATE FIELDS — the split is finished', () => {
  const rendered = HTML.replace(SRC, '');
  assert.ok(/registerDatePicker\('team',[\s\S]{0,120}teamRange\(\)/.test(rendered),
    'team reads state.teamRange');
  assert.ok(/registerDatePicker\('coaching',[\s\S]{0,120}state\.dateRange/.test(rendered),
    'coaching reads state.dateRange');
});

test("the DRILL-DOWNS inherit coaching's range, and the reason is recorded", () => {
  // A decision, not an oversight: a drilldown is opened by clicking a number ON
  // coaching, so owning a separate range would let it show a different period
  // than the number that opened it.
  assert.ok(/THOSE DRILL-DOWNS INHERIT RATHER THAN OWN, AND THAT IS A DECISION/.test(HTML));
  const setter = HTML.slice(HTML.indexOf('function setCoachingRange'), HTML.indexOf('function setDateRange'));
  ['needs-work', 'performance', 'section'].forEach((v) => {
    assert.ok(setter.indexOf("'" + v + "'") !== -1, 'the setter must refresh ' + v + ' in place');
  });
  assert.ok(/loadSectionBreakdown\(/.test(setter), 'and re-query the drilldown, not just re-render it');
});

test('the needs-work window label NAMES THE WINDOW, never "last N days"', () => {
  // Caught on the first live render of stage 3: the picker said "Jul 1 - Jul 31"
  // while the header said "last 90 days". "Last N days" is only true of a
  // trailing window, so with a free picker it is simply false.
  const { api } = sandbox();
  const src = HTML.slice(HTML.indexOf('function needsWorkWindowLabel'), HTML.indexOf('// ── A-2.1'));
  const fn = new Function('state', 'rangeLabelInclusive', src + '; return needsWorkWindowLabel();');
  assert.strictEqual(
    fn({ dateRange: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' } }, api.rangeLabelInclusive),
    'Jul 1 - Jul 31');
  assert.strictEqual(fn({}, api.rangeLabelInclusive), 'your recent calls', 'degrades without inventing a window');

  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/your last ' \+ win \+ ' days/.test(live), 'the trailing-window phrasing must be gone');
  assert.ok(!/try 30 or 90 days/.test(live), 'and must not point at presets that no longer exist');
});

// ─── STAGE 4: Calls — seeded once from coaching, independent thereafter ────

test('every picker mounts under its OWN key — four surfaces, four instances', () => {
  // ⚠ Extended for (dd): the EOD page is the FOURTH, and the first in
  // single-date mode. Each surface owns its own range/day; one shared instance
  // is the shared-carrier failure this list exists to prevent.
  const rendered = HTML.replace(SRC, '');
  const keys = (rendered.match(/registerDatePicker\('([a-z]+)'/g) || []).sort();
  assert.deepStrictEqual(keys, [
    "registerDatePicker('calls'", "registerDatePicker('coaching'",
    "registerDatePicker('eod'", "registerDatePicker('team'",
  ]);
  assert.ok(/datePickerHtml\('calls'\)/.test(rendered));
  assert.ok(/datePickerHtml\('eod'\)/.test(rendered), 'the EOD toolbar must mount the calendar');
});

test('⚠⚠ SINGLE-DATE IS A MODE, NOT A SECOND COMPONENT', () => {
  // Ruling 2026-08-18: "prefer a mode — a second component is how two calendars
  // drift apart." So there must be exactly ONE panel builder and ONE grid.
  assert.strictEqual((HTML.match(/function datePickerPanelHtml/g) || []).length, 1,
    'a second panel builder means a second calendar');
  assert.strictEqual((HTML.match(/function monthGridCells/g) || []).length, 1,
    'a second grid means the two can render different months');
  assert.ok(/registerDatePicker\('eod'[\s\S]{0,300}single: true/.test(HTML),
    'EOD must register with { single: true }');
});

test('⚠ single mode COMMITS on the first click and drops "Earliest"', () => {
  const at = HTML.indexOf('function datePickerPick');
  const fn = HTML.slice(at, HTML.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 300 && fn.length < 3000, 'slice suspicious: ' + fn.length);
  assert.ok(/if \(pickerIsSingle\(key\)\)/.test(fn), 'single mode must short-circuit before resolvePick');
  assert.ok(/inst\.set\(day\)/.test(fn), 'and hand back a DAY, not a span');
  // "Earliest" means "span everything back to the beginning" — meaningless for
  // one day, so it is absent rather than replaced.
  assert.ok(/single \? '' : '<button type="button" class="dp-earliest"/.test(HTML),
    'the Earliest button must be omitted in single mode');
});

test('⚠ the single-day label uses the MONDAY-FIRST weekday index', () => {
  // DOW_SHORT labels the grid columns and starts at Mon; getUTCDay() is Sun-0.
  // Indexing it directly prints the wrong weekday — silently.
  assert.ok(/DOW_SHORT\[\(d\.getUTCDay\(\) \+ 6\) % 7\]/.test(HTML),
    'the weekday index must be remapped, or every label is off by one');
});

test('SEEDING HAS EXACTLY ONE CALLER — drillCalls, and nowhere else', () => {
  // "Seeded once" versus "kept in sync" is the coupling that drifts back
  // together. A second caller is how it happens, so the count is pinned.
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const calls = (live.match(/seedCallsRangeFromCoaching\(\)/g) || []).length;
  assert.strictEqual(calls, 2, 'one definition + exactly one call site; found ' + calls);
  const drillAt = HTML.indexOf('function drillCalls');
  const drill = HTML.slice(drillAt, HTML.indexOf('setView(\'call-library\')', drillAt));
  assert.ok(drill.length > 0 && drill.length < 1200, 'slice must actually cover drillCalls: ' + drill.length);
  assert.ok(/seedCallsRangeFromCoaching\(\)/.test(drill), 'the seed must live in drillCalls');
});

test('CALLS NEVER WRITES BACK TO COACHING', () => {
  // The direction is one-way by construction: the setter touches only its own field.
  const setter = HTML.slice(HTML.indexOf('function setCallsRange'), HTML.indexOf('async function fetchCallLibrary'));
  assert.ok(/state\.callLibraryRange = /.test(setter), 'it writes its own range');
  assert.ok(!/state\.dateRange\s*=/.test(setter), 'and must never assign coaching\'s');
  assert.ok(!/state\.teamRange\s*=/.test(setter), "nor team's");
});

test('DIRECT NAV uses Calls\' own range and does not consult coaching', () => {
  const nav = HTML.slice(HTML.indexOf('function goCallLibrary'), HTML.indexOf('function drillCalls'));
  assert.ok(/callsRange\(\)/.test(nav), 'it resolves Calls\' own range');
  assert.ok(!/state\.dateRange/.test(nav), 'direct entry must not read coaching\'s range');
  assert.ok(!/seedCallsRangeFromCoaching/.test(nav), 'and must not seed');
});

test('the three ranges are three distinct state fields', () => {
  const rendered = HTML.replace(SRC, '');
  assert.ok(/registerDatePicker\('team',[\s\S]{0,120}teamRange\(\)/.test(rendered));
  assert.ok(/registerDatePicker\('coaching',[\s\S]{0,120}state\.dateRange/.test(rendered));
  assert.ok(/registerDatePicker\('calls',[\s\S]{0,120}callsRange\(\)/.test(rendered));
});

test('the Calls presets are gone from the render path', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/onclick="setCallLibraryRange\(/.test(live));
});

// ─── THE PICKER DIDN'T STICK (2026-08-16) ─────────────────────────────────

test('⚠ BOOT MUST NOT CLOBBER A RANGE RESTORED FROM THE HASH', () => {
  // The bug: init() called applyHashToState() — which restores the coaching
  // range from the hash — and then setDateRange(30, true) UNCONDITIONALLY on the
  // very next line, overwriting it with the last 30 days on EVERY boot. The
  // comment above it ("the 30-day range applies underneath") was true before
  // stage 3 put a range in the hash, and silently became false afterwards.
  //
  // Team and Calls were unaffected: setDateRange writes only state.dateRange,
  // so only the COACHING family lost its range.
  const at = HTML.indexOf('applyHashToState();');
  const boot = HTML.slice(at, HTML.indexOf('loadCallReview(state.selectedCallId)', at));
  assert.ok(boot.length > 100 && boot.length < 2500, 'slice must cover the boot tail: ' + boot.length);

  assert.ok(/if \(state\.dateRange && state\.dateRange\.from && state\.dateRange\.to\)/.test(boot),
    'boot must test whether the hash already supplied a range');
  assert.ok(/applyCoachingRangeChange\(true/.test(boot),
    'and honour it rather than overwriting');
  assert.ok(/else \{\s*setDateRange\(30/.test(boot),
    'the 30-day default must survive for the NO-hash case');
});

test('setDateRange still writes a range, and shares the change path', () => {
  // The tail was extracted so boot can reuse it; setDateRange must still work.
  const at = HTML.indexOf('function setDateRange');
  // ⚠ END ON THE NEXT DECLARATION, not on a NAMED neighbour. This sliced to
  // `function setUser`, and the 2026-08-18 pivot helpers were inserted between
  // the two — the slice swallowed them and the length assertion failed. The
  // neighbour was never part of the claim; "the next function" is.
  const fn = HTML.slice(at, HTML.indexOf('\n  function ', at + 10));
  assert.ok(fn.length > 100 && fn.length < 1200, 'slice: ' + fn.length);
  assert.ok(/state\.dateRange = \{ from: from\.toISOString\(\)/.test(fn), 'still writes the range');
  assert.ok(/applyCoachingRangeChange\(preserveView\)/.test(fn), 'and delegates the follow-up work');
});

test('the extracted change path does NOT write a range itself', () => {
  // If it did, boot would clobber the restored range again through the back door.
  const at = HTML.indexOf('function applyCoachingRangeChange');
  const fn = HTML.slice(at, HTML.indexOf('function setDateRange', at));
  assert.ok(fn.length > 100 && fn.length < 1500, 'slice: ' + fn.length);
  assert.strictEqual(/state\.dateRange = /.test(fn), false,
    'applyCoachingRangeChange must never assign the range');
});

// ─── the team sub-page hash gap (2026-08-17) ──────────────────────────────

test('EVERY team-family hash carries the range, not just #team', () => {
  // Only #team did. Landing on or refreshing a sub-page restored nothing and the
  // range fell back to the 7-day default. The coaching family already did this
  // correctly — this is the other reader of the same carrier.
  const at = HTML.indexOf('function viewToHashPath');
  const fn = HTML.slice(at, HTML.indexOf('function syncHashFromState', at));
  assert.ok(fn.length > 400 && fn.length < 3000, 'slice must cover the function: ' + fn.length);

  ['team-recs', 'team-needs-work', 'team-members'].forEach((h) => {
    const line = fn.split('\n').find((l) => l.indexOf("'" + h + "'") !== -1);
    assert.ok(line, 'no path for ' + h);
    assert.ok(/teamRangeHashSuffix\(\)/.test(line), h + ' must carry the range: ' + line.trim());
  });
  const teamLine = fn.split('\n').find((l) => /=== 'team'\)/.test(l));
  assert.ok(/teamRangeHashSuffix\(\)/.test(teamLine), '#team still carries it');
});

test('the router PARSES the range back for the whole team family', () => {
  // Emitting it without parsing it would look fixed and change nothing.
  const at = HTML.indexOf('function applyHashToState');
  const fn = HTML.slice(at, HTML.indexOf('function onRouteChange', at));
  assert.ok(fn.length > 400 && fn.length < 6000, 'slice: ' + fn.length);   // bound is a sanity check, not a spec
  assert.ok(/TEAM_HASH/.test(fn), 'a family map, not a single exact match');
  ['team-recs', 'team-needs-work', 'team-members'].forEach((h) => {
    assert.ok(new RegExp("'" + h + "'").test(fn), h + ' must be in the map');
  });
  assert.ok(/state\.teamRange = hashed/.test(fn) && /teamRangeInit = true/.test(fn),
    'and it must beat the 7-day default');
});

test('the superseded exact-match branches are commented, not left live', () => {
  assert.ok(/REMOVED 2026-08-17/.test(HTML));
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.strictEqual(/else if \(h === 'team-recs'\)/.test(live), false,
    'the unreachable duplicate must not stay in the render path');
});

test('the COACHING family already carried the range — no regression there', () => {
  const at = HTML.indexOf('function viewToHashPath');
  const fn = HTML.slice(at, HTML.indexOf('function syncHashFromState', at));
  ['objections', 'needs-work', 'performance', 'section'].forEach((h) => {
    const line = fn.split('\n').find((l) => l.indexOf("return '" + h + "'") !== -1);
    assert.ok(line && /coachingRangeHashSuffix\(\)/.test(line), h + ': ' + (line || 'missing'));
  });
});
