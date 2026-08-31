/**
 * THE BACKLOG A ZOOM-ONLY USER COULD NOT SEE, AND THE REPS THE GRAPH DROPPED.
 *
 * ⚠⚠ TWO DEFECTS, ONE SHAPE: Scout knew the user had to act and said nothing.
 *   1  The setup card deleted itself the moment ONE call was graded, having just
 *      said "Your recent calls are graded." A live customer synced 121, had 20
 *      graded by the first-sync cap, and reported it as a broken sync.
 *   2  The grading control was gated on `fathomStatus.connected`, so a Zoom-only
 *      user got no control on EITHER site — while the Calls page went on printing
 *      "102 not graded yet" from its own source-agnostic query.
 *   3  The rep graphs dropped a rep with nothing to plot without naming them, so
 *      Closing % showed many lines and Time to Price showed one, on one page.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// ⚠ COMMENTS FIRST, IN THIS ORDER. A `/*` inside a `//` line is a false opener
// that pairs with the next real closer and swallows the file.
const LIVE = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function slice(src, startNeedle, endNeedle, min, max) {
  const at = src.indexOf(startNeedle);
  assert.ok(at !== -1, 'stale anchor: ' + startNeedle);
  const end = src.indexOf(endNeedle, at);
  assert.ok(end !== -1, 'stale end anchor: ' + endNeedle);
  const out = src.slice(at, end + endNeedle.length);
  assert.ok(out.length > min && out.length < max, 'slice must cover it: ' + out.length);
  return out;
}

// ── the count itself ────────────────────────────────────────────────────────
test('gradingBacklog never filters on source — a Zoom row is a call like any other', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'grading-backlog.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/source/i.test(SRC), 'the backlog must be source-agnostic by construction');
  assert.ok(/not_a_sales_call/.test(SRC) && /duplicate_of/.test(SRC),
    'must apply the same exclusions every other count applies');
});

test('the route is self-scoped — grading dispatches against req.user.id', () => {
  const ME = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8');
  const src = slice(ME, "router.get('/grading-backlog'", '});', 120, 1200);
  assert.ok(/req\.user\.id/.test(src), 'must scope to the caller');
  assert.ok(/requireAuth/.test(src), 'must be authenticated');
});

test('⚠ the work count reads the shared backlog, NOT a provider status', () => {
  const src = slice(LIVE, 'function gradeBacklogWorkCount', '\n  }', 40, 600);
  assert.ok(!/fathomStatus/.test(src),
    'REGRESSION: gating on fathomStatus hides the control from every Zoom-only user');
  assert.ok(/gradingBacklog/.test(src), 'must read the source-agnostic count');
});

test('⚠ the progress poll reads the shared backlog too, or it never advances for Zoom', () => {
  const src = slice(LIVE, 'async function gradeBacklogTick', 'paintGradeBacklog', 200, 2500);
  assert.ok(/\/me\/grading-backlog/.test(src), 'must poll the source-agnostic count');
  assert.ok(!/st\.connected/.test(src), 'REGRESSION: a connected-gate stalls the bar for Zoom users');
});

// ── the card ────────────────────────────────────────────────────────────────
// Runs the REAL vanish condition against real state, rather than asserting the
// text of the branch — the property is what the user sees, not how it is spelt.
function cardVanishes(bl, connected) {
  const src = slice(LIVE, 'var bl = state.gradingBacklog || {};', "return '';", 100, 900);
  const fn = new Function('state', 'connected', src + "\n return '__stayed__';");
  // The real branch returns '' (render nothing). Anything else means it stayed.
  return fn({ gradingBacklog: bl }, connected) === '';
}

test('⚠ THE REPORTED DEFECT: the card must NOT vanish while calls are waiting', () => {
  // The live shape that produced the ticket: 123 synced, 19 graded, 102 waiting.
  assert.strictEqual(cardVanishes({ graded: 19, waiting: 102, total: 123 }, true), false,
    'REGRESSION: the card would delete itself with 102 calls ungraded');
});

test('and it MUST still vanish once the work really is done', () => {
  assert.strictEqual(cardVanishes({ graded: 123, waiting: 0, total: 123 }, true), true,
    'one wrong state must not be traded for another');
});

test('a connected user with nothing graded yet still sees it', () => {
  assert.strictEqual(cardVanishes({ graded: 0, waiting: 0, total: 0 }, true), false);
});

test('the card names BOTH numbers — a bare "graded" reads as finished', () => {
  const src = slice(LIVE, 'analyzed && blWaiting > 0', 'fathomConnected', 300, 2500);
  assert.ok(/blGraded \+ ' of your ' \+ blTotal/.test(src), 'must say "N of M"');
  assert.ok(/blWaiting/.test(src), 'must say how many are waiting');
  // ⚠ LINK, do not rebuild. A second control here is a second option list to
  // keep in step with the server's window cap.
  assert.ok(/goCallLibrary\(\)/.test(src), 'must send them to the existing control');
  assert.ok(!/gradeBacklogControlHtml/.test(src), 'must NOT build a second control');
});

test('the card is self-only — a pivot must not show onboarding for someone else', () => {
  const src = slice(LIVE, 'function getStartedCardHtml', 'var connected =', 60, 900);
  assert.ok(/isSelf\(\)/.test(src), 'the backlog is self-scoped, so the card must be too');
});

// ── the graph ───────────────────────────────────────────────────────────────
test('⚠ excluded reps are NAMED, not silently dropped', () => {
  const src = slice(LIVE, 'var allReps = series.reps', 'var datasets =', 400, 4000);
  assert.ok(/dropped/.test(src), 'the dropped set must be computed');
  assert.ok(/Excluded/.test(src), 'and written somewhere the user can read');
  /* ⚠ THERE IS NOW ONE REASON, NOT TWO (2026-08-31). The two-group split existed
     because the finder needed the rep's own saved offer price, so a rep without
     one was permanently UNMEASURABLE — a different fact from "quiet window" and
     rightly given different words. The finder now reads the moment from
     total-framing language, so every rep is measurable and the only reason to be
     absent is having no priced call in the window.
     ⚠ THE SUBJECT OF THIS TEST — dropped reps are NAMED, never silently gone —
     is unchanged and is what is still asserted. */
  assert.ok(/No data in this window/.test(src), 'the one remaining reason must be stated');
  assert.ok(!/no offer price saved/.test(src),
    'the unmeasurable group is gone — a rep is no longer invisible for lacking a saved price');
});

