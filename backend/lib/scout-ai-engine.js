'use strict';

// This module is the model boundary for Scout AI.  It deliberately gives the
// model a short list of named Scout tools, never a database client or a raw
// transcript.  The model chooses what to ask for; Scout computes the facts.

const CATEGORIES = ['fear', 'timing', 'partner', 'logistical', 'other'];
const STAGES = ['intro', 'discovery', 'pitch', 'objection', 'close'];
const EVIDENCE_STAGES = STAGES;
const STAGE_LABELS = { intro: 'Intro', discovery: 'Discovery', pitch: 'Pitch', objection: 'Objection Handling', close: 'Close' };

const COHORT_TOOL = {
  name: 'read_objection_cohort',
  description: 'Read verified Scout evidence for one closer and one documented objection phrase or category. Use for questions about how often a closer handled an objection, how often those prospects closed, or examples of handled and not-handled objections.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list. Omit when the user did not name a closer; Scout will draw examples from the authorized team.' },
      phrase: { type: 'string', description: 'Exact objection phrase to match, such as spouse or think about it. Omit if asking about a whole category.' },
      category: { type: 'string', enum: CATEGORIES, description: 'Canonical Scout objection category. Omit if a phrase is requested.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: [],
  },
};

const OBJECTION_COACHING_COMPARISON_TOOL = {
  name: 'read_objection_coaching_comparison',
  description: 'Compare one closer’s saved coaching patterns for one canonical objection category. Use for questions about what they do when that objection is handled versus what happens when it is not handled. The comparison is available only when Scout has saved repeated evidence; otherwise say so plainly.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list.' },
      category: { type: 'string', enum: CATEGORIES, description: 'Canonical Scout objection category.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: ['user_id', 'category'],
  },
};

const TEAM_OBJECTIONS_TOOL = {
  name: 'read_team_objections',
  description: 'Read verified Scout totals for the active closer group. Use for questions about which documented objection is raised most often or handled least often across the group.',
  input_schema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
  },
};

const TEAM_OBJECTION_LEADERBOARD_TOOL = {
  name: 'read_team_objection_leaderboard',
  description: 'Read verified per-closer handling rates for one canonical objection category. Use when asked which closer or closers handle a category best.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: CATEGORIES, description: 'The canonical Scout objection category to rank.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: ['category'],
  },
};

const CLOSER_CLOSE_RATE_TOOL = {
  name: 'read_closer_close_rate',
  description: 'Read Scout’s canonical prospect close rate for one closer. Use for questions about a closer’s overall closing rate in a date range.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: ['user_id'],
  },
};

const STAGE_PERFORMANCE_TOOL = {
  name: 'read_stage_performance',
  description: 'Read earned sales-stage scores for one closer or the authorized closer group. Use for questions about Discovery, Intro, Pitch, Objection Handling, or Close performance. For who needs the most coaching overall, omit both user_id and stage: Scout returns one complete, tied-safe priority from all eligible stages. When comparing who needs help with one stage, provide that stage and omit user_id.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list. Omit to compare the authorized group.' },
      stage: { type: 'string', enum: STAGES, description: 'One sales stage. Omit only when asking for one closer’s full stage breakdown.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
  },
};

const STAGE_EXAMPLES_TOOL = {
  name: 'read_stage_examples',
  description: 'Read up to three saved, verified call moments for Intro, Discovery, Pitch, Objection Handling, or Close. Use when asked to show a closer’s calls or exact examples for one stage. The saved moment is evidence only; do not claim it caused a score or outcome.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list. Omit to show examples from the authorized group.' },
      stage: { type: 'string', enum: EVIDENCE_STAGES, description: 'Intro, Discovery, Pitch, Objection Handling, or Close.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: ['stage'],
  },
};

const CALL_EXAMPLES_TOOL = {
  name: 'read_call_examples',
  description: 'Read up to five real calls for one closer using existing Scout Calls and Objections records. Outcomes are distinct: lost is a deal that ended without a path forward, follow_up is still open, and no_show had no meaningful conversation. For the exact phrase “not closed,” return a breakdown first instead of mixing those outcomes into one call list.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list.' },
      phrase: { type: 'string', description: 'Exact objection phrase to match. Omit if category is used.' },
      category: { type: 'string', enum: CATEGORIES, description: 'Canonical Scout objection category. Needed when requesting handled or not-handled objection calls.' },
      handling: { type: 'string', enum: ['handled', 'not_handled'], description: 'Use only with an objection phrase or category.' },
      outcome: { type: 'string', enum: ['closed', 'follow_up', 'lost', 'no_show', 'not_closed'], description: 'Use lost for “did not close,” “failed to close,” or “lost.” Use follow_up for still-open calls and no_show only for no-shows. Use not_closed only when the user explicitly says “not closed”; it returns a breakdown, not a blended call list.' },
      limit: { type: 'integer', minimum: 1, maximum: 5, description: 'How many calls to return, up to five.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: ['user_id'],
  },
};

