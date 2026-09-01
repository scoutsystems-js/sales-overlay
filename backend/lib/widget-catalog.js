'use strict';
/**
 * ⚠⚠ THE WIDGET CATALOG'S DATA LAYER — AND THIS TABLE *IS* THE HONESTY RULE.
 *
 * Which views a metric may offer is not a design preference; it falls out of
 * what the metric HAS. A gauge without a target has nothing to point at. A trend
 * without a time series has nothing to plot. A breakdown without categories has
 * nothing to break down. A by-rep view without per-rep data draws one line.
 *
 * So the offerable views are DERIVED here, never listed by hand — a hand-written
 * list is how a catalog comes to offer a gauge for a metric that has no target.
 *
 * ⚠⚠ EVERY ROW BELOW WAS MEASURED AGAINST THE LIVE DATABASE ON 2026-09-01, not
 * taken from a sketch. Counts are of REAL rows (seed/demo excluded where it
 * matters) and are recorded so the next reader can see WHY a metric is or is not
 * offerable, rather than trusting the flag.
 *
 * ⚠ CASH COLLECTED IS ABSENT BY STANDING RULING (Justin: "we don't track cash
 * collected at all, it's too finicky right now. The only time it's needed is on
 * the EOD report"). It is extracted and it drives EOD, and it must NOT appear in
 * this catalog — a catalog that offers every column would quietly overturn a
 * ruling. Its absence is asserted by a test so it cannot drift back in.
 */

/**
 * ⚠ THE PICKER GROUPS. Ten offerable metrics is enough that a flat list is worse
 * than categories — a manager scanning for "how are we closing" should not read
 * past objection handling to find it. The order is the order they are asked
 * about: what happened, then why, then how well it was run, then who.
 */
const GROUPS = [
  { key: 'outcomes',   label: 'Outcomes' },
  { key: 'objections', label: 'Objections' },
  { key: 'quality',    label: 'Call quality' },
  { key: 'people',     label: 'People' },
];

/** The view kinds a card can be. A card STRETCHES; it never changes kind. */
const VIEWS = {
  NUMBER: 'number',        // one figure now, with its counts
  GAUGE: 'gauge',          // needs a target
  TREND: 'trend',          // needs history
  BY_REP: 'by_rep',        // needs per-rep values
  BREAKDOWN: 'breakdown',  // needs categories
};

/**
 * ⚠ `source` is where the value comes from TODAY. `cost` says what asking for it
 * costs, because "computable" and "available" are different things and a catalog
 * that conflates them will offer a metric that takes ten seconds to draw.
 *   column     — a stored column, read directly
 *   aggregate  — computed by an existing lane from stored columns
 *   scan       — would require unpacking transcript JSON per call (see talk_ratio)
 */
