const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getDb, persist } = require('../db');
const { getUsageSummary } = require('../services/costTracker');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith('***')) {
    throw new Error('Stripe is not configured. Add your STRIPE_SECRET_KEY to server/.env');
  }
  return require('stripe')(key);
}

// Price / product ID map
// Group practice uses two separate prices: base flat ($399) + per-seat add-on ($39/each)
const PRICE_IDS = {
  trainee:   () => process.env.STRIPE_PRICE_TRAINEE,
  associate: () => process.env.STRIPE_PRICE_ASSOCIATE,
  solo:      () => process.env.STRIPE_PRICE_SOLO,
  group:     () => ({
    base:    process.env.STRIPE_PRICE_GROUP_BASE,
    perSeat: process.env.STRIPE_PRICE_GROUP_PER_SEAT,
  }),
};

const VALID_PLANS = ['trainee', 'associate', 'solo', 'group'];

async function resolvePriceId(stripe, plan) {
  const val = PRICE_IDS[plan]?.();
  if (!val) throw new Error(`Stripe price ID for "${plan}" is not configured yet.`);

  // Group returns an object — handled separately in the checkout endpoint
  if (typeof val === 'object') return val;

  if (val.startsWith('prod_')) {
    if (!stripe) throw new Error(`Stripe product ID for "${plan}" was provided, but Stripe is not configured yet.`);
    const product = await stripe.products.retrieve(val, { expand: ['default_price'] });
    const defaultPrice = product?.default_price;
    const priceId = typeof defaultPrice === 'string' ? defaultPrice : defaultPrice?.id;
    if (!priceId) throw new Error(`Product "${plan}" does not have a default recurring price in Stripe.`);
    return priceId;
  }
  if (val.startsWith('price_REPLACE')) {
    throw new Error(`Stripe price ID for "${plan}" is not configured yet.`);
  }
  return val;
}

