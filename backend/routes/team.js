// /team/* — v1.4 Manager view. Gated to manager+owner. The rep set is ALWAYS
// resolved server-side (never trusts a client-supplied list):
//   manager → their own reps (user_profiles.managed_by = self); the ?team= param
//             is ignored for managers.
//   owner   → ?team=<managerId> (that manager/owner's reps) | ?team=all (every
//             non-owner user) | default: their own reps if any, else all.
// "Has assigned reps" (not role) is what grants the manager experience, so an
// owner with reps defaults to their own team.

const { isDisqualified } = require('./../lib/dq-exclusion');
const { strictObjections } = require('./../lib/objection-strict');
const { closeRateForCalls } = require('./../lib/prospect-entity');
const express = require('express');
const { resolveDisplayName } = require('../lib/display-name');
const { nameMapFor } = require('../lib/team-name-map');
const { emailMapFor } = require('../lib/email-map');
const METRIC_BAND = require('../lib/metric-band');
var { withBoardOwner } = require('../lib/team-membership');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeTeamAnalytics, computeTeamTrends } = require('../lib/team-analytics');
const { buildRepSeries, OBJECTION_CATEGORIES } = require('../lib/rep-series');
const TA = require('../lib/team-averages');
const { isHandled, outcomeMap } = require('../lib/objection-handled');
const { computeWhyProse } = require('../lib/why-prose');
const Anthropic = require('@anthropic-ai/sdk');
const createWithUsage = require('../lib/model-usage').usageFor('team-why-prose');
const { CLAUDE_MODEL } = require('../config');
// Same lazy shape the synthesis lanes use: never constructed at import time, so
// a missing key is a clean per-request error rather than a boot failure.
var _anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}
const { computeTeamRecommendations } = require('../lib/team-synthesis');
const { resolveLayout, sanitizeLayout, MAX_BOARDS, MAX_CARDS } = require('../lib/dashboard-layout');
const { grouped: catalogGrouped, unavailable: catalogUnavailable } = require('../lib/widget-catalog');
const { computeTeamNeedsWork, loadBucketEvidence } = require('../lib/team-needs-work');
const { computePageSummary } = require('../lib/page-summary');
const { computeTeamObjections, ALL_CATEGORIES: OBJ_DRILL_CATEGORIES } = require('../lib/team-objections');
// ⚠ ONE definition of "synthetic", shared with every other team surface.
const { realCallsOnly } = require('../lib/real-calls');
const { companyDisplayName } = require('../lib/company');
const { computeTeamObjectionSummary } = require('../lib/team-objection-summary');

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

/* ⚠ ONE SHARED MAP, READ AT MOST ONCE PER MINUTE PER PROCESS — lib/email-map.js.
   This used to call auth.admin.listUsers on EVERY team request (~1s each). */
async function emailMap(admin) { return emailMapFor(admin); }
async function repIdsFor(admin, keyId) {
  var r = await admin.from('user_profiles').select('user_id').eq('managed_by', keyId);
  if (r.error) throw new Error('reps lookup: ' + r.error.message);
  return (r.data || []).map(function (x) { return x.user_id; });
}
/* ⚠⚠ THE COMPANY NAME COMES FROM lib/company.js, NOT FROM A LOCAL STRING.
   Before this, TWO places here built a team label and BOTH produced an email
   dressed up as a company — `resolveTeam` ("josh@scoutsystems.io's team") and
   the owner picker in /team/context. Justin's ruling is one name in one place;
   with three generators and no shared rule that lasts about a week. */
async function teamNameOf(admin, keyId) {
  if (!keyId) return null;
  var r = await admin.from('user_profiles').select('team_name').eq('user_id', keyId).maybeSingle();
  if (r.error) return null;          // a naming failure must never break the board
  return (r.data && r.data.team_name) || null;
}

async function profilesByRole(admin) {
  var r = await admin.from('user_profiles').select('user_id, role');
  if (r.error) throw new Error('profiles: ' + r.error.message);
  var owners = {}, roleOf = {};
  (r.data || []).forEach(function (p) { roleOf[p.user_id] = p.role; if (p.role === 'owner') owners[p.user_id] = true; });
  return { owners: owners, roleOf: roleOf };
}

// Returns { keyId, memberIds, label, mode } enforcing permission. Throws {status,msg}.
//
// ⚠⚠ THE MANAGER IS PART OF THEIR OWN BOARD, AND THIS IS THE ONLY PLACE THAT
// SAYS SO. `repIdsFor` reads `managed_by = keyId`, which BY DEFINITION cannot
// contain the manager — so every consumer had to add the manager back, and only
// two of the ten ever did, each carrying a private three-line copy of the same
// rule. Josh's own data was missing from eight team surfaces for exactly that
// reason. One rule, one home.
//
// ⚠ THE FIELD IS `memberIds`, NOT `repIds`, DELIBERATELY. The meaning changed
// but the type did not — a stale reader would keep working and silently drop
// the manager again, which is how this survived. Renaming makes any missed call
// site fail loudly instead of quietly returning the old answer.
//
// ⚠ 'all' MODE KEEPS ITS PRE-EXISTING ODDITY RATHER THAN QUIETLY ACQUIRING A
// NEW ONE: `allReps` excludes owners, yet the viewing owner is added by the rule
// below, so "All users" contains exactly one owner — the viewer. That is what
// /averages and /rep-series already did; unifying preserves it rather than
// inventing new behaviour under cover of a bug fix. Flagged, not changed.
/* withBoardOwner now lives in lib/team-membership.js so the digest cron can use
   the SAME rule — see that file for why nine sites got this wrong. */
