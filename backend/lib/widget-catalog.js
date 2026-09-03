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
  TREND: 'trend',          // needs history — this IS the line graph
  BY_REP: 'by_rep',        // needs per-rep values
  BREAKDOWN: 'breakdown',  // needs categories
  /* ⚠⚠ A NEW CHART TYPE IS A NEW CAPABILITY REQUIREMENT, NOT A NEW ENTRY ON A
     LIST. Both bars below reuse a requirement that already exists — per-rep
     values and categories — so `viewsFor` decides who gets them exactly as it
     decides everything else, and a metric with no categories is STRUCTURALLY
     unable to be offered a category bar chart.

     ⚠ ORIENTATION IS FIXED PER DATA SHAPE, AND IT IS A MEASURED DECISION rather
     than a restriction: rep names run 8-13 characters and there can be nine of
     them, which is unreadable rotated; category names run 4-10 and there are
     four or five, which is exactly what vertical columns are for. If the
     orientation should become a free choice, the drawing already takes it as a
     parameter — that is a small follow-up, not a rebuild.

     ⚠ AND NEITHER USES A CANVAS. `trend` needs one because it draws axes and
     several series over time; four-to-nine bars do not, and plain elements
     avoid the whole mount/destroy/rebuild lifecycle a canvas drags in. */
  BAR_REP: 'bar_rep',      // needs per-rep values — horizontal
  BAR_CAT: 'bar_cat',      // needs categories — vertical
  /* ⚠⚠ A PERSON, NOT A METRIC (2026-09-02). The catalog derives views from what
     a METRIC has; a rep card is ONE closer with every metric, so it is its own
     kind, offered only by a `person` entry and drawn by the SAME repCardHtml the
     Performance page uses. One design, two placements. */
  REP_CARD: 'rep_card',
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
    key: 'avg_score', description: "Scout's grade for each call, averaged. Points out of 100.", group: 'quality', label: 'Average call grade',
    source: 'aggregate', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: true, categories: null,
    measured: '1,551 of 1,585 done analyses carry overall_score',
    note: 'per_rep.avg_score and totals.avg_score both exist, with a prior-window '
        + 'value for a trend ARROW — which is not the same as a time series.',
  },
  {
    key: 'closing_rate', description: 'People who bought \u00f7 people you actually spoke to, as a percent. No-shows and disqualified prospects are left out, and one person counts once however many calls it took.', group: 'outcomes', label: 'Closing rate',
    source: 'aggregate', cost: 'aggregate', lane: 'prospect-entity',
    available: true, perRep: true, target: 25, history: true, categories: null,
    measured: 'prospect_id on 1,534 of 2,052 real calls; rep-series serves a '
            + '`close` line per rep and for the team',
    note: 'Denominator is PROSPECTS by the 2026-08-03 ruling, not calls. '
        + 'no_show and disqualified leave the denominator (hadAConversation).',
  },
  {
    key: 'objection_handle_rate', description: 'Objections you got past \u00f7 objections raised, as a percent. Half-handled counts as not handled.', group: 'objections', label: 'Objection handling rate',
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
    key: 'avg_call_time', description: 'Total call minutes \u00f7 calls, in minutes. 60 is a ceiling, not a target \u2014 under is good.', group: 'quality', label: 'Average call time',
    source: 'column', cost: 'aggregate', lane: 'team-averages',
    available: true, perRep: true, target: 60, targetDirection: 'lower_is_better',
    history: true, categories: null,
    measured: 'duration_seconds on 2,046 of 2,052 real calls, 2,005 of them > 0',
    note: '⚠ THE ONLY INVERTED TARGET — 60 is a CEILING. A gauge must say so; '
        + '"at or below 60 min", never "at or above target".',
  },
  {
    /* ⚠⚠ THE REP CARD — a PERSON entry (Justin, 2026-09-02: trading-card rep cards,
       treatment C). Not a metric: it has no value, no target, no history of its
       own. It carries a `rep` on the placed card and renders every figure that
       closer has, through the one repCardHtml the Performance page draws. */
    key: 'rep_card', description: 'One closer, every number \u2014 the card from the Performance page. You pick who.', group: 'people', label: 'Rep card',
    source: 'derived', cost: 'aggregate', lane: 'team-overview',
    available: true, person: true, perRep: false, target: null, targetDirection: null,
    history: false, categories: null,
    measured: 'per_rep on /team/overview \u2014 10 closers on the live board 2026-09-02, 8 with graded calls',
    note: '\u26a0 A card slot narrower than 2 columns cannot hold treatment C; the layout clamps it up rather than drawing a second, narrower design.',
  },
  {
    key: 'calls_analyzed', description: 'How many calls Scout has finished grading, as a count.', group: 'people', label: 'Calls graded',
    source: 'aggregate', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: true, categories: null,
    measured: '1,585 done analyses',
    note: 'A volume count. It has no target and inventing one would be the '
        + 'weakest-against-target shape the loud-number ruling already refuses.',
  },
  {
    key: 'outcome_mix', description: 'Every call split into closed, follow-up, lost and no-show. A breakdown, not a rate.', group: 'outcomes', label: 'Outcome mix',
    source: 'column', cost: 'aggregate', lane: 'team-analytics',
    available: true, perRep: true, target: null, history: false,
    categories: 'outcome',
    measured: 'follow_up 1,061 · closed 283 · lost 142 · no_show 89 · disqualified 0',
    note: '⚠ `disqualified` is MANUAL-ONLY and currently 0 — a breakdown must '
        + 'render the empty category rather than omitting it, or the reader '
        + 'cannot reconcile the total.',
  },
  {
    key: 'section_scores', description: 'The grade for each part of a call \u2014 intro, discovery, pitch, objections, close \u2014 side by side. Five numbers out of 100.', group: 'quality', label: 'Section scores',
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
    key: 'moment_mix', description: 'Every moment Scout flagged, split by kind \u2014 objection, buying signal, risk, missed opportunity. A count breakdown.', group: 'quality', label: 'Call moment mix',
    source: 'column', cost: 'aggregate', lane: 'call_highlights',
    available: true, perRep: true, target: null, history: false, categories: 'type',
    measured: 'buying_signal 2,620 · risk_signal 1,854 · objection 1,417 · '
            + 'strong_moment 1,012 · missed_opportunity 1,006 · barrier 795 · '
            + 'rapport_moment 161 · disqualify_signal 133',
    note: 'No lane serves this today — it is a group-by on call_highlights.type, '
        + 'which every team lane already loads.',
  },
  {
    key: 'time_to_price', description: 'Minutes from the start of the call to the price being said. Calls where no price came up are left out, not counted as zero.', group: 'quality', label: 'Minutes to price',
    source: 'column', cost: 'aggregate', lane: 'rep-series',
    available: true, perRep: true, target: null, history: true, categories: null,
    measured: 'price_stated_at_seconds on 426 of 1,585 (27%)',
    note: '⚠⚠ THE 27% IS NOT RANDOM AND A CARD MUST SAY SO. It is only computed '
        + 'for reps who have saved an offer price, so a rep with none is '
        + 'UNMEASURED rather than slow — and unmeasured and flat look identical '
        + 'on a chart. Already handled by the graph, and any new view inherits it.',
  },
  {
    key: 'prospects', description: 'How many people had a real conversation with you, as a count. These are the people your closing rate is out of.', group: 'people', label: 'People talked to',
    source: 'aggregate', cost: 'aggregate', lane: 'prospect-entity',
    available: true, perRep: true, target: null, history: true, categories: null,
    measured: 'prospect_id on 1,534 of 2,052 real calls',
    note: '⚠ Merge quality drives this directly — 355 unreviewed merge proposals '
        + 'on one account, each missed merge worth ~0.9 points of close rate.',
  },

  // ── NOT OFFERABLE TODAY, and each says why ───────────────────────────────
  {
    key: 'talk_ratio', description: 'Share of the words on a call that were yours, as a percent.', group: 'quality', label: 'Talk ratio',
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
    key: 'discovery_coverage', description: 'How often each discovery area was actually established, as a percent.', group: 'quality', label: 'Discovery coverage',
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
    key: 'coaching_volume', description: 'How many moments Scout wrote coaching for, as a count.', group: 'quality', label: 'Coached moments',
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
/* ⚠⚠ THE BAND IS IMPORTED, NOT DECLARED HERE. `lib/team-averages.js` and this
   file each declared call time's DIRECTION separately; they agreed, which is
   exactly how a shared-carrier failure hides. One definition, both consumers. */
var METRIC_BAND = require('./metric-band.js');

/* ⚠ ONE ARRAY, TWO KEYS (③-7, 2026-09-02). `by_rep` and `bar_rep` were typed twice under a
   comment claiming they were identical by construction; they were identical by coincidence.
   The bars draw the same ranking the list reads, so the offer is the same object. */
const RANKED_REP_VIEWS = ['avg_score', 'closing_rate', 'objection_handle_rate', 'calls_analyzed', 'prospects',
                          'avg_call_time', 'time_to_price'];

const RENDERABLE = {
  /* ⚠⚠ BOTH MINUTE METRICS REACH THE NUMBER CARD, AND ONLY ONE REACHES THE
     RANKED VIEWS. A number states a value and implies NO ORDERING, so it is
     safe for a metric whose direction nobody has ruled on. A ranked list or a
     bar chart asserts better-and-worse, and that is a different claim. */
  number:    ['avg_score', 'calls_analyzed', 'closing_rate', 'objection_handle_rate', 'prospects',
              'avg_call_time', 'time_to_price'],
  gauge:     ['closing_rate', 'objection_handle_rate', 'avg_call_time'],
  /* ⚠ FOUR HISTORIES ADDED 2026-09-01. Seven of ten metrics were snapshots, so
     seven of ten could never have a line — and a bar chart of a snapshot is the
     same number in a different outline. Three of these cost NOTHING (the rows
     were already fetched and bucketed by rep and week) and one cost a column. */
  trend:     ['closing_rate', 'objection_handle_rate', 'time_to_price',
              'avg_score', 'calls_analyzed', 'prospects', 'avg_call_time'],
  /* ⚠⚠ `avg_call_time` JOINS THE RANKED VIEWS AND `time_to_price` DOES NOT, and
     the difference is a RULING, not an oversight. Justin ruled the call-time
     direction outright — "60min is the max, anything less than that is good" —
     so `targetDirection: 'lower_is_better'` sorts the fastest rep first and the
     longest bar is correctly the worst. NOBODY HAS RULED WHETHER A FASTER TIME
     TO PRICE IS BETTER, and this project's own record warns the other way (a
     price question deflected before the pitch is CORRECT technique, v20). With
     no direction it would default to higher-is-better and rank the SLOWEST rep
     first — a wrong direction has no wrong number, so nothing on screen would
     look off. Left refused until it is ruled. */
  /* ⚠⚠ `time_to_price` JOINS THE RANKED VIEWS — a BAND gives it the order a
     direction could not. It was refused while it had neither: with no direction
     it would have sorted SLOWEST FIRST and the longest bar would have read as
     the best rep. Justin ruled the late edge ("if you're price dropping after 45
     min you're moving slow") and the early edge came from the coverage table, so
     ranking by distance from the band is now well defined — and each row states
     WHICH SIDE, because a rep pricing at 15 minutes and one pricing at 60 are
     both outside and need opposite coaching. */
  by_rep:    RANKED_REP_VIEWS,
  breakdown: ['objection_handle_rate'],
  /* ⚠ THE BARS DRAW THE SAME DATA THE LIST VIEWS ALREADY READ, so their
     renderable set is the SAME ARRAY — identical by construction now, not by a
     comment (③-7); a test asserts the identity. */
  bar_rep:   RANKED_REP_VIEWS,
  bar_cat:   ['objection_handle_rate'],
  rep_card:  ['rep_card'],
};

function canRender(view, key) {
  return (RENDERABLE[view] || []).indexOf(key) !== -1;
}

function viewsFor(metric) {
  if (!metric || !metric.available) return [];
  /* ⚠ THE DATA GATE IS UNCHANGED AND STILL FIRST — a gauge is unofferable for a
     metric with no target whether or not a renderer exists. The render gate
     only ever REMOVES; it can never add a view the data cannot support. */
  /* A person offers the card and nothing else — derived from the property,
     never listed by hand. */
  if (metric.person) return canRender(VIEWS.REP_CARD, metric.key) ? [VIEWS.REP_CARD] : [];
  const wanted = [VIEWS.NUMBER];
  if (typeof metric.target === 'number') wanted.push(VIEWS.GAUGE);
  if (metric.history) wanted.push(VIEWS.TREND);
  if (metric.perRep) wanted.push(VIEWS.BY_REP);
  if (metric.perRep) wanted.push(VIEWS.BAR_REP);
  if (metric.categories) wanted.push(VIEWS.BREAKDOWN);
  if (metric.categories) wanted.push(VIEWS.BAR_CAT);
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
/* ⚠⚠ `description` IS THE FIELD THAT ANSWERED THE COMPLAINT, not `label`.
   "I don't know what those metrics do" is not fixed by a better name — a
   manager placing a card needs the numerator, the denominator and the unit.
   It is customer-facing prose and belongs on the wire; the `measured` and
   `note` fields stay OFF it, because those are our engineering record. */
/* ⚠ `band` REACHES THE BROWSER because the ranked list and the card both need
   its edges to say which side a rep is on. A band with no edges on the wire
   would leave the client guessing, which is the direction model again. */
var PUBLIC_FIELDS = ['key', 'label', 'description', 'views', 'target', 'targetDirection', 'band', 'history', 'categories', 'person'];

function publicMetric(m) {
  var out = {};
  PUBLIC_FIELDS.forEach(function (f) { if (m[f] !== undefined) out[f] = m[f]; });
  /* ⚠ READ FROM THE ONE BAND MODULE rather than duplicated onto each metric —
     a second copy on the catalog entry is the drift this file exists to stop. */
  var b = METRIC_BAND.bandFor(m.key);
  if (b) out.band = b;
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
