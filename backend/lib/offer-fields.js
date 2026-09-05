/**
 * THE OFFER FIELDS — niche, offer, qualifications, script (H730, Justin's ruling 2026-09-05).
 *
 * WHO MAY WRITE THEM: managers and above, and single users. A MANAGED REP CANNOT.
 * THE REASON, at the code: the head's row feeds every rep's grading (the selling context inherits
 * from the team head, field by field — H728). A rep editing these would change how their OWN calls
 * are graded, which is the one thing a graded person must never control. A single user is their own
 * head, so they edit their own — the same rule, not an exception. The gate is the managed lock
 * (`user_profiles.managed_by IS NOT NULL` → refused), enforced SERVER-SIDE on both doors (the account
 * route and the admin route), never by hiding the fields.
 *
 * Grading changes on NEW calls only; nothing re-grades. A save invalidates every cached synthesis by
 * construction (the selling-context hash folds these fields).
 */
'use strict';

var OFFER_FIELDS = [
  { key: 'niche',          max: 200 },
  { key: 'offer',          max: 4000 },
  { key: 'qualifications', max: 1000 },
  { key: 'script_raw',     max: 20000 },
];

/** Copy the offer fields present in `body` onto `updates`, validated; '' → null. Returns updates. */
function applyOfferFields(body, updates) {
  var b = body || {}; var out = updates || {};
  OFFER_FIELDS.forEach(function (f) {
    if (b[f.key] === undefined) return;
    var v = b[f.key];
    if (v === null || (typeof v === 'string' && v.trim() === '')) { out[f.key] = null; return; }
    if (typeof v !== 'string') { var e = new Error(f.key + ' must be text'); e.status = 400; throw e; }
    if (v.length > f.max) { var e2 = new Error(f.key + ' must be at most ' + f.max + ' characters'); e2.status = 400; throw e2; }
    out[f.key] = v.trim();
  });
  return out;
}

/** The one sentence the save shows, where the manager is. */
function saveSentence(teamSize) {
  return teamSize > 0 ? 'This changes how your team’s calls are graded from the next call on.' : 'This changes how your calls are graded from the next call on.';
}

module.exports = { OFFER_FIELDS: OFFER_FIELDS, applyOfferFields: applyOfferFields, saveSentence: saveSentence };
