const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Lazy Stripe init — only loads when a billing route is actually called.
// Prevents crash on startup when STRIPE_SECRET_KEY is not yet configured.
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
    throw new Error('Stripe not configured yet. Add STRIPE_SECRET_KEY to Railway variables.');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}
const { requireAuth } = require('../middleware/auth');

var router = express.Router();
var supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    console.error('[billing] Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Customer portal — lets users manage/cancel their subscription
router.post('/portal', requireAuth, async function(req, res) {
  try {
    // Look up the Stripe customer ID from our subscriptions table
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
    console.error('[billing] Portal error:', err.message);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

// Check subscription status for the logged-in user
router.get('/status', requireAuth, async function(req, res) {
  try {
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
    console.error('[billing] Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        var session = event.data.object;
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

        await supabase.from('subscriptions')
          .update({
            status: sub.status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);

        console.log('[billing] Subscription updated:', sub.id, sub.status);
        break;
      }

      case 'customer.subscription.deleted': {
        var sub = event.data.object;

        await supabase.from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);

        console.log('[billing] Subscription canceled:', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        var invoice = event.data.object;

        await supabase.from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', invoice.customer);

        console.log('[billing] Payment failed for customer:', invoice.customer);
        break;
      }

      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error('[billing] Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;
