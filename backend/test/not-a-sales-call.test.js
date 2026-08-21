/**
 * "NOT A SALES CALL" — the exclusion tag (Justin's ruling 2026-08-20).
 *
 * ⚠⚠ THE PREDICATE IS `is not true`, NEVER `= false`, AND THIS IS THE WHOLE
 * REASON THIS FILE EXISTS. The column is NULLABLE with three states:
 *     NULL   never assessed          -> counts
 *     false  confirmed a sales call  -> counts
 *     true   not a sales call        -> excluded
 * In Postgres `not_a_sales_call = false` evaluates to NULL for an unassessed
 * row, and NULL is not true, so such a filter SILENTLY EXCLUDES EVERY CALL
 * NOBODY HAS LOOKED AT — which is almost the entire corpus. The numbers would
 * simply be wrong, with nothing erroring.
 *
 * ⚠ TWO SILENT-NULL BUGS OF EXACTLY THIS SHAPE HAVE ALREADY SHIPPED HERE: the
 * `.neq('prompt_version', …)` outdated count, and the `.or()` prompt_version
 * filter. Both were invisible until someone counted rows.
 *
 * ⚠⚠ THIS GUARD IS DELIBERATELY A CROSS-CUTTING SCAN, NOT ONE ASSERTION PER
 * CONSUMER. Eighteen individual assertions protect eighteen known sites; a scan
 * protects the NINETEENTH — the one a future session adds without reading this
 * file. That is the site that will get it wrong.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['lib', 'routes'];

function sourceFiles() {
  const out = [];
  DIRS.forEach(function (d) {
    const dir = path.join(ROOT, d);
    fs.readdirSync(dir).forEach(function (f) {
      if (!f.endsWith('.js')) return;
      out.push({ rel: d + '/' + f, src: fs.readFileSync(path.join(dir, f), 'utf8') });
    });
  });
  return out;
}

/* ⚠ Strip comments — line comments FIRST. A `/*` inside a `//` is a false opener
   that can swallow hundreds of lines, and this codebase explains its rules in
   prose right next to the code they govern, so an unstripped scan would match
   THIS FILE'S OWN EXPLANATION of the forbidden form. */
