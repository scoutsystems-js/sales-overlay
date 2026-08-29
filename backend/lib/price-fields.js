'use strict';
/**
 * The offer-price fields, validated in ONE place.
 *
 * ⚠⚠ TWO ROUTES WRITE THESE AND THEY MUST NOT DRIFT. A single user sets their
 * own via PATCH /me/account; a manager sets a REP's via the admin route. Two
 * copies of the same numeric rules is how one path comes to accept a value the
 * other rejects — and the value drives lib/price-moment, so a difference would
 * show up as a metric that works for some reps and not others.
 *
 * ⚠ price_2pay IS ACCEPTED BUT NEVER DRIVES THE METRIC. It is a decoy
 * generator: Josh's is 400 and his calls are full of "a couple hundred bucks",
 * "$300 to $500 a month", "about $400 max". lib/price-moment reads price_pif
 * ONLY. Keeping it writable is for profile completeness, nothing else.
 */

var PRICE_FIELDS = ['price_pif', 'price_2pay'];
var MAX_PRICE = 10000000;

/**
 * Copy any supplied price fields from `body` onto `updates`, validated.
 * Throws a 400-shaped error on a bad value. Returns `updates`.
 *
 * '' and null both clear the field — a manager removing a price is a real
 * action, not an error, and must not be confused with "not supplied".
 */
function applyPriceFields(body, updates) {
  var b = body || {};
  var out = updates || {};
  PRICE_FIELDS.forEach(function (k) {
    if (b[k] === undefined) return;                 // not supplied — leave alone
    if (b[k] === null || b[k] === '') { out[k] = null; return; }   // explicit clear
    var n = Number(b[k]);
    if (!isFinite(n) || n <= 0 || n > MAX_PRICE || Math.round(n) !== n) {
      throw Object.assign(new Error(k + ' must be a whole number of dollars'), { status: 400 });
    }
    out[k] = n;
  });
  return out;
}

module.exports = {
  applyPriceFields: applyPriceFields,
  PRICE_FIELDS: PRICE_FIELDS,
  MAX_PRICE: MAX_PRICE,
};
