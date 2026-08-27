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

/* ⚠⚠ ONE DEFINITION, because a reference is only useful if the value the PERSON
   was given is the value the ADMIN can find. Derived from the id rather than
   stored, so it can never drift from the row and needs no collision handling.
   ⚠ HEX HAS NO LETTER O, so there is no 0/O ambiguity when it is read aloud —
   the one property that matters for a code quoted down a phone line. */
function referenceFor(id) { return String(id || '').slice(0, 8).toUpperCase(); }

/* ⚠ APPROVED CATEGORIES (Justin, 2026-08-27). Grounded in what has actually
   been reported, not a generic taxonomy — see migration 053 for the mapping.
   ⚠ ONE LIST, shared by the validator and the admin filter; the labels live on
   the client. A second copy is how the two come to disagree. */
const CATEGORIES = ['sync_grading', 'wrong_data', 'wrong_coaching', 'cant_find', 'other'];

const ATTACH_BUCKET = 'support-attachments';
/* ⚠⚠ 5 MB, IMAGES ONLY — AND IT IS ENFORCED ON THE BUCKET ITSELF, not only here.
   A limit that lives only in application code is one bad code path from being
   bypassed; Supabase refuses an oversized or wrong-typed object outright. This
   check exists so the person gets a clear message BEFORE waiting for an upload
   that storage would reject anyway. */
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_LINK = 500;

/* A pasted video link. ⚠ http/https ONLY — `javascript:` and `data:` URLs in a
   field an admin later clicks is the obvious way to turn a support form into an
   attack surface. Scheme allowlist, never a blocklist. */
function cleanLink(raw) {
  var v = (typeof raw === 'string') ? raw.trim() : '';
  if (!v) return null;
  if (v.length > MAX_LINK) return null;
  try {
    var u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch (e) { return null; }
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

  /* ⚠ AN UNKNOWN CATEGORY IS STORED AS NULL, NOT REJECTED. The MESSAGE is the
     ticket; refusing a report because a dropdown value was unexpected would
     lose the thing that matters over the thing that does not. */
  var category = (req.body && CATEGORIES.indexOf(req.body.category) !== -1) ? req.body.category : null;
  var linkUrl = cleanLink(req.body && req.body.link_url);

  /* ⚠⚠ THE ATTACHMENT IS ALREADY UPLOADED BY NOW — see POST /attachments. It is
     a separate request on purpose: it keeps the 6-second send unchanged, and it
     surfaces an upload failure WHEN THEY PICK THE FILE rather than after they
     have written everything and pressed Send. */
  var attachPath = (req.body && typeof req.body.attachment_path === 'string') ? req.body.attachment_path : null;
  var attachName = (req.body && typeof req.body.attachment_name === 'string') ? req.body.attachment_name.slice(0, 200) : null;
  var attachError = (req.body && typeof req.body.attachment_error === 'string') ? req.body.attachment_error.slice(0, 300) : null;
  /* ⚠ THE PATH MUST BE THEIRS. It is client-supplied, so a crafted value could
     otherwise attach someone else's file to your own ticket. Paths are minted
     as `<user_id>/<random>` and this is the check that keeps them honest. */
  if (attachPath && attachPath.indexOf(req.user.id + '/') !== 0) {
    console.warn('[support] rejected foreign attachment path from %s: %s', req.user.id, attachPath);
    attachPath = null; attachName = null;
    attachError = 'attachment rejected (path did not belong to the uploader)';
  }

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
      .insert({ user_id: req.user.id, message: message, page: page, snapshot: snapshot, snapshot_error: snapshotError,
                category: category, link_url: linkUrl,
                attachment_path: attachPath, attachment_name: attachName, attachment_error: attachError })
      .select('id, created_at').maybeSingle();
    if (ins.error) throw new Error('insert: ' + ins.error.message);

    /* A short human reference. ⚠ The person needs something CONCRETE to quote —
       "I raised a ticket" is not checkable by either side. */
    var ref = referenceFor(ins.data.id);
    console.log('[support] ticket %s raised by %s from %s%s', ref, req.user.id, page || 'unknown page',
      snapshotError ? ' (snapshot FAILED)' : '');
    res.json({ ok: true, reference: ref, created_at: ins.data.created_at, snapshot_attached: !snapshotError });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] ticket raise failed for user ' + req.user.id + ':', err.stack || err.message);
    res.status(500).json({ error: 'Could not send that. Please email justin@scoutsystems.io.' });
  }
});