async function resolveTeam(admin, req) {
  var me = req.user.id;
  var role = req.user.role;
  var teamParam = req.query.team || null;

  /* ⚠⚠ `rep=` RESOLVES THE TEAM THAT CONTAINS THAT REP, and it exists because a
     rep-scoped panel was resolving the CALLER's team instead. The pivoted rep's
     objection graph fetches /team/rep-series; with no team named, an owner got
     their OWN default team, the viewed rep was absent from it, and the panel
     rendered "no objection data for this rep in the selected range" — while that
     rep had 19 objections in every window measured. Same family as the stale-
     panel bug: a panel answering about the WRONG POPULATION and saying nothing.

     ⚠ RESOLVED SERVER-SIDE ON PURPOSE. The client does not reliably know a rep's
     manager (`state.users` is loaded for some surfaces and not others), so
     deriving it there would fail back to the caller's team exactly when the list
     happened to be missing — the silent wrong-population failure again.

     ⚠ It is IGNORED for a non-owner: a manager only ever resolves their own
     reps, and the pivot itself is already 403'd server-side for anyone else's. */
  var repParam = req.query.rep || null;
  if (repParam && role === 'owner' && !teamParam) {
    var rp = await admin.from('user_profiles').select('managed_by, role').eq('user_id', repParam).maybeSingle();
    if (rp.error) throw new Error('rep lookup: ' + rp.error.message);
    var rprof = rp.data || {};
    if (rprof.managed_by) {
      teamParam = rprof.managed_by;                       // their manager's board
    } else if (rprof.role === 'manager' || rprof.role === 'owner') {
      teamParam = repParam;                               // they head their own
    } else {
      /* ⚠ AN UNMANAGED PLAIN USER IS ON NO TEAM, and that is a real state — not
         an error and not an empty result. Return them as a board of one so their
         own line still draws; the team baseline is simply themselves. Silently
         returning nothing here is the defect this block exists to remove. */
      return { keyId: repParam, memberIds: [repParam], label: 'This rep', mode: 'rep' };
    }
  }

  if (role !== 'owner') {
    // manager: always own reps, param ignored.
    var mine = await repIdsFor(admin, me);
    return { keyId: me, memberIds: withBoardOwner(me, mine), label: companyDisplayName(await teamNameOf(admin, me)), mode: 'own' };
  }

  // owner
  if (teamParam && teamParam !== 'all') {
    var pr = await profilesByRole(admin);
    if (pr.roleOf[teamParam] !== 'manager' && pr.roleOf[teamParam] !== 'owner') {
      var e = new Error('team must be a manager or owner'); e.status = 400; throw e;
    }
    var reps = await repIdsFor(admin, teamParam);
    var em = await emailMap(admin);
    return { keyId: teamParam, memberIds: withBoardOwner(teamParam, reps), label: companyDisplayName(await teamNameOf(admin, teamParam)), mode: 'pick' };
  }

  if (teamParam === 'all') {
    var pr2 = await profilesByRole(admin);
    var em2 = await emailMap(admin);
    var allReps = Object.keys(em2).filter(function (id) { return !pr2.owners[id]; });
    return { keyId: me, memberIds: withBoardOwner(me, allReps), label: 'All users', mode: 'all' };
  }

  // default: own team if the owner has reps, else all users.
  var own = await repIdsFor(admin, me);
  if (own.length > 0) return { keyId: me, memberIds: withBoardOwner(me, own), label: companyDisplayName(await teamNameOf(admin, me)), mode: 'own' };
  var pr3 = await profilesByRole(admin);
  var em3 = await emailMap(admin);
  return { keyId: me, memberIds: withBoardOwner(me, Object.keys(em3).filter(function (id) { return !pr3.owners[id]; })), label: 'All users', mode: 'all' };
}

// GET /team/context — what the manager-view chrome needs: role, whether the
// viewer has reps, and (owner only) the list of teams for the picker.
router.get('/context', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var myReps = await repIdsFor(admin, req.user.id);
    var ctx = { role: req.user.role, is_owner: req.user.role === 'owner', has_reps: myReps.length > 0, my_rep_count: myReps.length, teams: null };
    /* THE CALLER'S OWN COMPANY NAME, so every team surface can title itself.
       `teams` is populated for OWNERS ONLY (they are the only ones with a
       picker), which left a MANAGER arriving on #team-recs or #team-members by
       deep link with nothing to resolve: the heading fell through to the
       team-overview payload — a lane those sub-pages never load — and rendered
       the bare word "Team".
       It is a property of the CALLER, not of the current selection, so context
       stays un-scoped to the picked team. That matters: context is what
       RESTORES the selection and must not depend on it. */
    ctx.my_team_label = companyDisplayName(await teamNameOf(admin, req.user.id));
    if (req.user.role === 'owner') {
      var em = await emailMap(admin);
      var pr = await profilesByRole(admin);
      // teams = every manager/owner who actually has >=1 rep, + the All option.
      var managers = Object.keys(pr.roleOf).filter(function (id) { return pr.roleOf[id] === 'manager' || pr.roleOf[id] === 'owner'; });
      var teams = [];
      for (var i = 0; i < managers.length; i++) {
        var reps = await repIdsFor(admin, managers[i]);
        if (reps.length > 0) teams.push({ key: managers[i], label: companyDisplayName(await teamNameOf(admin, managers[i])), rep_count: reps.length, is_self: managers[i] === req.user.id });
      }
      teams.push({ key: 'all', label: 'All users', rep_count: Object.keys(em).filter(function (id) { return !pr.owners[id]; }).length, is_self: false });
      ctx.teams = teams;
    }
    res.json(ctx);
  } catch (err) { if (handleConfigError(err, res)) return; logTeamError('context', err); res.status(500).json({ error: 'Failed to load team context' }); }
});

router.get('/overview', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var data = await computeTeamAnalytics(admin, team.memberIds, range.from, range.to, em);
    /* ⚠ The bands ride with the payload so the rep card states each side
       (`47.3 min OVER`) from the ONE source, never a client copy of the edges. */
    res.json(Object.assign({ team: { label: team.label, key: team.keyId, mode: team.mode }, bands: METRIC_BAND.BANDS }, data));
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('overview', err); res.status(500).json({ error: 'Failed to load team overview' }); }
});

