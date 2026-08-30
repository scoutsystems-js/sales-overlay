/**
 * THE SIX DISCOVERY ITEMS — Justin's checklist, captured verbatim from the call.
 *
 *   PAIN · GOALS · CURRENT_SITUATION · DECISION_MAKERS · WHY_NOW · FINANCIAL_RESOURCES
 *
 * ⚠⚠ THESE ARE FIXED AREAS ADDED TO THE EXISTING `coverage` BLOCK — NOT a seventh
 * field. `coverage` already carries every requirement this needed, word for word:
 * per area, established BY ANY conversational route, evidence copied verbatim as a
 * contiguous run from ONE transcript line, NULL rather than a guess, verified at
 * write time, and explicitly barred from influencing any score. Building a parallel
 * field would have been two things answering one question — the defect this codebase
 * has paid for repeatedly.
 *
 * ⚠⚠ WHY IT WAS NEEDED AT ALL, given the contract existed: `coverage`'s areas are
 * DERIVED PER REP, and exactly ONE rep of eight has any — 537 of 537 calls on one
 * account, ZERO on all seven others. The contract was right; the population was
 * wrong. Fixed areas take it from one user to all of them.
 *
 * ⚠ AND IT CLOSES A HAZARD ALREADY ON FILE, independently of the checklist: derived
 * area keys are NON-DETERMINISTIC and drift between derivations, orphaning anything
 * joined to them. A fixed key cannot drift.
 *
 * ⚠ ADDED TO the derived areas, never instead of them — `what_mattered` RANKS the
 * derived areas, so dropping them would break a working feature.
 */

var DISCOVERY_AREAS = [
  {
    key: 'pain',
    label: 'PAIN — what is wrong with their situation now, in their own words. '
      + '⚠ SOME OFFERS ARE BOUGHT ON LOGIC AND HAVE NO PAIN AT ALL. Where the offer is '
      + 'bought on logic rather than on relief from a problem, absent pain is simply '
      + 'covered:false — it is NOT a failure and nothing reads it as one.',
  },
  { key: 'goals',
    label: 'GOALS — what they said they want to reach. Their words, not a restatement.' },
  { key: 'current_situation',
    label: 'CURRENT SITUATION — where they are now; the facts their goal is measured against.' },
  { key: 'decision_makers',
    label: 'DECISION MAKERS — confirmed present, or confirmed as the sole decider.' },
  { key: 'why_now',
    label: 'WHY NOW — why this matters at this moment rather than later.' },
  { key: 'financial_resources',
    label: 'FINANCIAL RESOURCES — whether they can actually fund it.' },
];

var DISCOVERY_KEYS = DISCOVERY_AREAS.map(function (a) { return a.key; });

/**
 * The area list the grader is given: the six FIXED items first, then whatever the
 * rep's own material derived, with any duplicate key dropped.
 *
 * ⚠ The six lead deliberately — a derived area that collides with a fixed key loses,
 * so the stable key wins and nothing joined to it can be orphaned by a re-derivation.
 */
function withDiscoveryAreas(derived) {
  var out = DISCOVERY_AREAS.slice();
  var seen = {};
  DISCOVERY_KEYS.forEach(function (k) { seen[k] = true; });
  (Array.isArray(derived) ? derived : []).forEach(function (a) {
    if (!a || !a.key || seen[a.key]) return;
    seen[a.key] = true;
    out.push(a);
  });
  return out;
}

/** Is this one of the six? Used to read the checklist back out of a coverage map. */
function isDiscoveryArea(key) { return DISCOVERY_KEYS.indexOf(key) !== -1; }

module.exports = {
  DISCOVERY_AREAS: DISCOVERY_AREAS,
  DISCOVERY_KEYS: DISCOVERY_KEYS,
  withDiscoveryAreas: withDiscoveryAreas,
  isDiscoveryArea: isDiscoveryArea,
};
