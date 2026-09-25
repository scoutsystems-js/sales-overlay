'use strict';

/*
 * Company billing deliberately models only the launch offer:
 *   - one recurring price per closer seat;
 *   - an owner-selected standard or launch rate;
 *   - managers are included operationally but are never line items here.
 *
 * Team and Agency packages are future commercial offers, not aliases for this
 * one. Keeping their names out of this module prevents a future price card from
 * accidentally becoming a charge path before its entitlements are built.
 */
const RATE_CODES = Object.freeze({
  CLOSER_197: 'closer_197',
  CLOSER_LAUNCH_97: 'closer_launch_97',
});

const VALID_RATE_CODES = new Set(Object.values(RATE_CODES));
const MAX_CLOSER_SEATS = 500;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  // This is input hygiene, not a claim that every valid email address has this
  // shape. Stripe remains the delivery/payment authority.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeCompanyBillingDraft(input) {
  const value = input || {};
  const billingEmail = normalizeEmail(value.billing_email);
  if (!billingEmail) throw new Error('billing_email must be a valid email address');

  const seats = value.closer_seats;
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_CLOSER_SEATS) {
    throw new Error('closer_seats must be a whole number from 1 to ' + MAX_CLOSER_SEATS);
  }

  if (!VALID_RATE_CODES.has(value.rate_code)) {
    throw new Error('rate_code must be one of the approved closer rates');
  }

  return {
    billing_email: billingEmail,
    closer_seats: seats,
    rate_code: value.rate_code,
  };
}

function stripePriceIdFor(rateCode, env) {
  const key = rateCode === RATE_CODES.CLOSER_197
    ? 'STRIPE_CLOSER_197_PRICE_ID'
    : rateCode === RATE_CODES.CLOSER_LAUNCH_97
      ? 'STRIPE_CLOSER_LAUNCH_97_PRICE_ID'
      : null;
  if (!key || !env || !env[key]) {
    throw new Error('Stripe price for this approved rate is not configured');
  }
  return env[key];
}

function buildCompanyCheckoutParams(draft, env, origin) {
  const normalized = normalizeCompanyBillingDraft(draft);
  if (!draft || typeof draft.company_head_id !== 'string' || !draft.company_head_id) {
    throw new Error('company billing draft is missing its company head');
  }
  if (!origin || !/^https:\/\//.test(origin)) {
    throw new Error('A secure canonical origin is required for checkout');
  }

  return {
    mode: 'subscription',
    payment_method_types: ['card'],
    allow_promotion_codes: false,
    line_items: [{
      price: stripePriceIdFor(normalized.rate_code, env),
      quantity: normalized.closer_seats,
    }],
    customer_email: normalized.billing_email,
    metadata: {
      billing_scope: 'company',
      company_head_id: draft.company_head_id,
      rate_code: normalized.rate_code,
    },
    subscription_data: {
      metadata: {
        billing_scope: 'company',
        company_head_id: draft.company_head_id,
        rate_code: normalized.rate_code,
      },
    },
    success_url: origin + '/dashboard?billing=success#admin',
    cancel_url: origin + '/dashboard?billing=canceled#admin',
  };
}

function isStripeManagedCompanyBilling(row) {
  return !!row
    && row.provider === 'stripe'
    && (row.status === 'active' || row.status === 'trialing');
}

module.exports = {
  RATE_CODES,
  MAX_CLOSER_SEATS,
  normalizeCompanyBillingDraft,
  stripePriceIdFor,
  buildCompanyCheckoutParams,
  isStripeManagedCompanyBilling,
};