/* ── POST /support/attachments ────────────────────────────────────────────────
 * One screenshot, uploaded BEFORE the ticket is sent.
 *
 * ⚠⚠ ITS OWN REQUEST, DELIBERATELY. Folding it into the raise would add the
 * upload to a send that already takes ~6 seconds, and would surface a failure
 * only AFTER the person had written everything and pressed Send. Here they learn
 * immediately, while the form still holds their words.
 *
 * ⚠⚠ WHAT STOPS IT ACCEPTING SOMETHING DANGEROUS:
 *   · IMAGES ONLY, enforced on the BUCKET as well as here — a limit that lives
 *     only in application code is one bad path from being bypassed.
 *   · The bucket is PRIVATE. Nothing is ever served from a public URL, so a file
 *     cannot be fetched by guessing, linked to from elsewhere, or rendered as
 *     HTML by the browser.
 *   · The stored name is GENERATED, never the user's. An uploaded filename is
 *     attacker-controlled text and must not become a path.
 *   · 5 MB, and one file per ticket.
 *
 * ⚠ WHAT STOPS IT BEING FREE FILE HOSTING: private bucket + generated paths +
 * images only + 5 MB + a per-user rate limit + no public URL and no listing.
 * There is nothing to share and nothing to enumerate.
 */
var uploadCounts = Object.create(null);   // userId -> { n, windowStart }
const UPLOADS_PER_HOUR = 20;

router.post('/attachments', requireAuth, async function (req, res) {
  var contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_TYPES.indexOf(contentType) === -1) {
    return res.status(400).json({ error: 'Screenshots only — PNG, JPEG, GIF or WEBP.' });
  }

  /* ⚠ A CHEAP PER-USER CEILING. Not a security boundary — the private bucket and
     the type/size limits are — but it stops one account filling the tier. */
  var now = Date.now();
  var uc = uploadCounts[req.user.id];
  if (!uc || now - uc.windowStart > 3600000) uc = uploadCounts[req.user.id] = { n: 0, windowStart: now };
  if (uc.n >= UPLOADS_PER_HOUR) {
    return res.status(429).json({ error: 'Too many uploads just now. Send the ticket and email the file if you need to.' });
  }
  uc.n++;

  try {
    var chunks = [], total = 0, tooBig = false;
    await new Promise(function (resolve, reject) {
      req.on('data', function (c) {
        total += c.length;
        /* ⚠⚠ STOP BUFFERING AT THE CAP, BUT KEEP READING. Destroying the request
           protects memory and kills the connection before the 413 can be
           written — so the person sees a network error instead of "that image is
           over 5 MB", which is the one thing they needed to be told.
           ⚠ Memory is still bounded: chunks stop accumulating here. What we give
           up is bandwidth on a request the client-side check already prevents. */
        if (total > MAX_ATTACH_BYTES) { tooBig = true; return; }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', function (e) { tooBig ? resolve() : reject(e); });
      req.on('aborted', resolve);
    });
    if (tooBig) return res.status(413).json({ error: 'That image is over 5 MB. Please crop or compress it.' });
    var buf = Buffer.concat(chunks);
    if (!buf.length) return res.status(400).json({ error: 'That file was empty.' });

    var admin = getAdminClient();
    var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[contentType];
    // ⚠ GENERATED PATH, SCOPED TO THE UPLOADER. The prefix is what the raise
    // route checks, so a crafted path cannot attach someone else's file.
    var objectPath = req.user.id + '/' + require('crypto').randomBytes(16).toString('hex') + '.' + ext;
    var up = await admin.storage.from(ATTACH_BUCKET).upload(objectPath, buf, { contentType: contentType, upsert: false });
    if (up.error) throw new Error('storage: ' + up.error.message);

    res.json({ ok: true, path: objectPath, bytes: buf.length });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] attachment upload failed for user ' + req.user.id + ':', err.message);
    /* ⚠⚠ THE CLIENT IS TOLD TO SEND ANYWAY. An upload failure must never cost
       them the report — same rule as the broken diagnostics. */
    res.status(500).json({ error: 'Could not upload that image. You can still send the report without it.' });
  }
});

/* ── GET /support/attachment/:ticket_id ───────────────────────────────────────
 * A short-lived signed URL for one ticket's screenshot.
 *
 * ⚠⚠ ENFORCED IN THE QUERY, NOT THE VIEW: an owner may see any, and a person may
 * see THEIR OWN — because the file is theirs, unlike the diagnostics. Everyone
 * else is refused. The path is never returned; only a URL that expires.
 */
