/**
 * COACHABLE MOMENTS (H726) — what is worth a manager's attention on this call, mixed kinds.
 *
 * JUSTIN'S FILTER (2026-09-04), verbatim: "did this move the call forward and get the prospect
 * closer to buying — by digging for pain, getting goals, building a gap — or, using the
 * missed-signals logic, did this quote or sequence cost the call?" ONE question about DIRECTION,
 * asked both ways. The forward side is the "you have done this before, so I know you can do it
 * again" coaching for a rep in a down.
 *
 * THE APPROVED MIX: five per rep · ONE moment per call · up to three from the cost side, two from
 * the forward side, either filling the other's shortfall · TIER BEFORE RECENCY (a projection
 * ordered newest-first showed ONE pair in the whole panel; tiered, fifteen — a panel sorted by
 * recency is a panel sorted by nothing).
 *   COST    — a missed-signal pair · an objection left unhandled on a call that did not close ·
 *             a missed opportunity on one.
 *   FORWARD — a buying signal the closer earned (an evidenced move, H719) · an objection handled ·
 *             a risk signal or barrier addressed · a verified closer strong moment.
 * The pair's five-minute floor, closer-DQ exclusion and leaving exclusion survive unchanged — the
 * pair comes from lib/missed-signal-pair.js. The consequence is stated IN CODE ("The call did not
 * close." / "N min later, a disqualification."), never a principle, never a model call.
 *
 * WHO SEES IT: the panel lives on Team → Coaching (managers and above). A rep sees the pair beside
 * the moment on their own review page (H722) and nothing aggregated; the forward side shown to a
 * rep is UNRULED (H726) — nothing here shows it to one.
 *
 * Pure. Input: one rep's calls, each { id, user_id, title, call_date, recording_url, outcome,
 * highlights[] }. Output: the rep's items, best first.
 */
'use strict';
var { findMissedSignalPairs, gapLabel } = require('./missed-signal-pair');
var { evidencedMove } = require('./moment-bar');

var COST_ORDER = ['missed_signal_pair', 'objection_unhandled', 'missed_opportunity'];
var FORWARD_ORDER = ['earned_signal', 'objection_handled', 'signal_addressed', 'strong_moment'];
var KIND_LABELS = {
  missed_signal_pair: 'Missed signal',
  objection_unhandled: 'Objection left unhandled',
  missed_opportunity: 'Missed opportunity',
  earned_signal: 'Buying signal the closer earned',
  objection_handled: 'Objection handled',
  signal_addressed: 'Signal addressed',
  strong_moment: 'Strong moment',
};
var DEFAULTS = { perRep: 5, cost: 3, forward: 2 };

function pickMoment(h) {
  return { id: h.id, type: h.type, section: h.section || null, timestamp_seconds: h.timestamp_seconds, speaker: h.speaker || null,
    quote: h.quote, observation: h.observation || null,
    closer_response: (typeof h.closer_response === 'string') ? h.closer_response : null,
    closer_response_verified: (typeof h.closer_response_verified === 'boolean') ? h.closer_response_verified : null,
    handling: h.handling || null, resolution: h.resolution || null };
}
function notClosed(call) { return call.outcome !== 'closed'; }
/* The consequence, in code. A FORWARD item on a call that is still open says so (Justin, 2026-09-04): an
   earned signal beside "The call did not close." read as a contradiction — both true, direction not
   outcome — and "still open" removes it without flattering anything. A cost item only exists on a call
   that did not close, and says that. */
function consequenceFor(call, direction) {
  if (call.outcome === 'closed') return 'The call closed.';
  if (direction === 'forward' && call.outcome === 'follow_up') return 'The call is still open.';
  return 'The call did not close.';
}
function first(arr, f) { for (var i = 0; i < arr.length; i++) if (f(arr[i])) return arr[i]; return null; }

