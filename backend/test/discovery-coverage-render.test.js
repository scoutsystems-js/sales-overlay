/* The six discovery items on the call review page (surface ①, 2026-08-30).
   Captured since v33 and displayed nowhere until now. This is the TRUST CHECK —
   it lets the captured quotes be read across real calls before anything is built
   on top of them — so the guards are about what is SHOWN and what is WITHHELD. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function render() {
  const from = HTML.indexOf('var DISCOVERY_ITEMS');
  const to = HTML.indexOf('function gradeCardHtml', from);
  const src = HTML.slice(from, to);
  // ⚠ a backwards or truncated slice silently tests the empty string
  assert.ok(src.length > 800 && src.length < 6000, 'slice must cover the block: ' + src.length);
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  return new Function('escapeHtml', src + '; return { html: discoveryCoverageHtml, list: discoveryCoverage };')(escapeHtml);
}

const FULL = [
  { area_key: 'pain', covered: true, evidence: 'no sober living homes per se', evidence_verified: true },
  { area_key: 'goals', covered: true, evidence: 'she has had this vision', evidence_verified: false },
  { area_key: 'current_situation', covered: true, evidence: 'almost ready to retire', evidence_verified: true },
  { area_key: 'decision_makers', covered: false, evidence: null, evidence_verified: false },
  { area_key: 'why_now', covered: true, evidence: 'this year has really been the year', evidence_verified: true },
  { area_key: 'financial_resources', covered: false, evidence: null, evidence_verified: false },
];

test('⚠⚠ NOT COVERED IS A FACT, NOT A CRITICISM', () => {
  const out = render().html({ coverage: FULL });
  assert.ok(!/✗|✘|✕|&#10007;/.test(out), 'no crosses — six marks on a well-run call would make the page a scold');
  assert.ok(!/\bmissed\b|\bfailed\b|\bfailure\b/i.test(out), 'no failure vocabulary: ' + out.slice(0, 200));
  assert.ok(!/--bad|var\(--bad\)/.test(out), 'the uncovered state must not borrow the error colour');
  assert.ok(/Not established on this call/.test(out), 'it states the fact plainly instead');
});

test('⚠ PAIN carries the logical-sale caveat, and ONLY when it is uncovered', () => {
  const r = render();
  const covered = r.html({ coverage: FULL });
  assert.ok(!/bought on logic/.test(covered),
    'the caveat is noise when pain WAS established');

  const uncovered = FULL.map((c) => (c.area_key === 'pain'
    ? { area_key: 'pain', covered: false, evidence: null, evidence_verified: false } : c));
  assert.ok(/bought on logic/.test(r.html({ coverage: uncovered })),
    'absent pain on a logical sale is NOT a miss and the display must say so, or it reads as one');
});

test('⚠⚠ an UNVERIFIED quote is withheld — the whole point is that these can be trusted', () => {
  const out = render().html({ coverage: FULL });
  assert.ok(/no sober living homes per se/.test(out), 'a verified quote is shown');
  assert.ok(!/she has had this vision/.test(out),
    'an unverified line must NOT be presented as the prospect\'s words — this surface exists '
    + 'so the captured quotes can be trusted, and showing an unproven one defeats it');
  assert.ok(/Established on the call/.test(out), 'covered-without-a-provable-quote still says so');
});

test('⚠ a pre-v33 call renders NOTHING, never six blanks', () => {
  const r = render();
  assert.strictEqual(r.html({ coverage: null }), '', 'no coverage at all');
  assert.strictEqual(r.html({ coverage: [] }), '', 'empty coverage');
  assert.strictEqual(r.html({ coverage: [{ area_key: 'income_goal_and_motivation', covered: true }] }), '',
    'a DERIVED-areas-only call carries none of the six — an empty six-row grid would read as six failures');
});

test('⚠ the count is visible while COLLAPSED, and only on discovery', () => {
  const live = HTML.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/review-grade-disc-count/.test(live),
    'a feature behind a click that nothing hints at is the complete-and-unreachable failure');
  assert.ok(/sectionKey !== 'discovery'\) return ''/.test(live),
    'the count belongs to the discovery card alone');
  assert.ok(/sectionKey === 'discovery'\) \? discoveryCoverageHtml/.test(live),
    'and so does the block itself');
});

test('⚠ the six are in a fixed order — a stable list is what makes calls comparable', () => {
  const items = render().list({ coverage: FULL.slice().reverse() });
  assert.deepStrictEqual(items.map((i) => i.key),
    ['pain', 'goals', 'current_situation', 'decision_makers', 'why_now', 'financial_resources'],
    'stored order must not leak into the display');
});
