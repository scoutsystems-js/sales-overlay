'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  RATE_CODES,
  normalizeCompanyBillingDraft,
  stripePriceIdFor,
  buildCompanyCheckoutParams,
  isStripeManagedCompanyBilling,
} = require('../lib/company-billing');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260925150000_company_billing.sql'), 'utf8');

test('company billing is server-only and follows the existing company-head identity', () => {
  assert.match(MIGRATION, /create table if not exists public\.company_billing/i);
  assert.match(MIGRATION, /company_head_id uuid primary key references public\.user_profiles\(user_id\)/i,
    'a company already has a durable identity: its team head');
  assert.match(MIGRATION, /enable row level security/i);
  assert.match(MIGRATION, /revoke all on table public\.company_billing from anon, authenticated/i,
    'the service role is the only reader/writer; browser clients must never see Stripe identifiers');
  assert.match(MIGRATION, /closer_197.*closer_launch_97/i,
    'only the two approved closer rates are stored');
});

test('company billing drafts charge closer seats only and accept only the two approved rates', () => {
  const draft = normalizeCompanyBillingDraft({
    billing_email: ' Billing@Example.com ',
    closer_seats: 9,
    rate_code: RATE_CODES.CLOSER_197,
  });

  assert.deepStrictEqual(draft, {
    billing_email: 'billing@example.com',
    closer_seats: 9,
    rate_code: 'closer_197',
  });

  assert.throws(() => normalizeCompanyBillingDraft({
    billing_email: 'billing@example.com', closer_seats: 2, rate_code: 'manager_297',
  }), /rate_code/i, 'managers are not a billable seat in this launch model');

  assert.throws(() => normalizeCompanyBillingDraft({
    billing_email: 'billing@example.com', closer_seats: 0, rate_code: RATE_CODES.CLOSER_197,
  }), /closer_seats/i, 'a company checkout must never create a zero-seat subscription');
});

test('the launch rate is an admin-assigned price, never a browser coupon', () => {
  assert.strictEqual(stripePriceIdFor(RATE_CODES.CLOSER_197, {
    STRIPE_CLOSER_197_PRICE_ID: 'price_standard',
    STRIPE_CLOSER_LAUNCH_97_PRICE_ID: 'price_launch',
  }), 'price_standard');
  assert.strictEqual(stripePriceIdFor(RATE_CODES.CLOSER_LAUNCH_97, {
    STRIPE_CLOSER_197_PRICE_ID: 'price_standard',
    STRIPE_CLOSER_LAUNCH_97_PRICE_ID: 'price_launch',
  }), 'price_launch');
  assert.throws(() => stripePriceIdFor(RATE_CODES.CLOSER_LAUNCH_97, {
    STRIPE_CLOSER_197_PRICE_ID: 'price_standard',
  }), /not configured/i);
});

test('company checkout reads the saved draft and never accepts price or quantity from the browser', () => {
  const params = buildCompanyCheckoutParams({
    company_head_id: 'head-1',
    billing_email: 'billing@example.com',
    closer_seats: 9,
    rate_code: RATE_CODES.CLOSER_LAUNCH_97,
  }, {
    STRIPE_CLOSER_197_PRICE_ID: 'price_standard',
    STRIPE_CLOSER_LAUNCH_97_PRICE_ID: 'price_launch',
  }, 'https://www.scoutsystems.io');

  assert.strictEqual(params.line_items[0].price, 'price_launch');
  assert.strictEqual(params.line_items[0].quantity, 9);
  assert.strictEqual(params.customer_email, 'billing@example.com');
  assert.deepStrictEqual(params.metadata, {
    billing_scope: 'company',
    company_head_id: 'head-1',
    rate_code: RATE_CODES.CLOSER_LAUNCH_97,
  });
  assert.deepStrictEqual(params.subscription_data.metadata, params.metadata,
    'later Stripe subscription events retain the same company identity');
  assert.strictEqual(params.allow_promotion_codes, false);
  assert.ok(params.success_url.startsWith('https://www.scoutsystems.io/'));
});

test('only Stripe-managed company rows participate in the new entitlement path', () => {
  assert.strictEqual(isStripeManagedCompanyBilling({ provider: 'stripe', status: 'active' }), true);
  assert.strictEqual(isStripeManagedCompanyBilling({ provider: 'stripe', status: 'trialing' }), true);
  assert.strictEqual(isStripeManagedCompanyBilling({ provider: 'stripe', status: 'past_due' }), false);
  assert.strictEqual(isStripeManagedCompanyBilling({ provider: null, status: 'active' }), false,
    'existing manually provisioned companies stay outside the new Stripe path');
});
