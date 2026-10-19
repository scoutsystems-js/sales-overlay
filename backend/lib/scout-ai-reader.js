'use strict';

// The only database reader Scout AI will receive in its first release.  It is
// deliberately narrow: a caller asks about one verified closer, one bounded
// date range, and one objection category or exact phrase.  Models do not get a
// database client, SQL, or arbitrary transcript access.
var { CHUNK } = require('./chunk');
var { realCallsOnly } = require('./real-calls');
var facts = require('./scout-ai-facts');

var PAGE_SIZE = 1000;
var MAX_PAGES = 25;

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

module.exports = {
  validateRequest: validateRequest,
  validateTeamRequest: validateTeamRequest,
  readObjectionCohort: readObjectionCohort,
  readTeamObjections: readTeamObjections,
};