function live(src) {
  return src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

test('⚠⚠ NO CONSUMER MAY USE `= false` / .eq(false) ON THE TAG', () => {
  const bad = [];
  sourceFiles().forEach(function (f) {
    const s = live(f.src);
    // the forbidden forms, in SQL and in the supabase client
    const pats = [
      /not_a_sales_call\s*=\s*false/gi,
      /\.eq\(\s*['"]not_a_sales_call['"]\s*,\s*false\s*\)/g,
      /\.neq\(\s*['"]not_a_sales_call['"]\s*,\s*true\s*\)/g,   // same NULL trap
      /not_a_sales_call\s*<>\s*true/gi,
    ];
    pats.forEach(function (p) {
      const m = s.match(p);
      if (m) bad.push(f.rel + ' :: ' + m[0]);
    });
  });
  assert.deepStrictEqual(bad, [],
    'these silently exclude every UNASSESSED call (NULL = false is NULL, and ' +
    'NULL is not true). Use `is not true` / .not(...,\'is\',true) instead:\n  ' +
    bad.join('\n  '));
});

test('⚠ NON-VACUITY — the scan detects the forbidden form when it is present', () => {
  /* An absence assertion is the easiest test here to write and have mean
     nothing. Prove each matcher fires against the defect it names. */
  const fixtures = [
    "q.eq('not_a_sales_call', false)",
    "where not_a_sales_call = false",
    "q.neq('not_a_sales_call', true)",
    "where not_a_sales_call <> true",
  ];
  const pats = [
    /not_a_sales_call\s*=\s*false/gi,
    /\.eq\(\s*['"]not_a_sales_call['"]\s*,\s*false\s*\)/g,
    /\.neq\(\s*['"]not_a_sales_call['"]\s*,\s*true\s*\)/g,
    /not_a_sales_call\s*<>\s*true/gi,
  ];
  fixtures.forEach(function (fx) {
    const hit = pats.some(function (p) { p.lastIndex = 0; return p.test(fx); });
    assert.ok(hit, 'the scan must detect: ' + fx);
  });
  // and must NOT fire on the correct form
  const good = "q.not('not_a_sales_call', 'is', true)";
  assert.ok(!pats.some(function (p) { p.lastIndex = 0; return p.test(good); }),
    'the correct form must not be flagged');
});

test('⚠ THE MIGRATION DECLARES THREE STATES — nullable, no default', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'migrations', '042_not_a_sales_call.sql'), 'utf8');
  assert.ok(/add column if not exists not_a_sales_call\s+boolean/i.test(sql),
    'the column exists');
  assert.ok(!/not_a_sales_call\s+boolean[^,;]*default/i.test(sql),
    'NO DEFAULT — a default false collapses "never assessed" into "confirmed a ' +
    'sales call" and makes an un-mark indistinguishable from an untouched row');
  assert.ok(/not_sales_marked_by/.test(sql) && /not_sales_marked_role/.test(sql),
    'who marked it and in which role — either a closer or a manager may');
  assert.ok(/check \(not_sales_marked_role is null or not_sales_marked_role in \('closer','manager'\)\)/i.test(sql),
    'the role is constrained to the two that can mark');
});

/* ── THE PROSPECT "DETACH" IS A FILTER, AND THAT IS WHY IT REVERSES ────────── */
const pe = require('../lib/prospect-entity');

test('⚠⚠ a prospect whose ONLY call is marked leaves the denominator by itself', () => {
  /* No destructive detach: rollupProspects groups BY prospect and skips calls
     with none, so excluding the call at the query removes the prospect from
     both numerator and denominator. Un-marking puts it straight back, with no
     stored prior-attachment column to keep in sync. */
  const withFake = pe.rollupProspects([
    { id: 'c1', user_id: 'u', prospect_id: 'real',  outcome: 'closed' },
    { id: 'c2', user_id: 'u', prospect_id: 'fake',  outcome: 'lost'   },
  ], {});
  const withoutFake = pe.rollupProspects([
    { id: 'c1', user_id: 'u', prospect_id: 'real',  outcome: 'closed' },
  ], {});
  assert.strictEqual(withFake.u.total, 2, 'the fake prospect is in the denominator today');
  assert.strictEqual(withoutFake.u.total, 1, 'filtering the call removes the prospect entirely');
  assert.strictEqual(withoutFake.u.closed, 1);
  assert.strictEqual(withoutFake.u.pct, 100, 'and the rate moves: 50% -> 100%');
});

test('⚠⚠ a prospect with OTHER calls KEEPS them — marking one must not orphan the rest', () => {
  // two calls on the same prospect; one gets marked
  const before = pe.rollupProspects([
    { id: 'c1', user_id: 'u', prospect_id: 'p', outcome: 'lost'   },
    { id: 'c2', user_id: 'u', prospect_id: 'p', outcome: 'closed' },
  ], {});
  const after = pe.rollupProspects([
    { id: 'c2', user_id: 'u', prospect_id: 'p', outcome: 'closed' },
  ], {});
  assert.strictEqual(before.u.total, 1, 'follow-ups collapse into ONE prospect');
  assert.strictEqual(after.u.total, 1, 'the prospect SURVIVES — it still has a call');
  assert.strictEqual(after.u.closed, 1, 'and keeps its outcome');
});

/* ── THE LIBRARY KEEPS MARKED CALLS, FLAGGED ───────────────────────────────── */
test('⚠⚠ the call library SELECTS the tag AND EMITS it — both ends of the bug', () => {
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'fathom.js'), 'utf8');
  const s = live(src);
  // selected...
  assert.ok(/sync_status, not_a_sales_call'\)/.test(s),
    'the library select must include the tag, or the flag is always undefined');
  // ...AND used. Selecting a column you forget to use, and using one you forgot
  // to select, are the same bug from opposite ends; this codebase has shipped
  // the second four times.
  assert.ok(/not_a_sales_call: cc\.not_a_sales_call === true/.test(s),
    'the library payload must EMIT the flag');
  // and it must NOT be filtered out of the list
  const at = s.indexOf("sync_status, not_a_sales_call')");
  const window = s.slice(Math.max(0, at - 400), at + 600);
  assert.ok(!/not\('not_a_sales_call', 'is', true\)/.test(window),
    'the LIBRARY must not filter — a marked call that vanishes cannot be un-marked');
});

test('⚠ the review-page fetch is NOT filtered — a marked call must still open', () => {
  const s = live(fs.readFileSync(path.join(ROOT, 'routes', 'fathom.js'), 'utf8'));
  const at = s.indexOf(".eq('id', callRowId)");
  const probe = at > -1 ? s.slice(Math.max(0, at - 500), at + 200) : '';
  assert.ok(!/not\('not_a_sales_call'/.test(probe),
    'single-call fetch by id must never be filtered, or the call cannot be opened');
});
