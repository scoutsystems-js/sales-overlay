'use strict';
/* A VERSION BUMP MUST NOT ERASE VALID MEASUREMENTS (H768, found the same day).
   The reader (`stageMetric` → `read`) refused any saved record whose version was not the
   current one. When H768 moved the validator to stage-eligibility-v18, the 171 records
   written under v17 that day (the seven-day regrade and the cron's own grades) read as
   unmeasured on Team → Coaching: Preston's fourteen calls showed "Awaiting grades" with
   nothing counted while twelve of them carried evaluated stages in the database.
   v17 and v18 differ only in what becomes not_applicable (a genuine DQ's objection and
   close; never-due coercions) — an evaluated score under v17 is the same measurement
   under v18, and the states that differ contribute nothing either way. So the reader
   carries the set of versions it can read, and a version outside the set is what stays
   unavailable. Withholding a valid measurement is a failure of the same size as
   publishing a wrong one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-eligibility');

function record(version) {
  const sections = Object.fromEntries(S.SECTIONS.map(section => [section, { state: 'evaluated', score: 80, grade: 'B' }]));
  return { summary: { version, verification: S.PRODUCTION_VERIFICATION, grader_version: S.PRODUCTION_GRADER_VERSION, source_hash: 'abc', sections } };
}

test('a v17 record still counts under v18 — every stage contributes its score', () => {
  const row = { stage_eligibility: record('stage-eligibility-v17') };
  S.SECTIONS.forEach(section => {
    const m = S.stageMetric(row, section);
    assert.equal(m.state, 'evaluated', section);
    assert.equal(m.contributes, true, section);
    assert.equal(m.score, 80, section);
  });
});

test('the current version counts, an unknown older version does not', () => {
  assert.equal(S.stageMetric({ stage_eligibility: record(S.VERSION) }, 'intro').contributes, true);
  const old = S.stageMetric({ stage_eligibility: record('stage-eligibility-v16') }, 'intro');
  assert.equal(old.state, 'unmeasured');
  assert.equal(old.contributes, false);
  assert.deepEqual([...S.READABLE_VERSIONS].sort(), ['stage-eligibility-v17', 'stage-eligibility-v18']);
});
