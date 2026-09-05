/**
 * PAGE FACTS (H728, step 2) — lanes must not contradict each other on one page.
 *
 * Justin's correction governs: generalising about "the team" is FINE ("we're doing really well at
 * XYZ" with one or two exceptions is what a manager says, and it is true). The defect is two lanes
 * asserting OPPOSITES on one page — "reps are isolating well" beside "reps are not isolating" —
 * because each was generated blind to the others. The shape: every generated lane on a page is
 * handed the SAME deterministic facts (section averages; objection handling by category, above the
 * one comparison floor), and a claim whose DIRECTION contradicts them — a strength on the weakest
 * section or the worst-handled category, a gap on the strongest or the best-handled — is dropped.
 * The middle is never judged: generalising is fine. Pure.
 */
'use strict';

/** @param sections {intro, discovery, pitch, objection, close} averages (null when unmeasured)
 *  @param obj {category: {handled, total}}
 *  @param opts {minBucket} — the one comparison floor (MIN_BUCKET, team-needs-work) */
function pageFacts(sections, obj, opts) {
  var floor = (opts && typeof opts.minBucket === 'number') ? opts.minBucket : 5;
  var secs = {}; var strongest = null, weakest = null;
  Object.keys(sections || {}).forEach(function (s) {
    var v = sections[s]; if (typeof v !== 'number') return; secs[s] = v;
    if (strongest === null || v > secs[strongest]) strongest = s;
    if (weakest === null || v < secs[weakest]) weakest = s;
  });
  if (Object.keys(secs).length < 2) { strongest = null; weakest = null; }
  var cats = {}; var best = null, worst = null;
  Object.keys(obj || {}).forEach(function (c) {
    var b = obj[c] || {}; var total = b.total || 0, handled = b.handled || 0;
    var rate = total > 0 ? Math.round(100 * handled / total) : null;
    cats[c] = { handled: handled, total: total, rate: rate, below_floor: total < floor };
    if (total < floor || rate === null) return;
    if (best === null || rate > cats[best].rate) best = c;
    if (worst === null || rate < cats[worst].rate) worst = c;
  });
  if (best !== null && best === worst) { best = null; worst = null; }   // one measured category: nothing to contrast
  return { sections: secs, strongest: strongest, weakest: weakest, categories: cats, bestCategory: best, worstCategory: worst, floor: floor };
}

function factsBlock(f) {
  if (!f) return '';
  var secLine = Object.keys(f.sections).map(function (s) { return s + ' ' + f.sections[s]; }).join(', ');
  var catLine = Object.keys(f.categories).map(function (c) { var x = f.categories[c]; return c + ' ' + x.handled + '/' + x.total + (x.rate === null ? '' : ' (' + x.rate + '%)') + (x.below_floor ? ' [too few to compare]' : ''); }).join(', ');
  return [
    'PAGE FACTS (the numbers this page already shows; every claim you make must agree with them — generalising about the team is fine, contradicting these is not):',
    '  sections (avg score): ' + (secLine || 'none measured') + (f.strongest ? ' — strongest section: ' + f.strongest + '; weakest section: ' + f.weakest : ''),
    '  objections handled/total by category: ' + (catLine || 'none') + (f.bestCategory ? ' — best-handled: ' + f.bestCategory + '; worst-handled: ' + f.worstCategory : ''),
  ].join('\n');
}

/** @returns a reason string when the claim's direction contradicts the facts, else null */
function claimContradictsFacts(item, direction, f) {
  var subj = item && item.subject; if (!subj || !f) return null;
  var kind = typeof subj.kind === 'string' ? subj.kind.toLowerCase() : null;
  if (kind === 'section' && subj.section) {
    var s = String(subj.section).toLowerCase();
    if (direction === 'working' && f.weakest && s === f.weakest) return 'a strength claimed on the weakest section (' + s + ' ' + f.sections[s] + ')';
    if (direction === 'improve' && f.strongest && s === f.strongest) return 'a gap claimed on the strongest section (' + s + ' ' + f.sections[s] + ')';
    return null;
  }
  if (kind === 'objection' && subj.category) {
    var c = String(subj.category).toLowerCase(); var x = f.categories[c];
    if (!x || x.below_floor) return null;
    if (direction === 'working' && f.worstCategory && c === f.worstCategory) return 'a strength claimed on the worst-handled category (' + c + ' ' + x.handled + '/' + x.total + ')';
    if (direction === 'improve' && f.bestCategory && c === f.bestCategory) return 'a gap claimed on the best-handled category (' + c + ' ' + x.handled + '/' + x.total + ')';
  }
  return null;
}

module.exports = { pageFacts: pageFacts, factsBlock: factsBlock, claimContradictsFacts: claimContradictsFacts };
