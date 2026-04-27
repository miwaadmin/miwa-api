const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { getUsageSummary } = require('../services/costTracker');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith('***')) {
    throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY to the environment.');
  }
  return require('stripe')(key);
}

// Price / product ID map.
// Group practice uses two separate prices: base flat fee + per-seat add-on.
const PRICE_IDS = {
  trainee: () => process.env.STRIPE_PRICE_TRAINEE,
  associate: () => process.env.STRIPE_PRICE_ASSOCIATE,
  solo: () => process.env.STRIPE_PRICE_SOLO,
  group: () => ({
    base: process.env.STRIPE_PRICE_GROUP_BASE,
    perSeat: process.env.STRIPE_PRICE_GROUP_PER_SEAT,
  }),
};

const VALID_PLANS = ['trainee', 'associate', 'solo', 'group'];

function sanitizeStripeError(err) {
  return {
    message: 'Stripe operation failed',
    type: err?.type || null,
    code: err?.code || null,
    statusCode: err?.statusCode || err?.status || null,
    requestId: err?.requestId || err?.request_id || null,
  };
}

async function resolvePriceId(stripe, plan) {
  const val = PRICE_IDS[plan]?.();
  if (!val) throw new Error(`Stripe price ID for "${plan}" is not configured yet.`);

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

async function findTherapistForSubscription(db, subscription) {
  const byCustomer = subscription.customer
    ? await db.get('SELECT id FROM therapists WHERE stripe_customer_id = ?', subscription.customer)
    : null;
  if (byCustomer) return byCustomer;

  const therapistId = parseInt(subscription.metadata?.therapist_id, 10);
  if (!therapistId) return null;
  return db.get('SELECT id FROM therapists WHERE id = ?', therapistId);
}

async function handleStripeEvent(db, event) {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const therapist = await findTherapistForSubscription(db, sub);
      if (!therapist) return { handled: false, reason: 'therapist_not_found', type: event.type };

      const status = sub.status;
      const plan = sub.metadata?.plan || null;

      if (status === 'active' || status === 'trialing') {
        await db.run(
          'UPDATE therapists SET subscription_status = ?, subscription_tier = ?, stripe_subscription_id = ? WHERE id = ?',
          'active', plan, sub.id, therapist.id,
        );
        return { handled: true, therapistId: therapist.id, subscriptionStatus: 'active', plan, type: event.type };
      }

      if (status === 'past_due') {
        await db.run('UPDATE therapists SET subscription_status = ? WHERE id = ?', 'past_due', therapist.id);
        return { handled: true, therapistId: therapist.id, subscriptionStatus: 'past_due', plan, type: event.type };
      }

      if (status === 'canceled' || status === 'unpaid') {
        await db.run(
          'UPDATE therapists SET subscription_status = ?, subscription_tier = NULL WHERE id = ?',
          'trial', therapist.id,
        );
        return { handled: true, therapistId: therapist.id, subscriptionStatus: 'trial', plan, type: event.type };
      }

      return { handled: true, therapistId: therapist.id, subscriptionStatus: status, plan, type: event.type };
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const therapist = await findTherapistForSubscription(db, sub);
      if (!therapist) return { handled: false, reason: 'therapist_not_found', type: event.type };
      await db.run(
        'UPDATE therapists SET subscription_status = ?, subscription_tier = NULL, stripe_subscription_id = NULL WHERE id = ?',
        'expired', therapist.id,
      );
      return { handled: true, therapistId: therapist.id, subscriptionStatus: 'expired', type: event.type };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const therapist = await db.get('SELECT id FROM therapists WHERE stripe_customer_id = ?', invoice.customer);
      if (!therapist) return { handled: false, reason: 'therapist_not_found', type: event.type };
      await db.run('UPDATE therapists SET subscription_status = ? WHERE id = ?', 'past_due', therapist.id);
      return { handled: true, therapistId: therapist.id, subscriptionStatus: 'past_due', type: event.type };
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const therapist = await db.get('SELECT id FROM therapists WHERE stripe_customer_id = ?', invoice.customer);
      if (!therapist) return { handled: false, reason: 'therapist_not_found', type: event.type };
      await db.run(
        `UPDATE therapists SET subscription_status = 'active' WHERE id = ? AND subscription_status = 'past_due'`,
        therapist.id,
      );
      return { handled: true, therapistId: therapist.id, subscriptionStatus: 'active_if_past_due', type: event.type };
    }

    default:
      return { handled: false, reason: 'unhandled_event_type', type: event.type };
  }
}

