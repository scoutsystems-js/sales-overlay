'use strict';
/* ⚠ ONE {user_id: email} MAP, READ AT MOST ONCE PER TTL PER PROCESS.
   `auth.admin.listUsers` is a full auth-table round trip (~1s on production)
   and it ran on EVERY team request — /overview, /objections, /objections/summary,
   /recommendations… each rebuilt the same map. The map changes only when a
   user is provisioned, so a short TTL is the whole trade: a new user's email
   can lag as a NAME FALLBACK for at most TTL_MS; every manager stops paying a
   second on every page. It is not a cache keyed on data (H372) — it is a
   time window, stated here. Errors are thrown and never cached. */
var TTL_MS = 60 * 1000;
var _entry = null;   // { at, map }

async function emailMapFor(admin, opts) {
  var now = (opts && typeof opts.now === 'number') ? opts.now : Date.now();
  if (_entry && (now - _entry.at) < TTL_MS && (now - _entry.at) >= 0) return _entry.map;
  var list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (list.error) throw new Error('listUsers: ' + list.error.message);
  var m = {};
  ((list.data && list.data.users) || []).forEach(function (u) { if (u && u.id) m[u.id] = u.email || null; });
  _entry = { at: now, map: m };
  return m;
}

function _reset() { _entry = null; }

module.exports = { emailMapFor: emailMapFor, TTL_MS: TTL_MS, _reset: _reset };
