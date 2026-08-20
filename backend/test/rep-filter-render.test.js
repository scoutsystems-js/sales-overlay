/**
 * REP FILTER — the control must render without the user first using it.
 *
 * ⚠⚠ THE DEFECT: renderRepFilterControls() had exactly ONE call site, inside the
 * toggle-apply path. So the control that lets you change the filter was only
 * rendered AFTER you changed the filter — which you could not do, because it was
 * not on screen. A closed loop. Observed live: roster 4 reps, repFilterHtml()
 * 570 chars, host present in the DOM, host innerHTML EMPTY. One manual call
 * rendered it correctly.
 *
 * ⚠⚠ AND THE CALL SITE IS NOT "FIRST PAINT" — IT IS "AFTER THE CHARTS BUILD".
 * The roster is derived from live chart datasets (eachLiveToggleChart → _userId),
 * so at first paint it is EMPTY and repFilterHtml() returns ''. Rendering there
 * would still show nothing. Rendering at the end of drawRepSeriesCharts couples
 * the control's existence to the charts' existence — which is what makes
 * removing the legend safe on every path, including the refresh path where the
 * charts do not build at all (no charts → no lines → no key needed).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fnBody(name) {
  const at = LIVE.indexOf('function ' + name + '(');
  assert.ok(at !== -1, 'stale anchor — ' + name + ' not found');
  const end = LIVE.indexOf('\n  }', at);
  assert.ok(end > at, 'could not bracket ' + name);
  const body = LIVE.slice(at, end + 4);
  /* ⚠ 8000, not 4000 — repSeriesChart is 6508 chars and my first bound
     rejected a correct slice. The bound exists to catch a RUNAWAY slice, not to
     encode how long a function may be. */
  assert.ok(body.length > 60 && body.length < 8000, name + ' slice suspicious: ' + body.length);
  return body;
}

test('⚠⚠ the filter renders where the ROSTER EXISTS — at the end of the chart build', () => {
  const draw = fnBody('drawRepSeriesCharts');
  assert.ok(/renderRepFilterControls\s*\(/.test(draw),
    'drawRepSeriesCharts must render the filter after building the charts — the '
    + 'roster comes from live chart datasets, so anywhere earlier it is empty '
    + 'and repFilterHtml() returns an empty string');
  // and it must come AFTER the charts are created, not before
  const chartAt = draw.indexOf("repSeriesChart('repPriceChart'");
  const filterAt = draw.indexOf('renderRepFilterControls');
  assert.ok(chartAt !== -1 && filterAt > chartAt,
    'the filter render must follow the chart construction, or the roster is empty');
});

test('⚠ more than one call site — it is no longer only reachable via a toggle', () => {
  const sites = LIVE.split('\n').filter((l) => /renderRepFilterControls\s*\(/.test(l)
    && !/function\s+renderRepFilterControls/.test(l));
  assert.ok(sites.length >= 2,
    'expected the toggle-apply site PLUS the chart-build site; got ' + sites.length);
});

/* ⚠⚠ §2 (remove the legend) and §3 (colour swatch) are HELD, DELIBERATELY.
   The rep filter is a NATIVE <select>. Option background-color is honoured in
   the computed style on Chrome/macOS, but native option painting is UA/OS
   controlled and macOS Safari ignores it — and I could not verify Safari or
   Firefox from here. Removing the legend without a GUARANTEED colour key would
   leave four coloured lines a reader cannot tell apart, which is worse than the
   page Justin is complaining about. Standing rule: both land or neither does.
   These assert the CURRENT state so the pair cannot be half-shipped by accident. */
test('\u26a0 HELD: the legend is still present until the swatch is guaranteed', () => {
  const chart = fnBody('repSeriesChart');
  const flat = chart.replace(/\s+/g, ' ');
  const legendHidden = /legend:\s*\{[^}]*display:\s*false/.test(flat);
  const swatch = /background-color/.test(fnBody('repFilterHtml'));
  assert.strictEqual(legendHidden, swatch,
    'the legend may only be hidden in the SAME change that adds a guaranteed '
    + 'colour swatch to the filter. One without the other ships a chart whose '
    + 'lines cannot be identified.');
});
