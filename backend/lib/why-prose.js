/**
 * 10d — the WHY sentence on a manager's rep card.
 *
 * ⚠⚠ THE CAUSE IS COUNTED, NOT INFERRED. THE MODEL IS NEVER ASKED WHY.
 * Justin's worked example — "John scores low on discovery because he isn't
 * challenging prospects enough" — contains a judgement no number produces, and
 * "let the model explain why" is exactly the drift this guards against. It does
 * not have to be inferred: 7d's `what_mattered` already stores, per call, the
 * highest-priority UNCOVERED discovery area, VERIFIED AT WRITE TIME (the area
 * exists for that rep, was marked uncovered, and the prospect's quote
 * reconstructs). JS counts the modal one here; the model only turns the handed
 * numbers into a sentence.
 *
 * ⚠ TWO TIERS, because that evidence exists for one rep in eight. Coaching areas
 * derive only from a rep's own offer/criteria/script — the standing asymmetry
 * already recorded for 8c/8d. Tier 1 is numbers only and always available; tier 2
 * adds the counted cause and appears only above the thresholds below. Measured
 * live: Josh 93/130 = 72%; the other three reps have no coverage map at all.
 *
 * ⚠ NO INTENSIFIERS THE DATA DOES NOT CARRY. "Discovery is his weakest section"
 * is supported. "Constantly scores low" is not: 19 of 146 of Josh's calls (13%)
 * are post-sale onboarding or mid-process follow-ups where discovery legitimately
 * should not happen, and excluding them discovery moves 47 → 51. The ranking
 * survives, so the weakest-section claim is safe — the adverb would be describing
 * call-type mix, not the rep.
 *
 * EVERY SENTENCE IS VERIFIED BEFORE IT IS SHOWN. Numbers must trace to the facts,
 * intensifiers are refused, and a cause may not appear without tier-2 evidence. A
 * sentence that fails is replaced by the deterministic fallback — never shown.
 */

const TIER2_MIN_SHARE_PCT = 40;   // the modal area must dominate, not merely lead
const TIER2_MIN_CALLS = 10;       // and rest on more than a handful of calls

// Adverbs that assert a pattern over time. The data supports a period average,
// not a habit — see the call-type note above.
const BANNED_INTENSIFIERS = [
  'constantly', 'consistently', 'repeatedly', 'chronically', 'habitually',
  'always', 'never stops', 'every single', 'time after time', 'routinely',
];
// Causal connectives. Permitted ONLY when tier-2 evidence was handed over.
const CAUSAL_MARKERS = ['because', 'due to', 'the reason', 'owing to', 'as a result of'];

function humanArea(key) {
  if (typeof key !== 'string' || !key) return null;
  return key.replace(/_/g, ' ').trim() || null;
}

// rep: a per_rep row from computeTeamAnalytics (10c-1 fields included).
// whatMattered: that rep's stored what_mattered objects for the period.
function computeWhyFacts(rep, whatMattered) {
  var r = rep || {};
  var rows = Array.isArray(whatMattered) ? whatMattered : [];

  // Only VERIFIED rows count — the whole claim rests on the field having been
  // proven at write time, so an unverified row is not evidence of anything.
  var verified = rows.filter(function (w) { return w && w.reason_verified === true && w.area_key; });
  var counts = {};
  verified.forEach(function (w) { counts[w.area_key] = (counts[w.area_key] || 0) + 1; });

  var modal = null;
  Object.keys(counts).sort().forEach(function (k) {
    if (!modal || counts[k] > modal.count) modal = { area_key: k, count: counts[k] };
  });

  var cause = null;
  if (modal && verified.length >= TIER2_MIN_CALLS) {
    var share = Math.round((modal.count / verified.length) * 100);
    if (share >= TIER2_MIN_SHARE_PCT) {
      cause = { area_key: modal.area_key, area: humanArea(modal.area_key),
                count: modal.count, denominator: verified.length, share: share };
    }
  }

  return {
    name: r.display_name || null,
    // Unmeasured stays null rather than becoming a zero to narrate.
    closing: (r.prospect_close_total > 0 && typeof r.prospect_close_rate === 'number')
      ? { rate: r.prospect_close_rate, closed: r.prospect_close_wins, total: r.prospect_close_total } : null,
    objections: (r.obj_total > 0 && typeof r.obj_handle_rate === 'number')
      ? { rate: r.obj_handle_rate, handled: r.obj_handled, total: r.obj_total } : null,
    weakest_section: r.weakest_section || null,
    weakest_objection: r.weakest_objection || null,
    cause: cause,
    tier: cause ? 2 : 1,
  };
}

