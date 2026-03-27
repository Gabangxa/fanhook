/**
 * POST /webhooks/stripe
 *
 * Receives Stripe subscription lifecycle events and keeps the local
 * `sinks.tier` in sync.
 *
 * Requires express.raw({ type: 'application/json' }) applied BEFORE this
 * router so that req.body is the raw Buffer needed for signature verification.
 *
 * Relevant events handled:
 *   checkout.session.completed  → mark sink as 'starter', store customer + subscription IDs
 *   customer.subscription.updated → sync status (e.g. payment failed → downgrade)
 *   customer.subscription.deleted → downgrade sink back to 'free'
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

// ---------------------------------------------------------------------------
// POST /webhooks/stripe
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    console.warn('[stripe-webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set — skipping');
    return res.status(200).json({ received: true });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const sinkId = session.client_reference_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (!sinkId) {
          console.warn('[stripe-webhook] checkout.session.completed missing client_reference_id');
          break;
        }

        db.prepare(`
          UPDATE sinks
          SET tier = 'starter',
              stripe_customer_id = ?,
              stripe_subscription_id = ?
          WHERE id = ?
        `).run(customerId, subscriptionId, sinkId);

        console.log(`[stripe-webhook] Upgraded sink ${sinkId} → starter`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        // If subscription becomes past_due or unpaid, downgrade
        if (sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'canceled') {
          db.prepare(`
            UPDATE sinks
            SET tier = 'free',
                stripe_subscription_id = NULL
            WHERE stripe_subscription_id = ?
          `).run(sub.id);
          console.log(`[stripe-webhook] Downgraded sink with sub ${sub.id} → free (status: ${sub.status})`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        db.prepare(`
          UPDATE sinks
          SET tier = 'free',
              stripe_subscription_id = NULL
          WHERE stripe_subscription_id = ?
        `).run(sub.id);
        console.log(`[stripe-webhook] Subscription ${sub.id} deleted — sink downgraded to free`);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err);
    return res.status(500).json({ error: 'Handler error' });
  }

  return res.json({ received: true });
});

module.exports = router;
