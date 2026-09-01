'use strict';
/**
 * ⚠⚠ THE LAYOUT RESOLVER — where a stored board meets the catalog.
 *
 * THE DEFAULT LIVES HERE, IN CODE, AND IS NEVER WRITTEN TO A ROW. A manager who
 * has never customised anything has no row in `dashboards` and inherits this.
 * ⚠ The moment a default is materialised per manager, adding a widget stops
 * reaching anyone who already has a board — silently and permanently. That is
 * the third application of store-the-deviation, and the first two (Customize
 * View's hidden set; the pivot-state opt-in list) are precedent, not analogy.
 *
 * ⚠⚠ THE CATALOG IS THE AUTHORITY. A stored layout is a REQUEST, not a
 * guarantee: `reps_active` and `close_rate` were both removed in one week, and a
 * board naming either must degrade rather than throw or render an empty box.
 */
const { byKey, VIEWS } = require('./widget-catalog');

/**
 * ⚠ THE DEFAULT MIRRORS WHAT THE PERFORMANCE PAGE RENDERS TODAY, in its order —
 * the three gauges, then the two graphs, then the rep list. A manager who never
 * touches this must not notice the catalog exists.
 * ⚠ Sizes are grid columns of 4. `w:4` is full width.
 */
const DEFAULT_LAYOUT = [
  { metric: 'closing_rate',          view: VIEWS.GAUGE,     w: 1, h: 1 },
  { metric: 'objection_handle_rate', view: VIEWS.GAUGE,     w: 1, h: 1 },
  { metric: 'avg_call_time',         view: VIEWS.GAUGE,     w: 1, h: 1 },
  { metric: 'objection_handle_rate', view: VIEWS.TREND,     w: 2, h: 2 },
  { metric: 'closing_rate',          view: VIEWS.TREND,     w: 2, h: 2 },
  { metric: 'avg_score',             view: VIEWS.BY_REP,    w: 4, h: 2 },
];

const MAX_BOARDS = 10;          // a dropdown limit, not a storage one
const MAX_CARDS = 24;

function clampSpan(n, max) {
  var v = Math.round(Number(n));
  if (!isFinite(v) || v < 1) return 1;
  return v > max ? max : v;
}

/**
 * Resolve a stored layout against the catalog.
 *
 * Returns { cards, dropped } where `dropped` names what could not be rendered —
 * ⚠⚠ THE BOARD MUST SAY A CARD WAS DROPPED, ONCE. A board that quietly shrinks
 * is indistinguishable from a manager mis-remembering what they put there.
 *
 * ⚠⚠ NOTHING HERE WRITES. The unknown entry stays in the stored row untouched,
 * because a metric can come back — a lane restored, a column re-added — and a
 * read path that prunes storage makes that unrecoverable. Drop it from the
 * RENDER, never from the ROW.
 */
function resolveLayout(stored) {
  var raw = Array.isArray(stored) && stored.length ? stored : DEFAULT_LAYOUT;
  var cards = [];
  var dropped = [];

  raw.slice(0, MAX_CARDS).forEach(function (c) {
    var key = c && c.metric;
    var m = key ? byKey(key) : null;
    if (!m || !m.available) { dropped.push({ metric: key || '(unnamed)', reason: 'no longer available' }); return; }

    /* ⚠ A STORED VIEW A METRIC NO LONGER SUPPORTS FALLS BACK TO `number`, which
       every available metric offers — a target can be withdrawn, and a gauge
       with nothing to point at is worse than a plain figure. The fallback is
       recorded so the card can say it changed rather than silently differing
       from what the manager chose. */
    var want = c.view;
    var view = (m.views.indexOf(want) !== -1) ? want : VIEWS.NUMBER;

    cards.push({
      metric: m.key, label: m.label, view: view,
      requestedView: (view === want) ? null : (want || null),
      w: clampSpan(c.w, 4), h: clampSpan(c.h, 3),
      target: (typeof m.target === 'number') ? m.target : null,
      targetDirection: m.targetDirection || 'higher_is_better',
      categories: m.categories || null,
    });
  });

  return { cards: cards, dropped: dropped, isDefault: !(Array.isArray(stored) && stored.length) };
}

/**
 * ⚠⚠ SANITISE ON THE WAY IN, NOT ONLY ON THE WAY OUT. `resolveLayout` already
 * refuses an unknown metric and clamps a span at READ time — but a board is
 * stored for a long time and read by code that trusts it, so letting a bad entry
 * into the row means every future reader depends on the reader's own guard.
 * ⚠ THE CLIENT IS A SUGGESTION. A 99-column span or a made-up view name must not
 * reach the database in the first place.
 * ⚠ AN UNSUPPORTED VIEW IS COERCED TO `number` HERE TOO, so the stored row says
 * what will actually be rendered rather than a request that silently degrades on
 * every read.
 */
function sanitizeLayout(input) {
  if (!Array.isArray(input)) return [];
  var out = [];
  input.slice(0, MAX_CARDS).forEach(function (c) {
    var m = c && c.metric ? byKey(c.metric) : null;
    if (!m || !m.available) return;
    var view = (c.view && m.views.indexOf(c.view) !== -1) ? c.view : VIEWS.NUMBER;
    out.push({ metric: m.key, view: view, w: clampSpan(c.w, 4), h: clampSpan(c.h, 3) });
  });
  return out;
}

module.exports = {
  sanitizeLayout: sanitizeLayout,
  DEFAULT_LAYOUT: DEFAULT_LAYOUT,
  MAX_BOARDS: MAX_BOARDS,
  MAX_CARDS: MAX_CARDS,
  resolveLayout: resolveLayout,
};
