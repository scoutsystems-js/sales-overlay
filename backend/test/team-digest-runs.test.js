'use strict';
/* ⚠⚠⚠ THIS EXECUTES computeDailyDigest. THAT IS THE WHOLE POINT.
   On 2026-08-30 an edit spliced three lines INSIDE the callback passed to
   w.inChunks — after its `return`, with no closing brace between — so
   `var objections` became unreachable and the read below it threw
   ReferenceError. EVERY digest failed from the next cron onward: two days with
   no landing page for the manager who uses it first each morning.

   ⚠ NOTHING CAUGHT IT. It parses, so `node -c` passed. The existing suite tests
   the ET-date maths, the cache-key convention and the quiet shape — all real
   properties, all of them HELPERS, none of which calls the function. And the
   failure landed in a per-manager try/catch that logs one line to a buffer
   nobody reads.

   ⚠⚠ "TESTING A FUNCTION IN ISOLATION AND GREPPING FOR ITS NAME ARE THE SAME
   CHECK TWICE." The only check that could see this is one that RUNS the entry
   point. It needs no network and no model call — a fake supabase and a quiet
   day is enough, because a ReferenceError throws before any of that matters. */
const test = require('node:test');
const assert = require('node:assert');
const { computeDailyDigest } = require('../lib/team-digest');

/* A supabase double that answers every shape team-digest asks for. Deliberately
   returns NO calls, so the run takes the quiet path and never reaches a model
   call — the identifier bug throws long before that either way. */
function fakeAdmin(rows) {
  /* ⚠ A PROXY, NOT A HAND-LISTED CHAIN. A first version enumerated the builder
     methods and died on `.is()` — and a double that fails for its OWN reasons
     cannot tell you whether the code under test is sound. Any unknown method
     returns the chainable; awaiting it yields the table's rows. */
  const build = (table) => {
    const rowsFor = rows[table] || [];
    const target = {
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rowsFor, error: null }).then(res, rej),
    };
    const q = new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        return () => q;                       // every builder method chains
      },
    });
    return q;
  };
  return { from: build, auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } };
}

/* ⚠⚠ THE SAMPLE MUST REACH THE CODE. A first version returned NO calls, so the
   run took the quiet-day path and returned BEFORE the objections block — it
   passed cleanly against the real defect. A check that can pass by never running
   the line is not a check. The fake now returns a call, which is what carries
   execution past the quiet gate and into the block that was broken. */
test('⚠ computeDailyDigest RUNS PAST THE OBJECTIONS BLOCK on a day with calls', async () => {
  /* ⚠ NO MODEL CALL GOES OUT: the key is cleared, so the narration step fails
     operationally. That is fine and it is the point — the identifier bug throws
     BEFORE it, so the two are distinguishable by TYPE. */
  const hadKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const admin = fakeAdmin({
      fathom_calls: [{ id: 'c1', user_id: 'rep-1', title: 'A call', call_date: '2026-08-30T15:00:00Z' }],
      call_analyses: [{ fathom_call_id: 'c1', user_id: 'rep-1', outcome: 'closed', overall_score: 70, status: 'done' }],
      call_highlights: [{ fathom_call_id: 'c1', timestamp_seconds: 100, speaker: 'PROSPECT',
                          quote: 'too expensive', observation: 'price', type: 'objection',
                          objection_category: 'fear', resolution: 'handled' }],
    });
    let err = null;
    try { await computeDailyDigest(admin, 'mgr-1', ['rep-1'], '2026-08-30', {}, {}); }
    catch (e) { err = e; }

    /* ⚠ THE ASSERTION IS ABOUT THE ERROR'S TYPE, NOT ITS ABSENCE. An operational
       failure (no model key) is expected here and is not a defect. A
       ReferenceError or TypeError is OUR bug — it is what shipped, and it is what
       ran for two days behind a catch that logged one line. */
    if (err) {
      assert.ok(!(err instanceof ReferenceError),
        'ReferenceError from computeDailyDigest — an identifier is out of scope: ' + err.message);
      assert.ok(!/is not defined/.test(err.message || ''),
        'an identifier is out of scope: ' + err.message);
    }
  } finally {
    if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey;
  }
});

test('⚠ a manager with no reps is reported, not thrown', async () => {
  const admin = fakeAdmin({ fathom_calls: [], call_analyses: [], call_highlights: [] });
  const d = await computeDailyDigest(admin, 'mgr-1', [], '2026-08-30', {}, {});
  assert.strictEqual(d.available, false, 'no reps means nothing to report');
});

test('⚠⚠ the DQ filter is OUTSIDE the inChunks callback, not spliced into it', async () => {
  /* The structural half, so the shape cannot come back even if a future fake
     happens to short-circuit before the read. */
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'team-digest.js'), 'utf8');
  const at = src.indexOf("var objectionsAll = await w.inChunks(");
  assert.ok(at !== -1, 'stale anchor — the objections fetch is gone');
  const span = src.slice(at, src.indexOf('var objLines', at));
  assert.ok(span.length > 200 && span.length < 2200, 'slice must cover it: ' + span.length);

  // the callback must CLOSE on the line that opens it
  assert.ok(/function \(q\) \{ return q\.eq\('type', 'objection'\); \}\);/.test(span),
    'the inChunks callback must close on its own line — anything after `return` inside it is dead code');
  // and the declaration must come after that close, not before it
  const close = span.indexOf("'objection'); });");
  const decl = span.indexOf('var objections =');
  assert.ok(close !== -1 && decl > close,
    'var objections must be declared OUTSIDE the callback, or it is undefined where it is read');
});