router.get('/attachment/:ticket_id', requireAuth, async function (req, res) {
  try {
    var admin = getAdminClient();
    var t = await admin.from('support_tickets')
      .select('user_id, attachment_path').eq('id', req.params.ticket_id).maybeSingle();
    if (t.error) throw new Error('lookup: ' + t.error.message);
    if (!t.data || !t.data.attachment_path) return res.status(404).json({ error: 'No attachment on that ticket.' });

    var isOwner = req.userProfileRole === 'owner';
    if (!isOwner && t.data.user_id !== req.user.id) {
      console.warn('[support] attachment scope violation: actor=%s ticket=%s', req.user.id, req.params.ticket_id);
      return res.status(403).json({ error: 'Not authorized for that attachment.' });
    }

    // 5 minutes — long enough to open, short enough that a copied URL dies.
    var signed = await admin.storage.from(ATTACH_BUCKET).createSignedUrl(t.data.attachment_path, 300);
    if (signed.error) throw new Error('sign: ' + signed.error.message);
    res.json({ url: signed.data.signedUrl });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] signed url failed:', err.message);
    res.status(500).json({ error: 'Could not open that attachment' });
  }
});

/* ── GET /support/my-tickets ──────────────────────────────────────────────────
 * A person's OWN tickets. Status only — no replies, no diagnostics.
 *
 * ⚠⚠ A SEPARATE QUERY, NOT THE ADMIN LIST FILTERED. The admin list carries other
 * companies' account state, so "the same list scoped to them" must be a
 * different query with a different SELECT — a hidden row is only a suggestion,
 * and one forgotten filter would leak every attached snapshot.
 *
 * ⚠⚠ THE SNAPSHOT COLUMNS ARE NOT SELECTED AT ALL, deliberately. They describe
 * an ACCOUNT, and on a shared company account that is not automatically theirs
 * to read. Omitting them from the query is stronger than omitting them from the
 * render: the data never leaves the database.
 *
 * ⚠ Justin's ruling: "admin-only" was about people seeing EACH OTHER'S tickets.
 * Someone seeing their own submission is not that list — the same distinction as
 * the submit control being universal while the list is not.
 */
router.get('/my-tickets', requireAuth, async function (req, res) {
  try {
    var admin = getAdminClient();
    var r = await admin.from('support_tickets')
      .select('id, created_at, page, message, status, category, link_url, attachment_name')   // ⚠ no snapshot, no snapshot_error
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (r.error) throw new Error('list: ' + r.error.message);
    res.json({
      tickets: (r.data || []).map(function (t) {
        return {
          reference: referenceFor(t.id),
          created_at: t.created_at, page: t.page, message: t.message, status: t.status,
          category: t.category, link_url: t.link_url,
          /* ⚠ THE NAME, NEVER THE PATH. An attachment they uploaded is theirs to
             know about, but handing back the storage path would let a client
             mint a URL for it outside the signed-URL route that gates access. */
          attachment_name: t.attachment_name,
        };
      }),
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[support] my-tickets failed for user ' + req.user.id + ':', err.stack || err.message);
    res.status(500).json({ error: 'Could not load your reports' });
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
      .select('id, user_id, created_at, page, message, snapshot, snapshot_error, status, closed_at, category, link_url, attachment_path, attachment_name, attachment_error')
      .order('created_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    // ⚠ Validated against the SAME list the raise path uses — an unknown value
    // must narrow to nothing rather than silently returning everything.
    if (req.query.category) {
      if (CATEGORIES.indexOf(req.query.category) === -1) return res.json({ tickets: [] });
      q = q.eq('category', req.query.category);
    }
    var r = await q;
    if (r.error) throw new Error('list: ' + r.error.message);

    // Emails in one batch — the same shape the admin user list already uses.
    var users = await admin.auth.admin.listUsers({ perPage: 1000 });
    var emailOf = {};
    ((users.data && users.data.users) || []).forEach(function (u) { emailOf[u.id] = u.email; });

    res.json({
      /* ⚠⚠ THE REFERENCE TRAVELS WITH THE ROW. Without it the code we hand the
         person appears NOWHERE an admin can see — so someone reading it out on a
         call could not be found, in the one moment the reference exists for. */
      tickets: (r.data || []).map(function (t) {
        return Object.assign({}, t, { email: emailOf[t.user_id] || null, reference: referenceFor(t.id) });
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
