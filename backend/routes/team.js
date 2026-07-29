// /team/* — v1.4 Manager view. Gated to manager+owner. The rep set is ALWAYS
// resolved server-side (never trusts a client-supplied list):
//   manager → their own reps (user_profiles.managed_by = self); the ?team= param
//             is ignored for managers.
//   owner   → ?team=<managerId> (that manager/owner's reps) | ?team=all (every
//             non-owner user) | default: their own reps if any, else all.
// "Has assigned reps" (not role) is what grants the manager experience, so an
// owner with reps defaults to their own team.

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeTeamAnalytics, computeTeamTrends } = require('../lib/team-analytics');
const { computeTeamRecommendations, computeWeeklyHighlights } = require('../lib/team-synthesis');
const { computeTeamNeedsWork, loadBucketEvidence } = require('../lib/team-needs-work');
const { computePageSummary } = require('../lib/page-summary');

const router = express.Router();
const teamGate = [requireAuth, requireRole(['manager', 'owner'])];

function getAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function handleConfigError(err, res) {
  if (err && err.message && err.message.indexOf('not configured') !== -1) { res.status(503).json({ error: err.message }); return true; }
  return false;
}
function rangeFrom(req) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return null;
  return { from: from, to: to };
}

async function emailMap(admin) {
  var list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (list.error) throw new Error('listUsers: ' + list.error.message);
  var m = {}; (list.data.users || []).forEach(function (u) { if (u && u.id) m[u.id] = u.email || null; });
  return m;
}
async function repIdsFor(admin, keyId) {
  var r = await admin.from('user_profiles').select('user_id').eq('managed_by', keyId);
  if (r.error) throw new Error('reps lookup: ' + r.error.message);
  return (r.data || []).map(function (x) { return x.user_id; });
}
async function profilesByRole(admin) {
  var r = await admin.from('user_profiles').select('user_id, role');
  if (r.error) throw new Error('profiles: ' + r.error.message);
  var owners = {}, roleOf = {};
  (r.data || []).forEach(function (p) { roleOf[p.user_id] = p.role; if (p.role === 'owner') owners[p.user_id] = true; });
  return { owners: owners, roleOf: roleOf };
}

// Returns { keyId, repIds, label, mode } enforcing permission. Throws {status,msg}.
async function resolveTeam(admin, req) {
  var me = req.user.id;
  var role = req.user.role;
  var teamParam = req.query.team || null;

  if (role !== 'owner') {
    // manager: always own reps, param ignored.
    return { keyId: me, repIds: await repIdsFor(admin, me), label: 'My team', mode: 'own' };
  }

  // owner
  if (teamParam && teamParam !== 'all') {
    var pr = await profilesByRole(admin);
    if (pr.roleOf[teamParam] !== 'manager' && pr.roleOf[teamParam] !== 'owner') {
      var e = new Error('team must be a manager or owner'); e.status = 400; throw e;
    }
    var reps = await repIdsFor(admin, teamParam);
    var em = await emailMap(admin);
    return { keyId: teamParam, repIds: reps, label: ((em[teamParam] || 'manager') + "'s team"), mode: 'pick' };
  }

  if (teamParam === 'all') {
    var pr2 = await profilesByRole(admin);
    var em2 = await emailMap(admin);
    var allReps = Object.keys(em2).filter(function (id) { return !pr2.owners[id]; });
    return { keyId: me, repIds: allReps, label: 'All users', mode: 'all' };
  }

  // default: own team if the owner has reps, else all users.
  var own = await repIdsFor(admin, me);
  if (own.length > 0) return { keyId: me, repIds: own, label: 'My team', mode: 'own' };
  var pr3 = await profilesByRole(admin);
  var em3 = await emailMap(admin);
  return { keyId: me, repIds: Object.keys(em3).filter(function (id) { return !pr3.owners[id]; }), label: 'All users', mode: 'all' };
}