// Every number the sentence is permitted to contain.
function allowedNumbers(f) {
  var out = [];
  if (f.closing) out.push(f.closing.rate, f.closing.closed, f.closing.total);
  if (f.objections) out.push(f.objections.rate, f.objections.handled, f.objections.total);
  if (f.weakest_section) out.push(f.weakest_section.score);
  var wo = f.weakest_objection;
  if (wo) {
    out.push(wo.rate, wo.handled, wo.total);
    if (wo.comparable && typeof wo.team_rate === 'number') out.push(wo.team_rate);
  }
  if (f.cause) out.push(f.cause.count, f.cause.denominator, f.cause.share);
  return out.filter(function (n) { return typeof n === 'number' && isFinite(n); });
}

function buildWhyPrompt(f) {
  var lines = [];
  if (f.closing) lines.push('- closing rate: ' + f.closing.rate + '% (' + f.closing.closed + ' of ' + f.closing.total + ' prospects closed)');
  else lines.push('- closing rate: no prospects in this period');
  if (f.objections) lines.push('- objection handling: ' + f.objections.rate + '% (' + f.objections.handled + ' of ' + f.objections.total + ' handled)');
  else lines.push('- objection handling: no objections in this period');
  if (f.weakest_section) lines.push('- weakest section: ' + f.weakest_section.section + ', scoring ' + f.weakest_section.score);
  if (f.weakest_objection) {
    var wo = f.weakest_objection;
    lines.push('- weakest objection category: ' + wo.category + ' at ' + wo.rate + '% (' + wo.handled + ' of ' + wo.total + ' handled)'
      + (wo.comparable ? ' — team average ' + wo.team_rate + '%' + (wo.is_lowest ? ', the lowest on the team' : '') : ''));
  }
  if (f.cause) {
    lines.push('- on ' + f.cause.count + ' of this rep\'s ' + f.cause.denominator + ' calls that were assessed, the highest-priority'
      + ' discovery ground left uncovered was: ' + f.cause.area);
  }

  var rules = [
    'Write ONE or TWO sentences summarising this rep for their manager.',
    'Use ONLY the facts below. Every number you write must appear above, unchanged.',
    'Do not invent, add or supply a cause, reason or explanation that is not in the facts.',
    'Do not use intensifiers such as "' + BANNED_INTENSIFIERS.slice(0, 4).join('", "') + '".'
      + ' They assert a habit; these are period averages, and some calls are onboarding or'
      + ' follow-up conversations where a low section score is expected rather than a failing.',
    'Plain, factual, manager-to-manager. No praise, no admonishment, no advice.',
  ];
  if (f.cause) {
    rules.push('The uncovered-ground fact is the ONLY explanation you may state, and state it as a count, not as a personality trait.');
  } else {
    rules.push('There is no cause in the facts. State the numbers only and do not speculate about why.');
  }

  return rules.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n')
    + '\n\nFACTS' + (f.name ? ' about ' + f.name : '') + ':\n' + lines.join('\n')
    + '\n\nReturn only the sentence(s), with no preamble.';
}

// ⚠ A sentence that fails this is never shown. Same shape as the quote
// verification: the claim must be checkable, and an unverifiable one is dropped.
function verifyWhySentence(sentence, f) {
  if (typeof sentence !== 'string' || !sentence.trim()) return { ok: false, reason: 'empty sentence' };
  var s = sentence.trim();
  var lower = s.toLowerCase();

  var bad = BANNED_INTENSIFIERS.find(function (w) { return lower.indexOf(w) !== -1; });
  if (bad) return { ok: false, reason: 'banned intensifier: "' + bad + '"' };

  // ⚠ A CAUSAL CLAIM MUST BE *THE COUNTED ONE*. Checking only "is there a cause
  // when there is no evidence" leaves the hole that matters: a tier-2 rep could
  // be given a fabricated cause ("because he rushes past rapport") that has
  // nothing to do with the area actually counted, and it would pass. Found by
  // running the guards against live facts rather than fixtures.
  var causal = CAUSAL_MARKERS.find(function (w) { return lower.indexOf(w) !== -1; });
  if (causal) {
    if (!f.cause) return { ok: false, reason: 'asserts a cause with no tier-2 evidence: "' + causal + '"' };
    var area = String(f.cause.area || '').toLowerCase();
    if (!area || lower.indexOf(area) === -1) {
      return { ok: false, reason: 'asserts a cause ("' + causal + '") that is not the counted one ("' + f.cause.area + '")' };
    }
  }

  var allowed = allowedNumbers(f);
  var found = s.match(/\d+(?:\.\d+)?/g) || [];
  for (var i = 0; i < found.length; i++) {
    var n = Number(found[i]);
    if (allowed.indexOf(n) === -1) {
      return { ok: false, reason: 'number ' + found[i] + ' does not appear in the facts' };
    }
  }
  return { ok: true, reason: null };
}