/* The best COST item on one call, by tier, or null. */
function costItem(call) {
  var hs = Array.isArray(call.highlights) ? call.highlights : [];
  var pairs = findMissedSignalPairs(hs);
  if (pairs.length) {
    var p = pairs[0];
    return { kind: 'missed_signal_pair', direction: 'cost', tier: 0, pair: p, moment: p.signal,
      consequence: gapLabel(p.gap_seconds) + ' later, a disqualification.' };
  }
  if (notClosed(call)) {
    var obj = first(hs, function (h) { return h.type === 'objection' && h.resolution === 'unhandled'; });
    if (obj) return { kind: 'objection_unhandled', direction: 'cost', tier: 1, moment: pickMoment(obj), consequence: consequenceFor(call) };
    var miss = first(hs, function (h) { return h.type === 'missed_opportunity'; });
    if (miss) return { kind: 'missed_opportunity', direction: 'cost', tier: 2, moment: pickMoment(miss), consequence: consequenceFor(call) };
  }
  return null;
}

/* The best FORWARD item on one call, by tier, or null. */
function forwardItem(call) {
  var hs = Array.isArray(call.highlights) ? call.highlights : [];
  var earned = first(hs, function (h) { return h.type === 'buying_signal' && evidencedMove(h); });
  if (earned) return { kind: 'earned_signal', direction: 'forward', tier: 0, moment: pickMoment(earned), move: earned.cause.move, move_summary: earned.cause.summary || null,
    evidence: earned.cause.evidence, consequence: consequenceFor(call, 'forward') };
  var handled = first(hs, function (h) { return h.type === 'objection' && h.resolution === 'handled'; });
  if (handled) return { kind: 'objection_handled', direction: 'forward', tier: 1, moment: pickMoment(handled), consequence: consequenceFor(call, 'forward') };
  var addressed = first(hs, function (h) { return (h.type === 'risk_signal' || h.type === 'barrier') && h.handling === 'addressed'; });
  if (addressed) return { kind: 'signal_addressed', direction: 'forward', tier: 2, moment: pickMoment(addressed), consequence: consequenceFor(call, 'forward') };
  var strong = first(hs, function (h) { return h.type === 'strong_moment' && h.speaker === 'CLOSER' && h.speaker_verified === true; });
  if (strong) return { kind: 'strong_moment', direction: 'forward', tier: 3, moment: pickMoment(strong), consequence: consequenceFor(call, 'forward') };
  return null;
}

function withCall(item, call) {
  return Object.assign({ call_id: call.id, user_id: call.user_id || null, title: call.title || null, call_date: call.call_date || null, recording_url: call.recording_url || null, outcome: call.outcome || null, label: KIND_LABELS[item.kind] }, item);
}

/**
 * @param {Array} calls — one rep's calls with their highlights
 * @param {{perRep?:number, cost?:number, forward?:number}} [opts]
 */
function selectCoachableMoments(calls, opts) {
  var o = Object.assign({}, DEFAULTS, opts || {});
  var arr = (Array.isArray(calls) ? calls : []).slice().sort(function (a, b) { return String(b.call_date || '').localeCompare(String(a.call_date || '')); });   // newest first WITHIN a tier
  var cost = [], fwd = [];
  arr.forEach(function (c) {
    var ci = costItem(c); if (ci) cost.push(withCall(ci, c));
    var fi = forwardItem(c); if (fi) fwd.push(withCall(fi, c));
  });
  var byTier = function (a, b) { return a.tier - b.tier; };   // stable: recency order survives inside a tier
  cost.sort(byTier); fwd.sort(byTier);
  var used = {};
  function take(list, n) { var out = []; for (var i = 0; i < list.length && out.length < n; i++) { if (used[list[i].call_id]) continue; used[list[i].call_id] = true; out.push(list[i]); } return out; }
  var c = take(cost, o.cost), f = take(fwd, o.forward);
  if (c.length < o.cost) f = f.concat(take(fwd, o.cost - c.length));
  if (f.length < o.forward) c = c.concat(take(cost, o.forward - f.length));
  return c.concat(f).slice(0, o.perRep);
}

module.exports = { selectCoachableMoments: selectCoachableMoments, COST_ORDER: COST_ORDER, FORWARD_ORDER: FORWARD_ORDER, KIND_LABELS: KIND_LABELS, DEFAULTS: DEFAULTS, _costItem: costItem, _forwardItem: forwardItem };