router.get('/trends', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  var bucket = req.query.bucket === 'month' ? 'month' : (req.query.bucket === 'quarter' ? 'quarter' : 'week');
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var data = await computeTeamTrends(admin, team.memberIds, bucket, range.from, range.to);
    res.json(data);
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('trends', err); res.status(500).json({ error: 'Failed to load team trends' }); }
});


// ─── the manager board's two graphs (10b) ──────────────────────────────────
//
// RULING 1 (2026-08-15): a manager who also takes calls IS a rep on their own
// board. Normal player-coach behaviour on a small team, and it is what makes
// the board real — Josh's 173 calls anchor it instead of three demo accounts
// with five copied calls each. A manager with no calls of their own simply
// does not appear, which falls out of the has-calls filter rather than needing
// a special case.
//
// ⚠ SCOPED TO THIS LANE ON PURPOSE. repIdsFor() is shared by the overview
// cards, trends, needs-work, highlights and the digest; widening it there would
// change five surfaces at once. Whether the same ruling should apply to them is
// a decision for Justin, not a side effect of a graph stage.
//
// Zero model cost: buildRepSeries is arithmetic over rows.
// GET /team/why-prose — one verified sentence per rep (10d).
// Lazy and separate from /team/overview: it can spend a model call per rep on a
// changed period, and the board must never wait on it.
router.get('/why-prose', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    // ⚠⚠ THESE TWO LINES HAD BOTH BEEN WRONG SINCE THE ROUTE WAS WRITTEN, and
    // this was the only one of the ten team routes with either. It called
    // `getAdminClient()` — defined in auth.js, admin.js, fathom.js and me.js but
    // NOT here, and not imported — so it threw a ReferenceError on the first
    // line of the try block, every single request. And it passed
    // `resolveTeam(req, admin)` with the arguments reversed, a second fault that
    // could only surface once the first was fixed.
    // ⚠ `getAdmin()` is team.js's OWN helper, used by the other nine routes.
    // me.js does not export its version, and a second name for the same thing
    // inside one file is how this started.
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var analytics = await computeTeamAnalytics(admin, team.memberIds, range.from, range.to, em);
    var ask = async function (prompt) {
      var r = await createWithUsage({
        model: CLAUDE_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }],
      });
      return r.content[0] ? r.content[0].text : '';
    };
    var by_rep = {};
    for (var i = 0; i < analytics.per_rep.length; i++) {
      var rep = analytics.per_rep[i];
      try {
        var out = await computeWhyProse(admin, rep, range.from, range.to, ask);
        if (out) by_rep[rep.user_id] = { sentence: out.sentence, tier: out.tier };
      } catch (e) {
        // One rep failing must not lose the others.
        console.warn('[team] why-prose for ' + rep.user_id + ': ' + ((e && e.message) || 'unknown'));
      }
    }
    res.json({ by_rep: by_rep });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    if (err.status) return res.status(err.status).json({ error: err.message });
    logTeamError('why-prose', err);
    res.status(500).json({ error: 'Failed to load rep summaries' });
  }
});

/**
 * GET /team/averages — the three team-average gauges (2026-08-18).
 *
 * ⚠⚠ THE WINDOW IS COMPUTED SERVER-SIDE AND THIS ROUTE ACCEPTS NO from/to.
 * That is the entire reason it exists rather than widening /team/rep-series:
 * "the date picker does not drive this panel" becomes a STRUCTURAL property of
 * the endpoint instead of a convention the browser is trusted to keep. The old
 * per-rep dials rode rep-series with a second hand-built query string
 * (`gaugeQP` beside `teamQP`) precisely because the windows differ — one route
 * serving two windows is the shared-carrier shape that has cost this project
 * four separate times. There is deliberately no `days` parameter to pass.
 *
 * ⚠ rep-series does NOT carry duration_seconds and must not be made to. It is
 * shaped for time-bucketed per-rep series driven by the picker; this is a
 * single-window team aggregate. They are different questions.
 */
/* ⚠⚠ THE DASHBOARD LAYOUT — READ ONLY IN THIS BLOCK. No editor, no save path.
   ⚠ IT RETURNS THE LAYOUT, NEVER THE NUMBERS. Every card reads from a lane the
   Performance page ALREADY loads (averages, rep-series, overview), so a board
   and the page it sits beside cannot disagree about the same metric. A second
   source for a number that already exists is how one screen comes to contradict
   another, which this product has already had to fix twice.
   ⚠ A MANAGER WITH NO ROW GETS THE CODE DEFAULT, and `is_default` says so — the
   caller must be able to tell "never customised" from "customised to look like
   the default", because only one of those should inherit a new widget later. */
router.get('/dashboard', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    /* ⚠ KEYED ON THE VIEWER, NOT THE BOARD. A board belongs to the manager who
       built it; an owner pivoting to another company sees THEIR OWN layout over
       that company's data, which is the same shape as the date picker. */
    var q = await admin.from('dashboards')
      .select('id, name, layout, pinned, updated_at')
      .eq('user_id', req.user.id)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(MAX_BOARDS);
    if (q.error) throw new Error('dashboards: ' + q.error.message);

    var boards = q.data || [];
    var wanted = req.query.board
      ? boards.filter(function (b) { return b.id === req.query.board; })[0]
      : boards[0];
    var resolved = resolveLayout(wanted ? wanted.layout : null);

    res.json({
      team: { key: team.keyId },
      board: wanted ? { id: wanted.id, name: wanted.name, pinned: wanted.pinned } : null,
      boards: boards.map(function (x) { return { id: x.id, name: x.name, pinned: x.pinned }; }),
      is_default: resolved.isDefault,
      cards: resolved.cards,
      dropped: resolved.dropped,
    });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('dashboard', err); res.status(500).json({ error: 'Failed to load the dashboard layout' }); }
});