const CATALOG = [
  {
    key: 'avg_score', group: 'quality', label: 'Average call score',
    source: 'aggregate', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: false, categories: null,
    measured: '1,551 of 1,585 done analyses carry overall_score',
    note: 'per_rep.avg_score and totals.avg_score both exist, with a prior-window '
        + 'value for a trend ARROW — which is not the same as a time series.',
  },
  {
    key: 'closing_rate', group: 'outcomes', label: 'Closing rate',
    source: 'aggregate', cost: 'aggregate', lane: 'prospect-entity',
    available: true, perRep: true, target: 25, history: true, categories: null,
    measured: 'prospect_id on 1,534 of 2,052 real calls; rep-series serves a '
            + '`close` line per rep and for the team',
    note: 'Denominator is PROSPECTS by the 2026-08-03 ruling, not calls. '
        + 'no_show and disqualified leave the denominator (hadAConversation).',
  },
  {
    key: 'objection_handle_rate', group: 'objections', label: 'Objection handling rate',
    source: 'aggregate', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: 35, history: true, categories: 'objection_category',
    measured: '1,417 objection moments, all 4 categories present '
            + '(fear 634 · partner 398 · timing 288 · logistical 97)',
    note: '⚠ objection_class (the strict true-objection split, v37) is on only 52 '
        + 'of 1,417 — new calls only. NULL counts by design, so the strict and '
        + 'loose rates are near-identical TODAY and will diverge as the corpus '
        + 'turns over. A breakdown by category is honest now; a strict-vs-loose '
        + 'comparison is not.',
  },
  {
    key: 'avg_call_time', group: 'quality', label: 'Average call time',
    source: 'column', cost: 'aggregate', lane: 'team-averages',
    available: true, perRep: true, target: 60, targetDirection: 'lower_is_better',
    history: false, categories: null,
    measured: 'duration_seconds on 2,046 of 2,052 real calls, 2,005 of them > 0',
    note: '⚠ THE ONLY INVERTED TARGET — 60 is a CEILING. A gauge must say so; '
        + '"at or below 60 min", never "at or above target".',
  },
  {
    key: 'calls_analyzed', group: 'people', label: 'Calls analyzed',
    source: 'aggregate', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: false, categories: null,
    measured: '1,585 done analyses',
    note: 'A volume count. It has no target and inventing one would be the '
        + 'weakest-against-target shape the loud-number ruling already refuses.',
  },
  {
    key: 'outcome_mix', group: 'outcomes', label: 'Outcome mix',
    source: 'column', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: false,
    categories: 'outcome',
    measured: 'follow_up 1,061 · closed 283 · lost 142 · no_show 89 · disqualified 0',
    note: '⚠ `disqualified` is MANUAL-ONLY and currently 0 — a breakdown must '
        + 'render the empty category rather than omitting it, or the reader '
        + 'cannot reconcile the total.',
  },
  {
    key: 'section_scores', group: 'quality', label: 'Section scores',
    source: 'column', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: false,
    categories: 'section',
    measured: 'intro 1,528 · discovery 1,478 · pitch 1,436 · objection 1,292 · '
            + 'close(earned) 1,401 of 1,585',
    note: '⚠ USE close_score_earned, NEVER close_score — migration 027 forces the '
        + 'DISPLAYED close score to 100 on a closed call. Measured 8 points of '
        + 'difference on a real board.',
  },
  {
    key: 'moment_mix', group: 'quality', label: 'Call moment mix',
    source: 'column', cost: 'aggregate', lane: 'call_highlights',
    available: true, perRep: true, target: null, history: false, categories: 'type',
    measured: 'buying_signal 2,620 · risk_signal 1,854 · objection 1,417 · '
            + 'strong_moment 1,012 · missed_opportunity 1,006 · barrier 795 · '
            + 'rapport_moment 161 · disqualify_signal 133',
    note: 'No lane serves this today — it is a group-by on call_highlights.type, '
        + 'which every team lane already loads.',
  },
  {
    key: 'time_to_price', group: 'quality', label: 'Time to price',
    source: 'column', cost: 'aggregate', lane: 'rep-series',
    available: true, perRep: true, target: null, history: true, categories: null,
    measured: 'price_stated_at_seconds on 426 of 1,585 (27%)',
    note: '⚠⚠ THE 27% IS NOT RANDOM AND A CARD MUST SAY SO. It is only computed '
        + 'for reps who have saved an offer price, so a rep with none is '
        + 'UNMEASURED rather than slow — and unmeasured and flat look identical '
        + 'on a chart. Already handled by the graph, and any new view inherits it.',
  },
  {
    key: 'prospects', group: 'people', label: 'Prospects',
    source: 'aggregate', cost: 'aggregate', lane: 'prospect-entity',
    available: true, perRep: true, target: null, history: false, categories: null,
    measured: 'prospect_id on 1,534 of 2,052 real calls',
    note: '⚠ Merge quality drives this directly — 355 unreviewed merge proposals '
        + 'on one account, each missed merge worth ~0.9 points of close rate.',
  },

  // ── NOT OFFERABLE TODAY, and each says why ───────────────────────────────
  {
    key: 'talk_ratio', group: 'quality', label: 'Talk ratio',
    source: 'scan', cost: 'scan', lane: null,
    available: false, perRep: true, target: null, history: false, categories: null,
    measured: 'COMPUTABLE, and I computed it: 66% closer on average across 200 '
            + 'real calls (min 0, max 100). transcript_stored.turns[] carries '
            + 'speaker + text on 1,585 of 1,585, speaker matched on 1,556.',
    note: '⚠⚠ COMPUTABLE IS NOT AVAILABLE, AND THAT DISTINCTION IS THE WHOLE '
        + 'POINT OF THIS ROW. Nothing stores or serves it: producing it means '
        + 'unpacking ~719 turns × 33 kB per call (50 MB total) on every render. '
        + 'That is a different cost class from reading a column. '
        + '⚠ AND THE min 0 / max 100 ARE REAL: one-speaker calls, the collapsed-'
        + 'transcript case already on file. A talk-ratio metric needs that '
        + 'exclusion or it will report 100% for a broken recording. '
        + '⚠ Turns carry start_seconds and NO END, so a TIME ratio must infer '
        + 'duration from the next turn and the last turn has none — word share '
        + 'is the sounder measure. Offerable after a stored per-call column.',
  },
  {
    key: 'discovery_coverage', group: 'quality', label: 'Discovery coverage',
    source: 'column', cost: 'aggregate', lane: null,
    available: false, perRep: true, target: null, history: false, categories: 'area_key',
    measured: 'coverage on 683 of 1,585 — but SPLIT ACROSS TWO VOCABULARIES: 626 '
            + 'rows carry one rep\'s DERIVED areas, only 65 carry the fixed six '
            + '(v33, new calls only)',
    note: '⚠⚠ NOT OFFERABLE AS ONE BREAKDOWN YET: the categories differ per rep. '
        + 'A chart whose columns change when you switch rep is one a manager '
        + 'cannot read. It becomes offerable as the corpus rolls forward onto '
        + 'the fixed six — a due date, not a dependency.',
  },
  {
    key: 'coaching_volume', group: 'quality', label: 'Coached moments',
    source: 'column', cost: 'aggregate', lane: null,
    available: false, perRep: true, target: null, history: false, categories: null,
    measured: 'call_highlights.coaching on 197 of 8,998 (2%) — v30, new calls only',
    note: 'Too thin to chart. Same roll-forward shape as discovery coverage.',
  },
];

