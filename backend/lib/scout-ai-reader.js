'use strict';

// The only database reader Scout AI will receive in its first release.  It is
// deliberately narrow: a caller asks about one verified closer, one bounded
// date range, and one objection category or exact phrase.  Models do not get a
// database client, SQL, or arbitrary transcript access.
var { CHUNK } = require('./chunk');
var { realCallsOnly } = require('./real-calls');
var { fetchProspectCloseRates } = require('./prospect-entity');
var { SECTION_ORDER, LABELS, sectionStatsFromAnalyses, rankSections } = require('./section-ranking');
var stageCoachingEvidence = require('./stage-coaching-evidence');
var facts = require('./scout-ai-facts');
var { computeObjectionSynthesis } = require('./objection-synthesis');
var { comparisonFromSavedCoaching } = require('./scout-ai-coaching-comparison');

var PAGE_SIZE = 1000;
var MAX_PAGES = 25;
var EVIDENCE_STAGES = ['discovery', 'pitch', 'close'];
var EVIDENCE_LABELS = {
  discovery: ['Prospect context', 'Closer digs deeper', 'Prospect detail'],
  pitch: ['Prospect question', 'Closer explains', 'Prospect confirmation'],
  close: ['Closer asks', 'Prospect response', 'Closer next move'],
};

function validIso(value) {
  return typeof value === 'string' && !isNaN(Date.parse(value));
}

function validateRequest(input) {
  input = input || {};
  if (!input.userId || typeof input.userId !== 'string') throw new Error('A closer is required.');
  if (!validIso(input.from) || !validIso(input.to) || input.from > input.to) throw new Error('A valid date range is required.');
  if (!input.filter || (!input.filter.phrase && !input.filter.category)) throw new Error('An objection phrase or category is required.');
  return input;
}

function validateTeamRequest(input) {
  input = input || {};
  if (!Array.isArray(input.userIds) || input.userIds.length === 0 || input.userIds.some(function (id) { return typeof id !== 'string' || !id; })) {
    throw new Error('At least one closer is required.');
  }
  if (!validIso(input.from) || !validIso(input.to) || input.from > input.to) throw new Error('A valid date range is required.');
  return input;
}

function validateStageRequest(input) {
  input = validateTeamRequest(input);
  if (input.stage != null && SECTION_ORDER.indexOf(input.stage) === -1) throw new Error('A valid sales stage is required.');
  return input;
}

async function paged(read) {
  var out = [];
  for (var page = 0; page < MAX_PAGES; page++) {
    var result = await read(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message || 'Scout AI data read failed.');
    var rows = result.data || [];
    out = out.concat(rows);
    if (rows.length < PAGE_SIZE) return out;
  }
  throw new Error('Scout AI data set is too large for one answer. Narrow the date range.');
}

async function chunked(ids, read) {
  var all = [];
  for (var i = 0; i < ids.length; i += CHUNK) {
    var result = await read(ids.slice(i, i + CHUNK));
    if (result.error) throw new Error(result.error.message || 'Scout AI data read failed.');
    all = all.concat(result.data || []);
  }
  return all;
}

function baseCalls(admin, userId) {
  return admin.from('fathom_calls')
    .select('id, user_id, fathom_call_id, prospect_id, title, call_date, recording_url, not_a_sales_call, duplicate_of')
    .eq('user_id', userId)
    .not('not_a_sales_call', 'is', true)
    .is('duplicate_of', null);
}

function baseTeamCalls(admin, userIds) {
  return admin.from('fathom_calls')
    .select('id, user_id, fathom_call_id, prospect_id, title, call_date, recording_url, not_a_sales_call, duplicate_of')
    .in('user_id', userIds)
    .not('not_a_sales_call', 'is', true)
    .is('duplicate_of', null);
}

async function callsInWindow(admin, input) {
  var rows = await paged(function (from, to) {
    return baseCalls(admin, input.userId)
      .gte('call_date', input.from)
      .lte('call_date', input.to)
      .order('call_date', { ascending: false })
      .range(from, to);
  });
  return realCallsOnly(rows);
}

async function highlightsForCalls(admin, callIds) {
  if (!callIds.length) return [];
  return chunked(callIds, function (ids) {
    return admin.from('call_highlights')
      .select('id, fathom_call_id, type, quote, speaker, timestamp_seconds, objection_surface, objection_category, objection_class, resolution')
      .in('fathom_call_id', ids)
      .eq('type', 'objection');
  });
}

