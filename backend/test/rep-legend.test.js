/**
 * REP LEGEND — selected reps only, capped, overflow named, display-only.
 * Justin's rulings, 2026-08-20.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Extract generateLabels and run it against a fake Chart. */
function extractGenerateLabels() {
  const at = PAGE.indexOf('generateLabels: function (chart) {');
  assert.ok(at !== -1, 'stale anchor — generateLabels');
  /* ⚠ BRACE-MATCHED, not indentation-matched. Two earlier attempts anchored on
     a fixed indent depth (16 then 14) and both cut the function in the wrong
     place — one reported "could not bracket", the other produced a slice that
     would not parse. Counting braces cannot be wrong about where a function
     ends. */
  let depth = 0, end = -1;
  for (let i = PAGE.indexOf('{', at); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > at, 'could not brace-match generateLabels');
  const src = PAGE.slice(at + 'generateLabels: '.length, end);
  assert.ok(src.length > 300 && src.length < 6000, 'slice suspicious: ' + src.length);
  // the function closes over REP_LEGEND_MAX and LEGEND_OFF_MARKER
  const maxM = LIVE.match(/REP_LEGEND_MAX\s*=\s*(\d+)/);
  assert.ok(maxM, 'REP_LEGEND_MAX not defined');
  // eslint-disable-next-line no-new-func
  return { fn: new Function('REP_LEGEND_MAX', 'LEGEND_OFF_MARKER',
                            'return (' + src + ')')(Number(maxM[1]), '#888'),
           max: Number(maxM[1]) };
}

function fakeChart(names, hiddenNames) {
  const hidden = new Set(hiddenNames || []);
  const datasets = names.map((n) => ({ label: n, _userId: 'u-' + n, borderColor: '#0f0',
                                       backgroundColor: '#0f0', borderWidth: 2 }));
  datasets.unshift({ label: 'Team average', _fixed: true, borderColor: '#09e046',
                     backgroundColor: '#09e046', borderWidth: 3, borderDash: [4, 4] });
  return { data: { datasets },
           isDatasetVisible: (i) => !hidden.has(datasets[i].label) };
}

test('⚠⚠ the legend shows ONLY selected reps', () => {
  const { fn } = extractGenerateLabels();
  const out = fn(fakeChart(['Ava', 'Ben', 'Cara'], ['Ben']));
  const texts = out.map((o) => o.text);
  assert.ok(!texts.includes('Ben'), 'a hidden rep must not appear — the legend is the key '
    + 'to the lines ON the chart, and Ben has no line');
  assert.ok(texts.includes('Ava') && texts.includes('Cara'));
});

test('⚠⚠ capped at REP_LEGEND_MAX, and the OVERFLOW IS NAMED at 11, 14 and 20', () => {
  const { fn, max } = extractGenerateLabels();
  [11, 14, 20].forEach((n) => {
    const names = Array.from({ length: n }, (_, i) => 'Rep ' + String(i + 1).padStart(2, '0'));
    const out = fn(fakeChart(names, []));
    const overflow = out.filter((o) => /\+\d+ more/.test(String(o.text)));
    assert.strictEqual(overflow.length, 1, n + ' reps: expected exactly one overflow entry');
    const stated = Number(String(overflow[0].text).match(/\+(\d+) more/)[1]);
    assert.strictEqual(stated, n - max,
      n + ' reps with a cap of ' + max + ' must state "+' + (n - max) + ' more", got +' + stated
      + ' — A FILTERED VIEW MUST NEVER PASS AS A FULL ONE');
    // rep entries (excluding the fixed baseline and the overflow marker)
    const reps = out.filter((o) => !/\+\d+ more/.test(String(o.text)) && o.text !== 'Team average');
    assert.strictEqual(reps.length, max, n + ' reps: expected exactly ' + max + ' rep entries');
  });
});

test('⚠ no overflow entry when everything fits', () => {
  const { fn, max } = extractGenerateLabels();
  const out = fn(fakeChart(Array.from({ length: max }, (_, i) => 'R' + i), []));
  assert.strictEqual(out.filter((o) => /more/.test(String(o.text))).length, 0);
});

test('⚠⚠ ALPHABETICAL, not dataset order — dataset order moves with the date window', () => {
  const { fn } = extractGenerateLabels();
  const out = fn(fakeChart(['Zoe', 'Ava', 'Mia'], []));
  const reps = out.map((o) => o.text).filter((t) => t !== 'Team average');
  assert.deepStrictEqual(reps, ['Ava', 'Mia', 'Zoe'],
    'dataset order follows whichever reps have data in the window, so an '
    + 'index-based cut would show a different 10 on every range change');
});

test('⚠ the fixed team-average baseline survives the cap', () => {
  const { fn, max } = extractGenerateLabels();
  const out = fn(fakeChart(Array.from({ length: max + 5 }, (_, i) => 'R' + i), []));
  assert.ok(out.some((o) => o.text === 'Team average'),
    'the baseline is what the reps are read against — it must never be capped out');
});

test('⚠⚠ onClick is a FUNCTION, not null — null restores the built-in toggle', () => {
  /* ⚠ CORRECTED: null DOES disable it (Chart.js guards with `if (opts.onClick)`,
     verified on the deployed chart — invoking the handler left visibility
     unchanged). The earlier claim came from a probe that printed "DEFAULT" for
     any falsy onClick. A no-op is still preferred: explicit, unmistakable for an
     oversight, and robust to a future Chart.js that treats null differently. */
  assert.ok(!/onClick:\s*null/.test(LIVE),
    'prefer an explicit no-op over null — null works but reads as an oversight');
  assert.ok(/onClick:\s*function\s*\(\s*\)\s*\{/.test(LIVE), 'expected a no-op function');
  // ⚠ and the reason must be AT THE SITE, or the next reader "simplifies" it back
  const at = PAGE.indexOf('onClick: function');
  const before = PAGE.slice(Math.max(0, at - 900), at);
  assert.ok(/merge|default|null/i.test(before),
    'the comment beside onClick must name WHY it is a no-op — a bare function () {} '
    + 'invites simplification back to null, which is how this survived for weeks');
});
