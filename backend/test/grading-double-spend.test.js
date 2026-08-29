const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠⚠ THE CLAIM IS THE SAFETY MECHANISM AND THE RESET USED TO DESTROY IT.
   `claimAnalysisRun` refuses a duplicate only while a row reads
   status='processing' with a FRESH analyzed_at. The update-analyses reset wrote
   'pending' over every id with NO status guard, so a second press wiped that
   claim and a second loop could grade a call the first was mid-way through —
   two full analyses, one call, and the rep pays twice.

   ⚠ CORRECTING AN EARLIER REPORT OF MINE: rows the first run has FINISHED are
   NOT re-selected. analyzeCall sets sync_status='processed' and stamps the
   current prompt_version, which removes them from both the pending and the
   outdated lists. The exposure is IN-FLIGHT and NOT-YET-STARTED rows. */

const ROOT = path.join(__dirname, '..');
function live(p) {
  const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
  return src.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('⚠⚠ the reset EXCLUDES calls a live run is holding', () => {
  const src = live('routes/fathom.js');
  const at = src.indexOf('runUpdateAnalyses');
  assert.ok(at !== -1);
  const body = src.slice(at, src.indexOf('router.post(\'/update-analyses\'', at));
  assert.ok(body.length > 2000, 'slice must cover the function: ' + body.length);
  // it must ask which rows are claimed, using the claim's OWN staleness window
  assert.ok(/status'?,?\s*'processing'/.test(body) || /eq\('status', 'processing'\)/.test(body),
    'must look for in-flight claims');
  assert.ok(/_CLAIM_STALE_MS/.test(body),
    'must use the WORKER\'S staleness window, not a second copy that can drift');
  assert.ok(/heldSet\[x\]/.test(body) || /!heldSet/.test(body),
    'and must remove those ids before the reset');
});

test('⚠⚠ it FAILS CLOSED — if the claims cannot be read, nothing is reset', () => {
  // A wrong reset spends money twice; doing nothing costs a retry. The safe
  // direction is unambiguous, so it must not be left to chance.
  const src = live('routes/fathom.js');
  const at = src.indexOf('refusing to reset');
  assert.ok(at !== -1, 'the failure path must refuse, and say so');
  const around = src.slice(at, at + 400);
  assert.ok(/return res\.status\(503\)/.test(around), 'and must not proceed to the reset');
});

test('⚠ a STALE claim is still reclaimable — a killed drain must self-heal', () => {
  // Rows left at 'processing' by a dead run are NOT a live run. Treating them as
  // one would strand them forever behind a guard meant for live work.
  const src = live('routes/fathom.js');
  assert.ok(/gt\('analyzed_at', claimCutoff\)/.test(src),
    'only claims NEWER than the staleness window count as live');
});

test('⚠⚠ /me/grading-backlog reports LIVE claims only', () => {
  const src = live('lib/grading-backlog.js');
  assert.ok(/processing: processing/.test(src), 'the count must be returned');
  assert.ok(/eq\('status', 'processing'\)/.test(src));
  assert.ok(/gt\('analyzed_at', claimCutoff\)/.test(src),
    'a stranded row from a killed drain must not read as a live run');
});

test('⚠⚠ the staleness window is resolved LAZILY — the require is circular', () => {
  /* worker -> routes/fathom -> grading-backlog -> worker. A top-level require
     can hand back `undefined` from a partially-initialised module; then
     `Date.now() - undefined` is NaN, `new Date(NaN).toISOString()` THROWS, the
     catch swallows it and the in-flight count reads 0 FOREVER — silently, which
     is the exact failure this change exists to remove. */
  const src = live('lib/grading-backlog.js');
  assert.ok(/function claimStaleMs\(\)/.test(src), 'must resolve at call time');
  assert.ok(/throw new Error\('claim staleness window unavailable/.test(src),
    'and must THROW on a bad value rather than defaulting to something plausible');
  assert.ok(!/^var CLAIM_STALE_MS = require/m.test(src),
    'a top-level require of the worker is the circular-dependency trap');
});

test('⚠⚠ the page reconstructs a live run on load and does NOT offer to start it', () => {
  const src = live('web/dashboard.html');
  const at = src.indexOf('function adoptRunningGrade');
  assert.ok(at !== -1, 'a reload must be able to adopt a running grade');
  const fn = src.slice(at, src.indexOf('function gradeBacklogControlHtml', at));
  assert.ok(fn.length > 200 && fn.length < 3000, 'slice must cover it: ' + fn.length);
  assert.ok(/b\.processing > 0/.test(fn), 'it keys on the SERVER\'s live-claim count');
  // and the control must call it BEFORE deciding what to render
  const ctrl = src.slice(src.indexOf('function gradeBacklogControlHtml'), src.indexOf('function gradeBacklogControlHtml') + 600);
  assert.ok(/adoptRunningGrade\(\)/.test(ctrl), 'the control must adopt before reading state.gradeRun');
});

test('⚠ the total is REMEMBERED, never invented', () => {
  // Without a stored total we can honestly say how many are LEFT but not
  // "X of Y" — a made-up denominator on a progress bar is worse than no bar.
  const src = live('web/dashboard.html');
  const at = src.indexOf('function adoptRunningGrade');
  const fn = src.slice(at, at + 900);
  assert.ok(/readGradeRunTotal\(\)/.test(fn), 'it must look for a remembered total');
  assert.ok(/saved && saved\.total >= remaining/.test(fn),
    'and fall back to the remaining count rather than inventing a denominator');
  assert.ok(/clearGradeRunTotal/.test(src), 'a finished or dismissed run must clear it');
});