async function analysesForCalls(admin, callIds) {
  if (!callIds.length) return [];
  return chunked(callIds, function (ids) {
    return admin.from('call_analyses')
      .select('fathom_call_id, outcome, status')
      .in('fathom_call_id', ids)
      .eq('status', 'done');
  });
}

async function stageAnalysesForCalls(admin, callIds) {
  if (!callIds.length) return [];
  return chunked(callIds, function (ids) {
    return admin.from('call_analyses')
      .select('fathom_call_id, status, intro_score, discovery_score, pitch_score, objection_score, close_score_earned, stage_eligibility')
      .in('fathom_call_id', ids)
      .eq('status', 'done');
  });
}

async function stageHighlightsForCalls(admin, callIds) {
  if (!callIds.length) return [];
  return chunked(callIds, function (ids) {
    return admin.from('call_highlights')
      .select('fathom_call_id, section, timestamp_seconds, coaching_evidence')
      .in('fathom_call_id', ids);
  });
}

async function fullProspectHistory(admin, input, prospectIds) {
  if (!prospectIds.length) return [];
  var rows = await chunked(prospectIds, function (ids) {
    return baseCalls(admin, input.userId).in('prospect_id', ids);
  });
  return realCallsOnly(rows);
}

function outcomesByCall(analyses) {
  var out = {};
  (analyses || []).forEach(function (row) {
    if (row && row.fathom_call_id) out[row.fathom_call_id] = row.outcome || null;
  });
  return out;
}

function callsById(calls) {
  var out = {};
  (calls || []).forEach(function (call) {
    if (!call || !call.id) return;
    out[call.id] = {
      prospect_name: call.title || null,
      call_date: call.call_date || null,
      recording_url: call.recording_url || null,
    };
  });
  return out;
}

async function readObjectionCohort(admin, request) {
  var input = validateRequest(request);
  var windowCalls = await callsInWindow(admin, input);
  var windowCallIds = windowCalls.map(function (call) { return call.id; });
  var moments = await highlightsForCalls(admin, windowCallIds);
  var matching = facts.cohortRows(moments, input.filter);
  var prospectIds = [];
  var byCall = {};
  windowCalls.forEach(function (call) { byCall[call.id] = call; });
  matching.forEach(function (moment) {
    var call = byCall[moment.fathom_call_id];
    if (call && call.prospect_id && prospectIds.indexOf(call.prospect_id) === -1) prospectIds.push(call.prospect_id);
  });
  var historyCalls = await fullProspectHistory(admin, input, prospectIds);
  var allCalls = windowCalls.slice();
  historyCalls.forEach(function (call) {
    if (!byCall[call.id]) allCalls.push(call);
  });
  var analyses = await analysesForCalls(admin, allCalls.map(function (call) { return call.id; }));
  var outcomeByCall = outcomesByCall(analyses);
  allCalls.forEach(function (call) { call.outcome = outcomeByCall[call.id] || null; });

  return {
    kind: 'objection_cohort',
    window: { from: input.from, to: input.to },
    filter: { phrase: input.filter.phrase || null, category: input.filter.category || null },
    calls_in_window: windowCalls.length,
    matching_moments: matching.length,
    objection_handle_rate: facts.summarizeObjectionCohort(moments, outcomeByCall, input.filter),
    close_rate: facts.summarizeCohortCloseRate(moments, allCalls, input.filter),
    handled_examples: facts.selectObjectionExamples(moments, callsById(windowCalls), input.filter, 'handled'),
    not_handled_examples: facts.selectObjectionExamples(moments, callsById(windowCalls), input.filter, 'not_handled'),
  };
}

// The comparison language is already generated and guarded by the personal
// Objections coaching lane. Reuse it here rather than asking a second model to
// summarize the same calls. The accompanying examples remain direct facts.
async function readObjectionCoachingComparison(admin, request) {
  var input = validateRequest({
    userId: request && request.userId,
    from: request && request.from,
    to: request && request.to,
    filter: { category: request && request.category },
  });
  var cohort = await readObjectionCohort(admin, input);
  var synthesis = await computeObjectionSynthesis(admin, input.userId, input.from, input.to);
  return comparisonFromSavedCoaching({
    cohort: cohort,
    synthesis: synthesis,
    userId: input.userId,
    name: request && request.name,
    category: input.filter.category,
  });
}

