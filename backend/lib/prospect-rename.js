// lib/prospect-rename.js — PROSPECT RENAME THAT CARRIES EVERYWHERE (Justin's ruling
// 2026-09-03, H707 — overruling the "leave it to the CRM" recommendation).
//
// THE RISK, STATED AT THE CODE: move every call on the row and a WRONG rename FUSES two
// people; move one call and a RIGHT rename STRANDS the rest under the old name. The
// shape that survives that: a human-source name on the PROSPECT that wins over the
// grader, applied to every call currently on that prospect's row, recorded as the
// linking policy's HUMAN PATH — above the exact path, because a person on the call
// knows more than an invite list.
//
// SAFETY: a rename that would land on an EXISTING prospect's name is a MERGE, and a
// merge is confirmed, naming both, never silent (planRename returns `merge` and the
// caller must send confirm_merge). A rename never touches a call a person has already
// renamed differently (prospect_renames rows per call). Every rename is a row — what
// it was, what it became, who did it — reversible through undone_at.
//
// planRename is pure and total. applyRename does I/O and throws on a hard failure
// (the route turns that into a 500 and nothing half-applied is reported as done).
'use strict';
var { nameKey } = require('./prospect-entity');
var { isRejectedName } = require('./prospect-name');
var { hasPlaceholderToken } = require('./prospect-identity');

function cleanName(v) {
  if (typeof v !== 'string') return null;
  var s = v.replace(/\s+/g, ' ').trim();
  if (!s || s.length > 120 || /[@<>]/.test(s)) return null;
  if (isRejectedName(s) || hasPlaceholderToken(s.split(' '))) return null;
  return s;
}

/* input: { name, prospect: {id, display_name}|null, existing: [{id, display_name, name_key}] (the rep's prospects),
            calls: [{id, human_name}] (calls on the prospect's row; human_name = a person's earlier rename or null) }
   → { ok:false, reason } | { ok:true, kind:'rename'|'merge'|'create', name, name_key, into: {id, display_name}|null,
       move: [call ids], skip: [call ids] } */
function planRename(input) {
  var o = input || {};
  var name = cleanName(o.name);
  if (!name) return { ok: false, reason: 'not_a_name' };
  var key = nameKey(name);
  if (!key) return { ok: false, reason: 'not_a_name' };
  var calls = Array.isArray(o.calls) ? o.calls : [];
  var move = [], skip = [];
  calls.forEach(function (c) {
    if (!c || !c.id) return;
    if (c.human_name && nameKey(c.human_name) !== key) skip.push(c.id); else move.push(c.id);
  });
  var target = (Array.isArray(o.existing) ? o.existing : []).filter(function (p) { return p && p.name_key === key && (!o.prospect || p.id !== o.prospect.id); })[0] || null;
  if (target) return { ok: true, kind: 'merge', name: name, name_key: key, into: { id: target.id, display_name: target.display_name }, move: move, skip: skip };
  if (!o.prospect) return { ok: true, kind: 'create', name: name, name_key: key, into: null, move: move, skip: skip };
  return { ok: true, kind: 'rename', name: name, name_key: key, into: null, move: move, skip: skip };
}

