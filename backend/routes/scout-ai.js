'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateRequest, readObjectionCohort, readTeamObjections, readTeamObjectionLeaderboard } = require('../lib/scout-ai-reader');
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

function defaultRange(body) {
  body = body || {};
  const to = body.to || new Date().toISOString();
  const from = body.from || new Date(Date.parse(to) - (90 * 24 * 60 * 60 * 1000)).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to)) || from > to) throw new Error('Choose a valid date range.');
  if (Date.parse(to) - Date.parse(from) > 366 * 24 * 60 * 60 * 1000) throw new Error('Choose a date range of one year or less.');
  return { from, to };
}

function priorQuestions(body) {
  var values = body && body.prior_questions;
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 8 || values.some(function (item) { return typeof item !== 'string' || item.length > 1500; })) {
    throw new Error('Scout AI could not read this conversation.');
  }
  return values.map(function (item) { return item.trim(); }).filter(Boolean);
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

// This is a deliberately narrow first tool endpoint, not a general query API.
// It remains owner-only until the chat writer and scope rules are complete.
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

router.post('/ask', requireAuth, requireRole(['user', 'manager', 'owner']), async function (req, res) {
  try {
    const question = String((req.body && req.body.question) || '').trim();
    if (!question) return res.status(400).json({ error: 'Ask Scout a question first.' });
    const range = defaultRange(req.body);
    const admin = adminClient();
    const result = await answerQuestion({
      question: question,
      profiles: await availableClosers(admin, { id: req.user.id, role: req.user.role }),
      defaultRange: range,
      priorQuestions: priorQuestions(req.body),
      model: CLAUDE_MODEL,
      create: function (params) { return createWithUsage(params, { userId: req.user.id }); },
      readObjectionCohort: function (input) { return readObjectionCohort(admin, input); },
      readTeamObjections: function (input) { return readTeamObjections(admin, input); },
      readTeamObjectionLeaderboard: function (input) { return readTeamObjectionLeaderboard(admin, input); },
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

module.exports = router;