// ── GET /api/billing/usage ──────────────────────────────────────────────────
// Returns this therapist's AI token usage + budget + top-spending tasks this month.
router.get('/usage', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const summary = getUsageSummary(req.therapist.id);

    // Breakdown by task kind for the current month
    const byKind = db.all(
      `SELECT kind,
              COUNT(*) AS call_count,
              COALESCE(SUM(input_tokens),  0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_cents),    0) AS cost_cents
         FROM cost_events
        WHERE therapist_id = ?
          AND created_at >= date('now', 'start of month')
     GROUP BY kind
     ORDER BY cost_cents DESC`,
      req.therapist.id,
    );

    res.json({ ...summary, by_kind: byKind });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/billing/status ─────────────────────────────────────────────────
// Returns current subscription info for the logged-in therapist
router.get('/status', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const row = db.get(
      'SELECT subscription_status, subscription_tier, workspace_uses, trial_limit FROM therapists WHERE id = ?',
      req.therapist.id,
    );
    if (!row) return res.status(404).json({ error: 'Therapist not found' });

    const trialLimit = row.trial_limit || 10;
    const trialUsed  = row.workspace_uses || 0;
    res.json({
      subscription_status: row.subscription_status || 'trial',
      subscription_tier:   row.subscription_tier   || null,
      workspace_uses:      trialUsed,
      trial_limit:         trialLimit,
      trial_remaining:     Math.max(0, trialLimit - trialUsed),
      is_active:           row.subscription_status === 'active',
      is_trial:            (row.subscription_status || 'trial') === 'trial',
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/billing/create-checkout-session ───────────────────────────────
// Creates a Stripe Checkout session for the selected plan
// Body: { plan: 'trainee'|'associate'|'solo'|'group', additionalSeats?: number }
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const db = getDb();
    const { plan, additionalSeats = 0 } = req.body;

    if (!VALID_PLANS.includes(plan)) {
      return res.status(400).json({ error: `Invalid plan. Choose one of: ${VALID_PLANS.join(', ')}.` });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const priceVal = await resolvePriceId(stripe, plan);

    // Get or create Stripe customer
    let row = db.get('SELECT stripe_customer_id, email, full_name FROM therapists WHERE id = ?', req.therapist.id);
    let customerId = row?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: row.email,
        name:  row.full_name || undefined,
        metadata: { therapist_id: String(req.therapist.id) },
      });
      customerId = customer.id;
      db.run('UPDATE therapists SET stripe_customer_id = ? WHERE id = ?', customerId, req.therapist.id);
    }

    // Build line items — group uses base flat price + optional per-seat add-on
    let lineItems;
    if (plan === 'group' && typeof priceVal === 'object') {
      const { base, perSeat } = priceVal;
      if (!base) throw new Error('STRIPE_PRICE_GROUP_BASE is not configured.');
      lineItems = [{ price: base, quantity: 1 }];
      if (perSeat && additionalSeats > 0) {
        lineItems.push({ price: perSeat, quantity: additionalSeats });
      }
    } else {
      lineItems = [{ price: priceVal, quantity: 1 }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      success_url: `${appUrl}/settings?subscribed=1`,
      cancel_url:  `${appUrl}/settings?canceled=1`,
      subscription_data: {
        metadata: { therapist_id: String(req.therapist.id), plan },
      },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing] create-checkout-session error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/billing/portal ────────────────────────────────────────────────
// Creates a Stripe Customer Portal session so users can manage / cancel
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const row = db.get('SELECT stripe_customer_id FROM therapists WHERE id = ?', req.therapist.id);
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const stripe = getStripe();
    if (!row?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer:   row.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });

    res.json({ url: portal.url });
  } catch (err) {
    console.error('[billing] portal error:', err.message);

    // Stale test-mode customer ID used against live key (or vice versa).
    // Clear it from the DB so the next checkout creates a fresh live customer.
    const isStaleCustomer =
      err.message?.includes('No such customer') ||
      err.message?.includes('test mode') ||
      err.message?.includes('live mode');

    if (isStaleCustomer) {
      try {
        const db2 = getDb();
        db2.run('UPDATE therapists SET stripe_customer_id = NULL WHERE id = ?', req.therapist.id);
        const { persist } = require('../db');
        persist();
        console.warn('[billing] Cleared stale stripe_customer_id for therapist', req.therapist.id);
      } catch {}
      return res.status(400).json({
        error: 'Your billing account needs to be refreshed. Please go to Billing and start a new subscription — your previous test account was not carried over to the live system.',
      });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/billing/webhook ───────────────────────────────────────────────
// Stripe sends events here — must be raw body (handled below)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[billing] STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[billing] Webhook signature error:', err.message);
    return res.status(400).send('Webhook signature verification failed');
  }

  const db = getDb();

  // Helper: find therapist by Stripe customer ID
  const byCustomer = (customerId) =>
    db.get('SELECT id FROM therapists WHERE stripe_customer_id = ?', customerId);

  // Helper: find therapist by subscription metadata
  const bySubMeta = (subscription) => {
    const tid = subscription.metadata?.therapist_id;
    return tid ? db.get('SELECT id FROM therapists WHERE id = ?', parseInt(tid, 10)) : null;
  };

  try {
    switch (event.type) {
      // ── Subscription became active (new or renewed) ──────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const therapist = byCustomer(sub.customer) || bySubMeta(sub);
        if (!therapist) { console.warn('[billing] No therapist found for customer', sub.customer); break; }

        const status = sub.status; // 'active', 'trialing', 'past_due', 'canceled', etc.
        const plan   = sub.metadata?.plan || null;

        if (status === 'active' || status === 'trialing') {
          db.run(
            'UPDATE therapists SET subscription_status = ?, subscription_tier = ?, stripe_subscription_id = ? WHERE id = ?',
            'active', plan, sub.id, therapist.id,
          );
          console.log(`[billing] Therapist ${therapist.id} subscription active (${plan})`);
        } else if (status === 'past_due') {
          db.run('UPDATE therapists SET subscription_status = ? WHERE id = ?', 'past_due', therapist.id);
          console.log(`[billing] Therapist ${therapist.id} subscription past_due`);
        } else if (status === 'canceled' || status === 'unpaid') {
          db.run(
            'UPDATE therapists SET subscription_status = ?, subscription_tier = NULL WHERE id = ?',
            'trial', therapist.id,
          );
          console.log(`[billing] Therapist ${therapist.id} subscription canceled`);
        }
        break;
      }

      // ── Subscription deleted (canceled at end of period) ─────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const therapist = byCustomer(sub.customer) || bySubMeta(sub);
        if (!therapist) break;
        db.run(
          'UPDATE therapists SET subscription_status = ?, subscription_tier = NULL, stripe_subscription_id = NULL WHERE id = ?',
          'expired', therapist.id,
        );
        console.log(`[billing] Therapist ${therapist.id} subscription expired`);
        break;
      }

      // ── Payment failed ────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const therapist = byCustomer(invoice.customer);
        if (!therapist) break;
        db.run('UPDATE therapists SET subscription_status = ? WHERE id = ?', 'past_due', therapist.id);
        console.log(`[billing] Therapist ${therapist.id} payment failed`);
        break;
      }

      // ── Payment succeeded ─────────────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const therapist = byCustomer(invoice.customer);
        if (!therapist) break;
        // Restore to active if they had failed before
        db.run(
          `UPDATE therapists SET subscription_status = 'active' WHERE id = ? AND subscription_status = 'past_due'`,
          therapist.id,
        );
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }
  } catch (handlerErr) {
    console.error('[billing] Webhook handler error:', handlerErr.message);
  }

  res.json({ received: true });
});

module.exports = router;