/** ⚠ DERIVED, NEVER LISTED. This function IS the honesty rule. */
/**
 * ⚠⚠⚠ WHICH VIEWS A RENDERER CAN ACTUALLY DRAW — AND IT IS A DIFFERENT FACT
 * FROM WHETHER THE DATA EXISTS. Conflating those two is what shipped a catalog
 * asserting 30 offerable combinations of which THIRTEEN were broken.
 *
 * Measured on the deployed page by rendering every offered combination through
 * the real dashCardHtml and reading what a manager would SEE:
 *
 *     8 rendered "Not enough to measure — NO DATA IN THIS RANGE", which is a
 *       FALSE REASON: there is data, we simply do not read it here;
 *     5 rendered ANOTHER METRIC'S NUMBERS. dashByRepHtml fell back to avg_score
 *       for any key it did not know, so "Outcome mix — by rep", "Time to price
 *       — by rep" and three others all showed Josh 64 / Godwin 60 / Yazan 58.
 *       ⚠⚠ THAT IS WORSE THAN AN EMPTY CARD BY A LONG WAY — a card headed "Time
 *       to price" showing 64 reads as minutes, and nothing on screen says
 *       otherwise. Silently wrong, confidently labelled.
 *
 * ⚠ SO THE OFFER IS THE INTERSECTION OF *DATA* CAPABILITY AND *RENDER*
 * CAPABILITY. Neither alone is the answer, and dropping either gate re-opens
 * one of the two failures above.
 *
 * ⚠⚠ THIS IS A FACT ABOUT web/dashboard.html, WHICH THIS FILE CANNOT READ — so
 * it is declared here and MIRRORED against the real renderers by
 * test/widget-render-mirror.test.js, the same shape as the SQL/JS scope mirror.
 * A renderer gaining a metric and this list not following is a test failure,
 * never a silently broken card.
 */
const RENDERABLE = {
  number:    ['avg_score', 'calls_analyzed', 'closing_rate', 'objection_handle_rate', 'prospects'],
  gauge:     ['closing_rate', 'objection_handle_rate', 'avg_call_time'],
  trend:     ['closing_rate', 'objection_handle_rate', 'time_to_price'],
  by_rep:    ['avg_score', 'closing_rate', 'objection_handle_rate', 'calls_analyzed', 'prospects'],
  breakdown: ['objection_handle_rate'],
};

function canRender(view, key) {
  return (RENDERABLE[view] || []).indexOf(key) !== -1;
}

function viewsFor(metric) {
  if (!metric || !metric.available) return [];
  /* ⚠ THE DATA GATE IS UNCHANGED AND STILL FIRST — a gauge is unofferable for a
     metric with no target whether or not a renderer exists. The render gate
     only ever REMOVES; it can never add a view the data cannot support. */
  const wanted = [VIEWS.NUMBER];
  if (typeof metric.target === 'number') wanted.push(VIEWS.GAUGE);
  if (metric.history) wanted.push(VIEWS.TREND);
  if (metric.perRep) wanted.push(VIEWS.BY_REP);
  if (metric.categories) wanted.push(VIEWS.BREAKDOWN);
  return wanted.filter(function (v) { return canRender(v, metric.key); });
}

