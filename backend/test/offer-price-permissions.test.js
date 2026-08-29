/**
 * THE OFFER PRICE IS SET BY MANAGERS AND ABOVE (Justin, 2026-08-26).
 *
 * ⚠⚠ IT IS A PERMISSIONS CHANGE, NOT A DATA CHANGE. `user_profiles.price_pif`
 * STAYS ON THE INDIVIDUAL — a manager may set a DIFFERENT price per rep — so
 * there is no migration, no moved column, and no fallback in the worker. Only
 * WHO MAY WRITE IT changes.
 *
 * ⚠ HALF THE RULING ALREADY HELD, which is worth recording so nobody "fixes"
 * it again: PATCH /me/account 403s any user whose managed_by is set, so a
 * managed rep already could not set their own price, and a SINGLE USER already
 * could set theirs. The missing half was a manager setting a REP's.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { applyPriceFields, MAX_PRICE } = require('../lib/price-fields');

function code(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ── the shared validator ──────────────────────────────────────────────── */

test('a whole-dollar price is accepted', () => {
  assert.deepStrictEqual(applyPriceFields({ price_pif: 9800 }, {}), { price_pif: 9800 });
  assert.deepStrictEqual(applyPriceFields({ price_pif: '9800' }, {}), { price_pif: 9800 });
});

test("'' and null both CLEAR — a manager removing a price is a real action", () => {
  /* ⚠ And it must be distinguishable from "not supplied", which leaves the
     value alone. Collapsing those two is how a clear silently does nothing. */
  assert.deepStrictEqual(applyPriceFields({ price_pif: '' }, {}), { price_pif: null });
  assert.deepStrictEqual(applyPriceFields({ price_pif: null }, {}), { price_pif: null });
  assert.deepStrictEqual(applyPriceFields({}, {}), {}, 'absent must not write anything');
});

test('junk is refused with a 400-shaped error', () => {
  [0, -5, 1.5, 'abc', MAX_PRICE + 1, NaN, Infinity].forEach(v => {
    assert.throws(() => applyPriceFields({ price_pif: v }, {}),
      e => e.status === 400, 'must reject ' + String(v));
  });
});

test('⚠ ONE validator, TWO callers — the rules cannot drift', () => {
  /* The value drives lib/price-moment, so two sets of numeric rules would show
     up as a metric that works for some reps and not others. */
  ['routes/me.js', 'routes/admin.js'].forEach(f => {
    const src = code(f);
    assert.ok(/applyPriceFields/.test(src), f + ' must use the shared validator');
    assert.ok(!/must be a whole number of dollars/.test(src),
      f + ' still carries its own copy of the price rules');
  });
});

/* ── the permission boundary ───────────────────────────────────────────── */

test('the manager route is role-gated and uses the SAME scope predicate', () => {
  const a = code('routes/admin.js');
  const at = a.indexOf("router.patch('/users/:user_id/price'");
  assert.ok(at > 0, 'the manager price route is missing');
  const head = a.slice(at, at + 160);
  assert.ok(/requireRole\(\['manager', 'owner'\]\)/.test(head), 'manager+owner only');
  const body = a.slice(at, a.indexOf('\n});', at));
  assert.ok(body.length > 500, 'slice must cover the route: ' + body.length);
  assert.ok(/t\.data\.managed_by !== req\.user\.id/.test(body),
    'a non-owner may only act on their own reps');
  assert.ok(/req\.user\.role !== 'owner'/.test(body), 'an owner passes platform-wide');
  assert.ok(/t\.data\.user_id !== req\.user\.id/.test(body),
    'acting on yourself must be allowed — a manager has a price too');
});

test('⚠ the SELF route stays structurally incapable of naming another user', () => {
  const m = code('routes/me.js');
  const at = m.indexOf("router.patch('/account'");
  const body = m.slice(at, m.indexOf('\n});', at));
  assert.ok(body.length > 400, 'slice too short: ' + body.length);
  assert.ok(/\.eq\('user_id', req\.user\.id\)/.test(body), 'it may only write the caller');
  /* the managed lock is what already stopped a rep setting their own */
  assert.ok(/lock\.data\.managed_by/.test(body), 'the managed lock must remain');
});

/* ── the value has to reach the page ───────────────────────────────────── */

test('⚠ price_pif is re-picked explicitly by /admin/users, not just selected upstream', () => {
  /* fetchUsersWithProfiles selecting the column is NOT enough — that route
     builds its own object field by field, so a missing line there means the
     cell renders empty for everyone and the feature looks broken. */
  const a = code('routes/admin.js');
  assert.ok(/price_pif'\);/.test(a) || /, price_pif'/.test(a), 'the column must be selected');
  const at = a.indexOf("router.get('/users'");
  const body = a.slice(at, a.indexOf('\n});', at));
  assert.ok(/price_pif: \(u\.price_pif/.test(body),
    '/admin/users must re-pick price_pif onto its response object');
});

test('the members table shows and edits it, and names the consequence of a blank', () => {
  const html = code('web/dashboard.html');
  assert.ok(/<th>Offer price<\/th>/.test(html), 'the column header is missing');
  assert.ok(/priceCellHtml\(m\)/.test(html), 'the cell must be rendered per member');
  assert.ok(/setMemberPrice\(/.test(html), 'and be editable');
  /* ⚠ An empty price is not a cosmetic gap — it is the reason that rep is
     UNMEASURED, and unmeasured and flat look identical on a graph. */
  assert.ok(/no time-to-price measurement at all/.test(html),
    'the page must say what a missing price costs');
});

test('it calls a helper that exists — showToast does not', () => {
  /* Caught before shipping: the first draft called showToast(), which is not
     defined anywhere on this page. The members surface uses alert(). */
  const html = code('web/dashboard.html');
  assert.strictEqual((html.match(/showToast\(/g) || []).length, 0,
    'showToast is not defined on this page');
});
