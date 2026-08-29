const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠ "BLANK GRAPHS ON REFRESH" — THE SWALLOWING GUARD, FOUND 2026-08-29.
   Two separate silences, both in the render path:
     _error      -> the skeleton went away (a truthy object reads as ARRIVED),
                    drawRepSeriesCharts returned, and the user got an empty
                    300px box with NO explanation.
     _forbidden  -> was not checked AT ALL. A truthy object with no `.reps`
                    slipped past the guard and drew three empty charts.
   ⚠ This does NOT identify why the request fails upstream — it makes the next
   occurrence SAY so instead of blanking. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function harness() {
  const grab = (n, e) => { const a = LIVE.indexOf(n); return LIVE.slice(a, LIVE.indexOf(e, a) + e.length); };
  return new Function(`
    var state = { teamRepSeries:null, teamRepSeriesLoading:false, teamObjectionCategory:'' };
    var OBJECTION_CATEGORY_OPTIONS = [{key:'',label:'All'}];
    function escapeHtml(s){ return String(s==null?'':s); }
    var drew = [];
    function loadRepFilter(){}
    function repSeriesChart(id){ drew.push(id); }
    function renderRepFilterControls(){}
    function updateRepGraphAllHiddenNotes(){}
    function updateRepGraphExcludedNotes(){}
    ${grab('function repGraphBodyHtml(canvasId)', '\n  }')}
    ${grab('function drawRepSeriesCharts()', '\n  }')}
    return function(lane){
      state.teamRepSeries = lane; state.teamRepSeriesLoading = false; drew = [];
      var html = repGraphBodyHtml('repHandleChart');
      drawRepSeriesCharts();
      return { html: html, charts: drew.length,
               skeleton: /rep-graph-skeleton/.test(html) };
    };
  `)();
}

test('⚠⚠ a FAILED lane SAYS SO instead of rendering an empty box', () => {
  const run = harness();
  const r = run({ _error: 'HTTP 500' });
  assert.strictEqual(r.charts, 0, 'nothing should be drawn from a failed lane');
  assert.ok(/could not be loaded/i.test(r.html), 'it must explain itself, not blank');
  assert.ok(!r.skeleton, 'and must not pretend to still be loading');
});

test('⚠⚠ _forbidden no longer SLIPS PAST the guard', () => {
  // It is a truthy object with no `.reps`, so it used to draw three empty charts.
  const run = harness();
  const r = run({ _forbidden: true });
  assert.strictEqual(r.charts, 0, '_forbidden must stop the draw');
  assert.ok(/do not have access/i.test(r.html), 'and must say why');
});

test('the loading and healthy states are unchanged', () => {
  const run = harness();
  const loading = run(null);
  assert.ok(loading.skeleton, 'a not-yet-arrived lane still shows the skeleton');
  assert.strictEqual(loading.charts, 0);
  const ok = run({ reps: [{ user_id: 'u1' }], buckets: [] });
  assert.strictEqual(ok.charts, 3, 'a healthy lane still draws all three graphs');
  assert.ok(!/could not be loaded/i.test(ok.html), 'and says nothing');
});

test('⚠ a failed lane is NOT treated as a loading lane', () => {
  // The bug: `_error` is truthy, so `!state.teamRepSeries` was false and the
  // skeleton was dropped — the box emptied and nothing replaced it.
  assert.ok(/var failed = !!\(state\.teamRepSeries && \(state\.teamRepSeries\._error \|\| state\.teamRepSeries\._forbidden\)\)/.test(LIVE),
    'the failed state must be computed explicitly');
  assert.ok(/var loading = !failed &&/.test(LIVE), 'and must exclude it from loading');
});