// GET /team/context — what the manager-view chrome needs: role, whether the
// viewer has reps, and (owner only) the list of teams for the picker.
router.get('/context', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var myReps = await repIdsFor(admin, req.user.id);
    var ctx = { role: req.user.role, is_owner: req.user.role === 'owner', has_reps: myReps.length > 0, my_rep_count: myReps.length, teams: null };
    if (req.user.role === 'owner') {
      var em = await emailMap(admin);
      var pr = await profilesByRole(admin);
      // teams = every manager/owner who actually has >=1 rep, + the All option.
      var managers = Object.keys(pr.roleOf).filter(function (id) { return pr.roleOf[id] === 'manager' || pr.roleOf[id] === 'owner'; });
      var teams = [];
      for (var i = 0; i < managers.length; i++) {
        var reps = await repIdsFor(admin, managers[i]);
        if (reps.length > 0) teams.push({ key: managers[i], label: (managers[i] === req.user.id ? 'My team' : (em[managers[i]] || 'manager') + "'s team"), rep_count: reps.length, is_self: managers[i] === req.user.id });
      }
      teams.push({ key: 'all', label: 'All users', rep_count: Object.keys(em).filter(function (id) { return !pr.owners[id]; }).length, is_self: false });
      ctx.teams = teams;
    }
    res.json(ctx);
  } catch (err) { if (handleConfigError(err, res)) return; console.error('[team] context:', err.message); res.status(500).json({ error: 'Failed to load team context' }); }
});

router.get('/overview', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var data = await computeTeamAnalytics(admin, team.repIds, range.from, range.to, em);
    res.json(Object.assign({ team: { label: team.label, key: team.keyId, mode: team.mode } }, data));
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] overview:', err.message); res.status(500).json({ error: 'Failed to load team overview' }); }
});

router.get('/trends', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  var bucket = req.query.bucket === 'month' ? 'month' : (req.query.bucket === 'quarter' ? 'quarter' : 'week');
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var data = await computeTeamTrends(admin, team.repIds, bucket, range.from, range.to);
    res.json(data);
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] trends:', err.message); res.status(500).json({ error: 'Failed to load team trends' }); }
});

router.get('/recommendations', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var data = await computeTeamRecommendations(admin, team.keyId, team.repIds, range.from, range.to, em);
    res.json(data);
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] recommendations:', err.message); res.status(500).json({ error: 'Failed to load team recommendations' }); }
});

// C-1: "Generate summary" — page-agnostic executive summary. The client hands
// us a page label + the page's ALREADY-LOADED data (no re-fetch, no analytics
// computation here); Claude writes exec-voice prose around the handed numbers.
// Gated to manager+owner (credit protection); the data is the caller's own
// already-permission-checked page payload, so there's no new data exposure.
router.post('/summary', teamGate, async function (req, res) {
  try {
    var body = req.body || {};
    var pageLabel = (typeof body.page_label === 'string' && body.page_label.trim()) ? body.page_label.trim().slice(0, 160) : null;
    var data = body.data;
    if (!pageLabel || data == null || typeof data !== 'object') {
      return res.status(400).json({ error: 'page_label (string) and data (object) are required' });
    }
    var admin = getAdmin();
    var out = await computePageSummary(admin, req.user.id, pageLabel, data);
    res.json(out);
  } catch (err) { if (handleConfigError(err, res)) return; console.error('[team] summary:', err.message); res.status(500).json({ error: 'Failed to generate summary' }); }
});

// POST /team/needs-work/bucket — per-call evidence for one bucket across the team.
router.post('/needs-work/bucket', teamGate, async function (req, res) {
  var b = req.body || {};
  var surfaces = Array.isArray(b.surfaces) ? b.surfaces.slice(0, 200) : null;
  if (!surfaces || !surfaces.length) return res.status(400).json({ error: 'surfaces[] required' });
  var to = b.to || new Date().toISOString();
  var from = b.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var rows = await loadBucketEvidence(admin, team.repIds, surfaces, from, to);
    res.json({ calls: rows });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] needs-work bucket:', err.message); res.status(500).json({ error: 'Failed to load bucket evidence' }); }
});

