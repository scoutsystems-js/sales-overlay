/**
 * IS THIS OBJECTION HANDLED? — one definition, ten callers (ruling 2026-08-17).
 *
 * Justin: "objections are just barriers to a close, so if they side-step the
 * barrier and still close, that's a win in my book."
 *
 *     handled = resolution === 'handled'  OR  the call's outcome === 'closed'
 *
 * ⚠ BINARY. `partial` scores ZERO. Half-credit was considered and rejected — a
 * partially handled objection is not a handled one.
 *
 * ⚠ WHY THIS IS A MODULE AND NOT AN INLINE EXPRESSION. Ten surfaces ask this
 * question: the two manager line graphs, the gauge panel, the team glance box,
 * the rep cards, the WHY sentence (which quotes the rate in PROSE), the
 * per-category buckets that decide which category is named a rep's weakest,
 * team AND personal What-Needs-Work, the coaching tile, the Objections view, and
 * three synthesis prompts. Written out ten times it drifts, and the drift
 * surfaces as two different handle rates on ONE screen — which is how a manager
 * stops trusting the page.
 *
 * ⚠⚠ DO NOT USE THIS TO ANSWER "WAS THIS A GOOD MOMENT?" Five callers test
 * `resolution === 'handled'` for that question — the good/bad grouping, the
 * "what worked" lane, highlight-of-the-week, the mig-012 write-time boolean, and
 * the per-moment badge. A moment inside a closed call is NOT automatically a good
 * moment, and crediting it there would file weak handling under "what worked",
 * which is the opposite of coaching. Those five are deliberately untouched and
 * each carries a comment saying so.
 *
 * ⚠ AND THE REASON THE MONEY MATH HAD TO GO IN THE SAME COMMIT: What-Needs-Work
 * measured P(closed | handled) − P(closed | not handled). Under this definition
 * the not-handled group CANNOT contain a closed call, so that second term is
 * 0.0% by construction and the delta is a tautology. Measured live: 46.6 → 67.6
 * points, inflating every dollar figure ~45% while still reading as a
 * measurement. See the CLAUDE.md entry.
 */

// row: { resolution } — the stored highlight. outcome: the CALL's outcome.
// Never throws: a malformed row is simply not handled on its own merit, but a
// closed call still credits it, because the credit comes from the CALL.
function isStrict(row) {
  return !!(row && typeof row === 'object' && row.resolution === 'handled');
}

function isClosed(outcome) { return outcome === 'closed'; }

// Handled on the call's merit rather than the moment's. Deliberately EXCLUSIVE
// of isStrict so the two never double-count — the Objections view renders them
// as separate buckets and they must sum to the total.
function isCredited(row, outcome) {
  return isClosed(outcome) && !isStrict(row);
}

function isHandled(row, outcome) {
  return isStrict(row) || isClosed(outcome);
}

// analyses: [{ fathom_call_id, outcome }] → { call_id: outcome|null }
// A row with no outcome maps to null rather than being absent, so callers can
// tell "analysed, not closed" from "no analysis at all" if they ever need to.
function outcomeMap(analyses) {
  var m = {};
  (Array.isArray(analyses) ? analyses : []).forEach(function (a) {
    if (a && a.fathom_call_id) m[a.fathom_call_id] = a.outcome || null;
  });
  return m;
}

/**
 * Every count the rate AND the on-screen breakdown need, from one pass.
 *
 * The four displayed buckets — strict, credited, partial, unhandled — SUM TO THE
 * TOTAL. That is the property that makes the badge honest: a manager can add up
 * what is on screen and arrive at the rate above it.
 *
 * rate is NULL on an empty set, never 0 — "handled nothing" and "had nothing to
 * handle" are different claims, and the house rule is to make neither by accident.
 */
function countObjections(rows, outcomeByCall) {
  var m = outcomeByCall || {};
  var c = { total: 0, strict: 0, credited: 0, partial: 0, unhandled: 0, handled: 0, rate: null };
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r) return;
    c.total++;
    var outcome = m[r.fathom_call_id];
    if (isStrict(r)) { c.strict++; return; }
    if (isCredited(r, outcome)) { c.credited++; return; }
    if (r.resolution === 'partial') c.partial++; else c.unhandled++;
  });
  c.handled = c.strict + c.credited;
  c.rate = c.total > 0 ? Math.round((c.handled / c.total) * 100) : null;
  return c;
}

module.exports = {
  isHandled: isHandled,
  isCredited: isCredited,
  isStrict: isStrict,
  outcomeMap: outcomeMap,
  countObjections: countObjections,
};
