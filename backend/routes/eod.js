// /eod/* — EOD Report (v1.4 EOD stage). Per-user daily call report the closer
// reviews, edits inline, and copies for Slack. In-dashboard only; no Slack API.
//
// Data model: analysis values come from call_analyses (grader-owned; a
// re-analysis rewrites them). User edits live in eod_edits (migration 021),
// one row per (user, call, field) — the render rule is ALWAYS
// "override if present, else analysis value", so a re-analysis can update its
// side without ever touching what the user typed. The analysis writer never
// writes eod_edits; the edit routes never write call_analyses.
//
// "Today" = the current America/New_York calendar day — the platform-wide
// convention established by the digest lane (lib/team-digest.js helpers).

const express = require('express');
const { syncFreshness } = require('../lib/eod-freshness');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');
const teamDigest = require('../lib/team-digest');

const router = express.Router();

// Must match migration 022's CHECK (field IN (...)) exactly.
// 'outcome' RETIRED from EOD editing (Thread 1, 2026-07-27): the canonical outcome
// is the manual call tag (PATCH /me/calls/:id/outcome), composed with payment
// structure into the EOD label. The EOD view shows it read-only; this route no
// longer accepts outcome edits. (No eod_edits.outcome rows existed to migrate.)
const { nameFromTitle } = require('../lib/prospect-name');

const EDITABLE_FIELDS = ['prospect_name', 'cash_collected', 'summary', 'payment_structure'];
const VALUE_CAPS = { prospect_name: 200, cash_collected: 20, summary: 3000, payment_structure: 20 };
// payment_structure is a CONSTRAINED choice — mirrors the analysis-worker
// allowlist; the route rejects anything else (no free text).
const PAYMENT_STRUCTURES = ['paid_in_full', 'payment_plan', 'bnpl', 'none_stated'];

// Outcome prefill (product ruling 2026-07-22): closed calls with a KNOWN
// payment structure prefill as a composed label ("Closed - PIF" etc.) instead
// of the raw enum — the structure no longer renders as its own EOD row.
// Non-closed (and closed-but-none_stated) stay plain. Free-text editable as
// before; a stored outcome edit wins over the composed label untouched.
var COMPOSED_OUTCOME = { paid_in_full: 'Closed - PIF', payment_plan: 'Closed - Payment plan', bnpl: 'Closed - Financed' };
function outcomePrefill(a) {
  if (a && a.outcome === 'closed' && COMPOSED_OUTCOME[a.payment_structure]) {
    return COMPOSED_OUTCOME[a.payment_structure];
  }
  return (a && a.outcome) || null;
}

// EOD prefill rule (v8): the first-person eod_summary when present, falling
// back to the analytical overall_summary for pre-v8 rows. Edits override both.
function summaryPrefill(a) {
  return (a && typeof a.eod_summary === 'string' && a.eod_summary.trim()) ? a.eod_summary
    : ((a && a.overall_summary) || null);
}

var _admin = null;
function getAdmin() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _admin;
}
function handleConfigError(err, res) {
  if (err && err.message && err.message.indexOf('not configured') !== -1) { res.status(503).json({ error: err.message }); return true; }
  return false;
}

// PROSPECT NAMES 3a — the resolved name replaces the title-derived one.
//
// Precedence: the stored resolved name → a CLEANED title parse → "Unknown
// prospect". The middle branch matters during the window between 3a shipping
// and 3c's backfill: un-backfilled rows still get a name, but `nameFromTitle`
// REFUSES meeting labels, so "Impromptu Zoom Meeting" can never appear as a
// prospect again even before the backfill runs.
//
// The original implementation is preserved below, commented in place. It
// returned the last '|' segment unconditionally — which is why 11 distinct real
// prospects all displayed as the single prospect "Impromptu Zoom Meeting", and
// why booked-name titles displayed over the person who actually attended.
//
// function prospectNameFromTitle(title) {
//   if (!title || typeof title !== 'string' || !title.trim()) return 'Unknown prospect';
//   var parts = title.split('|').map(function (p) { return p.trim(); }).filter(Boolean);
//   return parts.length ? parts[parts.length - 1] : 'Unknown prospect';
// }
function prospectNameFor(analysisRow, title) {
  var stored = analysisRow && analysisRow.prospect_name;
  if (stored && String(stored).trim()) return String(stored).trim();
  return nameFromTitle(title) || 'Unknown prospect';
}