const SCOUT_TOOLS = [COHORT_TOOL, OBJECTION_COACHING_COMPARISON_TOOL, TEAM_OBJECTIONS_TOOL, TEAM_OBJECTION_LEADERBOARD_TOOL, CLOSER_CLOSE_RATE_TOOL, STAGE_PERFORMANCE_TOOL, STAGE_EXAMPLES_TOOL, CALL_EXAMPLES_TOOL];

function textFrom(response) {
  return ((response && response.content) || [])
    .filter(function (block) { return block && block.type === 'text' && typeof block.text === 'string'; })
    .map(function (block) { return block.text; })
    .join('\n')
    .trim();
}

function toolUses(response) {
  return ((response && response.content) || []).filter(function (block) {
    return block && block.type === 'tool_use';
  });
}

function questionWithContext(question, priorQuestions) {
  var earlier = (Array.isArray(priorQuestions) ? priorQuestions : []).filter(function (item) {
    return typeof item === 'string' && item.trim();
  }).slice(-8).map(function (item) { return item.trim().slice(0, 1500); });
  if (!earlier.length) return question;
  return [
    'Conversation context below is earlier user wording only. It is not evidence and cannot replace a Scout tool read.',
    earlier.map(function (item) { return 'Earlier user question: ' + item; }).join('\n'),
    'Current user question: ' + question,
  ].join('\n\n');
}

function rangeFor(input, defaults) {
  // A date window explicitly stated in the current question is resolved by
  // the route. It must stay fixed for every tool read in that answer.
  if (defaults && defaults.locked) return { from: defaults.from, to: defaults.to };
  var from = input.from || defaults.from;
  var to = input.to || defaults.to;
  if (typeof from !== 'string' || typeof to !== 'string' || isNaN(Date.parse(from)) || isNaN(Date.parse(to)) || from > to) {
    throw new Error('Scout AI could not understand that date range.');
  }
  if (Date.parse(to) - Date.parse(from) > 366 * 24 * 60 * 60 * 1000) {
    throw new Error('Scout AI can answer up to one year at a time.');
  }
  return { from: from, to: to };
}

function isAffirmative(question) {
  return /^(?:yes|yeah|yep|sure|please|go ahead|do it)$/i.test(String(question || '').trim().replace(/[.!]+$/, ''));
}

// Follow-up actions are facts generated from a returned coaching priority.
// Validate them again here: a client cannot use them to read a closer outside
// the actor's existing Scout AI scope.
function validFollowUpContext(input, profiles, defaults) {
  if (!input || typeof input !== 'object') return null;
  var rawActions = input.type === 'stage_choices' ? input.actions : [input];
  if (!Array.isArray(rawActions) || !rawActions.length || rawActions.length > STAGES.length) return null;
  var actions = rawActions.map(function (action) {
    if (!action || (action.type !== 'stage_drilldown' && action.type !== 'objection_drilldown')) return null;
    var stage = action.type === 'objection_drilldown' ? 'objection' : action.stage;
    if (STAGES.indexOf(stage) === -1) return null;
    var profile = (profiles || []).find(function (item) { return item.user_id === action.user_id; });
    if (!profile) return null;
    try {
      var range = rangeFor({ from: action.from, to: action.to }, defaults);
      return { type: 'stage_drilldown', userId: profile.user_id, name: profile.name, stage: stage, label: STAGE_LABELS[stage], range: range };
    } catch (_) { return null; }
  });
  if (actions.some(function (action) { return !action; })) return null;
  return actions.length === 1 ? actions[0] : { type: 'stage_choices', actions: actions };
}

function categorySentence(item, label) {
  if (!item || item.rate == null) return '';
  var category = String(item.category || 'This category');
  category = category.charAt(0).toUpperCase() + category.slice(1);
  return category + ' was ' + label + ': ' + item.handled + ' of ' + item.total + ' handled (' + item.rate + '%).';
}

function objectionDrilldownAnswer(overview, comparison) {
  var closer = (overview.closer && overview.closer.name) || 'This closer';
  var answer = closer + '’s saved objection breakdown is based on ' + overview.total + ' documented objections in this date range. ';
  answer += categorySentence(overview.most_raised, 'raised most often') + ' ';
  answer += categorySentence(overview.least_handled, 'handled least often');
  if (comparison && (comparison.when_handled || comparison.when_not_handled)) {
    var category = String(comparison.category || overview.least_handled.category || 'this objection');
    category = category.charAt(0).toUpperCase() + category.slice(1);
    if (comparison.when_handled) answer += ' When ' + category + ' was handled, Scout’s saved coaching pattern was: ' + comparison.when_handled;
    if (comparison.when_not_handled) answer += ' When it was not handled, Scout’s saved coaching pattern was: ' + comparison.when_not_handled;
  } else if (overview.least_handled && overview.least_handled.total) {
    answer += ' Scout does not yet have enough saved repeated coaching evidence to describe the pattern behind ' + overview.least_handled.category + ' outcomes.';
  }
  return answer.trim();
}

