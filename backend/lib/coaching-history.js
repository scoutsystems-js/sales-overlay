/**
 * lib/coaching-history.js — THE REP'S HISTORY REACHES THE COACHING (Justin's step 3, 2026-09-05; H735).
 *
 * Justin's shape: "Josh has been coached on partner objections three times and it hasn't moved." A manager
 * wants to know whether this is the first time or the fourth — chronic and new are coached differently.
 *
 * THE RECORD (migration 073, coaching_history): one row per rep × pattern × call where Scout wrote coaching on
 * a moment of that pattern. The pattern key is CODE over the moment's stored fields (patternKey), never a model
 * call. Written by the coaching pass at write time; backfilled once from the entries already on file.
 *
 * THE TWO CLAIMS:
 *   · "Scout has coached this on N calls this period" — answerable: distinct calls in the record for that rep
 *     and pattern inside the window. It earns a place on the rep line only when N ≥ REPEAT_FLOOR (3 — "third
 *     time this period" changes what a manager does; "once before" mostly does not).
 *   · "and it hasn't moved" — ONLY when it could have moved and did not. THE BAR (movedAssessment; Justin rules):
 *     measurable only for an objection category (the strict handle rate); BEFORE = the rep's objections of that
 *     category before Scout first coached it, AFTER = since; each window ≥ MIN_BUCKET attempts (the one comparison
 *     floor already ruled, H704); HEADROOM = the before rate ≤ 100 − MOVE_POINTS; "not moved" = the after rate
 *     rose by fewer than MOVE_POINTS (20 — with six attempts one more handled objection is ~17 points, so one
 *     handled objection alone is noise); "moved" = it rose by MOVE_POINTS or more. Where the bar is not cleared
 *     Scout says the count and stops. A data problem never renders as bad news about a rep.
 *   · Never on a strength. Never as an accusation (scoldsRepeat drops the phrasings in code).
 */
'use strict';
var { CHUNK } = require('./chunk');
var { isHandled } = require('./objection-handled');
var { countsAsObjection } = require('./objection-strict');
var { MIN_BUCKET } = require('./comparison-floor');   // H738

var REPEAT_FLOOR = 3;      // the third time this period earns a clause
var PRIOR_FLOOR = 2;       // the coaching prompt is told when this is at least the third call (two earlier)
var MOVE_POINTS = 20;      // the change a handle rate must show to be called movement
var HEADROOM_MAX = 100 - MOVE_POINTS;

var PATTERN_LABELS = {
  missed_signal: 'a missed signal', missed_opportunity: 'a missed opportunity',
  'objection:fear': 'fear objections', 'objection:timing': 'timing objections', 'objection:partner': 'partner objections',
  'objection:logistical': 'logistical objections', 'objection:uncategorized': 'objections',
};
function labelFor(key) { return PATTERN_LABELS[key] || (key || '').replace(/^objection:/, '') + ' objections'; }

/** The pattern a coached MOMENT belongs to — code over stored fields; null = not a pattern that is counted. */
function patternKey(h) {
  if (!h) return null;
  if (h.type === 'objection' && (h.resolution === 'unhandled' || h.resolution === 'partial')) return 'objection:' + (h.objection_category || 'uncategorized');
  if ((h.type === 'risk_signal' || h.type === 'barrier') && (h.handling === 'ignored' || h.handling === 'deflected')) return 'missed_signal';
  if (h.type === 'missed_opportunity') return 'missed_opportunity';
  return null;
}
/** The pattern a REP LINE is about: the most frequent key among its cited panel items (ties → first cited). */
function repLinePatternKey(items, evidenceIds) {
  var counts = {}, order = [];
  (Array.isArray(evidenceIds) ? evidenceIds : []).forEach(function (id) {
    var it = items[Number(String(id).replace(/^m/, '')) - 1]; if (!it) return;
    var key = it.kind === 'missed_signal_pair' ? 'missed_signal'
      : it.kind === 'objection_unhandled' ? 'objection:' + ((it.moment && it.moment.objection_category) || 'uncategorized')
      : it.kind === 'missed_opportunity' ? 'missed_opportunity' : null;
    if (!key) return;
    if (!counts[key]) { counts[key] = 0; order.push(key); } counts[key]++;
  });
  var best = null; order.forEach(function (k) { if (!best || counts[k] > counts[best]) best = k; });
  return best;
}

