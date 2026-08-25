// lib/company.js — THE one definition of "a company" and of what it is called.
//
// ⚠⚠ THE RULING (Justin, 2026-08-24): A COMPANY IS A RENAMED TEAM, admin view
// only. No new tier, no schema change beyond storage for the name. So there is
// no company entity here — only a grouping over users that already exist, plus
// the name stored on the head's `user_profiles.team_name`.
//
// ⚠⚠ WHY THIS FILE EXISTS AT ALL: the name has to render in TWO places (the
// admin company block and the Team view header) and the label is already
// generated in THREE (`resolveTeam`, `/team/context`'s picker, and now admin).
// Two copies is how they diverge — and this codebase has the receipts: two
// `rankSections` meaning opposite directions, four duplicated scope predicates,
// a per-endpoint copy of the manager-counts-as-a-member rule that eight
// endpoints did not have. One name, one place.
//
// Pure and total. No I/O, never throws.

'use strict';

/* ⚠ THE FALLBACK, and it is a ruling not a placeholder. An unnamed company must
   NOT render blank, "undefined", or an email dressed up as a company name.
   Today `resolveTeam` produces "josh@scoutsystems.io's team" — an email wearing
   a company's clothes — which is exactly what this replaces.
   ⚠ It is deliberately NOT derived from the head's name or email: a derived
   label reads as a real name and nobody questions it, so nobody ever sets the
   real one. "Unnamed company" is visibly a gap, which is the point. Same
   governing principle as prospect names: a WRONG name is worse than NO name. */
var COMPANY_NAME_FALLBACK = 'Unnamed company';

/* Long enough for a real company name, short enough that it cannot be used to
   smuggle a paragraph into a header. */
var MAX_COMPANY_NAME = 80;

/**
 * Normalise a name on the way IN (writes).
 * Returns a trimmed string, or null meaning "unset" — so clearing the field is
 * expressible and lands back on the fallback rather than storing ''.
 * ⚠ Returns undefined for input that is not a string at all, which the route
 * treats as a 400: that distinguishes "clear it" (null) from "you sent junk".
 */
function sanitizeCompanyName(v) {
  if (v === null) return null;                     // explicit clear
  if (typeof v !== 'string') return undefined;     // not a valid payload
  var t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;                             // '' and '   ' both mean unset
  if (t.length > MAX_COMPANY_NAME) t = t.slice(0, MAX_COMPANY_NAME).trim();
  return t;
}

/**
 * What to SHOW for a company (reads). One function, so the admin block and the
 * Team view header can never disagree about what an unnamed company is called.
 */
function companyDisplayName(teamName) {
  var t = (typeof teamName === 'string') ? teamName.trim() : '';
  return t || COMPANY_NAME_FALLBACK;
}

/** True when the name shown is the fallback rather than something a human set. */
function isUnnamedCompany(teamName) {
  return companyDisplayName(teamName) === COMPANY_NAME_FALLBACK;
}

/* ⚠⚠ ROLE ORDER, WITH GAPS ON PURPOSE. §2: members are ordered top-down by
   ROLE, not alphabetically. The gaps exist so a future tier can slot in
   (between owner and manager, or between manager and user) WITHOUT renumbering
   every value and without this file naming a role that does not exist yet.
   ⚠ Do not compact these to 0/1/2. The spacing IS the forward compatibility. */
var ROLE_RANK = { owner: 10, manager: 30, user: 50 };
var UNKNOWN_ROLE_RANK = 90;   // an unrecognised role sorts last, never crashes

function roleRank(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? ROLE_RANK[role] : UNKNOWN_ROLE_RANK;
}

/* Deterministic tiebreak WITHIN a role. Role is the sort; this only decides
   two users of the same role, so the order is stable across renders rather
   than following whatever order the query returned. */
function tiebreak(a, b) {
  var ae = String(a.email || a.user_id || '');
  var be = String(b.email || b.user_id || '');
  return ae < be ? -1 : (ae > be ? 1 : 0);
}

function byRoleThenEmail(a, b) {
  var d = roleRank(a.role) - roleRank(b.role);
  return d !== 0 ? d : tiebreak(a, b);
}