function stageDrilldownAnswer(action, performance, examples) {
  var closer = action.name || 'This closer';
  var score = performance && performance.closers && performance.closers[0];
  var answer = closer + '’s ' + action.label + ' earned score is ' + (score && score.score != null ? score.score : 'not available') + ' across ' + (score && score.graded_calls != null ? score.graded_calls : 0) + ' graded calls in this date range.';
  var count = examples && Array.isArray(examples.examples) ? examples.examples.length : 0;
  answer += count ? ' Scout found ' + count + ' saved ' + action.label + ' call moment' + (count === 1 ? '' : 's') + ' to review below.' : ' Scout does not have a saved ' + action.label + ' call moment to show for this date range yet.';
  return answer;
}

function coachingPriorityAnswer(facts) {
  var ties = facts && facts.priority && Array.isArray(facts.priority.ties) ? facts.priority.ties : [];
  if (!ties.length) return 'Scout does not have enough measured stage data to name one coaching priority for this date range.';
  var labels = ties.map(function (item) {
    return item.name + ' · ' + item.label + ' (' + item.score + ' across ' + item.graded_calls + ' graded calls)';
  });
  if (labels.length === 1) return 'For this date range, Scout’s lowest measured coaching area is ' + labels[0] + '. Review the saved evidence below.';
  return 'For this date range, Scout found a tie for the lowest measured coaching score: ' + labels.join(' and ') + '. The scores do not establish that one area causes the other. Choose an area below to review its saved evidence.';
}

function isPerformanceCoachingQuestion(question) {
  var text = String(question || '').toLowerCase();
  return /(?:what|which|who)\s+(?:closer|rep|person).*(?:needs?|need).*(?:most\s+)?(?:coaching|help)|(?:what|which|who).*(?:most\s+)?(?:coaching|help).*(?:closer|rep|person)/.test(text);
}

function strongestRepeatedObjection(overview) {
  var categories = overview && overview.categories ? Object.keys(overview.categories).map(function (key) { return overview.categories[key]; }) : [];
  return categories.filter(function (item) {
    return item && item.total >= 3 && item.rate != null;
  }).sort(function (left, right) {
    return left.rate - right.rate || right.total - left.total || String(left.category).localeCompare(String(right.category));
  })[0] || null;
}

function dateRangeLabel(window) {
  return String(window && window.from || '').slice(0, 10) + ' through ' + String(window && window.to || '').slice(0, 10);
}

function performanceDiagnosisAnswer(closeRate, focus, window) {
  var name = closeRate.name || 'This closer';
  var answer = 'From ' + dateRangeLabel(window) + ', ' + name + ' has the lowest close rate in the group at ' + closeRate.closed + ' of ' + closeRate.total + ' prospects (' + closeRate.pct + '%). ';
  if (!focus) return answer + 'Scout does not yet have a repeated, documented coaching pattern strong enough to point to one specific area.';
  var category = String(focus.category || 'this category');
  var label = category.charAt(0).toUpperCase() + category.slice(1);
  return answer + label + ' objections are the strongest repeated coaching opportunity in the recorded calls: ' + focus.handled + ' of ' + focus.total + ' were handled (' + focus.rate + '%). That does not prove it caused the low close rate, but it is the clearest repeated gap to review first.';
}

function usableObjectionCalls(result) {
  return ((result && result.calls) || []).filter(function (call) {
    var objection = call && call.objection;
    return objection && typeof objection.quote === 'string' && objection.quote.trim() && typeof objection.closer_response === 'string' && objection.closer_response.trim();
  });
}

async function performanceCoachingDiagnosis(options, profiles, defaults) {
  if (typeof options.readTeamCloseRateLeaderboard !== 'function' || typeof options.readCloserObjectionOverview !== 'function' || typeof options.readCallExamples !== 'function') return null;
  var namesByUserId = {};
  profiles.forEach(function (profile) { namesByUserId[profile.user_id] = profile.name; });
  var leaderboard = await options.readTeamCloseRateLeaderboard({ userIds: Object.keys(namesByUserId), namesByUserId: namesByUserId, from: defaults.from, to: defaults.to });
  var closeRate = leaderboard && leaderboard.closers && leaderboard.closers[0];
  if (!closeRate) return null;
  var overview = await options.readCloserObjectionOverview({ userId: closeRate.user_id, name: closeRate.name, from: defaults.from, to: defaults.to });
  var focus = strongestRepeatedObjection(overview);
  var missed = { calls: [] };
  var handled = { calls: [] };
  if (focus) {
    var reads = await Promise.all([
      options.readCallExamples({ userId: closeRate.user_id, filter: { phrase: null, category: focus.category, handling: 'not_handled', outcome: null }, limit: 2, from: defaults.from, to: defaults.to }),
      options.readCallExamples({ userId: closeRate.user_id, filter: { phrase: null, category: focus.category, handling: 'handled', outcome: null }, limit: 1, from: defaults.from, to: defaults.to }),
    ]);
    missed = reads[0] || missed;
    handled = reads[1] || handled;
  }
  return {
    status: 'answered',
    answer: performanceDiagnosisAnswer(closeRate, focus, leaderboard.window || defaults),
    evidence: {
      kind: 'performance_coaching_diagnosis',
      window: leaderboard.window || defaults,
      closer: { user_id: closeRate.user_id, name: closeRate.name },
      close_rate: closeRate,
      coaching_focus: focus,
      missed_calls: usableObjectionCalls(missed),
      handled_calls: usableObjectionCalls(handled),
    },
    follow_up_context: null,
  };
}

