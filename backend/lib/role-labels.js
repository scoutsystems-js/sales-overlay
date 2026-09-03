'use strict';
/* ⚠⚠ ROLE LABELS — RULED (Justin, 2026-09-02, H673): user → Rep · manager → Manager ·
   owner → Admin. The STORED value stays `user`/`manager`/`owner`; only the word
   a customer reads changes. ONE map: every page mirrors this object verbatim (a
   browser cannot require), and test/role-labels-mirror.test.js executes each
   page's copy against this one — three string edits is how `user` reached the
   My Team table, the pivot pill and the coaching page as the machine word (⑥-1..3). */
var ROLE_LABELS = { user: 'Rep', manager: 'Manager', owner: 'Admin' };
function roleLabel(role) {
  var k = (typeof role === 'string') ? role.toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(ROLE_LABELS, k) ? ROLE_LABELS[k] : 'Rep';
}
module.exports = { ROLE_LABELS: ROLE_LABELS, roleLabel: roleLabel };