// "What needs work" — the objection-bucket counterfactual (B-2). On-demand,
// cached (synthesis_type='team_needs_work'); a cache hit spends no Claude.
router.get('/needs-work', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var data = await computeTeamNeedsWork(admin, team.keyId, team.repIds, range.from, range.to, em);
    res.json(data);
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] needs-work:', err.message); res.status(500).json({ error: 'Failed to load what-needs-work' }); }
});

// Call Highlights of the Week. ?week=<ISO monday> optional; default = this week.
router.get('/highlights', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var weekFrom, weekTo;
    if (req.query.week && !isNaN(Date.parse(req.query.week))) { weekFrom = new Date(req.query.week); }
    else { var now = new Date(); var day = (now.getUTCDay() + 6) % 7; weekFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day)); }
    weekTo = new Date(weekFrom.getTime() + 7 * 24 * 60 * 60 * 1000);
    var data = await computeWeeklyHighlights(admin, team.keyId, team.repIds, weekFrom.toISOString(), weekTo.toISOString(), em);
    res.json(Object.assign({ week_from: weekFrom.toISOString(), week_to: weekTo.toISOString() }, data));
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] highlights:', err.message); res.status(500).json({ error: 'Failed to load highlights' }); }
});

// Manager daily digest — cache read. Generation is the sync cron's post-sync
// pass (lib/team-digest.js) or the owner-only manual trigger below. Default
// date = the previous ET calendar day (matches what generation writes).
// recent_dates gives the panel its history nav (last 7 stored digest days).
router.get('/digest', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var teamDigest = require('../lib/team-digest');
    var date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : teamDigest.etYesterday(new Date());
    var q = await admin.from('objection_synthesis_cache').select('synthesis, generated_at')
      .eq('user_id', team.keyId).eq('synthesis_type', 'digest').eq('from_ts', date).order('generated_at', { ascending: false }).limit(1).maybeSingle();
    var recentQ = await admin.from('objection_synthesis_cache').select('from_ts')
      .eq('user_id', team.keyId).eq('synthesis_type', 'digest').order('from_ts', { ascending: false }).limit(30);
    var recent = [];
    if (!recentQ.error) {
      var seen = {};
      (recentQ.data || []).forEach(function (r) {
        var d = String(r.from_ts).slice(0, 10);
        if (!seen[d] && recent.length < 7) { seen[d] = true; recent.push(d); }
      });
    }
    if (!q.error && q.data && q.data.synthesis) return res.json(Object.assign({ available: true, date: date, recent_dates: recent }, q.data.synthesis));
    res.json({ available: false, date: date, recent_dates: recent, reason: 'No digest for ' + date + ' yet — it generates after the morning sync.' });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[team] digest:', err.message); res.status(500).json({ error: 'Failed to load digest' }); }
});

// Owner-only manual trigger: generate digests on demand (all users-with-reps)
// without waiting for the next cron pass. Body: { date?: 'YYYY-MM-DD' }
// (defaults to ET-yesterday). Returns the generation summary — idempotent:
// re-runs for an unchanged day are cache hits, no duplicate Claude spend.
router.post('/digest/run', requireAuth, requireRole(['owner']), async function (req, res) {
  try {
    var admin = getAdmin();
    var generateDailyDigests = require('../lib/team-digest').generateDailyDigests;
    var body = req.body || {};
    var opts = {};
    if (body.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      opts.date = String(body.date);
    }
    var summary = await generateDailyDigests(admin, opts);
    res.json(summary);
  } catch (err) { if (handleConfigError(err, res)) return; console.error('[team] digest/run:', err.message); res.status(500).json({ error: 'Digest generation failed' }); }
});

module.exports = router;