/* ⚠ THE CATALOG THE PICKER READS. Served rather than duplicated in the browser:
   `viewsFor()` IS the honesty rule and a second copy in the client is how a
   gauge comes to be offered for a metric with no target. The unavailable list is
   sent DELIBERATELY — a manager who wonders where talk ratio went must be told,
   not left guessing. */
/* ⚠⚠ `unavailable` IS NO LONGER SENT (Justin's ruling, 2026-09-01). The picker
   listed six metrics it could not offer, each with a sentence explaining why —
   and a picker that lists what it cannot do spends a manager's attention on
   things they cannot have.
   ⚠ IT IS DROPPED FROM THE WIRE, NOT JUST FROM THE RENDER, and that is the
   point: a payload nothing renders is one `innerHTML` from being back on
   screen, so removing it here makes the ruling structural rather than a display
   choice the next person undoes by accident.
   ⚠ THE CATALOG KEEPS THE RECORD. `catalogUnavailable()` still exists and still
   carries every `available: false` row and its measurement — that is what it
   would take to build them, and it belongs in the catalog, not in a browser. */
router.get('/catalog', teamGate, function (_req, res) {
  res.json({ groups: catalogGrouped() });
});

/* ⚠⚠ SAVE. The cap is enforced HERE and reads as words, never as a database
   error — a manager who has ten boards is told they have ten, not shown a 23505.
   ⚠ AND THE LAYOUT IS SANITISED SERVER-SIDE. The client is a suggestion: a board
   is stored for a long time and read by a renderer that trusts it, so an unknown
   view or a 99-column span must not reach the row in the first place. */
router.put('/dashboard', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var body = req.body || {};
    var name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim().slice(0, 60) : 'My board';
    var layout = sanitizeLayout(body.layout);
    if (!layout.length) return res.status(400).json({ error: 'A board needs at least one card.' });

    var existing = await admin.from('dashboards').select('id').eq('user_id', req.user.id);
    if (existing.error) throw new Error('dashboards: ' + existing.error.message);
    var rows = existing.data || [];

    if (body.id) {
      if (!rows.some(function (r) { return r.id === body.id; })) {
        /* ⚠ 404, NOT 403 — a board id that is not yours is indistinguishable
           from one that does not exist, and saying which is a disclosure. */
        return res.status(404).json({ error: 'That board no longer exists.' });
      }
      var up = await admin.from('dashboards')
        .update({ name: name, layout: layout, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('user_id', req.user.id).select('id, name, pinned').maybeSingle();
      if (up.error) throw new Error('dashboards update: ' + up.error.message);
      return res.json({ board: up.data });
    }

    if (rows.length >= MAX_BOARDS) {
      /* ⚠ "Rename or delete one" WAS WRONG — renaming makes no room, and telling
         a manager at the cap to rename something sends them to do a thing that
         cannot work. Forking is the fastest route to this message, so it has to
         name the one action that helps. */
      return res.status(400).json({ error: 'You already have ' + MAX_BOARDS
        + ' boards. Delete one to make room for another.' });
    }
    var ins = await admin.from('dashboards')
      .insert({ user_id: req.user.id, name: name, layout: layout })
      .select('id, name, pinned').maybeSingle();
    if (ins.error) throw new Error('dashboards insert: ' + ins.error.message);
    res.json({ board: ins.data });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('dashboard-save', err); res.status(500).json({ error: 'Could not save your board.' }); }
});

/* ⚠⚠ PIN. A partial unique index makes two pinned boards UNREPRESENTABLE, so the
   unpin-then-pin has to happen in that order or the insert collides — the
   constraint is the authority and this code obeys it rather than assuming. */
/* ⚠⚠ UNPIN. There was no way to undo a pin — the button only rendered when a
   board was NOT pinned, so pinning was a one-way door: a manager with a single
   board could pin it and never get back. A capability with no inverse is the
   same shape as a capability with no control.
   ⚠ NO INDEX PROBLEM IN THIS DIRECTION: clearing a pin can never collide with
   the partial unique index, so this is a single write where pinning needs two. */
router.delete('/dashboard/:id/pin', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    /* ⚠ SCOPED TO THE CALLER'S OWN BOARD, exactly as the pin route is — a board
       belongs to the manager who built it, and `user_id` is on the update rather
       than checked separately so a crafted id cannot reach someone else's row. */
    var mine = await admin.from('dashboards').select('id').eq('user_id', req.user.id).eq('id', req.params.id).maybeSingle();
    if (mine.error) throw new Error('dashboards: ' + mine.error.message);
    if (!mine.data) return res.status(404).json({ error: 'That board no longer exists.' });
    var clear = await admin.from('dashboards').update({ pinned: false })
      .eq('id', req.params.id).eq('user_id', req.user.id);
    if (clear.error) throw new Error('unpin: ' + clear.error.message);
    /* ⚠ WHAT UNPINNING DOES, stated because a manager is entitled to know: the
       dashboard route orders `pinned DESC, updated_at DESC` and returns
       boards[0], so with nothing pinned the MOST RECENTLY UPDATED board is what
       opens — and the nav entry names it, because that label follows the board
       it opens rather than requiring a pin. Never an empty entry. */
    res.json({ ok: true, pinned: null });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('dashboard-unpin', err); res.status(500).json({ error: 'Could not unpin that board.' }); }
});

router.post('/dashboard/:id/pin', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var mine = await admin.from('dashboards').select('id').eq('user_id', req.user.id).eq('id', req.params.id).maybeSingle();
    if (mine.error) throw new Error('dashboards: ' + mine.error.message);
    if (!mine.data) return res.status(404).json({ error: 'That board no longer exists.' });

    var clear = await admin.from('dashboards').update({ pinned: false }).eq('user_id', req.user.id).eq('pinned', true);
    if (clear.error) throw new Error('unpin: ' + clear.error.message);
    var set = await admin.from('dashboards').update({ pinned: true }).eq('id', req.params.id).eq('user_id', req.user.id);
    if (set.error) throw new Error('pin: ' + set.error.message);
    res.json({ ok: true, pinned: req.params.id });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('dashboard-pin', err); res.status(500).json({ error: 'Could not pin that board.' }); }
});

