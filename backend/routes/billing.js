const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CANONICAL_ORIGIN } = require('../config');
const { buildCompanyCheckoutParams } = require('../lib/company-billing');

var router = express.Router();
var _stripeForTests = null;

// Lazy Stripe init — only loads when a billing route is actually called.
// Prevents crash on startup when STRIPE_SECRET_KEY is not yet configured.
function getStripe() {
  if (_stripeForTests) return _stripeForTests;
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
    throw new Error('Stripe not configured — set STRIPE_SECRET_KEY in Railway Variables.');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Lazy Supabase client (service role — can write to subscriptions table).
var _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Railway Variables.');
  }
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _supabase;
}

// Wraps a route handler so a getStripe()/getSupabase() throw turns into 503.
function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[billing] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

// Create a Stripe Checkout session — user pays $197/month
// Electron app opens the returned URL in a browser window
router.post('/checkout', requireAuth, async function(req, res) {
  try {
    var session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      customer_email: req.user.email,
      metadata: {
        user_id: req.user.id,
      },
      success_url: 'scout://billing/success',   // Electron intercepts this
      cancel_url: 'scout://billing/cancel',
    });

    res.json({ url: session.url });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[billing] Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Owner-created company checkout for the current per-seat offer. The browser cannot send
// a price, coupon, seat count, or customer email here: all of it comes from the
// owner-saved company_billing draft. That keeps both current seat prices under
// owner control and prevents a future pricing-card edit from becoming a charge.
router.post('/admin/companies/:head_id/checkout', requireAuth, requireRole('owner'), async function(req, res) {
  try {
    var supabase = getSupabase();
    var draftResult = await supabase.from('company_billing').select('*')
      .eq('company_head_id', req.params.head_id).maybeSingle();
    if (draftResult.error) throw new Error('company billing lookup failed: ' + draftResult.error.message);
    if (!draftResult.data) return res.status(404).json({ error: 'Save a company billing draft before creating checkout.' });
    if (draftResult.data.status !== 'draft') {
      return res.status(409).json({ error: 'This company already has a checkout or subscription. Save a new draft before creating another checkout link.' });
    }

    var params = buildCompanyCheckoutParams(draftResult.data, process.env, CANONICAL_ORIGIN);
    var session = await getStripe().checkout.sessions.create(params);
    if (!session || !session.id || !session.url) throw new Error('Stripe did not return a checkout link');

    var saved = await supabase.from('company_billing').update({
      status: 'checkout_started',
      stripe_checkout_session_id: session.id,
      stripe_closer_price_id: params.line_items.filter(function (item) { return item.price === process.env.STRIPE_CLOSER_197_PRICE_ID; })[0] ? process.env.STRIPE_CLOSER_197_PRICE_ID : null,
      stripe_manager_price_id: params.line_items.filter(function (item) { return item.price === process.env.STRIPE_MANAGER_497_PRICE_ID; })[0] ? process.env.STRIPE_MANAGER_497_PRICE_ID : null,
      updated_at: new Date().toISOString(),
    }).eq('company_head_id', req.params.head_id).eq('status', 'draft')
      .select('company_head_id').maybeSingle();
    if (saved.error) throw new Error('company checkout state save failed: ' + saved.error.message);
    if (!saved.data) throw new Error('company billing draft changed before checkout state could be saved');

    console.log('[billing] company checkout created: actor=%s head=%s closer_seats=%d manager_seats=%d',
      req.user.id, req.params.head_id,
      draftResult.data.closer_seats, draftResult.data.manager_seats);
    res.json({ url: session.url });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[billing] company checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create company checkout' });
  }
});

// Customer portal — lets users manage/cancel their subscription
router.post('/portal', requireAuth, async function(req, res) {
  try {
    // Look up the Stripe customer ID from our subscriptions table
    var supabase = getSupabase();
    var { data, error } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    var portalSession = await getStripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: 'scout://billing/portal-return',
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[billing] Portal error:', err.message);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

// Check subscription status for the logged-in user
router.get('/status', requireAuth, async function(req, res) {
  try {
    var supabase = getSupabase();
    var { data, error } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.json({ status: 'none' });
    }

    res.json({ status: data.status, current_period_end: data.current_period_end });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[billing] Status error:', err.message);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// Stripe webhook — updates subscription status in Supabase when payments succeed/fail
// Raw body required — handled in index.js before express.json()
router.post('/webhook', async function(req, res) {
  var sig = req.headers['stripe-signature'];
  var event;

  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[billing] Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    var supabase = getSupabase();
    switch (event.type) {
      case 'checkout.session.completed': {
        var session = event.data.object;
        if (session.metadata && session.metadata.billing_scope === 'company') {
          var companyHeadId = session.metadata.company_head_id;
          if (!companyHeadId) throw new Error('company checkout is missing company_head_id metadata');
          var companySubscription = await getStripe().subscriptions.retrieve(session.subscription);
          var companyUpsert = await supabase.from('company_billing').update({
            provider: 'stripe',
            status: companySubscription.status,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            stripe_checkout_session_id: session.id,
            current_period_end: new Date(companySubscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('company_head_id', companyHeadId);
          if (companyUpsert.error) throw new Error('company checkout write failed: ' + companyUpsert.error.message);
          console.log('[billing] Company subscription created for head:', companyHeadId);
          break;
        }

        var userId = session.metadata.user_id;
        var customerId = session.customer;
        var subscriptionId = session.subscription;

        // Get subscription details from Stripe
        var sub = await getStripe().subscriptions.retrieve(subscriptionId);

        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log('[billing] Subscription created for user:', userId);
        break;
      }

      case 'customer.subscription.updated': {
        var sub = event.data.object;

        var legacyUpdated = await supabase.from('subscriptions')
          .update({
            status: sub.status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        if (legacyUpdated.error) throw new Error('legacy subscription update failed: ' + legacyUpdated.error.message);

        var companyUpdated = await supabase.from('company_billing')
          .update({
            status: sub.status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        if (companyUpdated.error) throw new Error('company subscription update failed: ' + companyUpdated.error.message);

        console.log('[billing] Subscription updated:', sub.id, sub.status);
        break;
      }

      case 'customer.subscription.deleted': {
        var sub = event.data.object;

        var legacyCanceled = await supabase.from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        if (legacyCanceled.error) throw new Error('legacy subscription cancel failed: ' + legacyCanceled.error.message);

        var companyCanceled = await supabase.from('company_billing')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        if (companyCanceled.error) throw new Error('company subscription cancel failed: ' + companyCanceled.error.message);

        console.log('[billing] Subscription canceled:', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        var invoice = event.data.object;

        var legacyPastDue = await supabase.from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', invoice.customer);
        if (legacyPastDue.error) throw new Error('legacy invoice update failed: ' + legacyPastDue.error.message);

        var companyPastDue = await supabase.from('company_billing')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', invoice.customer);
        if (companyPastDue.error) throw new Error('company invoice update failed: ' + companyPastDue.error.message);

        console.log('[billing] Payment failed for customer:', invoice.customer);
        break;
      }

      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[billing] Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;

// Narrow HTTP-test seam. Production still builds both clients from Railway
// variables; tests use a fake signed-in actor and a fake Stripe response, so no
// card, secret, account, or external request is ever involved.
module.exports._setClientsForTests = function (clients) {
  _stripeForTests = clients && clients.stripe ? clients.stripe : null;
  _supabase = clients && clients.supabase ? clients.supabase : null;
};
