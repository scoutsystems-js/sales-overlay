'use strict';

// Read-only facts for Scout AI.  This module deliberately contains no database
// access and no model calls: every answer starts from saved Scout evidence.
var { strictObjections } = require('./objection-strict');
var { countObjections } = require('./objection-handled');
var { closeRateForCalls } = require('./prospect-entity');
var { OBJECTION_CATEGORIES } = require('./objection-categories');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function momentText(row) {
  return [row && row.objection_surface, row && row.quote]
    .map(normalizeText)
    .filter(Boolean)
    .join('\n');
}

function matchesPhrase(row, phrase) {
  var needle = normalizeText(phrase);
  return !!needle && momentText(row).indexOf(needle) !== -1;
}

function matchesCohort(row, filter) {
  filter = filter || {};
  if (!row || row.type !== 'objection') return false;
  if (filter.category && normalizeText(row.objection_category) !== normalizeText(filter.category)) return false;
  if (filter.phrase && !matchesPhrase(row, filter.phrase)) return false;
  return true;
}

function cohortRows(rows, filter) {
  return strictObjections(rows).filter(function (row) {
    return matchesCohort(row, filter);
  });
}

// This is an objection-HANDLE rate.  It is intentionally not a close rate:
// phrase-specific closing cohorts need the prospect-identity/anchor definition
// used elsewhere in Scout and will be added only through that shared path.
function summarizeObjectionCohort(rows, outcomeByCall, filter) {
  var matched = cohortRows(rows, filter);
  var counts = countObjections(matched, outcomeByCall);
  return {
    kind: 'objection_handle_cohort',
    category: filter && filter.category ? normalizeText(filter.category) : null,
    phrase: filter && filter.phrase ? normalizeText(filter.phrase) : null,
    total: counts.total,
    handled: counts.handled,
    rate: counts.rate,
    definition: 'handled objections divided by documented objections in this requested cohort',
  };
}

// A requested phrase cohort is a different question from Scout's normal
// date-window close rate.  The cohort is formed from saved objection moments in
// the requested range; once a prospect is in that cohort, all known calls for
// that prospect determine whether the prospect ultimately closed.  The caller
// must label this distinction in the answer rather than replacing any standard
// close-rate surface with it.
function summarizeCohortCloseRate(rows, calls, filter) {
  var callById = {};
  (Array.isArray(calls) ? calls : []).forEach(function (call) {
    if (call && call.id) callById[call.id] = call;
  });

  var prospectIds = {};
  var missingProspect = 0;
  cohortRows(rows, filter).forEach(function (row) {
    var call = callById[row.fathom_call_id];
    if (!call || !call.prospect_id) { missingProspect++; return; }
    prospectIds[call.prospect_id] = true;
  });

  var cohortCalls = (Array.isArray(calls) ? calls : []).filter(function (call) {
    return !!(call && call.prospect_id && prospectIds[call.prospect_id]);
  });
  var rate = closeRateForCalls(cohortCalls);
  return {
    kind: 'objection_cohort_close_rate',
    category: filter && filter.category ? normalizeText(filter.category) : null,
    phrase: filter && filter.phrase ? normalizeText(filter.phrase) : null,
    closed: rate.closed,
    total: rate.total,
    rate: rate.pct,
    excluded_missing_prospect: missingProspect,
    definition: 'closed prospects divided by prospects with a documented requested objection cohort; known calls for each matched prospect determine outcome',
  };
}

// Examples teach from the saved moment, not from a call outcome.  A closed call
// may inform the normal handle-rate metric, but it cannot prove this moment was
// handled well enough to be a coaching example.
function selectObjectionExamples(rows, callsById, filter, state, limit) {
  var wanted = state === 'handled' ? 'handled' : 'not_handled';
  var seenCalls = new Set();
  var maximum = Math.min(Math.max(Number(limit) || 3, 1), 3);
  return cohortRows(rows, filter).filter(function (row) {
    if (wanted === 'handled') return row.resolution === 'handled';
    return row.resolution === 'partial' || row.resolution === 'unhandled';
  }).filter(function (row) {
    if (seenCalls.has(row.fathom_call_id)) return false;
    seenCalls.add(row.fathom_call_id);
    return true;
  }).slice(0, maximum).map(function (row) {
    var call = (callsById && callsById[row.fathom_call_id]) || {};
    return {
      call_id: row.fathom_call_id,
      prospect_name: call.prospect_name || null,
      call_date: call.call_date || null,
      recording_url: call.recording_url || null,
      timestamp_seconds: Number.isFinite(row.timestamp_seconds) ? row.timestamp_seconds : null,
      quote: row.quote || null,
      objection_surface: row.objection_surface || null,
      objection_category: row.objection_category || null,
      resolution: row.resolution || null,
    };
  });
}

