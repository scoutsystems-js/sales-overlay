// Account page tests (Stage 5) — the pure parts: name validation shared by
// PATCH /me/account, and the account payload shape (billing seam surfaced
// read-only; managed lock state included for the UI).
const test = require('node:test');
const assert = require('node:assert');
const me = require('../routes/me');

test('validateNameField: 1-60 chars after trim, strings only', () => {
  const f = me._validateNameField;
  assert.strictEqual(f('Tasha'), 'Tasha');
  assert.strictEqual(f('  padded  '), 'padded');
  assert.strictEqual(f(''), null);
  assert.strictEqual(f('   '), null);
  assert.strictEqual(f('x'.repeat(61)), null);
  assert.strictEqual(f('x'.repeat(60)), 'x'.repeat(60));
  assert.strictEqual(f(42), null);
  assert.strictEqual(f(null), null);
});

test('buildAccountPayload: profile + email → UI shape; managed lock state; billing read-only block', () => {
  const prof = {
    first_name: 'Tasha', last_name: 'P', role: 'user', managed_by: 'mgr-uuid',
    billing_status: 'trial', billing_plan: null, billing_provider: null,
  };
  const p = me._buildAccountPayload(prof, 'tasha@example.com');
  assert.deepStrictEqual(p, {
    email: 'tasha@example.com',
    first_name: 'Tasha',
    last_name: 'P',
    role: 'user',
    // (j) the seller's own price — the price-drop lookup reads it from here.
    price_pif: null,
    is_managed: true,
    billing: { status: 'trial', plan: null, provider: null },
    // H730: the offer fields the head edits and the team inherits, and the one save sentence
    niche: null, offer: null, qualifications: null, script_raw: null, price_2pay: null,
    team_size: 0, offer_save_sentence: 'This changes how your calls are graded from the next call on.',
  });
  // unmanaged + populated billing seam
  const p2 = me._buildAccountPayload({ first_name: null, last_name: null, role: 'manager', managed_by: null, billing_status: 'active', billing_plan: 'single_user', billing_provider: 'stripe' }, 'm@x.co');
  assert.strictEqual(p2.is_managed, false);
  assert.deepStrictEqual(p2.billing, { status: 'active', plan: 'single_user', provider: 'stripe' });
  // defaults: absent billing_status reads as trial (019 default), names null-safe
  const p3 = me._buildAccountPayload({}, 'e@x.co');
  assert.strictEqual(p3.billing.status, 'trial');
  assert.strictEqual(p3.first_name, null);
});