async function readTeamObjections(admin, request) {
  var input = validateTeamRequest(request);
  var calls = await paged(function (from, to) {
    return baseTeamCalls(admin, input.userIds)
      .gte('call_date', input.from)
      .lte('call_date', input.to)
      .order('call_date', { ascending: false })
      .range(from, to);
  });
  calls = realCallsOnly(calls);
  var callIds = calls.map(function (call) { return call.id; });
  var moments = await highlightsForCalls(admin, callIds);
  var analyses = await analysesForCalls(admin, callIds);
  var overview = facts.summarizeTeamObjections(moments, outcomesByCall(analyses));
  overview.window = { from: input.from, to: input.to };
  overview.calls_in_window = calls.length;
  overview.closer_count = input.userIds.length;
  return overview;
}

async function readTeamObjectionLeaderboard(admin, request) {
  var input = validateTeamRequest(request);
  if (typeof input.category !== 'string' || !input.category.trim()) throw new Error('An objection category is required.');
  var calls = await paged(function (from, to) {
    return baseTeamCalls(admin, input.userIds)
      .gte('call_date', input.from)
      .lte('call_date', input.to)
      .order('call_date', { ascending: false })
      .range(from, to);
  });
  calls = realCallsOnly(calls);
  var callById = {};
  calls.forEach(function (call) { callById[call.id] = call; });
  var moments = await highlightsForCalls(admin, calls.map(function (call) { return call.id; }));
  moments.forEach(function (moment) {
    var call = callById[moment.fathom_call_id];
    if (call) moment.user_id = call.user_id;
  });
  var analyses = await analysesForCalls(admin, calls.map(function (call) { return call.id; }));
  var leaderboard = facts.summarizeTeamObjectionLeaderboard(moments, outcomesByCall(analyses), input.category, input.namesByUserId || {});
  // A closed outcome may count toward the documented rate, but it never proves
  // an objection was handled well enough to teach from. Supporting calls stay
  // limited to saved moments explicitly marked handled, for the top closer.
  var best = leaderboard.leaders[0];
  var bestCalls = calls.filter(function (call) { return best && call.user_id === best.user_id; });
  var bestMoments = moments.filter(function (moment) { return best && moment.user_id === best.user_id; });
  leaderboard.handled_examples = facts.selectObjectionExamples(bestMoments, callsById(bestCalls), { category: input.category }, 'handled');
  leaderboard.window = { from: input.from, to: input.to };
  leaderboard.calls_in_window = calls.length;
  return leaderboard;
}

// This deliberately calls the one close-rate computation used by Scout's
// existing performance views. The rate's window is the prospect's first booked
// call, not whichever later follow-up happened to close it.
async function readCloserCloseRate(admin, request) {
  var input = validateTeamRequest({ userIds: [request && request.userId], from: request && request.from, to: request && request.to });
  var rates = await fetchProspectCloseRates(admin, input.userIds, input.from, input.to);
  return {
    kind: 'closer_close_rate',
    window: { from: input.from, to: input.to },
    close_rate: rates[input.userIds[0]] || { closed: 0, total: 0, pct: null },
  };
}