router.get('/usage', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const summary = await getUsageSummary(req.therapist.id);
    const byKind = await db.all(
      `SELECT kind,
              COUNT(*) AS call_count,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_cents), 0) AS cost_cents
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

router.get('/status', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get(
      'SELECT subscription_status, subscription_tier, workspace_uses, trial_limit FROM therapists WHERE id = ?',
      req.therapist.id,
    );
    if (!row) return res.status(404).json({ error: 'Therapist not found' });

    const trialLimit = row.trial_limit || 10;
    const trialUsed = row.workspace_uses || 0;
    res.json({
      subscription_status: row.subscription_status || 'trial',
      subscription_tier: row.subscription_tier || null,
      workspace_uses: trialUsed,
      trial_limit: trialLimit,
      trial_remaining: Math.max(0, trialLimit - trialUsed),
      is_active: row.subscription_status === 'active',
      is_trial: (row.subscription_status || 'trial') === 'trial',
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const db = getAsyncDb();
    const { plan, additionalSeats = 0 } = req.body;

    if (!VALID_PLANS.includes(plan)) {
      return res.status(400).json({ error: `Invalid plan. Choose one of: ${VALID_PLANS.join(', ')}.` });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const priceVal = await resolvePriceId(stripe, plan);

    let row = await db.get('SELECT stripe_customer_id, email, full_name FROM therapists WHERE id = ?', req.therapist.id);
    let customerId = row?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: row.email,
        name: row.full_name || undefined,
        metadata: { therapist_id: String(req.therapist.id) },
      });
      customerId = customer.id;
      await db.run('UPDATE therapists SET stripe_customer_id = ? WHERE id = ?', customerId, req.therapist.id);
      await persistIfNeeded();
    }

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
      cancel_url: `${appUrl}/settings?canceled=1`,
      subscription_data: {
        metadata: { therapist_id: String(req.therapist.id), plan },
      },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing] create-checkout-session error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/portal', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get('SELECT stripe_customer_id FROM therapists WHERE id = ?', req.therapist.id);
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const stripe = getStripe();
    if (!row?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });

    res.json({ url: portal.url });
  } catch (err) {
    console.error('[billing] portal error:', sanitizeStripeError(err));

    const isStaleCustomer =
      err.message?.includes('No such customer') ||
      err.message?.includes('test mode') ||
      err.message?.includes('live mode');

    if (isStaleCustomer) {
      try {
        const db2 = getAsyncDb();
        await db2.run('UPDATE therapists SET stripe_customer_id = NULL WHERE id = ?', req.therapist.id);
        await persistIfNeeded();
        console.warn('[billing] Cleared stale stripe_customer_id for therapist', req.therapist.id);
      } catch {}
      return res.status(400).json({
        error: 'Your billing account needs to be refreshed. Please go to Billing and start a new subscription - your previous test account was not carried over to the live system.',
      });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
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
    console.error('[billing] Webhook signature error:', sanitizeStripeError(err));
    return res.status(400).send('Webhook signature verification failed');
  }

  try {
    const result = await handleStripeEvent(getAsyncDb(), event);
    if (result.handled) {
      console.log('[billing] Stripe webhook handled:', {
        type: result.type,
        therapistId: result.therapistId,
        subscriptionStatus: result.subscriptionStatus,
      });
    } else if (result.reason === 'therapist_not_found') {
      console.warn('[billing] Stripe webhook therapist not found:', { type: result.type });
    }
  } catch (handlerErr) {
    console.error('[billing] Webhook handler error:', sanitizeStripeError(handlerErr));
  }

  try { await persistIfNeeded(); } catch {}
  res.json({ received: true });
});

router._test = {
  handleStripeEvent,
  resolvePriceId,
  sanitizeStripeError,
};

module.exports = router;