// The one merge rule: override if present (even empty-string — a deliberate
// clear), else analysis value. Returns effective fields + per-field edited flags.
// Read-only display fields (Thread 1): shown in the EOD view but not editable
// (outcome is the canonical call tag now). Carried into fields with no edited flag.
var READONLY_FIELDS = ['outcome'];
function applyEdits(analysis, edits) {
  var fields = {}, edited = {};
  EDITABLE_FIELDS.forEach(function (f) {
    var has = edits && Object.prototype.hasOwnProperty.call(edits, f);
    fields[f] = has ? edits[f] : analysis[f];
    edited[f] = !!has;
  });
  READONLY_FIELDS.forEach(function (f) { fields[f] = analysis[f]; });
  return { fields: fields, edited: edited };
}

// GET /eod?date=YYYY-MM-DD — the caller's own calls for that ET day (default:
// today, ET). Returns per call: analysis-sourced prefills + the user's edits,
// pre-merged, plus per-field edited flags so the UI can mark overrides.
router.get('/', requireAuth, async function (req, res) {
  try {
    var admin = getAdmin();
    var userId = req.user.id;
    var date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      ? req.query.date : teamDigest.etDateOf(new Date());
    var bounds = teamDigest.etDayBoundsUtc(date);

    /* ⚠⚠ IS THIS DAY FINISHED? Josh's EOD showed 3 for a day he took 6 on, and
       the 3 was correct — two calls had not synced yet and one exists only in a
       provider he is not connected to. The page said nothing, so a still-filling
       day looked identical to a finished one.
       ⚠ The NEWEST sync across his sources: if any source has run since the day
       ended, everything that source had a chance to deliver is here. */
    var syncTimes = [];
    var fq = await admin.from('fathom_connections').select('last_sync_at').eq('user_id', userId).maybeSingle();
    if (!fq.error && fq.data) syncTimes.push(fq.data.last_sync_at || null);
    var zq = await admin.from('call_connections').select('last_sync_at').eq('user_id', userId);
    if (!zq.error) (zq.data || []).forEach(function (c) { syncTimes.push(c.last_sync_at || null); });
    var connected = syncTimes.length > 0;
    var newest = syncTimes.filter(Boolean).sort().pop() || null;
    var freshness = syncFreshness({
      date: date, lastSyncAt: newest, dayEndsIso: bounds.toIso, connected: connected, now: new Date(),
    });

    var callsQ = await admin.from('fathom_calls')
      .select('id, title, call_date, recording_url')
      .eq('user_id', userId)
      .gte('call_date', bounds.fromIso).lt('call_date', bounds.toIso)
      .not('not_a_sales_call', 'is', true)
      .not('duplicate_of', 'is', null)
      .order('call_date', { ascending: true });
    if (callsQ.error) throw new Error('fathom_calls: ' + callsQ.error.message);
    var calls = callsQ.data || [];
    if (calls.length === 0) return res.json({ date: date, calls: [], sync: freshness });

    var callIds = calls.map(function (c) { return c.id; });
    var anQ = await admin.from('call_analyses')
      .select('fathom_call_id, status, outcome, overall_summary, eod_summary, cash_collected, payment_structure, prospect_name')
      .in('fathom_call_id', callIds);
    if (anQ.error) throw new Error('call_analyses: ' + anQ.error.message);
    var anByCall = {};
    (anQ.data || []).forEach(function (a) { anByCall[a.fathom_call_id] = a; });

    var edQ = await admin.from('eod_edits')
      .select('fathom_call_id, field, value')
      .eq('user_id', userId).in('fathom_call_id', callIds);
    if (edQ.error) throw new Error('eod_edits: ' + edQ.error.message);
    var edByCall = {};
    (edQ.data || []).forEach(function (e) {
      (edByCall[e.fathom_call_id] = edByCall[e.fathom_call_id] || {})[e.field] = e.value;
    });

    var out = calls.map(function (c) {
      var a = anByCall[c.id] || {};
      var analysis = {
        prospect_name: prospectNameFor(a, c.title),
        outcome: outcomePrefill(a),
        cash_collected: (typeof a.cash_collected === 'number' || typeof a.cash_collected === 'string') ? String(a.cash_collected) : '0',
        summary: summaryPrefill(a),
        payment_structure: a.payment_structure || 'none_stated',
      };
      var merged = applyEdits(analysis, edByCall[c.id] || {});
      return {
        call_id: c.id,
        call_date: c.call_date,
        recording_url: c.recording_url || null,
        analysis_status: a.status || null,
        fields: merged.fields,
        edited: merged.edited,
      };
    });
    res.json({ date: date, calls: out, sync: freshness });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[eod] list:', err.message);
    res.status(500).json({ error: 'Failed to load EOD report' });
  }
});

