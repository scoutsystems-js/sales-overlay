'use strict';

// This module is the model boundary for Scout AI.  It deliberately gives the
// model a short list of named Scout tools, never a database client or a raw
// transcript.  The model chooses what to ask for; Scout computes the facts.

const CATEGORIES = ['fear', 'timing', 'partner', 'logistical', 'other'];
const STAGES = ['intro', 'discovery', 'pitch', 'objection', 'close'];

const COHORT_TOOL = {
  name: 'read_objection_cohort',
  description: 'Read verified Scout evidence for one closer and one documented objection phrase or category. Use for questions about how often a closer handled an objection, how often those prospects closed, or examples of handled and not-handled objections.',
  input_schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'One id from the available closer list.' },
      phrase: { type: 'string', description: 'Exact objection phrase to match, such as spouse or think about it. Omit if asking about a whole category.' },
      category: { type: 'string', enum: CATEGORIES, description: 'Canonical Scout objection category. Omit if a phrase is requested.' },
      from: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
      to: { type: 'string', description: 'ISO date-time. Omit to use the stated default window.' },
    },
    required: ['user_id'],
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
  description: 'Read earned sales-stage scores for one closer or the authorized closer group. Use for questions about Discovery, Intro, Pitch, Objection Handling, or Close performance. When comparing who needs help with one stage, provide that stage and omit user_id.',
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

const SCOUT_TOOLS = [COHORT_TOOL, TEAM_OBJECTIONS_TOOL, TEAM_OBJECTION_LEADERBOARD_TOOL, CLOSER_CLOSE_RATE_TOOL, STAGE_PERFORMANCE_TOOL];

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
  if (!stage && !userId) throw new Error('Scout AI needs a closer or sales stage for that question.');
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
    'For an overall close-rate question, use the closer close-rate tool. For “who needs help with Discovery/Pitch/Close/Intro/Objection Handling,” use the stage-performance tool with that stage and explain that only sufficiently measured scores are ranked.',
    'Default date range: ' + defaults.from + ' through ' + defaults.to + '.',
    'Available closers (use only these ids):\n' + people,
  ].join('\n\n');
}

function evidenceFrom(facts) {
  if (facts && facts.kind === 'closer_close_rate') {
    return { kind: facts.kind, window: facts.window, close_rate: facts.close_rate };
  }
  if (facts && facts.kind === 'stage_performance') {
    return { kind: facts.kind, window: facts.window, stage: facts.stage, closers: facts.closers };
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
      } else {
        var stageRequest = plan.request;
        fact = await options.readStagePerformance({
          userIds: stageRequest.userIds,
          namesByUserId: stageRequest.namesByUserId,
          userId: stageRequest.userId,
          stage: stageRequest.stage,
          from: stageRequest.range.from,
          to: stageRequest.range.to,
        });
      }
      facts.push(fact);
      toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(fact) });
    } catch (error) {
      toolResults.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: (error && error.message) || 'Scout could not read that evidence.' });
    }
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
  return { status: 'answered', answer: textFrom(final), evidence: facts.length ? evidenceFrom(facts[0]) : null };
}

module.exports = {
  COHORT_TOOL: COHORT_TOOL,
  TEAM_OBJECTIONS_TOOL: TEAM_OBJECTIONS_TOOL,
  TEAM_OBJECTION_LEADERBOARD_TOOL: TEAM_OBJECTION_LEADERBOARD_TOOL,
  CLOSER_CLOSE_RATE_TOOL: CLOSER_CLOSE_RATE_TOOL,
  STAGE_PERFORMANCE_TOOL: STAGE_PERFORMANCE_TOOL,
  validToolInput: validToolInput,
  validTeamToolInput: validTeamToolInput,
  validLeaderboardToolInput: validLeaderboardToolInput,
  validCloseRateToolInput: validCloseRateToolInput,
  validStagePerformanceToolInput: validStagePerformanceToolInput,
  answerQuestion: answerQuestion,
};