/* ⚠⚠ RENAME HAS ITS OWN ROUTE AND MUST NOT GO THROUGH PUT — this is required by
   an existing ruling, not fastidiousness. `resolveLayout` DROPS a card whose
   metric no longer exists and deliberately DOES NOT WRITE: "the unknown entry
   stays in the stored row untouched", so a removed metric's return is
   recoverable. A rename routed through PUT would send back the RESOLVED layout
   the client is holding and permanently destroy that entry — silent data loss
   that looks exactly like a successful rename.
   ⚠ SO THIS TOUCHES `name` AND NOTHING ELSE. A guard asserts it never writes
   `layout`. */
router.patch('/dashboard/:id/name', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var raw = (req.body && typeof req.body.name === 'string') ? req.body.name.trim() : '';
    /* ⚠ THE SAME 60-CHARACTER CAP AND THE SAME FALLBACK AS THE SAVE PATH, because
       two places that name a board must not disagree about what a name may be. */
    var name = raw ? raw.slice(0, 60) : 'My board';
    var up = await admin.from('dashboards')
      .update({ name: name, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.user.id)
      .select('id, name, pinned').maybeSingle();
    if (up.error) throw new Error('dashboards rename: ' + up.error.message);
    /* ⚠ 404, NOT 403 — a board id that is not yours is indistinguishable from one
       that does not exist, and saying which is a disclosure. Same as PUT. */
    if (!up.data) return res.status(404).json({ error: 'That board no longer exists.' });
    res.json({ board: up.data });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('dashboard-rename', err); res.status(500).json({ error: 'Could not rename that board.' }); }
});

router.delete('/dashboard/:id', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var del = await admin.from('dashboards').delete().eq('id', req.params.id).eq('user_id', req.user.id).select('id');
    if (del.error) throw new Error('dashboards delete: ' + del.error.message);
    if (!(del.data || []).length) return res.status(404).json({ error: 'That board no longer exists.' });
    /* ⚠ DELETING THE LAST BOARD IS NOT AN ERROR — the manager simply returns to
       the code default, which is the whole point of storing the deviation. */
    res.json({ ok: true });
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('dashboard-delete', err); res.status(500).json({ error: 'Could not delete that board.' }); }
});