function followUpContextFromFacts(facts) {
  if (!facts || facts.kind !== 'stage_performance' || !facts.priority || !Array.isArray(facts.priority.ties) || !facts.priority.ties.length || !facts.window) return null;
  var actions = facts.priority.ties.map(function (priority) {
    if (!priority || !priority.user_id || STAGES.indexOf(priority.stage) === -1) return null;
    return { type: 'stage_drilldown', user_id: priority.user_id, stage: priority.stage, label: STAGE_LABELS[priority.stage], from: facts.window.from, to: facts.window.to };
  }).filter(Boolean);
  if (!actions.length || actions.length !== facts.priority.ties.length) return null;
  return { type: 'stage_choices', actions: actions };
}

function serializedFollowUp(context) {
  if (!context) return null;
  var actions = context.type === 'stage_choices' ? context.actions : [context];
  return {
    type: 'stage_choices',
    actions: actions.map(function (action) {
      return { type: 'stage_drilldown', user_id: action.userId, stage: action.stage, label: action.label, from: action.range.from, to: action.range.to };
    }),
  };
}

function validToolInput(input, profiles, defaults) {
  input = input || {};
  var validIds = new Set((profiles || []).map(function (profile) { return profile.user_id; }));
  if (!validIds.has(input.user_id)) throw new Error('Scout AI could not match that closer.');
  var phrase = typeof input.phrase === 'string' ? input.phrase.trim() : '';
  var category = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  if (!phrase && CATEGORIES.indexOf(category) === -1) throw new Error('Scout AI needs an objection phrase or category for that question.');
  return {
    userId: input.user_id,
    filter: { phrase: phrase || null, category: category || null },
    range: rangeFor(input, defaults),
  };
}

function validCoachingComparisonToolInput(input, profiles, defaults) {
  input = input || {};
  var userId = input.user_id;
  var profile = (profiles || []).find(function (item) { return item.user_id === userId; });
  if (!profile) throw new Error('Scout AI could not match that closer.');
  var category = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  if (CATEGORIES.indexOf(category) === -1) throw new Error('Scout AI needs a canonical objection category for that comparison.');
  return { userId: userId, name: profile.name, category: category, range: rangeFor(input, defaults) };
}

function validTeamToolInput(input, profiles, defaults) {
  return {
    userIds: (profiles || []).map(function (profile) { return profile.user_id; }),
    range: rangeFor(input || {}, defaults),
  };
}

function validLeaderboardToolInput(input, profiles, defaults) {
  var category = typeof (input || {}).category === 'string' ? input.category.trim().toLowerCase() : '';
  if (CATEGORIES.indexOf(category) === -1) throw new Error('Scout AI needs a canonical objection category to rank closers.');
  var namesByUserId = {};
  (profiles || []).forEach(function (profile) { namesByUserId[profile.user_id] = profile.name; });
  return { userIds: Object.keys(namesByUserId), namesByUserId: namesByUserId, category: category, range: rangeFor(input || {}, defaults) };
}

function validCloseRateToolInput(input, profiles, defaults) {
  input = input || {};
  var userId = input.user_id;
  if (!(profiles || []).some(function (profile) { return profile.user_id === userId; })) throw new Error('Scout AI could not match that closer.');
  return { userId: userId, range: rangeFor(input, defaults) };
}

function validStagePerformanceToolInput(input, profiles, defaults) {
  input = input || {};
  var userId = input.user_id || null;
  if (userId && !(profiles || []).some(function (profile) { return profile.user_id === userId; })) throw new Error('Scout AI could not match that closer.');
  var stage = typeof input.stage === 'string' ? input.stage.trim().toLowerCase() : null;
  if (stage && STAGES.indexOf(stage) === -1) throw new Error('Scout AI needs a valid sales stage for that question.');
  var namesByUserId = {};
  (profiles || []).forEach(function (profile) { namesByUserId[profile.user_id] = profile.name; });
  return {
    userIds: userId ? [userId] : Object.keys(namesByUserId),
    namesByUserId: namesByUserId,
    userId: userId,
    stage: stage,
    range: rangeFor(input, defaults),
  };
}

