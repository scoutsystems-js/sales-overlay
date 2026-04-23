const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireSubscription } = require('../middleware/auth');

var router = express.Router();

// Session + log inserts bypass RLS using the service role key. Clients can
// only SELECT their own rows (RLS enforces that); everything gets written
// server-side so we can trust the user_id stamped on each row.
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  var missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    throw new Error('Supabase admin not configured — missing: ' + missing.join(', ') + ' (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[log] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

// Upper bound per batch so a misbehaving client can't dump megabytes in one call.
// 100 entries × ~500 bytes each = ~50KB per batch — very safe for Railway.
var MAX_BATCH_ENTRIES = 100;
var MAX_MESSAGE_LEN = 4000;
var ALLOWED_LEVELS = ['info', 'warn', 'error'];

var protect = [requireAuth, requireSubscription];

// ── POST /log/session-start ─────────────────────────────────────────────────
// Creates a new call_sessions row when the user clicks Start in the app.
// Returns session_id that the client tags all subsequent log entries with.
router.post('/session-start', protect, async function(req, res) {
  var { clientVersion, platform } = req.body || {};
  try {
    var admin = getAdminClient();
    var insert = await admin
      .from('call_sessions')
      .insert({
        user_id: req.user.id,
        client_version: (clientVersion && String(clientVersion).slice(0, 32)) || null,
        platform: (platform && String(platform).slice(0, 64)) || null,
      })
      .select('session_id')
      .single();

    if (insert.error) {
      console.error('[log] session-start insert failed:', insert.error.message);
      return res.status(500).json({ error: 'Could not create session' });
    }
    res.json({ session_id: insert.data.session_id });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[log] session-start error:', err.message);
    res.status(500).json({ error: 'Session start failed' });
  }
});

// ── PATCH /log/session-end/:session_id ──────────────────────────────────────
// Marks a session as ended. Caller can optionally include an outcome
// (win | loss | follow_up) once post-call summary ships.
router.patch('/session-end/:session_id', protect, async function(req, res) {
  var sessionId = req.params.session_id;
  var { outcome } = req.body || {};

  if (outcome && ['win', 'loss', 'follow_up'].indexOf(outcome) === -1) {
    return res.status(400).json({ error: 'outcome must be win, loss, or follow_up' });
  }

  try {
    var admin = getAdminClient();
    // user_id filter in the update doubles as an ownership check — if someone
    // else's session_id is supplied, the update finds zero rows and no-ops.
    var update = await admin
      .from('call_sessions')
      .update({ ended_at: new Date().toISOString(), outcome: outcome || null })
      .eq('session_id', sessionId)
      .eq('user_id', req.user.id)
      .select('session_id')
      .maybeSingle();

    if (update.error) {
      console.error('[log] session-end update failed:', update.error.message);
      return res.status(500).json({ error: 'Could not end session' });
    }
    if (!update.data) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ session_id: update.data.session_id });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[log] session-end error:', err.message);
    res.status(500).json({ error: 'Session end failed' });
  }
});

// ── POST /log ───────────────────────────────────────────────────────────────
// Accepts a batch of log entries. Validates structure, stamps user_id and
// session_id server-side (ignores anything the client might claim), bulk
// inserts. Entries that fail validation are silently dropped — one bad
// entry shouldn't kill the whole batch.
//
// Body shape:
//   { session_id: "<uuid>", entries: [ { level, tag?, message, logged_at }, ... ] }
router.post('/', protect, async function(req, res) {
  var validation = validateLogBatch(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  var { session_id, rows } = validation;

  try {
    var admin = getAdminClient();

    // Confirm the session belongs to this user before we insert against it.
    // Prevents a valid auth token being used to scribble on someone else's session.
    var ownerCheck = await admin
      .from('call_sessions')
      .select('session_id')
      .eq('session_id', session_id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (ownerCheck.error) {
      console.error('[log] owner check failed:', ownerCheck.error.message);
      return res.status(500).json({ error: 'Could not validate session' });
    }
    if (!ownerCheck.data) {
      return res.status(404).json({ error: 'Session not found' });
    }

    var stamped = rows.map(function(r) {
      return {
        session_id: session_id,
        user_id: req.user.id,
        logged_at: r.logged_at,
        level: r.level,
        tag: r.tag,
        message: r.message,
      };
    });

    var insert = await admin.from('session_logs').insert(stamped);
    if (insert.error) {
      console.error('[log] bulk insert failed:', insert.error.message);
      return res.status(500).json({ error: 'Could not write logs' });
    }

    // Session counters (log_count, error_count) are recomputed on read from
    // session_logs — simpler than maintaining counters and always correct.

    res.json({ accepted: stamped.length });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[log] insert error:', err.message);
    res.status(500).json({ error: 'Log write failed' });
  }
});

// Pulled out as a pure function so it's testable without mounting express,
// supabase, or auth middleware. Returns either { error: string } or
// { session_id, rows } with rows already normalized.
function validateLogBatch(body) {
  if (!body || typeof body !== 'object') return { error: 'Body required' };
  var { session_id, entries } = body;
  if (!session_id || typeof session_id !== 'string') return { error: 'session_id required' };
  if (!Array.isArray(entries)) return { error: 'entries must be an array' };
  if (entries.length === 0) return { error: 'entries must not be empty' };
  if (entries.length > MAX_BATCH_ENTRIES) {
    return { error: 'Batch too large — max ' + MAX_BATCH_ENTRIES + ' entries' };
  }

  var rows = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || typeof e !== 'object') continue;
    if (!e.message || typeof e.message !== 'string') continue;
    var level = ALLOWED_LEVELS.indexOf(e.level) !== -1 ? e.level : 'info';
    var tag = e.tag && typeof e.tag === 'string' ? e.tag.slice(0, 32) : null;
    var loggedAt = e.logged_at && typeof e.logged_at === 'string' ? e.logged_at : new Date().toISOString();
    rows.push({
      level: level,
      tag: tag,
      message: e.message.slice(0, MAX_MESSAGE_LEN),
      logged_at: loggedAt,
    });
  }

  if (rows.length === 0) return { error: 'No valid entries in batch' };
  return { session_id: session_id, rows: rows };
}

// Exported only for tests. Not mounted as a route.
router._validateLogBatch = validateLogBatch;

module.exports = router;