router.get('/averages', teamGate, async function (req, res) {
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var win = TA.fixedWindow(new Date());

    // ⚠ the board owner is already in memberIds — resolveTeam owns that rule
    // now, so this endpoint no longer carries its own copy of it.
    var candidates = team.memberIds.slice();
    if (candidates.length === 0) {
      return res.json({ window: win, metrics: emptyMetrics(), reps: { total: 0 } });
    }

    var calls = [], start = 0;
    for (;;) {
      var cq = await admin.from('fathom_calls')
        // ⚠ call_date rides along because closeRateForCalls orders a prospect's
        // calls oldest-first; without it the 'most recent decided outcome' rule
        // would be reading an undefined sort key.
        .select('id, user_id, fathom_call_id, prospect_id, duration_seconds, call_date')
        .in('user_id', candidates).gte('call_date', win.from).lte('call_date', win.to)
        .not('not_a_sales_call', 'is', true)
        .is('duplicate_of', null)
        .range(start, start + 999);
      if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
      calls = calls.concat(cq.data || []);
      if (!cq.data || cq.data.length < 1000) break;
      start += 1000;
    }
    /* ⚠ SYNTHETIC EXCLUSION — same shared rule (lib/real-calls.js). This
       aggregates across a team, so demo copies would count as real reps. */
    calls = realCallsOnly(calls);

    var ids = calls.map(function (c) { return c.id; });
    var analyses = [], objections = [];
    for (var i = 0; i < ids.length; i += 100) {
      var slice = ids.slice(i, i + 100);
      var aq = await admin.from('call_analyses').select('fathom_call_id, outcome')
        .in('fathom_call_id', slice).eq('status', 'done');
      if (aq.error) throw new Error('call_analyses: ' + aq.error.message);
      analyses = analyses.concat(aq.data || []);
      var oq = await admin.from('call_highlights').select('fathom_call_id, resolution')
        .in('fathom_call_id', slice).eq('type', 'objection');
      if (oq.error) throw new Error('call_highlights: ' + oq.error.message);
      objections = objections.concat(oq.data || []);
    }

    // ⚠ "handled" is the SHARED definition (resolution 'handled' OR the call
    // closed). This is a RATE surface, so it credits closed calls — see
    // lib/objection-handled.js and the per-call-site guard in
    // test/handled-carrier.test.js. Do not hand-roll the comparison here.
    var outcomeByCall = outcomeMap(analyses);

    /* ⚠⚠ DISQUALIFIED CALLS LEAVE BOTH GAUGES — closing rate AND objection
       handling. Justin's ruling: a DQ'd prospect was never closeable, so their
       objections were never winnable either, and leaving them in either
       denominator marks a rep down for a call that could not be won.
       ⚠ THE CALL-TIME GAUGE IS DELIBERATELY LEFT ALONE. It is an average
       DURATION, not a rate with a prospect or objection denominator — the call
       genuinely happened and genuinely took that long. Excluding it there would
       be hiding the work, which is the not_a_sales_call behaviour this is not. */
    var dqGauge = {};
    analyses.forEach(function (a2) { if (isDisqualified(a2)) dqGauge[a2.fathom_call_id] = 1; });
    objections = objections.filter(function (o) { return !dqGauge[o.fathom_call_id]; });
    /* ⚠⚠ THE STRICT DENOMINATOR, FROM THE STORED CLASS — this gauge used to count
       EVERY objection moment while the focus panel counted true objections only,
       so a rep read two different numbers under one name. One definition now:
       lib/objection-strict.js. Nothing gets slower — the class is cached on the
       moment at analysis time rather than classified per surface. */
    objections = strictObjections(objections);
    var ratedCalls = calls.filter(function (c) { return !dqGauge[c.id]; });

    var callOwner = {}, callDuration = {};
    calls.forEach(function (c) { callOwner[c.id] = c.user_id; callDuration[c.id] = c.duration_seconds; });

    var per = {};
    function slot(uid) {
      if (!per[uid]) {
        per[uid] = {
          user_id: uid,
          closing: { numerator: 0, total: 0 },
          objections: { numerator: 0, total: 0 },
          calltime: { seconds: 0, calls: 0 },
        };
      }
      return per[uid];
    }
    candidates.forEach(slot);

    // A prospect is counted ONCE for its owner, and closed if ANY of their calls
    // closed — the standing close-rate ruling, not a per-call rate.
    var prospectClosed = {}, prospectOwner = {};
    ratedCalls.forEach(function (c) {
      var s = slot(c.user_id);
      // ⚠ duration is nullable (1 of 368 real calls). A missing duration is
      // EXCLUDED from the average, never counted as a zero-length call.
      if (typeof c.duration_seconds === 'number' && isFinite(c.duration_seconds)) {
        s.calltime.seconds += c.duration_seconds;
        s.calltime.calls += 1;
      }
      if (c.prospect_id) {
        prospectOwner[c.prospect_id] = c.user_id;
        if (outcomeByCall[c.id] === 'closed') prospectClosed[c.prospect_id] = true;
      }
    });
    /* ⚠⚠ ONE COMPUTATION — this gauge used to roll its own prospects up, and the
       manager graph rolled up a third way. The three agreed by luck rather than
       by construction, and only one of them applied merge remapping.
       closeRateForCalls is now THE definition; the WINDOW stays this endpoint's
       own concern (fixed 7 days here, the picker on the graph).
       ⚠ It is called PER REP so each gauge slot gets its own rate, and no-shows
       and DQs leave the denominator inside it — calls TAKEN, not booked. */
    var byRep = {};
    ratedCalls.forEach(function (c) {
      if (!c.prospect_id) return;
      (byRep[c.user_id] = byRep[c.user_id] || []).push({
        id: c.id, user_id: c.user_id, prospect_id: c.prospect_id,
        call_date: c.call_date, outcome: outcomeByCall[c.id],
      });
    });
    Object.keys(byRep).forEach(function (uid) {
      var r = closeRateForCalls(byRep[uid], {});
      var sl = slot(uid);
      sl.closing.total += r.total;
      sl.closing.numerator += r.closed;
    });
    objections.forEach(function (o) {
      var uid = callOwner[o.fathom_call_id];
      if (!uid) return;
      var s = slot(uid);
      s.objections.total += 1;
      if (isHandled(o, outcomeByCall[o.fathom_call_id])) s.objections.numerator += 1;
    });

    var reps = Object.keys(per).map(function (k) { return per[k]; });
    var metrics = {};
    TA.METRIC_ORDER.forEach(function (key) {
      var m = TA.METRICS[key];
      var pooled = (key === 'calltime') ? TA.poolDuration(reps) : TA.poolRate(reps, key);
      var counts = TA.repCounts(reps, key);
      metrics[key] = {
        key: key, label: m.label, target: m.target, scale: m.scale, unit: m.unit,
        value: pooled.value, numerator: pooled.numerator, total: pooled.total,
        enough: pooled.enough, reason: pooled.reason,
        unit_name: m.unitName, numerator_name: m.numeratorName,
        // Direction travels WITH the metric to the browser, so the render can
        // never re-derive it from a comparison of its own.
        direction: m.direction, target_caption: m.targetCaption,
        /* ⚠⚠ TWO DIFFERENT THINGS, DELIBERATELY NOT BOTH CALLED `band`. `band` is
           the CLASSIFICATION (good/mid/bad) and has meant that since the panel
           shipped; `sweet_spot` carries the EDGES so the dial can draw a ZONE
           rather than a notch. Reusing one name for both would be a shared
           carrier inside a single payload. */
        band: TA.band(pooled.value, m.target, m.direction, m.band),
        sweet_spot: m.band ? { good: m.band.good, ok: m.band.ok } : null,
        counts: counts, count_sentence: TA.countSentence(counts, key),
      };
    });

    res.json({ window: win, metrics: metrics, reps: { total: reps.length }, team: { label: team.label } });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    if (err.status) return res.status(err.status).json({ error: err.message });
    logTeamError('averages', err);
    res.status(500).json({ error: 'Failed to load team averages' });
  }
});

function emptyMetrics() {
  var out = {};
  TA.METRIC_ORDER.forEach(function (key) {
    var m = TA.METRICS[key];
    var counts = { meeting: 0, measured: 0, unmeasured: 0, total: 0 };
    out[key] = {
      key: key, label: m.label, target: m.target, scale: m.scale, unit: m.unit,
      value: null, numerator: 0, total: 0, enough: false,
      reason: 'no reps on this team', unit_name: m.unitName, numerator_name: m.numeratorName,
      direction: m.direction, target_caption: m.targetCaption,
      band: null, sweet_spot: m.band ? { good: m.band.good, ok: m.band.ok } : null,
      counts: counts, count_sentence: TA.countSentence(counts, key),
    };
  });
  return out;
}