// PUT /eod/edit { call_id, field, value } — upsert one field override for the
// caller. Ownership enforced: the call must belong to the caller. value:null
// clears the override (back to analysis value); strings (incl. '') persist.
router.put('/edit', requireAuth, async function (req, res) {
  try {
    var admin = getAdmin();
    var userId = req.user.id;
    var body = req.body || {};
    var callId = body.call_id, field = body.field;
    if (!callId || typeof callId !== 'string') return res.status(400).json({ error: 'call_id required' });
    if (EDITABLE_FIELDS.indexOf(field) === -1) return res.status(400).json({ error: 'field must be one of ' + EDITABLE_FIELDS.join(', ') });
    if (field === 'payment_structure' && body.value !== null && body.value !== undefined
        && PAYMENT_STRUCTURES.indexOf(String(body.value)) === -1) {
      return res.status(400).json({ error: 'payment_structure must be one of ' + PAYMENT_STRUCTURES.join(', ') });
    }

    var own = await admin.from('fathom_calls').select('id').eq('id', callId).eq('user_id', userId).maybeSingle();
    if (own.error) throw new Error('ownership check: ' + own.error.message);
    if (!own.data) return res.status(404).json({ error: 'call not found' });

    if (body.value === null || body.value === undefined) {
      var del = await admin.from('eod_edits').delete()
        .eq('user_id', userId).eq('fathom_call_id', callId).eq('field', field);
      if (del.error) throw new Error('edit clear: ' + del.error.message);
      return res.json({ ok: true, cleared: true });
    }

    var value = String(body.value).slice(0, VALUE_CAPS[field] || 500);
    var up = await admin.from('eod_edits').upsert(
      { user_id: userId, fathom_call_id: callId, field: field, value: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,fathom_call_id,field' });
    if (up.error) throw new Error('edit upsert: ' + up.error.message);
    res.json({ ok: true });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[eod] edit:', err.message);
    res.status(500).json({ error: 'Failed to save edit' });
  }
});

module.exports = router;
// pure helpers exported for tests (log.js:_validateLogBatch pattern)
module.exports._prospectNameFor = prospectNameFor;
module.exports._applyEdits = applyEdits;
module.exports._EDITABLE_FIELDS = EDITABLE_FIELDS;
module.exports._PAYMENT_STRUCTURES = PAYMENT_STRUCTURES;
module.exports._summaryPrefill = summaryPrefill;
module.exports._outcomePrefill = outcomePrefill;