function validStageExamplesToolInput(input, profiles, defaults) {
  input = input || {};
  var stage = typeof input.stage === 'string' ? input.stage.trim().toLowerCase() : '';
  if (EVIDENCE_STAGES.indexOf(stage) === -1) throw new Error('Scout needs a valid sales stage for those saved call moments.');
  var userId = input.user_id || null;
  if (userId && !(profiles || []).some(function (profile) { return profile.user_id === userId; })) throw new Error('Scout AI could not match that closer.');
  var namesByUserId = {};
  (profiles || []).forEach(function (profile) { namesByUserId[profile.user_id] = profile.name; });
  return {
    userIds: userId ? [userId] : Object.keys(namesByUserId),
    namesByUserId: namesByUserId,
    userId: userId,
    stage: stage,
    range: rangeFor(input, defaults),
  };
}

function currentQuestionNamesCloser(question, profiles) {
  var wording = String(question || '').toLowerCase();
  return (profiles || []).some(function (profile) {
    var name = String(profile.name || '').trim().toLowerCase();
    var first = name.split(/\s+/)[0];
    return (name && wording.indexOf(name) !== -1) || (first && new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(wording));
  });
}

function validCallExamplesToolInput(input, profiles, defaults, forceTeamSample) {
  input = input || {};
  var userId = forceTeamSample ? null : (input.user_id || null);
  if (userId && !(profiles || []).some(function (profile) { return profile.user_id === userId; })) throw new Error('Scout AI could not match that closer.');
  var phrase = typeof input.phrase === 'string' ? input.phrase.trim() : '';
  var category = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  var handling = input.handling === 'handled' || input.handling === 'not_handled' ? input.handling : null;
  var outcome = ['closed', 'follow_up', 'lost', 'no_show', 'not_closed'].indexOf(input.outcome) !== -1 ? input.outcome : null;
  var limit = Number(input.limit == null ? 5 : input.limit);
  if (!phrase && CATEGORIES.indexOf(category) === -1 && !outcome) throw new Error('Scout AI needs an outcome, objection phrase, or category for those calls.');
  if (handling && !phrase && CATEGORIES.indexOf(category) === -1) throw new Error('Scout AI needs an objection phrase or category to filter handling.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Scout AI can return between one and five calls.');
  var userIds = (profiles || []).map(function (profile) { return profile.user_id; });
  var namesByUserId = {};
  (profiles || []).forEach(function (profile) { namesByUserId[profile.user_id] = profile.name; });
  return {
    userId: userId,
    userIds: userId ? [userId] : userIds,
    namesByUserId: namesByUserId,
    filter: { phrase: phrase || null, category: CATEGORIES.indexOf(category) !== -1 ? category : null, handling: handling, outcome: outcome },
    limit: limit,
    range: rangeFor(input, defaults),
  };
}

function systemPrompt(profiles, defaults) {
  var people = (profiles || []).map(function (profile) {
    return profile.user_id + ' — ' + profile.name;
  }).join('\n');
  return [
    'You are Scout AI. Answer only from verified Scout tool results.',
    'You never invent a number, call, quote, outcome, or reason. If the available tool cannot answer the request, say that plainly and do not use a tool.',
    'A phrase such as “spouse” is not the same thing as the whole Partner category. Say which one you used.',
    'Question-specific cohort rates are answer-only. They do not change Scout’s normal dashboard metrics.',
    'When you use a tool, write a short plain-language answer that names the date range and the supporting counts. Distinguish objection handling, close rate, and earned stage scores; they answer different questions.',
    'Do not use Markdown, tables, headings, bullets, asterisks, or invented links. Write short plain sentences for Scout’s conversation view.',
    'The user can open the evidence cards Scout returns separately, so do not make up clips or quotes.',
    'For a team-wide objection question, distinguish the objection raised most often from the objection handled least often. They can be different.',
    'For “who handles a category best,” use the team leaderboard tool once. Do not call one closer tool per person.',
    'For “what does a closer do when an objection works versus when it does not,” use the objection-coaching-comparison tool once for that closer and category. State only the saved repeated patterns it returns; never add a cause, outcome, or pattern that is not present.',
    'For an overall close-rate question, use the closer close-rate tool. For “who needs help with Discovery/Pitch/Close/Intro/Objection Handling,” use the stage-performance tool with that stage and explain that only sufficiently measured scores are ranked. For “who needs the most coaching overall,” use the stage-performance tool exactly once with no stage and no closer, then state the returned priority directly; do not split it into separate stage reads or call a partial result an overall answer. Do not claim that one stage causes, feeds into, or is higher leverage than another unless a Scout fact tool explicitly returned that relationship.',
    'For a request to show saved calls or examples for any sales stage, use the stage-examples tool. Describe only the saved exchange or moment; never say it caused a grade, handling result, or call outcome.',
    'For a request to show specific recent objection calls or calls by outcome, use the call-examples tool. Return the available real calls directly. When the user did not name a closer, omit user_id: Scout will choose a varied sample from the authorized team, rather than asking the user to choose a closer. Do not refuse by describing a tool limitation. “Did not close,” “failed to close,” and “lost” mean lost only. Open follow-ups and no-shows are different outcomes and must never be called lost. For the exact phrase “not closed,” report the returned Lost, Open, and No-show breakdown and ask which group they want to review. A saved objection exchange can support an objection request. For an Open call, use its saved outcome_evidence only when it is present, call it “what kept it open,” and say the deal remains open; never infer a reason from the outcome alone or claim the reason caused a loss.',
    'Default date range: ' + defaults.from + ' through ' + defaults.to + '.',
    'Available closers (use only these ids):\n' + people,
  ].join('\n\n');
}