router.get('/rep-series', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  // 'day' added for the 7-day manager graphs (ruling 2026-08-15): weekly buckets
  // over 7 days collapse to a single point, which draws as a dot with no line.
  // Scoped to THIS route — /team/trends keeps week|month|quarter, since a daily
  // trend bucket is not something that view asks for or renders.
  var BUCKETS = ['day', 'week', 'month', 'quarter'];
  var bucket = BUCKETS.indexOf(req.query.bucket) !== -1 ? req.query.bucket : 'week';
  var cat = (OBJECTION_CATEGORIES.indexOf(req.query.objection_category) !== -1) ? req.query.objection_category : null;
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);

    // ⚠ the board owner is already in memberIds — resolveTeam owns that rule
    // now, so this endpoint no longer carries its own copy of it.
    var candidates = team.memberIds.slice();
    if (candidates.length === 0) return res.json({ bucket: bucket, buckets: [], reps: [], team: { handle: [], close: [] } });

    var calls = [], start = 0;
    for (;;) {
      /* ⚠ `duration_seconds` ADDED FOR THE CALL-LENGTH SERIES. The column already
         exists and is populated on 2,052 of 2,058 real calls — this is one field
         on a query that was already being made, not new stored data. */
      var cq = await admin.from('fathom_calls').select('id, user_id, fathom_call_id, call_date, prospect_id, duration_seconds')
        .in('user_id', candidates).gte('call_date', range.from).lte('call_date', range.to)
        .not('not_a_sales_call', 'is', true)
        .is('duplicate_of', null)
        .range(start, start + 999);
      if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
      calls = calls.concat(cq.data || []);
      if (!cq.data || cq.data.length < 1000) break;
      start += 1000;
    }
    /* ⚠ SYNTHETIC EXCLUSION — same shared rule (lib/real-calls.js). This
       aggregates across a team, so demo copies would count as real reps. */
    calls = realCallsOnly(calls);

    var ids = calls.map(function (c) { return c.id; });
    var analyses = [], objections = [];
    for (var i = 0; i < ids.length; i += 100) {
      var slice = ids.slice(i, i + 100);
      // price_stated_at_seconds drives the third graph (item j). Selecting it
      // here is the same class of omission that made the Part-1b section tags
      // invisible — the component was fine, the SELECT did not fetch the column.
      /* ⚠ `overall_score` ADDED FOR THE SCORE SERIES — populated on 1,555 of
         1,589 done analyses. Same shape: one field on an existing query. */
      var aq = await admin.from('call_analyses').select('fathom_call_id, outcome, price_stated_at_seconds, overall_score').in('fathom_call_id', slice).eq('status', 'done');
      if (aq.error) throw new Error('call_analyses: ' + aq.error.message);
      analyses = analyses.concat(aq.data || []);
      var oq = await admin.from('call_highlights').select('fathom_call_id, resolution, objection_category')
        .in('fathom_call_id', slice).eq('type', 'objection');
      if (oq.error) throw new Error('call_highlights: ' + oq.error.message);
      objections = objections.concat(oq.data || []);
    }

    // A rep with NO calls in the window is absent from the chart entirely —
    // not drawn as a flat zero, and not an empty legend entry implying a line.
    var withCalls = {}; calls.forEach(function (c) { withCalls[c.user_id] = true; });
    var em = await emailMap(admin);
    /* ⚠⚠ price_pif IS NO LONGER SELECTED HERE, AND THAT IS THE POINT (2026-08-31).
       It used to come along because its ABSENCE was the reason a rep had no
       price line — the finder only ran for a rep who had saved their own offer
       price, and 8 of 9 had not. The finder now works from total-framing
       language instead, so EVERY rep is measurable and there is no longer a
       "cannot be measured" group to name. A dropped rep simply has no priced
       call in this window, which the chart says.
       ⚠ price_pif itself is untouched — it is still edited via /me and /admin
       and stored on the profile. Only this ONE consumer went away. */
    var profs = await admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', candidates);
    // Hand the PROFILE ROW to the resolver rather than pre-joining the name here
    // — the join-and-fallback rules live in lib/display-name.js and nowhere else.
    var profOf = {};
    (profs.data || []).forEach(function (p) { profOf[p.user_id] = p; });
    var reps = candidates.filter(function (id) { return withCalls[id]; }).map(function (id) {
      // ⚠ THE GAUGE PANEL AND THE LINE GRAPHS ARE NAMED FROM HERE. This was a
      // raw local-part, which is why the dials read "josh" and "demo-ava".
      var pf = profOf[id];
      return {
        user_id: id,
        name: resolveDisplayName(pf, em[id] || null, id),
      };
    });

    res.json(buildRepSeries({
      reps: reps, calls: calls, analyses: analyses, objections: objections,
      from: range.from, to: range.to, bucket: bucket, objectionCategory: cat,
    }));
  } catch (err) {
    if (handleConfigError(err, res)) return;
    if (err.status) return res.status(err.status).json({ error: err.message });
    logTeamError('rep-series', err);
    res.status(500).json({ error: 'Failed to load rep series' });
  }
});

router.get('/recommendations', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var data = await computeTeamRecommendations(admin, team.keyId, team.memberIds, range.from, range.to, em, await nameMapFor(admin, team.memberIds, em));
    res.json(data);
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('recommendations', err); res.status(500).json({ error: 'Failed to load team recommendations' }); }
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
  } catch (err) { if (handleConfigError(err, res)) return; logTeamError('summary', err); res.status(500).json({ error: 'Failed to generate summary' }); }
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
    var rows = await loadBucketEvidence(admin, team.memberIds, surfaces, from, to);
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
    var data = await computeTeamNeedsWork(admin, team.keyId, team.memberIds, range.from, range.to, em, await nameMapFor(admin, team.memberIds, em));
    res.json(data);
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('needs-work', err); res.status(500).json({ error: 'Failed to load what-needs-work' }); }
});

