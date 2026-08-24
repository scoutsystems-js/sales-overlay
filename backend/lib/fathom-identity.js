// lib/fathom-identity.js — capture the Fathom identity AUTOMATICALLY where we can.
//
// ⚠⚠ JUSTIN CHALLENGED THE PROMPT: "He logs in to Fathom when he connects it.
// That's going to be the Fathom email. I'm not sure why we would need more."
// Probed live against Josh's own token on 2026-08-24, and the facts are:
//
//   /me, /users/me, /user, /account, /whoami, /oauth/userinfo  ->  404
//   /users                                                      ->  403
//   /team_members  -> 200, {name, email, created_at} x 10, and NO field marks
//                     which member authorised (no is_me / current / self)
//   /meetings unfiltered -> 5 DISTINCT recorded_by identities in ONE page
//
// So the token is WORKSPACE-SCOPED and Fathom's OAuth is `scope=public_api`,
// not OIDC — there is no id_token and no userinfo. Fathom genuinely does not
// tell us who authorised. Without `recorded_by[]` a sync pulls the whole
// workspace, so the identity is REQUIRED and cannot simply be dropped.
//
// ⚠ BUT THE PROMPT DOES NOT HAVE TO BE THE FIRST RESORT. When the Scout login
// email is EXACTLY one of the workspace members, that is the answer and asking
// is pure friction. That covers exactly the case Justin describes.
//
// Pure and total. No I/O, never throws.

'use strict';

/* Normalise for comparison ONLY — case and surrounding whitespace. Nothing
   else. No plus-address stripping, no dot-folding, no domain aliasing: those
   are guesses, and this file exists to avoid guessing. */
function normEmail(v) {
  return (typeof v === 'string') ? v.trim().toLowerCase() : '';
}

/**
 * Decide the Fathom identity without asking.
 *
 * ⚠⚠ EXACT EQUALITY, NEVER RESEMBLANCE. This is the same contract as
 * lib/zoom-identity.js, and for the same reason: a fuzzy match on names
 * recorded the CLOSER as the prospect on 6 of 83 Fathom calls. Here the cost
 * of a wrong match is worse than wrong data — it would sync a DIFFERENT
 * PERSON'S calls into this user's account, silently and permanently.
 *
 * ⚠ REFUSES on 0 matches and on >1. A workspace cannot normally contain two
 * identical emails, but refusing rather than taking [0] means the ambiguous
 * case can never be resolved by accident.
 *
 * scoutEmail   : the email on the Scout account doing the connecting
 * members      : [{ email, name }] from GET /team_members
 * returns { email, source } on a confident match, or { email: null, reason }
 */
function resolveFathomIdentity(scoutEmail, members) {
  var want = normEmail(scoutEmail);
  if (!want) return { email: null, reason: 'no_scout_email' };

  var list = Array.isArray(members) ? members : [];
  if (!list.length) return { email: null, reason: 'no_team_members' };

  var hits = list.filter(function (m) { return m && normEmail(m.email) === want; });

  if (hits.length === 1) {
    // ⚠ Return the STORED form, not the normalised one — `recorded_by[]` is an
    // exact-match filter on Fathom's side and we must send back what they gave
    // us, not a lowercased approximation of it.
    return { email: hits[0].email, source: 'scout_email_match' };
  }
  if (hits.length > 1) return { email: null, reason: 'ambiguous' };
  return { email: null, reason: 'no_match' };
}

module.exports = { normEmail: normEmail, resolveFathomIdentity: resolveFathomIdentity };
