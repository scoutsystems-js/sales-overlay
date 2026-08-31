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

/* ⚠⚠ TWO SOURCES, NOT ONE — THE NATHAN INCIDENT (2026-08-31).
   Auto-resolution consulted only /team_members. That endpoint returned TEN
   members and did not list him, so it correctly answered no_match and fell
   through to the picker — where the suggestions were ordered by who had
   recorded most of the last ten WORKSPACE meetings. Dre had recorded 7 of 10,
   so Dre was offered first and Nathan's own address third. The wrong one was
   chosen and 41 of Dre's calls were ingested into his account.

   ⚠ HIS OWN ADDRESS WAS AVAILABLE THE WHOLE TIME, in the `recorded_by` values
   on /meetings. The resolver was reading one source when two existed. Merging
   them costs one request we already make elsewhere and removes the question.

   ⚠ This does NOT relax the matching rule. resolveFathomIdentity still demands
   EXACT equality and still refuses on ambiguity — a wrong match syncs a
   different person's calls, which is precisely the damage being prevented.
   What widens is the CANDIDATE LIST, never the comparison. */
function identityCandidates(teamMembers, meetings) {
  var seen = {};
  var out = [];
  function add(email) {
    if (typeof email !== 'string') return;
    var k = normEmail(email);
    if (!k || seen[k]) return;
    seen[k] = true;
    // ⚠ keep the STORED form: recorded_by[] is an exact-match filter on
    // Fathom's side, so we must send back what they gave us.
    out.push({ email: email });
  }
  (Array.isArray(teamMembers) ? teamMembers : []).forEach(function (m) {
    if (m) add(m.email);
  });
  (Array.isArray(meetings) ? meetings : []).forEach(function (m) {
    if (m && m.recorded_by) add(m.recorded_by.email);
  });
  return out;
}

/* ⚠⚠⚠ READ EVERY PAGE. THE ROOT CAUSE OF THE NATHAN INCIDENT.
   /team_members is PAGINATED — it returns `items`, `next_cursor` and `limit`,
   ten at a time. This workspace has THIRTY-TWO members across FOUR pages and
   Nathan is #11, on page two. The resolver read page one, did not find him,
   and correctly answered no_match from an incomplete input.

   ⚠ IT WAS FIRST DIAGNOSED AS "he is not a listed team member". That was wrong:
   a PAGINATION LIMIT PRESENTING AS AN ABSENCE. Same family as a display cap
   that reads as missing data, or a default row limit that reports a rate as
   stopping days early.

   ⚠ Bounded at MAX_PAGES so a cursor that never terminates cannot hang a
   connect. A failed page returns what was already collected rather than
   throwing — an incomplete list degrades to the picker, which is the existing
   fallback, while an exception would break a successful connection. */
const MAX_IDENTITY_PAGES = 20;

async function fetchAllPages(url, headers, fetchImpl) {
  var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return [];
  var out = [];
  var cursor = null;
  for (var i = 0; i < MAX_IDENTITY_PAGES; i++) {
    var u = url + (cursor ? ((url.indexOf('?') === -1 ? '?' : '&') + 'cursor=' + encodeURIComponent(cursor)) : '');
    var res;
    try {
      res = await f(u, { headers: headers, });
    } catch (e) { return out; }
    if (!res || !res.ok) return out;
    var body;
    try { body = await res.json(); } catch (e) { return out; }
    var items = (body && (body.items || body.data)) || [];
    if (!Array.isArray(items) || !items.length) return out;
    out = out.concat(items);
    cursor = (body && body.next_cursor) || null;
    if (!cursor) return out;
  }
  return out;
}

module.exports = {
  normEmail: normEmail,
  resolveFathomIdentity: resolveFathomIdentity,
  identityCandidates: identityCandidates,
  fetchAllPages: fetchAllPages,
  MAX_IDENTITY_PAGES: MAX_IDENTITY_PAGES,
};
