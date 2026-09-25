'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeCompanyBillingDraft,
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
  assert.match(MIGRATION, /manager_seats integer not null check \(manager_seats between 0 and 100\)/i,
    'manager access must be an explicit billable seat, never a hidden free add-on');
});

test('company billing drafts count closer and manager access seats separately', () => {
  const draft = normalizeCompanyBillingDraft({
    billing_email: ' Billing@Example.com ',
    closer_seats: 9,
    manager_seats: 2,
  });

  assert.deepStrictEqual(draft, {
    billing_email: 'billing@example.com',
    closer_seats: 9,
    manager_seats: 2,
  });

  assert.throws(() => normalizeCompanyBillingDraft({
    billing_email: 'billing@example.com', closer_seats: 0, manager_seats: 0,
  }), /seat/i, 'a company checkout must never create an empty subscription');

  assert.throws(() => normalizeCompanyBillingDraft({
    billing_email: 'billing@example.com', closer_seats: -1, manager_seats: 1,
  }), /closer_seats/i, 'a company checkout must never create a zero-seat subscription');
});

test('company checkout reads both saved seat counts and never accepts price or quantity from the browser', () => {
  const params = buildCompanyCheckoutParams({
    company_head_id: 'head-1',
    billing_email: 'billing@example.com',
    closer_seats: 9,
    manager_seats: 2,
  }, {
    STRIPE_CLOSER_197_PRICE_ID: 'price_closer',
    STRIPE_MANAGER_497_PRICE_ID: 'price_manager',
  }, 'https://www.scoutsystems.io');

  assert.strictEqual(params.line_items[0].price, 'price_closer');
  assert.strictEqual(params.line_items[0].quantity, 9);
  assert.strictEqual(params.line_items[1].price, 'price_manager');
  assert.strictEqual(params.line_items[1].quantity, 2);
  assert.strictEqual(params.customer_email, 'billing@example.com');
  assert.deepStrictEqual(params.metadata, {
    billing_scope: 'company',
    company_head_id: 'head-1',
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