/** Write one row (idempotent on rep × pattern × call). */
async function recordCoaching(admin, row) {
  var key = row.pattern_key || patternKey(row.moment);
  if (!key || !row.user_id || !row.fathom_call_id) return { recorded: false, key: key || null };
  var up = await admin.from('coaching_history').upsert({ user_id: row.user_id, team_key: row.team_key || null, pattern_key: key, fathom_call_id: row.fathom_call_id, highlight_id: row.highlight_id || null,
    call_date: row.call_date || null, surface: row.surface || 'call_coaching', version: row.version || null }, { onConflict: 'user_id,pattern_key,fathom_call_id', ignoreDuplicates: true });
  if (up.error) { console.warn('[coaching-history] not recorded for ' + row.user_id + ': ' + up.error.message); return { recorded: false, key: key }; }
  return { recorded: true, key: key };
}

/** The record for a set of reps: { userId: { key: { calls: n, first: date, last: date, call_ids: [] } } }, within [from, to] when given. */
async function loadHistory(admin, userIds, from, to) {
  var out = {}; (userIds || []).forEach(function (u) { out[u] = {}; });
  for (var i = 0; i < (userIds || []).length; i += CHUNK) {
    for (var page = 0; page < 10; page++) {
      var q = admin.from('coaching_history').select('user_id, pattern_key, fathom_call_id, call_date').in('user_id', userIds.slice(i, i + CHUNK));
      if (from) q = q.gte('call_date', from); if (to) q = q.lte('call_date', to);
      var r = await q.order('user_id').order('pattern_key').order('fathom_call_id').range(page * 1000, page * 1000 + 999);
      if (r.error) throw new Error('coaching_history: ' + r.error.message);
      (r.data || []).forEach(function (row) {
        var byKey = out[row.user_id]; if (!byKey) return;
        var k = byKey[row.pattern_key] || (byKey[row.pattern_key] = { calls: 0, first: null, last: null, call_ids: [] });
        if (k.call_ids.indexOf(row.fathom_call_id) !== -1) return;
        k.call_ids.push(row.fathom_call_id); k.calls++;
        if (row.call_date && (!k.first || row.call_date < k.first)) k.first = row.call_date;
        if (row.call_date && (!k.last || row.call_date > k.last)) k.last = row.call_date;
      });
      if ((r.data || []).length < 1000) break;
      if (page === 9) throw new Error('Coaching history exceeds verified read limit');
    }
  }
  return out;
}

/** Pure. before/after = { attempts, handled }. */
function movedAssessment(before, after) {
  var b = before || { attempts: 0, handled: 0 }, a = after || { attempts: 0, handled: 0 };
  var rate = function (w) { return w.attempts ? Math.round(100 * w.handled / w.attempts) : null; };
  var rb = rate(b), ra = rate(a);
  var out = { state: 'not_cleared', before: { attempts: b.attempts, rate: rb }, after: { attempts: a.attempts, rate: ra }, bar: { min_attempts: MIN_BUCKET, move_points: MOVE_POINTS, headroom_max: HEADROOM_MAX }, why: null };
  if (b.attempts < MIN_BUCKET || a.attempts < MIN_BUCKET) { out.why = 'fewer than ' + MIN_BUCKET + ' attempts in a window'; return out; }
  if (rb > HEADROOM_MAX) { out.why = 'no headroom: the rate before was already ' + rb + '%'; return out; }
  out.state = (ra - rb >= MOVE_POINTS) ? 'moved' : 'not_moved';
  return out;
}