function catalog() {
  return CATALOG.map(function (m) {
    return Object.assign({}, m, { views: viewsFor(m) });
  });
}

function offerable() { return catalog().filter(function (m) { return m.available; }); }
function byKey(k) { return catalog().filter(function (m) { return m.key === k; })[0] || null; }

/** ⚠ DERIVED FROM THE CATALOG, so a metric cannot be added and left ungrouped —
    an ungrouped metric would simply vanish from the picker, which is the silent
    kind of absence this product keeps having to fix. */
/* ⚠⚠ THE CATALOG'S `measured` AND `note` FIELDS ARE INTERNAL AND MUST NOT BE
   SERIALISED. They are engineering notes — "USE close_score_earned, NEVER
   close_score", "migration 027", "transcript_stored.turns[]", row counts — and
   sending the WHOLE entry puts every one of them in a customer's browser. It
   renders nowhere today, which is exactly the problem: it is one innerHTML away
   from being on screen, and the customer-language ruling is about what a
   customer CAN see, not what they happen to be shown this week.

   ⚠ SO THE WIRE SHAPE IS AN ALLOWLIST, NOT A DELETION. The notes stay in
   CATALOG where they belong — they are the measured justification for every
   `available` flag — and this picks out the seven fields the picker reads. */
var PUBLIC_FIELDS = ['key', 'label', 'views', 'target', 'targetDirection', 'history', 'categories'];

function publicMetric(m) {
  var out = {};
  PUBLIC_FIELDS.forEach(function (f) { if (m[f] !== undefined) out[f] = m[f]; });
  return out;
}

/* ⚠⚠ A METRIC WITH NO OFFERABLE VIEW IS NOT OFFERED — it is NAMED in the
   unavailable list instead. An entry in the picker that leads only to cards
   which render nothing is worse than an absence a manager was told about, and
   this is the same rule the unavailable section already follows. */
function isOfferable(m) { return m.available && m.views.length > 0; }

function grouped() {
  var all = catalog();
  return GROUPS.map(function (g) {
    return { key: g.key, label: g.label,
             metrics: all.filter(function (m) { return m.group === g.key && isOfferable(m); })
                         .map(publicMetric) };
  }).filter(function (g) { return g.metrics.length; });
}

/** ⚠⚠ NOT HIDDEN. A manager who wonders where talk ratio went must be told, not
    left guessing — an unexplained absence reads as a product that lost it.
    ⚠ AND THE NAME IS ALL THEY GET. `measured` reads "coverage on 683 of 1,585 —
    SPLIT ACROSS TWO VOCABULARIES"; that is a fact about our schema, not
    something a manager can act on, and the customer-language ruling says a
    message that cannot say WHAT HAPPENED and WHAT TO DO does not belong on
    screen. The picker supplies the one sentence they can act on. */
/* ⚠⚠ TWO KINDS OF UNAVAILABLE, AND ONE SENTENCE CANNOT SERVE BOTH. "Scout
   cannot measure this across your team yet" is TRUE of talk ratio and FALSE of
   outcome mix — Scout measures that perfectly well; there is simply no card
   that draws it. A wrong reason is worse than no reason: it sends a manager to
   wait for data that already exists.

   ⚠ A CLOSED VOCABULARY, NOT PROSE. The surface owns the wording; this owns
   which of the two it is, so the sentence cannot drift per caller. */
var UNAVAILABLE_REASON = { NO_DATA: 'no_data', NO_CARD: 'no_card' };

function unavailable() {
  return catalog().filter(function (m) { return !isOfferable(m); })
                  .map(function (m) {
                    return { key: m.key, label: m.label,
                             reason: m.available ? UNAVAILABLE_REASON.NO_CARD
                                                 : UNAVAILABLE_REASON.NO_DATA };
                  });
}

module.exports = {
  VIEWS: VIEWS,
  GROUPS: GROUPS,
  grouped: grouped,
  _publicMetric: publicMetric,
  _PUBLIC_FIELDS: PUBLIC_FIELDS,
  unavailable: unavailable,
  catalog: catalog,
  offerable: offerable,
  UNAVAILABLE_REASON: UNAVAILABLE_REASON,
  _RENDERABLE: RENDERABLE,
  _canRender: canRender,
  byKey: byKey,
  _viewsFor: viewsFor,
  _CATALOG: CATALOG,
};