function evidenceFrom(facts) {
  if (facts && facts.kind === 'objection_coaching_comparison') {
    return {
      kind: facts.kind, window: facts.window, closer: facts.closer, category: facts.category, handle_rate: facts.handle_rate,
      when_handled: facts.when_handled, when_not_handled: facts.when_not_handled,
      handled_examples: facts.handled_examples, not_handled_examples: facts.not_handled_examples,
    };
  }
  if (facts && facts.kind === 'stage_examples') {
    return { kind: facts.kind, window: facts.window, stage: facts.stage, examples: facts.examples };
  }
  if (facts && facts.kind === 'call_examples') {
    return {
      kind: facts.kind,
      window: facts.window,
      filter: facts.filter,
      matching_call_count: facts.matching_call_count,
      outcome_breakdown: facts.outcome_breakdown,
      needs_outcome_choice: facts.needs_outcome_choice,
      calls: facts.calls,
    };
  }
  if (facts && facts.kind === 'closer_close_rate') {
    return { kind: facts.kind, window: facts.window, close_rate: facts.close_rate };
  }
  if (facts && facts.kind === 'stage_performance') {
    return { kind: facts.kind, window: facts.window, stage: facts.stage, priority: facts.priority || null, closers: facts.closers };
  }
  if (facts && facts.kind === 'team_objection_overview') {
    return {
      kind: facts.kind,
      window: facts.window,
      closer_count: facts.closer_count,
      most_raised: facts.most_raised,
      least_handled: facts.least_handled,
      categories: facts.categories,
    };
  }
  if (facts && facts.kind === 'team_objection_leaderboard') {
    return { kind: facts.kind, window: facts.window, category: facts.category, leaders: facts.leaders, handled_examples: facts.handled_examples };
  }
  return {
    kind: facts && facts.kind,
    window: facts.window,
    filter: facts.filter,
    objection_handle_rate: facts.objection_handle_rate,
    close_rate: facts.close_rate,
    handled_examples: facts.handled_examples,
    not_handled_examples: facts.not_handled_examples,
  };
}

