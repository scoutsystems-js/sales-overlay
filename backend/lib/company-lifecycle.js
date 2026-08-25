// lib/company-lifecycle.js — deactivate, reactivate and delete a whole company.
//
// ⚠⚠ JUSTIN'S RULING (2026-08-24): DEACTIVATE keeps the data, DELETE destroys it.
//
// ⚠⚠ DELETE DELIBERATELY DIFFERS FROM SINGLE-USER DELETE, WHICH KEEPS THE CALLS.
// Both are correct at their own scale, and the next person to read the two paths
// will otherwise think one is a bug:
//   • ONE REP LEAVING must not rewrite their team's history. Their calls stay,
//     the person is tombstoned, and last quarter's numbers still add up. That is
//     lib/user-management.js.
//   • A CHURNED CLIENT should not sit in the numbers at all. Their whole company
//     goes, calls included, because there is no longer a team whose history it
//     would be rewriting.
// The distinction is WHOSE HISTORY IS BEING PROTECTED. For a rep it is the
// team's; for a company there is no surviving team.
//
// Pure and total. No I/O, never throws.

'use strict';

/* ⚠⚠ WHAT A COMPANY DELETE DOES **NOT** REACH, AND WHY IT MUST NOT.
   `knowledge_base` has NO foreign key to auth.users, so its rows survive a
   cascade and have to be removed explicitly — except GLOBAL ones.

   A `scope='global'` row is platform-wide content: every other company can see
   and search it. Measured 2026-08-24, one account owns 583 global rows. Deleting
   them because their uploader's company churned would strip knowledge out of
   every OTHER customer's product — a figure moving outside the company being
   deleted, which is exactly what the ruling says to stop and report rather than
   ship. So global rows are kept, deliberately, and reported. */
var KB_SCOPES_TO_DELETE = ['personal', 'team'];

/**
 * Which of a company's members a DEACTIVATE should switch off.
 *
 * ⚠ Only those currently ACTIVE. A user already deactivated by hand is left
 * exactly as they are and, crucially, is NOT flagged — so the later reactivate
 * cannot bring them back. See migration 045.
 */
function membersToDeactivate(members) {
  return (Array.isArray(members) ? members : [])
    .filter(function (m) { return m && m.active !== false; })
    .map(function (m) { return m.user_id; });
}

/**
 * Which members a REACTIVATE should switch back on: exactly those the company
 * action switched off, identified by the flag rather than by "is inactive".
 *
 * ⚠ "Everyone who is inactive" would be the obvious rule and is WRONG — it
 * resurrects the person who was deactivated on purpose beforehand, and nothing
 * afterwards could tell you it had happened.
 */
function membersToReactivate(members) {
  return (Array.isArray(members) ? members : [])
    .filter(function (m) { return m && m.deactivated_with_company === true; })
    .map(function (m) { return m.user_id; });
}

/**
 * Does this company READ as deactivated?
 * Derived rather than stored: a company is deactivated when it has members and
 * every one of them is inactive. No second source of truth to fall out of step.
 */
function isCompanyDeactivated(company) {
  var all = allMemberRows(company);
  if (!all.length) return false;
  return all.every(function (m) { return m.active === false; });
}

/** head + members, in one list. The head IS part of the company. */
function allMemberRows(company) {
  var c = company || {};
  var out = [];
  if (c.head) out.push(c.head);
  (c.members || []).forEach(function (m) { if (m) out.push(m); });
  return out;
}

function allMemberIds(company) {
  return allMemberRows(company).map(function (m) { return m.user_id; }).filter(Boolean);
}

/**
 * The confirmation text. ⚠ It must NAME THE COST — the company, how many
 * people, how many calls — and say plainly that this cannot be undone. A
 * destructive action described in the abstract ("are you sure?") tells the
 * reader nothing they can weigh.
 */
function deleteConfirmation(name, userCount, callCount) {
  var u = userCount === 1 ? '1 person' : userCount + ' people';
  var c = callCount === 1 ? '1 call' : callCount + ' calls';
  return 'Delete "' + name + '"?\n\n'
    + 'This permanently deletes ' + u + ' and ' + c + ', along with every grade, '
    + 'highlight, objection, prospect and EOD entry belonging to them.\n\n'
    + 'This CANNOT be undone. There is no recovery.';
}

module.exports = {
  KB_SCOPES_TO_DELETE: KB_SCOPES_TO_DELETE,
  membersToDeactivate: membersToDeactivate,
  membersToReactivate: membersToReactivate,
  isCompanyDeactivated: isCompanyDeactivated,
  allMemberRows: allMemberRows,
  allMemberIds: allMemberIds,
  deleteConfirmation: deleteConfirmation,
};
