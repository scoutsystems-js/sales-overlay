/**
 * 10c-1 — the derivations the manager rep cards need. Pure, no model call.
 *
 * The cards show: name, closing % with counts, objection handling % with counts,
 * weakest section, and weakest objection with its team comparison. The first
 * three already come from computeTeamAnalytics; the last two are here.
 *
 * ⚠ WEAKEST SECTION MUST READ close_score_earned, NOT close_score. Migration 027
 * forces the DISPLAYED close score to 100 on closed calls — the section drilldown
 * already reads the earned column for that reason, but team-analytics selected
 * the inflated one. Measured live, this flips a result at the margin (one rep
 * ties under one column and not the other). The caller passes the earned value.
 *
 * ⚠ A TEAM RANKING NEEDS A TEAM (ruling 2026-08-16). "Lowest on the team" is
 * stated ONLY when at least MIN_REPS_FOR_RANKING reps have at least
 * MIN_CATEGORY_OBJECTIONS objections in that category. Measured on live data,
 * exactly ONE rep clears that today (josh: fear 47 / timing 42 / partner 27 /
 * logistical 16; everyone else 1-5). A ranking off n=1 reads as a finding and
 * means nothing, so the rep's own rate is shown with its counts and no ranking.
 */

// Consistent with team-needs-work's MIN_BUCKET — the same question ("is this
// enough objections to judge a category?") should not have two answers.
const MIN_CATEGORY_OBJECTIONS = 6;
const MIN_REPS_FOR_RANKING = 3;

// Stable order so a tie resolves the same way on every load rather than
// following object key order, which would make the card flicker.
const SECTION_ORDER = ['intro', 'discovery', 'pitch', 'objection', 'close'];

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }

// sections: { intro, discovery, pitch, objection, close } — close MUST be the
// EARNED score. A null section is skipped, never read as zero: a rep with no
// scored objection calls must not be told objection is their weakest area at 0.
function weakestSection(sections) {
  if (!sections || typeof sections !== 'object') return null;
  var best = null;
  SECTION_ORDER.forEach(function (key) {
    var v = sections[key];
    if (typeof v !== 'number' || !isFinite(v)) return;
    if (best === null || v < best.score) best = { section: key, score: v };
  });
  return best;
}

// byCategory: { fear: {total, handled}, ... } for ONE rep.
// teamByCategory: { fear: {reps_with_volume, total, handled, lowest_rate}, ... }
//
// Returns null when no category has enough volume to judge — a shrug is the
// honest answer, and dressing one up as a finding is the failure this project
// keeps designing against.
function weakestObjection(byCategory, teamByCategory) {
  if (!byCategory || typeof byCategory !== 'object') return null;
  var team = teamByCategory || {};
  var worst = null;

  // ⚠ COMPARE THE EXACT RATIO, ROUND ONLY FOR DISPLAY. Josh's live numbers are
  // the reason: timing 3/42 = 7.14% and partner 2/27 = 7.41% BOTH display as 7%,
  // so comparing the rounded values picked whichever came first alphabetically
  // and reported the wrong category as his weakest.
  Object.keys(byCategory).sort().forEach(function (key) {
    var c = byCategory[key];
    if (!c || c.total < MIN_CATEGORY_OBJECTIONS) return;      // too thin to judge
    var exact = c.handled / c.total;
    if (worst === null || exact < worst._exact) {
      worst = { category: key, rate: pct(c.handled, c.total), handled: c.handled, total: c.total, _exact: exact };
    }
  });
  if (!worst) return null;

  // The ranking, only if there is a team to rank against.
  var t = team[worst.category] || {};
  var comparable = (t.reps_with_volume || 0) >= MIN_REPS_FOR_RANKING;
  worst.comparable = comparable;
  worst.team_rate = comparable ? pct(t.handled, t.total) : null;
  worst.is_lowest = comparable ? (worst.rate <= t.lowest_rate) : null;
  delete worst._exact;                                        // internal only
  return worst;
}

// Worst first: closing rate ascending, reps with NO prospects last.
// A rep with zero prospects is not worst, they are unmeasured — and a genuine
// 0% IS worst, which is why the two are separated rather than both sorting low.
function sortRepsWorstFirst(reps) {
  if (!Array.isArray(reps)) return [];
  return reps.slice().sort(function (a, b) {
    var am = a.prospect_close_total > 0 && typeof a.prospect_close_rate === 'number';
    var bm = b.prospect_close_total > 0 && typeof b.prospect_close_rate === 'number';
    if (am !== bm) return am ? -1 : 1;                        // unmeasured last
    if (am && a.prospect_close_rate !== b.prospect_close_rate) {
      return a.prospect_close_rate - b.prospect_close_rate;
    }
    return String(a.display_name || '').localeCompare(String(b.display_name || ''));
  });
}

module.exports = {
  weakestSection: weakestSection,
  weakestObjection: weakestObjection,
  sortRepsWorstFirst: sortRepsWorstFirst,
  MIN_CATEGORY_OBJECTIONS: MIN_CATEGORY_OBJECTIONS,
  MIN_REPS_FOR_RANKING: MIN_REPS_FOR_RANKING,
};