async function answerQuestion(options) {
  var question = String((options || {}).question || '').trim();
  if (!question) throw new Error('Ask Scout a question first.');
  if (question.length > 1500) throw new Error('Keep the question under 1,500 characters.');
  if (!options || typeof options.create !== 'function' || typeof options.readObjectionCohort !== 'function') {
    throw new Error('Scout AI is not configured.');
  }
  var profiles = options.profiles || [];
  var defaults = options.defaultRange;
  if (!defaults || !defaults.from || !defaults.to) throw new Error('Scout AI needs a default date range.');
  var followUp = validFollowUpContext(options.followUp, profiles, defaults);
  if (!followUp && isPerformanceCoachingQuestion(question)) {
    var diagnosis = await performanceCoachingDiagnosis(options, profiles, defaults);
    if (diagnosis) return diagnosis;
  }
  if (isAffirmative(question) && followUp) {
    if (followUp.type === 'stage_choices') {
      return {
        status: 'answered',
        answer: 'Choose an area to review: ' + followUp.actions.map(function (action) { return action.name + ' · ' + action.label; }).join(' or ') + '. Scout will show only the saved evidence for the one you select.',
        evidence: null,
        follow_up_context: serializedFollowUp(followUp),
      };
    }
    if (followUp.stage !== 'objection') {
      if (typeof options.readStagePerformance !== 'function' || typeof options.readStageExamples !== 'function') throw new Error('Scout AI is not configured.');
      var namesByUserId = {}; namesByUserId[followUp.userId] = followUp.name;
      var performance = await options.readStagePerformance({
        userIds: [followUp.userId], namesByUserId: namesByUserId, userId: followUp.userId,
        stage: followUp.stage, from: followUp.range.from, to: followUp.range.to,
      });
      var examples = await options.readStageExamples({
        userIds: [followUp.userId], namesByUserId: namesByUserId, userId: followUp.userId,
        stage: followUp.stage, from: followUp.range.from, to: followUp.range.to,
      });
      return {
        status: 'answered', answer: stageDrilldownAnswer(followUp, performance, examples),
        evidence: { kind: 'stage_drilldown', window: examples.window, closer: { user_id: followUp.userId, name: followUp.name }, stage: followUp.stage, score: performance.closers && performance.closers[0] ? performance.closers[0].score : null, graded_calls: performance.closers && performance.closers[0] ? performance.closers[0].graded_calls : 0, examples: examples.examples || [] },
        follow_up_context: null,
      };
    }
    if (typeof options.readCloserObjectionOverview !== 'function') throw new Error('Scout AI is not configured.');
    var overview = await options.readCloserObjectionOverview({
      userId: followUp.userId, name: followUp.name, from: followUp.range.from, to: followUp.range.to,
    });
    var category = overview && overview.least_handled && overview.least_handled.total ? overview.least_handled.category : null;
    var comparison = null;
    if (category && typeof options.readObjectionCoachingComparison === 'function') {
      comparison = await options.readObjectionCoachingComparison({
        userId: followUp.userId, name: followUp.name, category: category, from: followUp.range.from, to: followUp.range.to,
      });
    }
    return {
      status: 'answered',
      answer: objectionDrilldownAnswer(overview, comparison),
      evidence: {
        kind: 'objection_drilldown', window: overview.window, closer: overview.closer,
        total: overview.total, categories: overview.categories, most_raised: overview.most_raised,
        least_handled: overview.least_handled, comparison: comparison ? {
          category: comparison.category, handle_rate: comparison.handle_rate,
          when_handled: comparison.when_handled, when_not_handled: comparison.when_not_handled,
          handled_examples: comparison.handled_examples, not_handled_examples: comparison.not_handled_examples,
        } : null,
      },
      follow_up_context: null,
    };
  }
  var hasPriorQuestions = Array.isArray(options.priorQuestions) && options.priorQuestions.some(function (item) {
    return typeof item === 'string' && item.trim();
  });
  var messages = [{ role: 'user', content: questionWithContext(question, options.priorQuestions) }];
  var firstRequest = {
    model: options.model,
    max_tokens: 700,
    system: systemPrompt(profiles, defaults),
    tools: SCOUT_TOOLS,
    messages: messages,
  };
  if (hasPriorQuestions) firstRequest.tool_choice = { type: 'any' };
  var first = await options.create(firstRequest);
  var requestedTools = toolUses(first);
  if (!requestedTools.length) {
    return {
      status: 'unsupported',
      answer: textFrom(first) || 'Scout does not have an approved evidence tool for that question yet.',
      evidence: null,
    };
  }
  // Validate every requested tool before reading any fact. A made-up closer or
  // unavailable tool must fail closed; a database read failure can be returned
  // to the model as a normal tool error after the safe request is established.
  var plans = requestedTools.map(function (tool) {
    if (tool.name === COHORT_TOOL.name) {
      return { kind: 'cohort', tool: tool, request: validToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === OBJECTION_COACHING_COMPARISON_TOOL.name) {
      if (typeof options.readObjectionCoachingComparison !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'coaching-comparison', tool: tool, request: validCoachingComparisonToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === TEAM_OBJECTIONS_TOOL.name) {
      if (typeof options.readTeamObjections !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'team', tool: tool, request: validTeamToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === TEAM_OBJECTION_LEADERBOARD_TOOL.name) {
      if (typeof options.readTeamObjectionLeaderboard !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'leaderboard', tool: tool, request: validLeaderboardToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === CLOSER_CLOSE_RATE_TOOL.name) {
      if (typeof options.readCloserCloseRate !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'close-rate', tool: tool, request: validCloseRateToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === STAGE_PERFORMANCE_TOOL.name) {
      if (typeof options.readStagePerformance !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'stage-performance', tool: tool, request: validStagePerformanceToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === STAGE_EXAMPLES_TOOL.name) {
      if (typeof options.readStageExamples !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'stage-examples', tool: tool, request: validStageExamplesToolInput(tool.input, profiles, defaults) };
    }
    if (tool.name === CALL_EXAMPLES_TOOL.name) {
      if (typeof options.readCallExamples !== 'function') throw new Error('Scout AI is not configured.');
      return { kind: 'call-examples', tool: tool, request: validCallExamplesToolInput(tool.input, profiles, defaults, !currentQuestionNamesCloser(question, profiles)) };
    }
    throw new Error('Scout AI requested an unavailable tool.');
  });
  var facts = [];
  var toolResults = [];
  for (var i = 0; i < plans.length; i++) {
    var plan = plans[i];
    var tool = plan.tool;
    try {
      var fact;
      if (plan.kind === 'cohort') {
        var request = plan.request;
        fact = await options.readObjectionCohort({
          userId: request.userId,
          from: request.range.from,
          to: request.range.to,
          filter: request.filter,
        });
      } else if (plan.kind === 'coaching-comparison') {
        var comparisonRequest = plan.request;
        fact = await options.readObjectionCoachingComparison({
          userId: comparisonRequest.userId,
          name: comparisonRequest.name,
          category: comparisonRequest.category,
          from: comparisonRequest.range.from,
          to: comparisonRequest.range.to,
        });
      } else if (plan.kind === 'team') {
        var teamRequest = plan.request;
        fact = await options.readTeamObjections({
          userIds: teamRequest.userIds,
          from: teamRequest.range.from,
          to: teamRequest.range.to,
        });
      } else if (plan.kind === 'leaderboard') {
        var leaderboardRequest = plan.request;
        fact = await options.readTeamObjectionLeaderboard({
          userIds: leaderboardRequest.userIds,
          namesByUserId: leaderboardRequest.namesByUserId,
          category: leaderboardRequest.category,
          from: leaderboardRequest.range.from,
          to: leaderboardRequest.range.to,
        });
      } else if (plan.kind === 'close-rate') {
        var closeRateRequest = plan.request;
        fact = await options.readCloserCloseRate({
          userId: closeRateRequest.userId,
          from: closeRateRequest.range.from,
          to: closeRateRequest.range.to,
        });
      } else if (plan.kind === 'stage-performance') {
        var stageRequest = plan.request;
        fact = await options.readStagePerformance({
          userIds: stageRequest.userIds,
          namesByUserId: stageRequest.namesByUserId,
          userId: stageRequest.userId,
          stage: stageRequest.stage,
          from: stageRequest.range.from,
          to: stageRequest.range.to,
        });
      } else if (plan.kind === 'stage-examples') {
        var exampleRequest = plan.request;
        fact = await options.readStageExamples({
          userIds: exampleRequest.userIds,
          namesByUserId: exampleRequest.namesByUserId,
          userId: exampleRequest.userId,
          stage: exampleRequest.stage,
          from: exampleRequest.range.from,
          to: exampleRequest.range.to,
        });
      } else {
        var callExamplesRequest = plan.request;
        var callRead = {
          userId: callExamplesRequest.userId,
          filter: callExamplesRequest.filter,
          limit: callExamplesRequest.limit,
          from: callExamplesRequest.range.from,
          to: callExamplesRequest.range.to,
        };
        if (!callExamplesRequest.userId) {
          callRead.userIds = callExamplesRequest.userIds;
          callRead.namesByUserId = callExamplesRequest.namesByUserId;
        }
        fact = await options.readCallExamples(callRead);
      }
      facts.push(fact);
      toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(fact) });
    } catch (error) {
      toolResults.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: (error && error.message) || 'Scout could not read that evidence.' });
    }
  }
  if (facts.length === 1 && facts[0] && facts[0].kind === 'stage_performance' && facts[0].priority) {
    return {
      status: 'answered', answer: coachingPriorityAnswer(facts[0]), evidence: evidenceFrom(facts[0]),
      follow_up_context: followUpContextFromFacts(facts[0]),
    };
  }
  messages.push({ role: 'assistant', content: first.content });
  messages.push({ role: 'user', content: toolResults });
  var final = await options.create({
    model: options.model,
    max_tokens: 700,
    system: systemPrompt(profiles, defaults),
    tools: SCOUT_TOOLS,
    messages: messages,
  });
  return {
    status: 'answered', answer: textFrom(final), evidence: facts.length ? evidenceFrom(facts[0]) : null,
    follow_up_context: facts.length ? followUpContextFromFacts(facts[0]) : null,
  };
}

module.exports = {
  COHORT_TOOL: COHORT_TOOL,
  OBJECTION_COACHING_COMPARISON_TOOL: OBJECTION_COACHING_COMPARISON_TOOL,
  TEAM_OBJECTIONS_TOOL: TEAM_OBJECTIONS_TOOL,
  TEAM_OBJECTION_LEADERBOARD_TOOL: TEAM_OBJECTION_LEADERBOARD_TOOL,
  CLOSER_CLOSE_RATE_TOOL: CLOSER_CLOSE_RATE_TOOL,
  STAGE_PERFORMANCE_TOOL: STAGE_PERFORMANCE_TOOL,
  STAGE_EXAMPLES_TOOL: STAGE_EXAMPLES_TOOL,
  CALL_EXAMPLES_TOOL: CALL_EXAMPLES_TOOL,
  validToolInput: validToolInput,
  validCoachingComparisonToolInput: validCoachingComparisonToolInput,
  validTeamToolInput: validTeamToolInput,
  validLeaderboardToolInput: validLeaderboardToolInput,
  validCloseRateToolInput: validCloseRateToolInput,
  validStagePerformanceToolInput: validStagePerformanceToolInput,
  validStageExamplesToolInput: validStageExamplesToolInput,
  validCallExamplesToolInput: validCallExamplesToolInput,
  answerQuestion: answerQuestion,
};
