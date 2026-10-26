'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateRequest, readObjectionCohort, readObjectionCoachingComparison, readTeamObjections, readCloserObjectionOverview, readTeamObjectionLeaderboard, readCloserCloseRate, readTeamCloseRateLeaderboard, readStagePerformance, readStageExamples, readCallExamples } = require('../lib/scout-ai-reader');
const { answerQuestion } = require('../lib/scout-ai-engine');
const { visibleUserIds } = require('../lib/scout-ai-scope');
const { resolveDisplayName } = require('../lib/display-name');
const createWithUsage = require('../lib/model-usage').usageFor('scout-ai');
const { CLAUDE_MODEL } = require('../config');

const router = express.Router();
let adminOverride = null;

function adminClient() {
  if (adminOverride) return adminOverride;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function relativeRangeInQuestion(question, to) {
  const text = String(question || '');
  const match = /\b(?:in\s+|over\s+)?(?:the\s+)?(?:last|past|previous)\s+(\d+)\s*(days?|weeks?|months?|years?)\b/i.exec(text);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isInteger(amount) || amount < 1) return null;

  const end = new Date(to);
  const start = new Date(end);
  if (unit.indexOf('day') === 0) start.setUTCDate(start.getUTCDate() - amount);
  else if (unit.indexOf('week') === 0) start.setUTCDate(start.getUTCDate() - (amount * 7));
  else {
    const months = unit.indexOf('year') === 0 ? amount * 12 : amount;
    const originalDay = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(originalDay, lastDay));
  }

  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new Error('Scout AI can answer up to one year at a time.');
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

function defaultRange(body, question) {
  body = body || {};
  const to = body.to || new Date().toISOString();
  // A supplied `to` only pins “now” for a deterministic request/test. A
  // supplied `from` is the explicit range boundary and therefore wins.
  const stated = !body.from ? relativeRangeInQuestion(question, to) : null;
  const from = body.from || (stated && stated.from) || new Date(Date.parse(to) - (30 * 24 * 60 * 60 * 1000)).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to)) || from > to) throw new Error('Choose a valid date range.');
  if (Date.parse(to) - Date.parse(from) > 366 * 24 * 60 * 60 * 1000) throw new Error('Choose a date range of one year or less.');
  const range = { from, to };
  if (stated) range.locked = true;
  return range;
}

function priorQuestions(body) {
  var values = body && body.prior_questions;
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 8 || values.some(function (item) { return typeof item !== 'string' || item.length > 1500; })) {
    throw new Error('Scout AI could not read this conversation.');
  }
  return values.map(function (item) { return item.trim(); }).filter(Boolean);
}

function followUpContext(body) {
  var value = body && body.follow_up_context;
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scout AI could not read this follow-up.');
  return value;
}

async function availableClosers(admin, actor) {
  const authResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authResult.error) throw new Error('Scout AI could not load closers.');
  const profilesResult = await admin.from('user_profiles').select('user_id, role, active, managed_by, first_name, last_name');
  if (profilesResult.error) throw new Error('Scout AI could not load closer profiles.');
  const assignmentsResult = await admin.from('manager_rep_assignments').select('manager_user_id, rep_user_id');
  if (assignmentsResult.error) throw new Error('Scout AI could not load team assignments.');
  const visible = new Set(visibleUserIds(actor, profilesResult.data || [], assignmentsResult.data || []));
  const profilesById = {};
  (profilesResult.data || []).forEach(function (profile) { profilesById[profile.user_id] = profile; });
  return ((authResult.data && authResult.data.users) || []).map(function (user) {
    const profile = profilesById[user.id] || {};
    return {
      user_id: user.id,
      name: resolveDisplayName(profile, user.email, user.id),
      role: profile.role || 'user',
      active: profile.active !== false,
    };
  }).filter(function (profile) { return profile.active && visible.has(profile.user_id); });
}

// This is a deliberately narrow internal fact endpoint, not a general query API.
// The Scout AI conversation below has its own manager-and-above access boundary.
router.post('/facts/objection-cohort', requireAuth, requireRole('owner'), async function (req, res) {
  try {
    const range = defaultRange(req.body);
    const request = validateRequest({
      userId: req.body && req.body.user_id,
      from: range.from,
      to: range.to,
      filter: (req.body && req.body.filter) || {},
    });
    const result = await readObjectionCohort(adminClient(), request);
    res.json(result);
  } catch (error) {
    const message = (error && error.message) || 'Scout AI could not read that evidence.';
    const config = message.indexOf('not configured') !== -1;
    res.status(config ? 503 : 400).json({ error: message });
  }
});

router.post('/ask', requireAuth, requireRole(['manager', 'owner']), async function (req, res) {
  try {
    const question = String((req.body && req.body.question) || '').trim();
    if (!question) return res.status(400).json({ error: 'Ask Scout a question first.' });
    const range = defaultRange(req.body, question);
    const admin = adminClient();
    const result = await answerQuestion({
      question: question,
      profiles: await availableClosers(admin, { id: req.user.id, role: req.user.role }),
      defaultRange: range,
      priorQuestions: priorQuestions(req.body),
      followUp: followUpContext(req.body),
      model: CLAUDE_MODEL,
      create: function (params) { return createWithUsage(params, { userId: req.user.id }); },
      readObjectionCohort: function (input) { return readObjectionCohort(admin, input); },
      readObjectionCoachingComparison: function (input) { return readObjectionCoachingComparison(admin, input); },
      readTeamObjections: function (input) { return readTeamObjections(admin, input); },
      readCloserObjectionOverview: function (input) { return readCloserObjectionOverview(admin, input); },
      readTeamObjectionLeaderboard: function (input) { return readTeamObjectionLeaderboard(admin, input); },
      readCloserCloseRate: function (input) { return readCloserCloseRate(admin, input); },
      readTeamCloseRateLeaderboard: function (input) { return readTeamCloseRateLeaderboard(admin, input); },
      readStagePerformance: function (input) { return readStagePerformance(admin, input); },
      readStageExamples: function (input) { return readStageExamples(admin, input); },
      readCallExamples: function (input) { return readCallExamples(admin, input); },
    });
    res.json(result);
  } catch (error) {
    const message = (error && error.message) || 'Scout AI could not answer that question.';
    const config = message.indexOf('not configured') !== -1;
    res.status(config ? 503 : 400).json({ error: message });
  }
});

router._setAdminClientForTests = function (client) { adminOverride = client; };
router._defaultRangeForTests = defaultRange;
router._availableClosersForTests = availableClosers;
router._priorQuestionsForTests = priorQuestions;
router._followUpContextForTests = followUpContext;

module.exports = router;