/* ⚠⚠ GET /team/highlights — RETIRED 2026-09-01 (Justin's ruling), archived in
   place. THE REASON, so nobody uncomments this as tidying: UNUSEFUL, HARD TO
   REACH, AND 87% OF ITS QUOTES WERE THE PROSPECT RATHER THAN THE CLOSER —
   1,004 of 1,160 candidate moments carried no closer reply at all.
   ⚠ The compute is archived in lib/team-synthesis.js with the full measurement
   and the CSS-revival warning. Nothing else calls it; the recommendations lane
   in that file is INDEPENDENT (its own select, its own cache type) and stays.
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
    var data = await computeWeeklyHighlights(admin, team.keyId, team.memberIds, weekFrom.toISOString(), weekTo.toISOString(), em, await nameMapFor(admin, team.memberIds, em));
    res.json(Object.assign({ week_from: weekFrom.toISOString(), week_to: weekTo.toISOString() }, data));
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('highlights', err); res.status(500).json({ error: 'Failed to load highlights' }); }
});
*/

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
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('digest', err); res.status(500).json({ error: 'Failed to load digest' }); }
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
  } catch (err) { if (handleConfigError(err, res)) return; logTeamError('digest/run', err); res.status(500).json({ error: 'Digest generation failed' }); }
});

/**
 * GET /team/objections?category=&from=&to=  — the objection drilldown (2026-08-22).
 *
 * MANAGER VIEW ONLY (Justin's ruling): closers keep their existing per-user
 * objection surfaces at /me/objections*. This is gated by `teamGate`
 * SERVER-SIDE — hiding the nav link is not access control, and the forbidden
 * case is exercised over HTTP with a forged closer in team-objections.test.js.
 *
 * ⚠ The date range is the caller's, in the same ISO format every other team
 * surface uses, so the existing picker drives it with no new component and no
 * new default.
 */
/**
 * user_id → display name for a board.
 *
 * ⚠ SHARED BY THE GRID AND THE SUMMARY DELIBERATELY. They render on the same
 * screen, and the summary names people in prose — a second copy of this that
 * drifted would have the paragraph calling someone by a different name from the
 * row directly above it.
 */
/**
 * ⚠⚠ A PROGRAMMER ERROR AND AN OPERATIONAL ONE MUST NOT LOOK THE SAME IN THE LOG.
 *
 * Every catch here answered a 500 with a generic client message and logged
 * `err.message` alone — no stack. `/team/why-prose` had NEVER worked (it called
 * an undefined `getAdminClient`, throwing a ReferenceError on its first line)
 * and the only trace was one line saying "getAdminClient is not defined", with
 * nothing to say WHERE. It sat broken for weeks behind a panel that rendered
 * its own error state.
 *
 * ⚠ THE GENERIC CLIENT MESSAGE IS CORRECT AND STAYS. Leaking an internal name
 * to a browser is worse. The fix is to make a programmer error LOUD on the
 * SERVER — a ReferenceError or TypeError is a bug in our code and gets its
 * stack; a database timeout is an operational fact and does not.
 */
function logTeamError(tag, err) {
  var isBug = (err instanceof ReferenceError) || (err instanceof TypeError);
  if (isBug) console.error('[team] ' + tag + ' — PROGRAMMER ERROR (this is a bug, not an outage):', err && err.stack);
  else console.error('[team] ' + tag + ':', err && err.message);
}

/* ⚠⚠ MOVED TO lib/team-name-map.js (2026-09-01). The cron warm-up needs the
   IDENTICAL map — the names go into the cached prose, so a warm-up built with a
   different one writes an entry this page then serves with the wrong names in
   it, silently. `disambiguateNames` is the part that would have diverged: the
   digest's own name map does not apply it. One implementation, two callers. */

router.get('/objections', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  var category = (OBJ_DRILL_CATEGORIES.indexOf(req.query.category) !== -1) ? req.query.category : null;
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var nameMap = await nameMapFor(admin, team.memberIds, em);

    var data = await computeTeamObjections(admin, team.memberIds, range.from, range.to,
      { category: category, emailMap: em, nameMap: nameMap });
    res.json(Object.assign({ team: { label: team.label, key: team.keyId, mode: team.mode } }, data));
  } catch (err) { if (handleConfigError(err, res)) return; if (err.status) return res.status(err.status).json({ error: err.message }); logTeamError('objections', err); res.status(500).json({ error: 'Failed to load team objections' }); }
});

/**
 * The coaching summary — step 3. The only lane here that costs money.
 *
 * ⚠ SAME GATE, SAME `resolveTeam`, SAME NAME MAP as the grid. A separate
 * authorization path for the expensive lane is how a closer ends up able to
 * spend a model call on a board they cannot see.
 */
router.get('/objections/summary', teamGate, async function (req, res) {
  var range = rangeFrom(req); if (!range) return res.status(400).json({ error: 'from/to must be ISO 8601' });
  try {
    var admin = getAdmin();
    var team = await resolveTeam(admin, req);
    var em = await emailMap(admin);
    var nameMap = await nameMapFor(admin, team.memberIds, em);

    var data = await computeTeamObjectionSummary(admin, team.memberIds, range.from, range.to,
      { keyId: team.keyId, emailMap: em, nameMap: nameMap });
    res.json(Object.assign({ team: { label: team.label, key: team.keyId, mode: team.mode } }, data));
  } catch (err) {
    if (handleConfigError(err, res)) return;
    if (err.status) return res.status(err.status).json({ error: err.message });
    // ⚠ the stack, not just the message — see the OPEN item on this file's catch
    // shape: a ReferenceError and a DB timeout are otherwise indistinguishable,
    // which is why /team/why-prose sat broken from the day it was written.
    console.error('[team] objections/summary:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to load the coaching summary' });
  }
});

// ⚠ Pure-ish helpers exported for test, per the log.js `_validateLogBatch`
// pattern. resolveTeam is the ONE place that decides who is on a board, so it
// is the one place worth pinning — see team-membership.test.js.
router._resolveTeam = resolveTeam;
router._repIdsFor = repIdsFor;

module.exports = router;