/** The strict handle rate before and after the first coaching on an objection category, for one rep. Reads only. */
async function assessObjectionMovement(admin, userId, category, firstCoachedAt) {
  var calls = [], page = 0;
  while (page < 10) {
    var cq = await admin.from('fathom_calls').select('id, call_date').eq('user_id', userId).not('not_a_sales_call', 'is', true).is('duplicate_of', null).order('call_date', { ascending: false }).range(page * 1000, page * 1000 + 999);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    calls = calls.concat(cq.data || []); if ((cq.data || []).length < 1000) break; page++;
  }
  var dateOf = {}; calls.forEach(function (c) { dateOf[c.id] = c.call_date; });
  var ids = calls.map(function (c) { return c.id; });
  var before = { attempts: 0, handled: 0 }, after = { attempts: 0, handled: 0 };
  for (var i = 0; i < ids.length; i += CHUNK) {
    var slice = ids.slice(i, i + CHUNK);
    var pair = await Promise.all([
      admin.from('call_highlights').select('fathom_call_id, objection_category, objection_class, resolution').in('fathom_call_id', slice).eq('type', 'objection').eq('objection_category', category),
      admin.from('call_analyses').select('fathom_call_id, outcome').in('fathom_call_id', slice),
    ]);
    if (pair[0].error) throw new Error('call_highlights: ' + pair[0].error.message);
    if (pair[1].error) throw new Error('call_analyses: ' + pair[1].error.message);
    var outcome = {}; (pair[1].data || []).forEach(function (a) { outcome[a.fathom_call_id] = a.outcome; });
    (pair[0].data || []).forEach(function (h) {
      if (!countsAsObjection(h)) return;
      var w = (dateOf[h.fathom_call_id] && firstCoachedAt && dateOf[h.fathom_call_id] < firstCoachedAt) ? before : after;
      w.attempts++; if (isHandled(h, outcome[h.fathom_call_id])) w.handled++;
    });
  }
  return movedAssessment(before, after);
}

/** The clause after a PATTERN line, in code. null when it earns no place. */
function historyClause(entry, assessment) {
  if (!entry || entry.calls < REPEAT_FLOOR) return null;
  var s = 'Scout has coached this on ' + entry.calls + ' calls this period';
  if (assessment && assessment.state === 'not_moved') s += ', and the handle rate has not moved: ' + assessment.before.rate + '% of ' + assessment.before.attempts + ' before, ' + assessment.after.rate + '% of ' + assessment.after.attempts + ' since';
  else if (assessment && assessment.state === 'moved') s += ', and the handle rate has moved: ' + assessment.before.rate + '% of ' + assessment.before.attempts + ' before, ' + assessment.after.rate + '% of ' + assessment.after.attempts + ' since';
  return s + '.';
}

/** The block for the coaching prompt on a call: the patterns of this call's moments that Scout has coached this rep on before. */
function historyBlock(history, moments) {
  var lines = [];
  var seen = {};
  (moments || []).forEach(function (m) {
    var key = m.pattern_key || patternKey(m); if (!key || seen[key]) return; seen[key] = true;
    var e = history && history[key]; if (!e || e.calls < PRIOR_FLOOR) return;
    lines.push('  · ' + labelFor(key) + ': coached on ' + e.calls + ' earlier calls' + (e.last ? ' (most recent ' + String(e.last).slice(0, 10) + ')' : ''));
  });
  if (!lines.length) return '';
  return ['HISTORY — what Scout has already coached this closer on, on earlier calls:'].concat(lines).concat([
    'A repeat is coached at its CAUSE — what upstream in discovery or qualification lets it keep arising — never as a word track and NEVER AS AN ACCUSATION. Do not write "again", "still", "yet again", "you keep", or any sentence that scolds. A closer coached repeatedly without change is the manager\'s to manage; you report the count only where it changes the advice, in one plain clause. Never use the words "record", "history" or "log" to the closer — say "on earlier calls".',
  ]).join('\n');
}
var SCOLD_PATTERNS = [/\byet again\b/i, /\bonce again\b/i, /\bhow many times\b/i, /\byou keep\b/i, /\byou still (?:haven'?t|don'?t|aren'?t|won'?t)\b/i, /\bas (?:I|we)(?:'ve| have)? (?:said|told you|noted) before\b/i, /\bfor the \w+ time\b/i, /\bsame mistake\b/i];
function scoldsRepeat(text) { var t = String(text || ''); return SCOLD_PATTERNS.some(function (p) { return p.test(t); }); }

module.exports = { REPEAT_FLOOR: REPEAT_FLOOR, PRIOR_FLOOR: PRIOR_FLOOR, MOVE_POINTS: MOVE_POINTS, HEADROOM_MAX: HEADROOM_MAX, PATTERN_LABELS: PATTERN_LABELS, labelFor: labelFor,
  patternKey: patternKey, repLinePatternKey: repLinePatternKey, recordCoaching: recordCoaching, loadHistory: loadHistory, movedAssessment: movedAssessment,
  assessObjectionMovement: assessObjectionMovement, historyClause: historyClause, historyBlock: historyBlock, scoldsRepeat: scoldsRepeat };
