'use strict';

/*
 * Company billing deliberately models only the current offer:
 *   - $197 recurring price per closer seat;
 *   - $497 recurring price per manager-access seat.
 *
 * Team and Agency packages are future commercial offers, not aliases for this
 * one. Keeping their names out of this module prevents a future price card from
 * accidentally becoming a charge path before its entitlements are built.
 */
const MAX_CLOSER_SEATS = 500;
const MAX_MANAGER_SEATS = 100;

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
  if (!Number.isInteger(seats) || seats < 0 || seats > MAX_CLOSER_SEATS) {
    throw new Error('closer_seats must be a whole number from 0 to ' + MAX_CLOSER_SEATS);
  }
  const managerSeats = value.manager_seats;
  if (!Number.isInteger(managerSeats) || managerSeats < 0 || managerSeats > MAX_MANAGER_SEATS) {
    throw new Error('manager_seats must be a whole number from 0 to ' + MAX_MANAGER_SEATS);
  }
  if (seats + managerSeats < 1) {
    throw new Error('At least one closer or manager seat is required');
  }

  return {
    billing_email: billingEmail,
    closer_seats: seats,
    manager_seats: managerSeats,
  };
}

function stripePriceIds(env) {
  if (!env || !env.STRIPE_CLOSER_197_PRICE_ID || !env.STRIPE_MANAGER_497_PRICE_ID) {
    throw new Error('Stripe closer and manager prices are not configured');
  }
  return {
    closer: env.STRIPE_CLOSER_197_PRICE_ID,
    manager: env.STRIPE_MANAGER_497_PRICE_ID,
  };
}

function buildCompanyCheckoutParams(draft, env, origin) {
  const normalized = normalizeCompanyBillingDraft(draft);
  if (!draft || typeof draft.company_head_id !== 'string' || !draft.company_head_id) {
    throw new Error('company billing draft is missing its company head');
  }
  if (!origin || !/^https:\/\//.test(origin)) {
    throw new Error('A secure canonical origin is required for checkout');
  }
  const prices = stripePriceIds(env);
  const lineItems = [];
  if (normalized.closer_seats) lineItems.push({ price: prices.closer, quantity: normalized.closer_seats });
  if (normalized.manager_seats) lineItems.push({ price: prices.manager, quantity: normalized.manager_seats });

  return {
    mode: 'subscription',
    payment_method_types: ['card'],
    allow_promotion_codes: false,
    line_items: lineItems,
    customer_email: normalized.billing_email,
    metadata: {
      billing_scope: 'company',
      company_head_id: draft.company_head_id,
    },
    subscription_data: {
      metadata: {
        billing_scope: 'company',
        company_head_id: draft.company_head_id,
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
  MAX_CLOSER_SEATS,
  MAX_MANAGER_SEATS,
  normalizeCompanyBillingDraft,
  stripePriceIds,
  buildCompanyCheckoutParams,
  isStripeManagedCompanyBilling,
};
