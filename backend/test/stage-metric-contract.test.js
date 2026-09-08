'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-eligibility');
const R = require('../lib/section-ranking');
const { buildSectionBreakdown, sectionScoreOf } = require('../lib/section-breakdown');

function stage(state, score, grade) {
  return { state: state, score: score == null ? null : score, grade: grade || null };
}

function rowWithStates(overrides, legacyColumns) {
  const sections = Object.fromEntries(S.SECTIONS.map(function (section) {
    return [section, stage('not_applicable', null, null)];
  }));
  Object.entries(overrides || {}).forEach(function ([section, value]) { sections[section] = value; });
  return Object.assign({
    stage_eligibility: {
      summary: {
        version: S.VERSION,
        review_version: require('../lib/stage-eligibility-review').VERSION,
        factual_version: require('../lib/stage-observation-review').VERSION,
        source_hash: 'source-bound-record',
        sections: sections,
      },
    },
  }, legacyColumns || {});
}

test('stageMetric defines contribution for every metric state', function () {
  assert.equal(typeof S.stageMetric, 'function', 'the shared eligibility metric contract must exist');

  const cases = [
    ['evaluated', stage('evaluated', 82, 'B'), true, 82, 'B'],
    ['expected_but_missed', stage('expected_but_missed', 35, 'D'), true, 35, 'D'],
    ['not_applicable', stage('not_applicable', null, null), false, null, null],
    ['unmeasured', stage('unmeasured', null, null), false, null, null],
  ];
  cases.forEach(function ([name, section, contributes, score, grade]) {
    const metric = S.stageMetric(rowWithStates({ discovery: section }), 'discovery');
    assert.deepEqual(metric, { state: name, contributes: contributes, score: score, grade: grade });
  });
});

test('missing eligibility never falls back to a numeric legacy score', function () {
  const metric = S.stageMetric({ discovery_score: 12, close_score_earned: 4 }, 'discovery');
  assert.deepEqual(metric, { state: 'legacy_unreviewed', contributes: false, score: null, grade: null });
});

test('invalid eligibility is unmeasured and never uses a legacy numeric score', function () {
  const row = { stage_eligibility: { summary: { version: 'wrong', sections: {} } }, discovery_score: 12 };
  assert.deepEqual(S.stageMetric(row, 'discovery'), { state: 'unmeasured', contributes: false, score: null, grade: null });
});

test('not applicable and unmeasured states never become zero', function () {
  ['not_applicable', 'unmeasured'].forEach(function (state) {
    const row = rowWithStates({ close: stage(state, null, null) }, { close_score_earned: 0 });
    const metric = S.stageMetric(row, 'close');
    assert.equal(metric.contributes, false);
    assert.equal(metric.score, null);
    assert.notEqual(metric.score, 0);
  });
});

test('Close uses the earned score in the eligibility record, never displayed or legacy columns', function () {
  const row = rowWithStates({ close: stage('evaluated', 63, 'C') }, { close_score: 100, close_score_earned: 7 });
  assert.deepEqual(S.stageMetric(row, 'close'), { state: 'evaluated', contributes: true, score: 63, grade: 'C' });
});

test('shared ranking and drilldown count only contributing stage records', function () {
  const evaluated = rowWithStates({ discovery: stage('evaluated', 80, 'B') }, { discovery_score: 1 });
  const missed = rowWithStates({ discovery: stage('expected_but_missed', 20, 'F') }, { discovery_score: 99 });
  const notApplicable = rowWithStates({ discovery: stage('not_applicable', null, null) }, { discovery_score: 0 });
  const legacy = { discovery_score: 0 };
  const rows = [evaluated, missed, notApplicable, legacy];

  assert.equal(R.sectionStatsFromAnalyses(rows).discovery.mean, 50);
  assert.equal(R.sectionStatsFromAnalyses(rows).discovery.n, 2);
  assert.equal(sectionScoreOf(evaluated, 'discovery'), 80);
  assert.equal(sectionScoreOf(notApplicable, 'discovery'), null);
  assert.equal(buildSectionBreakdown('discovery', { analyses: rows }).average, 50);
  assert.equal(buildSectionBreakdown('discovery', { analyses: rows }).scored_calls, 2);
});

test('a correct financial DQ in Discovery does not create downstream penalties', function () {
  const row = rowWithStates({
    discovery: stage('evaluated', 88, 'A'),
    pitch: stage('not_applicable', null, null),
    objection: stage('not_applicable', null, null),
    close: stage('not_applicable', null, null),
  }, { discovery_score: 88, pitch_score: 0, objection_score: 0, close_score_earned: 0 });
  assert.equal(S.stageMetric(row, 'discovery').contributes, true);
  ['pitch', 'objection', 'close'].forEach(function (section) {
    assert.deepEqual(S.stageMetric(row, section), { state: 'not_applicable', contributes: false, score: null, grade: null });
  });
});

test('a late financial DQ can retain a supported Discovery miss without penalizing Close', function () {
  const row = rowWithStates({
    discovery: stage('expected_but_missed', 35, 'D'),
    close: stage('not_applicable', null, null),
  }, { discovery_score: 35, close_score_earned: 0 });
  assert.deepEqual(S.stageMetric(row, 'discovery'), { state: 'expected_but_missed', contributes: true, score: 35, grade: 'D' });
  assert.deepEqual(S.stageMetric(row, 'close'), { state: 'not_applicable', contributes: false, score: null, grade: null });
});

test('no objection, no pitch, continuation, and cutoff states do not fabricate failures', function () {
  const noObjection = rowWithStates({ objection: stage('not_applicable', null, null) }, { objection_score: 0 });
  const noPitch = rowWithStates({ pitch: stage('unmeasured', null, null) }, { pitch_score: 0 });
  const continuation = rowWithStates({ close: stage('not_applicable', null, null) }, { close_score_earned: 0 });
  const cutoff = rowWithStates({ discovery: stage('unmeasured', null, null) }, { discovery_score: 0 });
  assert.deepEqual(S.stageMetric(noObjection, 'objection'), { state: 'not_applicable', contributes: false, score: null, grade: null });
  assert.deepEqual(S.stageMetric(noPitch, 'pitch'), { state: 'unmeasured', contributes: false, score: null, grade: null });
  assert.deepEqual(S.stageMetric(continuation, 'close'), { state: 'not_applicable', contributes: false, score: null, grade: null });
  assert.deepEqual(S.stageMetric(cutoff, 'discovery'), { state: 'unmeasured', contributes: false, score: null, grade: null });
});

test('a follow-up contributes only its stage work that was actually due', function () {
  const followUp = rowWithStates({
    discovery: stage('evaluated', 76, 'B'),
    pitch: stage('not_applicable', null, null),
    objection: stage('not_applicable', null, null),
    close: stage('not_applicable', null, null),
  }, { discovery_score: 76, pitch_score: 0, objection_score: 0, close_score_earned: 0 });
  assert.equal(S.stageMetric(followUp, 'discovery').contributes, true);
  ['pitch', 'objection', 'close'].forEach(function (section) {
    assert.equal(S.stageMetric(followUp, section).contributes, false);
  });
});
