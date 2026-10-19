'use strict';

// This module is the model boundary for Scout AI.  It deliberately gives the
// model a short list of named Scout tools, never a database client or a raw
// transcript.  The model chooses what to ask for; Scout computes the facts.

const CATEGORIES = ['fear', 'timing', 'partner', 'logistical', 'other'];

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

function textFrom(response) {
  return ((response && response.content) || [])
    .filter(function (block) { return block && block.type === 'text' && typeof block.text === 'string'; })
    .map(function (block) { return block.text; })
    .join('\n')
    .trim();
}

function firstToolUse(response) {
  return ((response && response.content) || []).find(function (block) {
    return block && block.type === 'tool_use';
  }) || null;
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

function systemPrompt(profiles, defaults) {
  var people = (profiles || []).map(function (profile) {
    return profile.user_id + ' — ' + profile.name;
  }).join('\n');
  return [
    'You are Scout AI. Answer only from verified Scout tool results.',
    'You never invent a number, call, quote, outcome, or reason. If the available tool cannot answer the request, say that plainly and do not use a tool.',
    'A phrase such as “spouse” is not the same thing as the whole Partner category. Say which one you used.',
    'Question-specific cohort rates are answer-only. They do not change Scout’s normal dashboard metrics.',
    'When you use a tool, write a short plain-language answer that names the date range, numerator and denominator, and distinguishes objection handling from closing.',
    'Do not use Markdown, tables, headings, bullets, asterisks, or invented links. Write short plain sentences for Scout’s conversation view.',
    'The user can open the evidence cards Scout returns separately, so do not make up clips or quotes.',
    'Default date range: ' + defaults.from + ' through ' + defaults.to + '.',
    'Available closers (use only these ids):\n' + people,
  ].join('\n\n');
}

function evidenceFrom(facts) {
  return {
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
  var messages = [{ role: 'user', content: question }];
  var first = await options.create({
    model: options.model,
    max_tokens: 700,
    system: systemPrompt(profiles, defaults),
    tools: [COHORT_TOOL],
    messages: messages,
  });
  var tool = firstToolUse(first);
  if (!tool) {
    return {
      status: 'unsupported',
      answer: textFrom(first) || 'Scout does not have an approved evidence tool for that question yet.',
      evidence: null,
    };
  }
  if (tool.name !== COHORT_TOOL.name) throw new Error('Scout AI requested an unavailable tool.');
  var request = validToolInput(tool.input, profiles, defaults);
  var facts = await options.readObjectionCohort({
    userId: request.userId,
    from: request.range.from,
    to: request.range.to,
    filter: request.filter,
  });
  messages.push({ role: 'assistant', content: first.content });
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(facts) }] });
  var final = await options.create({
    model: options.model,
    max_tokens: 700,
    system: systemPrompt(profiles, defaults),
    tools: [COHORT_TOOL],
    messages: messages,
  });
  return { status: 'answered', answer: textFrom(final), evidence: evidenceFrom(facts) };
}

module.exports = {
  COHORT_TOOL: COHORT_TOOL,
  validToolInput: validToolInput,
  answerQuestion: answerQuestion,
};
