/* THE "WHY" PANEL — level-at-zero is not a finding (2026-08-30).
   Justin, live: "it only says something about Josh." Every closer DID render;
   what failed was the CONTENT. `even_performance` fires when no category is far
   enough below the others to name — which is ALSO true when a closer is failing
   every type equally, and three closers on the live board handled 0 of 32,
   0 of 14 and 0 of 12 and were each told their handling was "running level". */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function render() {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.indexOf('function objTypeLabel') !== -1);
  const end = lines.findIndex((l, i) => i > start && l.indexOf('function teamObjSummaryHtml') !== -1);
  assert.ok(start !== -1 && end > start, 'renderer not found');
  const src = lines.slice(start, end).join('\n');
  assert.ok(src.indexOf('function objSummaryCloserHtml') !== -1, 'slice must cover the renderer');
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const f = new Function('escapeHtml', 'OBJ_DRILL_LABELS', 'objectionLabel', 'clipLabelFor', 'state',
    src + '; return objSummaryCloserHtml;')(
    escapeHtml, { fear: 'Fear', partner: 'Partner' }, (c) => c, () => 'Clip', { repLineHidden: {} });
  return (c) => f(c).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/&#39;/g, "'").trim();
}

test('⚠⚠ ZERO handled is never reported as "level" — that is a data problem as good news', () => {
  const t = render();
  const out = t({ name: 'Godwin', state: 'even_performance', total: 32, handled: 0,
    ranking: [{ category: 'fear', rate_pct: 0, baseline_pct: 0 }] });
  assert.ok(!/level|even across/i.test(out),
    'a closer who handled NONE of 32 objections was being told their handling is running '
    + 'level. Level at zero is the worst result on the board, not a clean bill: ' + out);
  assert.ok(/did not handle any of the 32/.test(out), 'it states the actual result: ' + out);
});

test('⚠ a LOW rate says it is low everywhere, not that it is even', () => {
  const out = render()({ name: 'Nick', state: 'even_performance', total: 26, handled: 3,
    ranking: [{ category: 'fear', rate_pct: 8, baseline_pct: 14 }] });
  assert.ok(/3 of 26/.test(out), 'EVEN ONE OBJECTION IS DATA — name the rate: ' + out);
  assert.ok(/low across every type/.test(out), 'and say what kind of problem it is: ' + out);
});

test('⚠ a genuinely level, decent rate still reads as a finding', () => {
  const out = render()({ name: 'Josh', state: 'even_performance', total: 30, handled: 12,
    ranking: [{ category: 'fear', rate_pct: 29, baseline_pct: 13 }] });
  assert.ok(/even across types/.test(out), 'the finding survives where it IS one: ' + out);
  assert.ok(/12 of 30/.test(out), 'with its counts');
});

test('⚠ the contrast clause is dropped when the two numbers are equal', () => {
  const out = render()({ name: 'Ava', state: 'even_performance', total: 40, handled: 16,
    ranking: [{ category: 'fear', rate_pct: 40, baseline_pct: 40 }] });
  assert.ok(/Every type is close to 40%/.test(out),
    'contrasting a number with itself reads as a mistake: ' + out);
});
