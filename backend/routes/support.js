/* Support tickets — raise one from any page, any role.
 *
 * ⚠⚠ TWO DIFFERENT PERMISSION ANSWERS IN ONE FEATURE, AND CONFLATING THEM IS A
 * DATA LEAK. Submitting is UNIVERSAL — closers are the ones who hit problems.
 * The LIST is ADMIN-ONLY, because it carries other companies' account state.
 * Same feature, opposite gates.
 *
 * ⚠⚠ THE TICKET LANDS EVEN IF THE SNAPSHOT FAILS. A support tool that refuses a
 * report because its own diagnostics broke fails at exactly the moment someone
 * needs to reach us. The snapshot is best-effort and its failure is RECORDED on
 * the row (`snapshot_error`) rather than swallowed — "no snapshot" and "the
 * snapshot broke" are different facts to whoever reads the ticket.
 */
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const healthSnapshot = require('../lib/health-snapshot');
const { classifyFailure } = require('../lib/failure-class');

const router = express.Router();

function getAdminClient() {
  var url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured — missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}
function handleConfigError(err, res) {
  if (err && err.message && err.message.indexOf('not configured') !== -1) {
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

const MAX_MESSAGE = 4000;
const MAX_PAGE = 120;

/* ── POST /support/tickets ────────────────────────────────────────────────────
 * Any authenticated user. Returns a REFERENCE so the person has something
 * concrete rather than a message that vanishes — see the silence note in
 * CLAUDE.md.
 */
router.post('/tickets', requireAuth, async function (req, res) {
  var message = (req.body && typeof req.body.message === 'string') ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Please describe what went wrong.' });
  if (message.length > MAX_MESSAGE) message = message.slice(0, MAX_MESSAGE);

  var page = (req.body && typeof req.body.page === 'string') ? req.body.page.trim().slice(0, MAX_PAGE) : null;

  try {
    var admin = getAdminClient();

    /* ⚠⚠ BEST-EFFORT, AND DELIBERATELY NOT AWAITED INTO THE FAILURE PATH. The
       snapshot is 2-4s of head-counts; if it throws, times out, or the DB is the
       very thing that is broken, the ticket must still be raised. Its failure is
       recorded so the admin knows the diagnostics are missing rather than
       reading an empty snapshot as "nothing was wrong". */
    var snapshot = null, snapshotError = null;
    try {
      snapshot = await healthSnapshot.buildSnapshot(admin, req.user.id, { classifyFailure: classifyFailure });
    } catch (snapErr) {
      snapshotError = String((snapErr && snapErr.message) || 'unknown').slice(0, 500);
      console.error('[support] snapshot failed for user ' + req.user.id + ' — raising the ticket anyway: ' + snapshotError);
    }

    var ins = await admin.from('support_tickets')
      .insert({ user_id: req.user.id, message: message, page: page, snapshot: snapshot, snapshot_error: snapshotError })
      .select('id, created_at').maybeSingle();
    if (ins.error) throw new Error('insert: ' + ins.error.message);

    /* A short human reference. ⚠ The person needs something CONCRETE to quote —
       "I raised a ticket" is not checkable by either side. */
    var ref = String(ins.data.id).slice(0, 8).toUpperCase();
    console.log('[support] ticket %s raised by %s from %s%s', ref, req.user.id, page || 'unknown page',
      snapshotError ? ' (snapshot FAILED)' : '');
    res.json({ ok: true, reference: ref, created_at: ins.data.created_at, snapshot_attached: !snapshotError });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] ticket raise failed for user ' + req.user.id + ':', err.stack || err.message);
    res.status(500).json({ error: 'Could not send that. Please email justin@scoutsystems.io.' });
  }
});

/* ── GET /support/tickets ─────────────────────────────────────────────────────
 * ⚠⚠ ADMIN-ONLY — Justin's ruling. It carries other companies' account state,
 * which is why it is gated where submission is not.
 */
router.get('/tickets', requireAuth, requireRole('owner'), async function (req, res) {
  try {
    var admin = getAdminClient();
    var status = (req.query.status === 'closed') ? 'closed' : (req.query.status === 'all' ? null : 'open');
    var q = admin.from('support_tickets')
      .select('id, user_id, created_at, page, message, snapshot, snapshot_error, status, closed_at')
      .order('created_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    var r = await q;
    if (r.error) throw new Error('list: ' + r.error.message);

    // Emails in one batch — the same shape the admin user list already uses.
    var users = await admin.auth.admin.listUsers({ perPage: 1000 });
    var emailOf = {};
    ((users.data && users.data.users) || []).forEach(function (u) { emailOf[u.id] = u.email; });

    res.json({
      tickets: (r.data || []).map(function (t) {
        return Object.assign({}, t, { email: emailOf[t.user_id] || null });
      }),
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] list failed:', err.stack || err.message);
    res.status(500).json({ error: 'Could not load tickets' });
  }
});

/* ── PATCH /support/tickets/:id ───────────────────────────────────────────────
 * open <-> closed. ⚠ TWO VALUES ON PURPOSE: a status nobody maintains is worse
 * than no status, and anything richer needs a workflow that does not exist.
 */
router.patch('/tickets/:id', requireAuth, requireRole('owner'), async function (req, res) {
  var status = req.body && req.body.status;
  if (status !== 'open' && status !== 'closed') return res.status(400).json({ error: 'status must be open or closed' });
  try {
    var admin = getAdminClient();
    var upd = await admin.from('support_tickets')
      .update({ status: status, closed_at: status === 'closed' ? new Date().toISOString() : null })
      .eq('id', req.params.id).select('id').maybeSingle();
    if (upd.error) throw new Error('update: ' + upd.error.message);
    if (!upd.data) return res.status(404).json({ error: 'ticket not found' });
    console.log('[support] ticket %s marked %s by %s', String(req.params.id).slice(0, 8), status, req.user.email);
    res.json({ ok: true, status: status });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] status update failed:', err.stack || err.message);
    res.status(500).json({ error: 'Could not update that ticket' });
  }
});

module.exports = router;
