'use strict';
/**
 * ⚠⚠ ONE NAME MAP, BECAUSE A SECOND ONE IS INVISIBLE WHEN IT DISAGREES.
 *
 * `nameMapFor` lived inside routes/team.js. The cron warm-up needs the SAME map:
 * the rep names it produces go into the synthesis PROSE, and that prose is then
 * cached and served to the manager. A warm-up built with a different map writes
 * a cache entry the page will happily serve with the wrong names in it — no
 * error, no mismatch, nothing to notice.
 *
 * ⚠ THE PART THAT WOULD HAVE DIVERGED: `disambiguateNames`. Two people sharing a
 * first name get a surname initial ("Josh P"), and the daily digest's own name
 * map does NOT apply it. Reusing the digest's map for the warm-up would have
 * cached "Josh" where the page says "Josh P", on the one board that has two
 * Joshes. That is the kind of difference nobody reports and nobody can explain.
 *
 * So the rule lives here and both callers consume it — the same shape as
 * lib/team-membership.js, and for the same reason.
 */
const { resolveDisplayName, disambiguateNames } = require('./display-name');

/**
 * @param {object} admin  service-role supabase client
 * @param {string[]} memberIds
 * @param {object} em      {user_id: email}
 * @returns {Promise<object>} {user_id: display name}
 */
async function nameMapFor(admin, memberIds, em) {
  var profOf = {};
  if (memberIds.length > 0) {
    var pr = await admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', memberIds);
    if (!pr.error) (pr.data || []).forEach(function (x) { profOf[x.user_id] = x; });
  }
  var nameMap = {};
  memberIds.forEach(function (id) { nameMap[id] = resolveDisplayName(profOf[id], (em && em[id]) || null, id); });
  /* ⚠ TWO PEOPLE SHARING A FIRST NAME GET A SURNAME INITIAL — "Josh P" (Justin,
     2026-08-29; live: Josh Pinner and Josh Niebloom). Applied HERE so every lane
     fed by this map is consistent, rather than each surface disambiguating on
     its own and disagreeing. Only colliding names change. */
  return disambiguateNames(nameMap);
}

module.exports = { nameMapFor: nameMapFor };