// Stage scores come from the same eligibility-aware score calculation as the
// coaching and performance views. A sparse stage remains unranked rather than
// becoming a made-up weakness.
async function readStagePerformance(admin, request) {
  var input = validateStageRequest(request);
  var calls = await paged(function (from, to) {
    return baseTeamCalls(admin, input.userIds)
      .gte('call_date', input.from)
      .lte('call_date', input.to)
      .order('call_date', { ascending: false })
      .range(from, to);
  });
  calls = realCallsOnly(calls);
  var analyses = await stageAnalysesForCalls(admin, calls.map(function (call) { return call.id; }));
  var byUser = {};
  input.userIds.forEach(function (userId) { byUser[userId] = []; });
  var callById = {};
  calls.forEach(function (call) { callById[call.id] = call; });
  analyses.forEach(function (analysis) {
    var call = callById[analysis.fathom_call_id];
    if (call && byUser[call.user_id]) byUser[call.user_id].push(analysis);
  });
  var stages = input.stage ? [input.stage] : SECTION_ORDER;
  var closers = input.userIds.map(function (userId) {
    var ranked = rankSections(sectionStatsFromAnalyses(byUser[userId] || []));
    var stageRows = stages.map(function (stage) {
      var row = ranked.find(function (item) { return item.section === stage; });
      return {
        stage: stage,
        label: LABELS[stage],
        score: row && row.score != null ? row.score : null,
        graded_calls: row ? row.n : 0,
        enough: !!(row && row.enough),
        reason: row ? row.reason : 'no graded calls in this period',
      };
    });
    return {
      user_id: userId,
      name: (input.namesByUserId && input.namesByUserId[userId]) || 'Closer name not recorded',
      stages: stageRows,
    };
  });
  if (input.stage) {
    closers = closers.map(function (closer) {
      var stage = closer.stages[0];
      return { user_id: closer.user_id, name: closer.name, score: stage.score, graded_calls: stage.graded_calls, enough: stage.enough, reason: stage.reason };
    }).filter(function (closer) { return closer.enough; }).sort(function (left, right) {
      return left.score - right.score || left.name.localeCompare(right.name);
    });
  }
  var priority = null;
  if (!input.stage) {
    var candidates = closers.flatMap(function (closer) {
      return closer.stages.filter(function (stage) { return stage.enough && stage.score != null; }).map(function (stage) {
        return {
          user_id: closer.user_id,
          name: closer.name,
          stage: stage.stage,
          label: stage.label,
          score: stage.score,
          graded_calls: stage.graded_calls,
        };
      });
    });
    if (candidates.length) {
      var lowestScore = Math.min.apply(null, candidates.map(function (candidate) { return candidate.score; }));
      priority = { ties: candidates.filter(function (candidate) { return candidate.score === lowestScore; }) };
    }
  }
  return {
    kind: 'stage_performance',
    window: { from: input.from, to: input.to },
    stage: input.stage || null,
    priority: priority,
    closers: closers,
  };
}

// These exchanges were verified against the stored transcript when the call
// was analyzed. The reader exposes that small saved record only; it never asks
// the model to read a transcript or infer why a score or outcome happened.
function savedStageExchange(value, stage) {
  var evidence = stageCoachingEvidence.sanitize(value, stage);
  var shape = stageCoachingEvidence.SHAPES[stage];
  if (!evidence || !shape) return null;
  return shape.map(function (part, index) {
    return { label: EVIDENCE_LABELS[stage][index], speaker: part[1], quote: evidence[part[0]].quote };
  });
}

async function readStageExamples(admin, request) {
  var input = validateStageRequest(request);
  if (EVIDENCE_STAGES.indexOf(input.stage) === -1) throw new Error('Saved call examples are currently available for Discovery, Pitch, or Close.');
  var calls = await paged(function (from, to) {
    return baseTeamCalls(admin, input.userIds)
      .gte('call_date', input.from)
      .lte('call_date', input.to)
      .order('call_date', { ascending: false })
      .range(from, to);
  });
  calls = realCallsOnly(calls);
  var callById = {};
  calls.forEach(function (call) { callById[call.id] = call; });
  var highlights = await stageHighlightsForCalls(admin, calls.map(function (call) { return call.id; }));
  var examples = highlights.map(function (highlight) {
    var call = callById[highlight.fathom_call_id];
    if (!call || highlight.section !== input.stage) return null;
    var exchange = savedStageExchange(highlight.coaching_evidence, input.stage);
    if (!exchange) return null;
    return {
      call_id: call.id,
      closer_name: (input.namesByUserId && input.namesByUserId[call.user_id]) || 'Closer name not recorded',
      prospect_name: call.title || null,
      call_date: call.call_date || null,
      recording_url: call.recording_url || null,
      timestamp_seconds: highlight.timestamp_seconds == null ? null : highlight.timestamp_seconds,
      exchange: exchange,
    };
  }).filter(Boolean).sort(function (left, right) {
    return String(right.call_date || '').localeCompare(String(left.call_date || '')) || left.call_id.localeCompare(right.call_id);
  }).slice(0, 3);
  return {
    kind: 'stage_examples',
    window: { from: input.from, to: input.to },
    stage: input.stage,
    calls_in_window: calls.length,
    examples: examples,
  };
}

module.exports = {
  validateRequest: validateRequest,
  validateTeamRequest: validateTeamRequest,
  validateStageRequest: validateStageRequest,
  readObjectionCohort: readObjectionCohort,
  readObjectionCoachingComparison: readObjectionCoachingComparison,
  readTeamObjections: readTeamObjections,
  readTeamObjectionLeaderboard: readTeamObjectionLeaderboard,
  readCloserCloseRate: readCloserCloseRate,
  readStagePerformance: readStagePerformance,
  readStageExamples: readStageExamples,
};