test('the excluded note is its OWN element — a legend click must not wipe it', () => {
  const src = slice(LIVE, 'function repGraphBodyHtml', '\n  }', 200, 2000);
  assert.ok(/'Note"/.test(src) && /'Excluded"/.test(src), 'two note elements, not one');
  const upd = slice(LIVE, 'function updateRepGraphAllHiddenNotes', '\n  }', 200, 2000);
  assert.ok(!/Excluded/.test(upd), 'the legend updater must not touch the data note');
});

/* ⚠⚠ ARCHIVED IN PLACE 2026-08-31 — ITS SUBJECT NO LONGER EXISTS, which is a
   different thing from its scaffolding going. It asserted that the PRICE
   PRECONDITION was carried route -> series -> chart so the chart could say
   "cannot be measured". There is no precondition now: findPriceMomentByFraming
   needs no stored price, so every rep is measurable.
   Original:
     assert.ok(/price_pif/.test(RT), 'the route must fetch it');
     assert.ok(/has_price/.test(RT), 'and stamp it on the rep');
     assert.ok(/has_price/.test(RS), 'the series must carry it through');
   ⚠ Inverted rather than deleted, so the retired precondition cannot creep back
   in and silently make reps invisible again. */
test('the retired price precondition stays retired', () => {
  const RS = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rep-series.js'), 'utf8');
  const RT = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  assert.ok(!/has_price/.test(RT), 'the route must not stamp a price precondition');
  assert.ok(!/has_price/.test(RS), 'nor the series carry one');
  // ⚠ price_pif itself is NOT retired — it is still edited via /me and /admin.
  // Only this one consumer went away.
  const ME = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8');
  assert.ok(/price_pif/.test(ME), 'price_pif remains an editable profile field');
});
