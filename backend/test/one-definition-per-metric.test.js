/* ⚠⚠ ONE DEFINITION PER METRIC (Justin's ruling 2026-08-30).
   "if a closer has 3 different closing % on 3 different pages we look like
   amateurs. If something is true on 1 page shouldn't it be true on all?"

   This guard is PER CALL SITE, not per file, because two modules legitimately
   hold one lane of each kind. It fails if a surface forms a closed/total or
   handled/total ratio itself instead of calling the shared computation — which
   is the only thing that stops the sixth surface disagreeing tomorrow. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ⚠ LINE COMMENTS FIRST, THEN BLOCK — a block opener inside a `//` line is a
// false opener that eats to the next real closer. This bit once.
function code(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/* Every surface that shows a CLOSING RATE. Before 2026-08-30 there were three
   computations: prospect-entity, rep-series and routes/team.js, agreeing by luck
   rather than by construction — and only one applied merge remapping. */
const CLOSING_SURFACES = ['lib/rep-series.js', 'routes/team.js', 'lib/team-analytics.js'];

test('⚠⚠ no surface rolls its OWN closing rate — they call the shared one', () => {
  CLOSING_SURFACES.forEach((f) => {
    const src = code(f);
    assert.ok(/closeRateForCalls|fetchProspectCloseRates|hadAConversation/.test(src),
      f + ' shows a closing rate and must call the shared computation in lib/prospect-entity.js');
    // the hand-rolled shape that existed here before: counting prospects into a
    // local closed/total pair without consulting the shared outcome rule
    assert.ok(!/closing\.total \+= 1;\s*\n\s*if \(prospectClosed/.test(src),
      f + ' is accumulating its own prospect close counts again');
  });
});

test('⚠⚠ the "calls taken, not booked" rule lives in ONE place', () => {
  const pe = code('lib/prospect-entity.js');
  assert.ok(/NOT_A_CONVERSATION\s*=\s*\{[^}]*no_show[^}]*\}/.test(pe),
    'no_show must leave the denominator, and the rule belongs with the close rate');
  assert.ok(/disqualified/.test(pe),
    'DQ and no-show leave for the SAME reason — there was no closeable conversation — '
    + 'so one predicate covers both rather than two rules that can drift');

  // and nobody else may define it
  ['lib/rep-series.js', 'routes/team.js'].forEach((f) => {
    const src = code(f);
    assert.ok(!/no_show/.test(src),
      f + ' must not carry its own no-show rule — it calls the shared one');
  });
});

/* Every surface that shows an OBJECTION HANDLE RATE. objection-handled.js
   centralised the NUMERATOR ("is this one handled?") and nobody centralised the
   DENOMINATOR ("does this one count?"), so three counted every moment while two
   counted true objections only: 20% vs 17% on one rep, under one name. */
const OBJECTION_RATE_SURFACES = [
  'routes/team.js',            // team gauge
  'lib/team-analytics.js',     // rep cards
  'lib/rep-series.js',         // manager graph
  'lib/team-objections.js',    // per-closer grid + feed
  'lib/team-needs-work.js',    // focus panel + the coaching tile that reuses its buckets
];

test('⚠⚠ every objection-rate surface reads ONE denominator definition', () => {
  OBJECTION_RATE_SURFACES.forEach((f) => {
    const src = code(f);
    assert.ok(/countsAsObjection|strictObjections|objection_class/.test(src),
      f + ' forms an objection handle rate and must use the shared denominator '
      + '(lib/objection-strict.js) — a shared numerator with an unshared denominator '
      + 'LOOKS solved and is not');
  });
});

test('⚠ the stored class must survive the query, or it is invisible', () => {
  // the dead-call-site family: the column can be read and never selected
  ['lib/team-objections.js', 'lib/team-needs-work.js'].forEach((f) => {
    const src = code(f);
    /* ⚠ LINE-BASED ON PURPOSE. A quoted-string regex spans concatenated selects
       and matches code between them, which reported a fragment as a select. A
       column list is identifiable: it names fathom_call_id AND objection_surface
       on one line. */
    const lines = src.split('\n').filter((l) =>
      l.indexOf('objection_surface,') !== -1
      && l.indexOf('fathom_call_id,') !== -1   // a COLUMN LIST, not a mapper
      && l.indexOf("'") !== -1);
    assert.ok(lines.length > 0, f + ' should select objection columns');
    lines.forEach((sel) => {
      assert.ok(sel.indexOf('objection_class') !== -1,
        f + ' selects objection_surface without objection_class — the stored class '
        + 'would be undefined at every read site: ' + sel.trim().slice(0, 100));
    });
  });
});

test('⚠ NULL counts — the crossover must not silently shrink the denominator', () => {
  const { countsAsObjection } = require('../lib/objection-strict');
  assert.strictEqual(countsAsObjection({ objection_class: null }), true,
    'nothing re-analyses, so pre-v37 moments carry no class. They must COUNT — the '
    + 'loose behaviour that already existed — or the number changes into a third thing');
  assert.strictEqual(countsAsObjection({ objection_class: 'disqualification' }), false);
  assert.strictEqual(countsAsObjection({ objection_class: 'true_objection' }), true);
});