/**
 * Partition a flat user list into COMPANIES and SINGLE USERS.
 *
 * ⚠⚠ THE DEFINITION, stated so it is not re-derived: a COMPANY is a user who
 * has at least one rep OR has been explicitly NAMED, plus their reps. A SINGLE
 * USER has neither, and no manager — they belong to no company.
 *
 * ⚠ IT IS NEVER KEYED ON ROLE, and that is load-bearing: live data has a user
 * whose role is `manager` with ZERO reps and no name. By role they look like a
 * company; they are a single user. This matches the standing rule that "has
 * assigned reps (not role)" grants the manager experience.
 *
 * ⚠ The "or named" half exists so a company can be CREATED — see isHead().
 *
 * ⚠⚠ EXACTLY-ONE IS GUARANTEED BY CONSTRUCTION, including the case the schema
 * allows and the data does not yet contain: a user with BOTH reps and a
 * manager. `reps > 0` is checked FIRST, so such a user heads their own company
 * and does not also appear as a member — one bucket, never two. (That shape is
 * the future second-tier case; heading their own company is the forward-
 * compatible reading. Asserted in test/company.test.js.)
 *
 * users: [{ user_id, email, role, managed_by, team_name, ... }]
 * returns { companies: [{ key, name, is_unnamed, head, members, user_count }], singles: [] }
 */
function bucketUsers(users) {
  var arr = Array.isArray(users) ? users : [];

  // reps per user
  var repsOf = {};
  arr.forEach(function (u) {
    if (u && u.managed_by) repsOf[u.managed_by] = (repsOf[u.managed_by] || 0) + 1;
  });

  var byId = {};
  arr.forEach(function (u) { if (u && u.user_id) byId[u.user_id] = u; });

  var companies = {};   // keyed by head user_id
  var singles = [];

  function company(key) {
    if (!companies[key]) {
      var head = byId[key] || null;
      companies[key] = {
        key: key,
        // ⚠ The name comes off the HEAD's row. A dangling head (managed_by
        // pointing at a user not in this set) yields null → the fallback,
        // rather than dropping the members on the floor.
        name: companyDisplayName(head && head.team_name),
        is_unnamed: isUnnamedCompany(head && head.team_name),
        head: head,
        members: [],
      };
    }
    return companies[key];
  }

  /* ⚠⚠ A COMPANY EXISTS IF IT HAS MEMBERS **OR** HAS BEEN EXPLICITLY NAMED.
     The "has reps" half is unchanged. The "named" half was added 2026-08-24 so
     a company can be CREATED — otherwise "Add company" is impossible by
     definition: a brand-new company has no members yet, so a reps-only rule
     would file its head under Single Users and the new company would vanish
     the instant it was made.
     ⚠ This does NOT reclassify anyone: naming is an explicit owner action, and
     the only pre-existing named row already had reps. A `manager` with zero
     reps and no name (a real production row) is still correctly a single user.
     ⚠ An EMPTY named company is a legitimate state — you create it, then move
     people into it. */
  function isHead(u) {
    return repsOf[u.user_id] > 0 || !!(typeof u.team_name === 'string' && u.team_name.trim());
  }

  arr.forEach(function (u) {
    if (!u || !u.user_id) return;
    if (isHead(u)) { company(u.user_id); return; }               // heads first — see above
    if (u.managed_by) { company(u.managed_by).members.push(u); return; }
    singles.push(u);
  });

  var list = Object.keys(companies).map(function (k) {
    var c = companies[k];
    c.members.sort(byRoleThenEmail);
    c.user_count = c.members.length + (c.head ? 1 : 0);
    return c;
  });

  /* Companies sort by NAME, with unnamed ones last — an unnamed company is a
     prompt to act, and burying it mid-list hides that. Within each group the
     comparison is case-insensitive so "acme" and "Acme" do not straddle. */
  list.sort(function (a, b) {
    if (a.is_unnamed !== b.is_unnamed) return a.is_unnamed ? 1 : -1;
    var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return String(a.key) < String(b.key) ? -1 : 1;
  });

  singles.sort(byRoleThenEmail);
  return { companies: list, singles: singles };
}

module.exports = {
  COMPANY_NAME_FALLBACK: COMPANY_NAME_FALLBACK,
  MAX_COMPANY_NAME: MAX_COMPANY_NAME,
  ROLE_RANK: ROLE_RANK,
  sanitizeCompanyName: sanitizeCompanyName,
  companyDisplayName: companyDisplayName,
  isUnnamedCompany: isUnnamedCompany,
  roleRank: roleRank,
  bucketUsers: bucketUsers,
};