// Deterministic, model-free, and correct by construction. Used when the model is
// unavailable or its sentence fails verification.
function fallbackSentence(f) {
  var who = f.name || 'This rep';
  var parts = [];
  if (f.closing) parts.push('closing ' + f.closing.rate + '% (' + f.closing.closed + ' of ' + f.closing.total + ' prospects)');
  else parts.push('no prospects yet this period');
  if (f.objections) parts.push('handling ' + f.objections.rate + '% of objections (' + f.objections.handled + ' of ' + f.objections.total + ')');

  var s = who + ': ' + parts.join(', ') + '.';
  if (f.weakest_section) {
    s += ' Weakest section is ' + f.weakest_section.section + ' at ' + f.weakest_section.score + '.';
  }
  if (f.cause) {
    s += ' On ' + f.cause.count + ' of ' + f.cause.denominator + ' assessed calls the discovery ground left uncovered was '
      + f.cause.area + '.';
  }
  return s;
}

module.exports = {
  computeWhyFacts: computeWhyFacts,
  buildWhyPrompt: buildWhyPrompt,
  verifyWhySentence: verifyWhySentence,
  fallbackSentence: fallbackSentence,
  humanArea: humanArea,
  allowedNumbers: allowedNumbers,
  TIER2_MIN_SHARE_PCT: TIER2_MIN_SHARE_PCT,
  TIER2_MIN_CALLS: TIER2_MIN_CALLS,
  BANNED_INTENSIFIERS: BANNED_INTENSIFIERS,
};

// ── the cached lane ───────────────────────────────────────────────────────
//
// Same shape as the existing syntheses: keyed per rep per period with an
// analysis-set hash, so a repeat view of an unchanged period spends nothing.
// Sub-stage 0's day-snapping already coarsens the timestamps, so two views on
// the same day share a key.
const crypto = require('crypto');
const { cacheGet, cachePut } = require('./team-synthesis');
const { realCallsOnly } = require('./real-calls');

const WHY_LANE_VERSION = 'v1';

// Fetches this rep's what_mattered rows for the window, computes the facts,
// and returns a VERIFIED sentence. `ask` is injected so every branch is
// testable without a network.
async function computeWhyProse(admin, rep, from, to, ask) {
  var userId = rep && rep.user_id;
  if (!userId) return null;

  // Calls in window → their analyses' what_mattered.
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, fathom_call_id')
      .eq('user_id', userId).gte('call_date', from).lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
      .range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }
  /* ⚠ Same shared rule. A demo account's copied rows would otherwise become
     that rep's 'why' prose on the team board. */
  calls = realCallsOnly(calls);
  var ids = calls.map(function (c) { return c.id; });
  var rows = [];
  for (var i = 0; i < ids.length; i += 100) {
    var aq = await admin.from('call_analyses').select('fathom_call_id, analyzed_at, what_mattered')
      .in('fathom_call_id', ids.slice(i, i + 100)).eq('status', 'done');
    if (aq.error) throw new Error('call_analyses: ' + aq.error.message);
    rows = rows.concat(aq.data || []);
  }

  var facts = computeWhyFacts(rep, rows.map(function (r) { return r.what_mattered; }).filter(Boolean));

  var hash = crypto.createHash('md5').update(
    rows.map(function (r) { return r.fathom_call_id + ':' + r.analyzed_at; }).sort().join('|')
    + '||facts:' + JSON.stringify(allowedNumbers(facts))
    + '||lane:' + WHY_LANE_VERSION
  ).digest('hex');

  var cached = await cacheGet(admin, userId, 'why_prose', from, to, hash);
  if (cached && cached.sentence) return { sentence: cached.sentence, tier: facts.tier, cached: true };

  var sentence = null;
  if (typeof ask === 'function') {
    try {
      var raw = await ask(buildWhyPrompt(facts));
      var candidate = typeof raw === 'string' ? raw.trim().replace(/^["']|["']$/g, '') : '';
      var check = verifyWhySentence(candidate, facts);
      if (check.ok) sentence = candidate;
      else console.warn('[why-prose] rejected for ' + userId + ': ' + check.reason);
    } catch (e) {
      console.warn('[why-prose] model call failed for ' + userId + ': ' + ((e && e.message) || 'unknown'));
    }
  }
  // ⚠ A sentence that fails verification is NEVER shown. The deterministic
  // fallback is correct by construction and passes the same verifier.
  if (!sentence) sentence = fallbackSentence(facts);

  var out = { sentence: sentence, tier: facts.tier, generated_at: new Date().toISOString() };
  await cachePut(admin, userId, 'why_prose', from, to, hash, out);
  return { sentence: sentence, tier: facts.tier, cached: false };
}

module.exports.computeWhyProse = computeWhyProse;
module.exports.WHY_LANE_VERSION = WHY_LANE_VERSION;