// This is a factual team overview, not an AI interpretation of what “biggest”
// means.  It returns both the category raised most often and the category with
// the lowest documented handle rate so the writer can distinguish volume from
// difficulty in plain language.
function summarizeTeamObjections(rows, outcomeByCall) {
  var categories = {};
  OBJECTION_CATEGORIES.forEach(function (category) {
    categories[category.key] = { category: category.key, total: 0, handled: 0, rate: null };
  });
  var grouped = {};
  strictObjections(rows).forEach(function (row) {
    var key = Object.prototype.hasOwnProperty.call(categories, row.objection_category) ? row.objection_category : 'other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });
  Object.keys(grouped).forEach(function (key) {
    var counts = countObjections(grouped[key], outcomeByCall);
    categories[key] = {
      category: key,
      total: counts.total,
      handled: counts.handled,
      rate: counts.rate,
    };
  });
  var populated = Object.keys(categories).map(function (key) { return categories[key]; })
    .filter(function (category) { return category.total > 0; });
  var mostRaised = populated.slice().sort(function (a, b) {
    return b.total - a.total || OBJECTION_CATEGORIES.map(function (c) { return c.key; }).indexOf(a.category) - OBJECTION_CATEGORIES.map(function (c) { return c.key; }).indexOf(b.category);
  })[0] || null;
  var leastHandled = populated.slice().sort(function (a, b) {
    return a.rate - b.rate || b.total - a.total || OBJECTION_CATEGORIES.map(function (c) { return c.key; }).indexOf(a.category) - OBJECTION_CATEGORIES.map(function (c) { return c.key; }).indexOf(b.category);
  })[0] || null;
  return {
    kind: 'team_objection_overview',
    total: populated.reduce(function (sum, category) { return sum + category.total; }, 0),
    categories: categories,
    most_raised: mostRaised,
    least_handled: leastHandled,
    definition: 'documented true objections in the requested date range; handled means the saved moment was handled or its call closed',
  };
}

function summarizeTeamObjectionLeaderboard(rows, outcomeByCall, category, namesByUserId) {
  var requestedCategory = normalizeText(category);
  var grouped = {};
  strictObjections(rows).forEach(function (row) {
    if (normalizeText(row.objection_category) !== requestedCategory || !row.user_id) return;
    if (!grouped[row.user_id]) grouped[row.user_id] = [];
    grouped[row.user_id].push(row);
  });
  var leaders = Object.keys(grouped).map(function (userId) {
    var counts = countObjections(grouped[userId], outcomeByCall);
    return {
      user_id: userId,
      name: (namesByUserId && namesByUserId[userId]) || 'Closer name not recorded',
      handled: counts.handled,
      total: counts.total,
      rate: counts.rate,
    };
  }).sort(function (a, b) {
    return b.rate - a.rate || b.total - a.total || a.name.localeCompare(b.name);
  });
  return {
    kind: 'team_objection_leaderboard',
    category: requestedCategory,
    leaders: leaders,
    definition: 'closers ranked by documented objection handling rate for the requested category; handled means the saved moment was handled or its call closed',
  };
}

module.exports = {
  matchesPhrase: matchesPhrase,
  matchesCohort: matchesCohort,
  cohortRows: cohortRows,
  summarizeObjectionCohort: summarizeObjectionCohort,
  summarizeCohortCloseRate: summarizeCohortCloseRate,
  selectObjectionExamples: selectObjectionExamples,
  summarizeTeamObjections: summarizeTeamObjections,
  summarizeTeamObjectionLeaderboard: summarizeTeamObjectionLeaderboard,
};