/* Apply a plan. args: { userId, actorId, callId, prospect, plan } */
async function applyRename(admin, args) {
  var a = args || {}; var plan = a.plan;
  if (!plan || !plan.ok) throw new Error('no plan');
  var now = new Date().toISOString();
  var targetId = null, fromName = a.prospect ? a.prospect.display_name : null;
  if (plan.kind === 'merge') {
    targetId = plan.into.id;
    var st = await admin.from('prospects').update({ human_name: plan.name, human_name_by: a.actorId, human_name_at: now }).eq('id', targetId).eq('user_id', a.userId);
    if (st.error) throw new Error('prospects (into): ' + st.error.message);
    if (a.prospect) {
      var mg = await admin.from('prospects').update({ merged_into: targetId, merged_at: now, merged_by: a.actorId }).eq('id', a.prospect.id).eq('user_id', a.userId);
      if (mg.error) throw new Error('prospects (merge): ' + mg.error.message);
    }
  } else if (plan.kind === 'rename') {
    targetId = a.prospect.id;
    var rn = await admin.from('prospects').update({ display_name: plan.name, name_key: plan.name_key, human_name: plan.name, human_name_by: a.actorId, human_name_at: now }).eq('id', targetId).eq('user_id', a.userId);
    if (rn.error) throw new Error('prospects (rename): ' + rn.error.message);
  } else {
    var ins = await admin.from('prospects').insert({ user_id: a.userId, display_name: plan.name, name_key: plan.name_key, human_name: plan.name, human_name_by: a.actorId, human_name_at: now }).select('id').maybeSingle();
    if (ins.error) throw new Error('prospects (create): ' + ins.error.message);
    targetId = ins.data ? ins.data.id : null;
    if (!targetId) throw new Error('prospects (create): no id');
  }
  var moved = 0;
  var ids = plan.move.slice();
  if (ids.indexOf(a.callId) === -1) ids.push(a.callId);
  for (var i = 0; i < ids.length; i++) {
    var cu = await admin.from('fathom_calls').update({ prospect_id: targetId, prospect_link_path: 'human' }).eq('id', ids[i]).eq('user_id', a.userId);
    if (cu.error) throw new Error('fathom_calls: ' + cu.error.message);
    var an = await admin.from('call_analyses').update({ prospect_name: plan.name, prospect_name_source: 'manual', prospect_name_confidence: 'high' }).eq('fathom_call_id', ids[i]).eq('user_id', a.userId);
    if (an.error) throw new Error('call_analyses: ' + an.error.message);
    moved++;
  }
  var rec = await admin.from('prospect_renames').insert({
    user_id: a.userId, actor_id: a.actorId, call_id: a.callId, prospect_id: a.prospect ? a.prospect.id : targetId,
    merged_into: plan.kind === 'merge' ? targetId : null, from_display_name: fromName, to_display_name: plan.name,
    calls_moved: moved, calls_skipped: plan.skip.length,
  });
  if (rec.error) throw new Error('prospect_renames: ' + rec.error.message);
  return { prospect_id: targetId, kind: plan.kind, name: plan.name, calls_moved: moved, calls_skipped: plan.skip.length, merged_from: plan.kind === 'merge' ? fromName : null };
}

/* THE ONE ENTRY both the Calls page and the EOD call: loads the call, its prospect, the
   rep's prospects and the calls on the row (with each call's latest human rename), plans,
   and either returns { merge_required } (never silent) or applies.
   args: { userId (the call's owner), actorId, callId, name, confirmMerge } */
async function renameOnCall(admin, args) {
  var a = args || {};
  var cq = await admin.from('fathom_calls').select('id, user_id, prospect_id').eq('id', a.callId).eq('user_id', a.userId).maybeSingle();
  if (cq.error) throw new Error('call: ' + cq.error.message);
  if (!cq.data) return { ok: false, status: 404, error: 'Call not found' };
  var prospect = null;
  if (cq.data.prospect_id) {
    var pq = await admin.from('prospects').select('id, display_name, name_key').eq('id', cq.data.prospect_id).maybeSingle();
    if (pq.error) throw new Error('prospect: ' + pq.error.message);
    prospect = pq.data || null;
  }
  var ex = await admin.from('prospects').select('id, display_name, name_key').eq('user_id', a.userId).is('merged_into', null);
  if (ex.error) throw new Error('prospects: ' + ex.error.message);
  var calls = [];
  if (prospect) {
    var cl = await admin.from('fathom_calls').select('id').eq('user_id', a.userId).eq('prospect_id', prospect.id);
    if (cl.error) throw new Error('calls: ' + cl.error.message);
    var rn = await admin.from('prospect_renames').select('call_id, to_display_name, created_at').eq('user_id', a.userId).eq('prospect_id', prospect.id).is('undone_at', null).order('created_at', { ascending: true });
    if (rn.error) throw new Error('renames: ' + rn.error.message);
    var latest = {}; (rn.data || []).forEach(function (r) { if (r.call_id) latest[r.call_id] = r.to_display_name; });
    calls = (cl.data || []).map(function (c) { return { id: c.id, human_name: latest[c.id] || null }; });
  }
  var plan = planRename({ name: a.name, prospect: prospect, existing: ex.data || [], calls: calls });
  if (!plan.ok) return { ok: false, status: 400, error: 'That is not a name Scout can store' };
  if (plan.kind === 'merge' && !a.confirmMerge) {
    return { ok: false, status: 409, merge_required: { from: prospect ? prospect.display_name : null, into: plan.into.display_name, calls_moving: plan.move.length + (plan.move.indexOf(a.callId) === -1 ? 1 : 0), calls_skipped: plan.skip.length } };
  }
  var out = await applyRename(admin, { userId: a.userId, actorId: a.actorId, callId: a.callId, prospect: prospect, plan: plan });
  return Object.assign({ ok: true }, out);
}

module.exports = { planRename: planRename, applyRename: applyRename, cleanName: cleanName, renameOnCall: renameOnCall };
