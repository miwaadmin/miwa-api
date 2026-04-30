const express = require('express');
const router = express.Router();
const crypto = require('crypto');
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
const INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'refunded', 'failed'];

function sanitizeStripeError(err) {
  return {
    message: 'Stripe operation failed',
    type: err?.type || null,
    code: err?.code || null,
    statusCode: err?.statusCode || err?.status || null,
    requestId: err?.requestId || err?.request_id || null,
  };
}

function centsFromDollars(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function dollarsFromCents(cents) {
  return Number(((Number(cents || 0)) / 100).toFixed(2));
}

function genericStripeDescription(value) {
  const text = String(value || 'Professional services').trim();
  // Keep Stripe-visible text generic. Clinical details live only in Miwa.
  if (!text) return 'Professional services';
  return text.slice(0, 120).replace(/[^\w\s.,&()/-]/g, '');
}

function makeInvoiceNumber(therapistId) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `MIWA-${therapistId}-${Date.now().toString(36).toUpperCase()}-${suffix}`;
}

function isBillingCredentialEligible(therapist) {
  const credential = therapist?.credential_type || 'licensed';
  if (credential === 'trainee') {
    return {
      eligible: false,
      reason: 'Trainee accounts cannot collect client payments directly in Miwa.',
    };
  }
  if (credential === 'associate') {
    return {
      eligible: true,
      reason: 'Associate billing should be used only under an appropriate supervisor or practice arrangement.',
      requires_supervision: true,
    };
  }
  return { eligible: true, reason: 'Licensed clinician billing is eligible.' };
}

function normalizeAccountStatus(account) {
  if (!account) {
    return {
      status: 'not_connected',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }
  const configuration = account.configuration || {};
  const merchantStatus = configuration.merchant?.status;
  const cardStatus = configuration.merchant?.capabilities?.card_payments?.status;
  const chargesEnabled = !!account.charges_enabled || merchantStatus === 'active' || cardStatus === 'active';
  const payoutsEnabled = !!account.payouts_enabled || configuration.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active';
  const detailsSubmitted = !!account.details_submitted || !!account.requirements || !!account.future_requirements;
  return {
    status: chargesEnabled ? 'ready' : detailsSubmitted ? 'needs_onboarding' : 'created',
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
  };
}

async function refreshConnectStatus(db, stripe, therapistId, accountId) {
  if (!accountId) return null;
  let account;
  try {
    account = await stripe.v2.core.accounts.retrieve(accountId);
  } catch (err) {
    account = await stripe.accounts.retrieve(accountId);
  }
  const status = normalizeAccountStatus(account);
  await db.run(
    `UPDATE therapists
        SET stripe_connect_status = ?,
            stripe_connect_charges_enabled = ?,
            stripe_connect_payouts_enabled = ?,
            stripe_connect_details_submitted = ?,
            stripe_connect_last_checked_at = CURRENT_TIMESTAMP,
            billing_enabled = CASE WHEN ? = 1 THEN 1 ELSE billing_enabled END
      WHERE id = ?`,
    status.status,
    status.chargesEnabled ? 1 : 0,
    status.payoutsEnabled ? 1 : 0,
    status.detailsSubmitted ? 1 : 0,
    status.chargesEnabled ? 1 : 0,
    therapistId,
  );
  return status;
}

async function createConnectedAccount(stripe, therapist) {
  const displayName = therapist.full_name || therapist.email || 'Miwa clinician';
  try {
    return await stripe.v2.core.accounts.create({
      contact_email: therapist.email,
      display_name: displayName,
      dashboard: 'full',
      defaults: {
        currency: 'usd',
        responsibilities: {
          fees_collector: 'stripe',
          losses_collector: 'stripe',
        },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
      },
      metadata: { miwa_therapist_id: String(therapist.id) },
    });
  } catch (err) {
    // Fallback for Stripe accounts or SDK/API versions where Accounts v2 is
    // unavailable. This keeps production onboarding usable while preserving
    // the same responsibility model: full Stripe dashboard, account-paid fees,
    // and Stripe-collected requirements.
    return stripe.accounts.create({
      email: therapist.email,
      business_type: 'individual',
      controller: {
        fees: { payer: 'account' },
        losses: { payments: 'stripe' },
        stripe_dashboard: { type: 'full' },
        requirement_collection: 'stripe',
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { miwa_therapist_id: String(therapist.id) },
    });
  }
}

async function createConnectOnboardingLink(stripe, accountId, appUrl) {
  try {
    return await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant'],
          refresh_url: `${appUrl}/billing?connect=refresh`,
          return_url: `${appUrl}/billing?connect=return`,
        },
      },
    });
  } catch (err) {
    return stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/billing?connect=refresh`,
      return_url: `${appUrl}/billing?connect=return`,
      type: 'account_onboarding',
    });
  }
}

async function getTherapistBillingRow(db, therapistId) {
  return db.get(
    `SELECT id, email, full_name, credential_type, credential_verified, practice_id, practice_role,
            stripe_connect_account_id, stripe_connect_status,
            stripe_connect_charges_enabled, stripe_connect_payouts_enabled,
            stripe_connect_details_submitted, stripe_connect_last_checked_at,
            billing_enabled, billing_default_rate_cents, billing_autopay_enabled,
            billing_card_on_file_enabled, billing_no_show_fee_cents, billing_policy_json
       FROM therapists
      WHERE id = ?`,
    therapistId,
  );
}

async function insertBillingEvent(db, { therapistId, patientId, invoiceId, eventType, stripeEventId, status, message, meta }) {
  try {
    await db.insert(
      `INSERT INTO client_billing_events
        (therapist_id, patient_id, invoice_id, event_type, stripe_event_id, status, message, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      therapistId || null,
      patientId || null,
      invoiceId || null,
      eventType,
      stripeEventId || null,
      status || null,
      message || null,
      meta ? JSON.stringify(meta) : null,
    );
  } catch {}
}

async function requireInvoiceOwner(db, invoiceId, therapistId) {
  return db.get(
    `SELECT ci.*, p.display_name, p.first_name, p.last_name, p.email AS patient_email
       FROM client_invoices ci
       LEFT JOIN patients p ON p.id = ci.patient_id
      WHERE ci.id = ? AND ci.therapist_id = ?`,
    invoiceId,
    therapistId,
  );
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

    case 'checkout.session.completed': {
      const session = event.data.object;
      const invoiceId = parseInt(session.metadata?.miwa_invoice_id, 10);
      const therapistId = parseInt(session.metadata?.miwa_therapist_id, 10);
      const patientId = parseInt(session.metadata?.miwa_patient_id, 10) || null;
      if (!therapistId) return { handled: false, reason: 'not_miwa_client_checkout', type: event.type };

      const mode = session.mode;
      if (mode === 'setup') {
        await db.run(
          `UPDATE client_billing_profiles
              SET card_on_file_authorized = 1,
                  autopay_authorized = CASE WHEN autopay_authorized = 1 THEN 1 ELSE 0 END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE therapist_id = ? AND patient_id = ?`,
          therapistId,
          patientId,
        );
        await insertBillingEvent(db, {
          therapistId,
          patientId,
          eventType: 'card_setup.completed',
          stripeEventId: event.id,
          status: 'authorized',
        });
        return { handled: true, therapistId, type: event.type, subscriptionStatus: 'client_card_authorized' };
      }
      if (!invoiceId) return { handled: false, reason: 'not_miwa_client_payment', type: event.type };

      await db.run(
        `UPDATE client_invoices
            SET status = 'paid',
                stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?),
                stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?),
                paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND therapist_id = ?`,
        session.id || null,
        session.payment_intent || null,
        invoiceId,
        therapistId,
      );
      await db.insert(
        `INSERT INTO client_payments
          (therapist_id, patient_id, invoice_id, stripe_account_id, stripe_payment_intent_id,
           amount_cents, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded')`,
        therapistId,
        patientId,
        invoiceId,
        event.account || null,
        session.payment_intent || null,
        session.amount_total || 0,
        session.currency || 'usd',
      );
      await insertBillingEvent(db, {
        therapistId,
        patientId,
        invoiceId,
        eventType: 'checkout.completed',
        stripeEventId: event.id,
        status: 'paid',
      });
      return { handled: true, therapistId, type: event.type, subscriptionStatus: 'client_invoice_paid' };
    }

    case 'setup_intent.succeeded': {
      const intent = event.data.object;
      const therapistId = parseInt(intent.metadata?.miwa_therapist_id, 10);
      const patientId = parseInt(intent.metadata?.miwa_patient_id, 10);
      if (!therapistId || !patientId) return { handled: false, reason: 'not_miwa_client_setup', type: event.type };
      await db.run(
        `UPDATE client_billing_profiles
            SET default_payment_method_id = ?,
                card_on_file_authorized = 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE therapist_id = ? AND patient_id = ?`,
        intent.payment_method || null,
        therapistId,
        patientId,
      );
      await insertBillingEvent(db, {
        therapistId,
        patientId,
        eventType: 'setup_intent.succeeded',
        stripeEventId: event.id,
        status: 'authorized',
      });
      return { handled: true, therapistId, type: event.type, subscriptionStatus: 'client_card_authorized' };
    }

    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      const invoiceId = parseInt(intent.metadata?.miwa_invoice_id, 10);
      const therapistId = parseInt(intent.metadata?.miwa_therapist_id, 10);
      const patientId = parseInt(intent.metadata?.miwa_patient_id, 10) || null;
      if (!invoiceId || !therapistId) return { handled: false, reason: 'not_miwa_client_payment', type: event.type };
      const succeeded = event.type === 'payment_intent.succeeded';
      await db.run(
        `UPDATE client_invoices
            SET status = ?,
                stripe_payment_intent_id = ?,
                paid_at = CASE WHEN ? = 1 THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND therapist_id = ?`,
        succeeded ? 'paid' : 'failed',
        intent.id,
        succeeded ? 1 : 0,
        invoiceId,
        therapistId,
      );
      await db.insert(
        `INSERT INTO client_payments
          (therapist_id, patient_id, invoice_id, stripe_account_id, stripe_payment_intent_id,
           amount_cents, currency, status, failure_code, failure_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        therapistId,
        patientId,
        invoiceId,
        event.account || null,
        intent.id,
        intent.amount || 0,
        intent.currency || 'usd',
        succeeded ? 'succeeded' : 'failed',
        intent.last_payment_error?.code || null,
        intent.last_payment_error?.message || null,
      );
      await insertBillingEvent(db, {
        therapistId,
        patientId,
        invoiceId,
        eventType: event.type,
        stripeEventId: event.id,
        status: succeeded ? 'paid' : 'failed',
      });
      return { handled: true, therapistId, type: event.type, subscriptionStatus: succeeded ? 'client_invoice_paid' : 'client_invoice_failed' };
    }

    case 'charge.refunded': {
      const charge = event.data.object;
      const invoiceId = parseInt(charge.metadata?.miwa_invoice_id, 10);
      const therapistId = parseInt(charge.metadata?.miwa_therapist_id, 10);
      const patientId = parseInt(charge.metadata?.miwa_patient_id, 10) || null;
      if (!invoiceId || !therapistId) return { handled: false, reason: 'not_miwa_client_refund', type: event.type };
      await db.run(
        `UPDATE client_invoices
            SET status = CASE WHEN ? >= amount_cents THEN 'refunded' ELSE status END,
                refunded_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND therapist_id = ?`,
        charge.amount_refunded || 0,
        invoiceId,
        therapistId,
      );
      await insertBillingEvent(db, {
        therapistId,
        patientId,
        invoiceId,
        eventType: 'charge.refunded',
        stripeEventId: event.id,
        status: 'refunded',
      });
      return { handled: true, therapistId, type: event.type, subscriptionStatus: 'client_invoice_refunded' };
    }

    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      const dispute = event.data.object;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      await db.run(
        `UPDATE client_payments
            SET stripe_dispute_id = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE stripe_charge_id = ? OR stripe_payment_intent_id = ?`,
        dispute.id,
        `dispute_${dispute.status || 'open'}`,
        chargeId || '',
        dispute.payment_intent || '',
      );
      await insertBillingEvent(db, {
        eventType: event.type,
        stripeEventId: event.id,
        status: dispute.status || 'open',
        message: 'Client payment dispute event received.',
      });
      return { handled: true, therapistId: null, type: event.type, subscriptionStatus: `client_dispute_${dispute.status || 'open'}` };
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

router.get('/client-payments/status', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await getTherapistBillingRow(db, req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Therapist not found' });

    const eligibility = isBillingCredentialEligible(row);
    res.json({
      eligibility,
      connect: {
        account_id: row.stripe_connect_account_id || null,
        status: row.stripe_connect_status || 'not_connected',
        charges_enabled: !!row.stripe_connect_charges_enabled,
        payouts_enabled: !!row.stripe_connect_payouts_enabled,
        details_submitted: !!row.stripe_connect_details_submitted,
        last_checked_at: row.stripe_connect_last_checked_at || null,
      },
      settings: {
        billing_enabled: !!row.billing_enabled,
        default_rate_cents: row.billing_default_rate_cents || null,
        default_rate_dollars: row.billing_default_rate_cents ? dollarsFromCents(row.billing_default_rate_cents) : null,
        card_on_file_enabled: row.billing_card_on_file_enabled !== 0,
        autopay_enabled: !!row.billing_autopay_enabled,
        no_show_fee_cents: row.billing_no_show_fee_cents || null,
        no_show_fee_dollars: row.billing_no_show_fee_cents ? dollarsFromCents(row.billing_no_show_fee_cents) : null,
        policy: (() => {
          try { return JSON.parse(row.billing_policy_json || '{}'); } catch { return {}; }
        })(),
      },
      phase_guidance: {
        phase_1: 'Connect Stripe, create invoices, collect manual payments, save card with consent, issue refunds.',
        phase_2: 'Auto-invoice/autopay remains opt-in and requires client authorization.',
        phase_3: 'Superbills and insurance exports should stay separate from Stripe payment metadata.',
      },
    });
  } catch (err) {
    console.error('[billing] client-payments/status error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/client-payments/settings', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await getTherapistBillingRow(db, req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Therapist not found' });
    const eligibility = isBillingCredentialEligible(row);
    if (!eligibility.eligible) return res.status(403).json({ error: eligibility.reason });

    const defaultRate = req.body.default_rate_dollars !== undefined
      ? centsFromDollars(req.body.default_rate_dollars)
      : (req.body.default_rate_cents ? Number(req.body.default_rate_cents) : row.billing_default_rate_cents);
    const noShowFee = req.body.no_show_fee_dollars !== undefined
      ? centsFromDollars(req.body.no_show_fee_dollars)
      : (req.body.no_show_fee_cents ? Number(req.body.no_show_fee_cents) : row.billing_no_show_fee_cents);
    const policy = {
      cancellation_notice_hours: Number(req.body.cancellation_notice_hours || 24),
      refund_policy: String(req.body.refund_policy || 'Refunds are reviewed by the clinician or practice.').slice(0, 500),
      autopay_policy: String(req.body.autopay_policy || 'Card-on-file charges require client authorization.').slice(0, 500),
    };

    await db.run(
      `UPDATE therapists
          SET billing_default_rate_cents = ?,
              billing_no_show_fee_cents = ?,
              billing_card_on_file_enabled = ?,
              billing_autopay_enabled = ?,
              billing_policy_json = ?
        WHERE id = ?`,
      defaultRate || null,
      noShowFee || null,
      req.body.card_on_file_enabled === false ? 0 : 1,
      req.body.autopay_enabled === true ? 1 : 0,
      JSON.stringify(policy),
      req.therapist.id,
    );
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    console.error('[billing] client-payments/settings error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/client-payments/connect/start', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await getTherapistBillingRow(db, req.therapist.id);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found' });
    const eligibility = isBillingCredentialEligible(therapist);
    if (!eligibility.eligible) return res.status(403).json({ error: eligibility.reason });

    const stripe = getStripe();
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    let accountId = therapist.stripe_connect_account_id;
    if (!accountId) {
      const account = await createConnectedAccount(stripe, therapist);
      accountId = account.id;
      await db.run(
        `UPDATE therapists
            SET stripe_connect_account_id = ?,
                stripe_connect_status = 'created',
                stripe_connect_last_checked_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        accountId,
        req.therapist.id,
      );
      await persistIfNeeded();
    }

    const link = await createConnectOnboardingLink(stripe, accountId, appUrl);
    res.json({ url: link.url, account_id: accountId });
  } catch (err) {
    console.error('[billing] connect/start error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Could not start Stripe Connect onboarding.' });
  }
});

router.post('/client-payments/connect/refresh', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await getTherapistBillingRow(db, req.therapist.id);
    if (!row?.stripe_connect_account_id) {
      return res.status(400).json({ error: 'Stripe Connect is not connected yet.' });
    }
    const status = await refreshConnectStatus(db, getStripe(), req.therapist.id, row.stripe_connect_account_id);
    await persistIfNeeded();
    res.json({ ok: true, status });
  } catch (err) {
    console.error('[billing] connect/refresh error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Could not refresh Stripe Connect status.' });
  }
});

router.get('/client-payments/invoices', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const { status, patient_id: patientId } = req.query;
    const clauses = ['ci.therapist_id = ?'];
    const params = [req.therapist.id];
    if (status && INVOICE_STATUSES.includes(status)) {
      clauses.push('ci.status = ?');
      params.push(status);
    }
    if (patientId) {
      clauses.push('ci.patient_id = ?');
      params.push(patientId);
    }
    const invoices = await db.all(
      `SELECT ci.*, p.display_name, p.first_name, p.last_name, p.client_id
         FROM client_invoices ci
         LEFT JOIN patients p ON p.id = ci.patient_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY ci.created_at DESC
        LIMIT 100`,
      ...params,
    );
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/client-payments/invoices', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await getTherapistBillingRow(db, req.therapist.id);
    const eligibility = isBillingCredentialEligible(therapist);
    if (!eligibility.eligible) return res.status(403).json({ error: eligibility.reason });

    const amountCents = req.body.amount_cents ? Number(req.body.amount_cents) : centsFromDollars(req.body.amount_dollars);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: 'Enter a valid invoice amount.' });
    }

    let patient = null;
    if (req.body.patient_id) {
      patient = await db.get(
        'SELECT id FROM patients WHERE id = ? AND therapist_id = ?',
        req.body.patient_id,
        req.therapist.id,
      );
      if (!patient) return res.status(404).json({ error: 'Client not found.' });
    }
    if (req.body.session_id) {
      const session = await db.get(
        'SELECT id, patient_id FROM sessions WHERE id = ? AND therapist_id = ?',
        req.body.session_id,
        req.therapist.id,
      );
      if (!session) return res.status(404).json({ error: 'Session not found.' });
      if (patient && String(patient.id) !== String(session.patient_id)) {
        return res.status(400).json({ error: 'Session does not belong to the selected client.' });
      }
    }

    const invoiceNumber = makeInvoiceNumber(req.therapist.id);
    const result = await db.insert(
      `INSERT INTO client_invoices
        (therapist_id, patient_id, session_id, invoice_number, status, amount_cents, currency,
         service_date, due_date, generic_description, internal_note)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      req.therapist.id,
      req.body.patient_id || null,
      req.body.session_id || null,
      invoiceNumber,
      amountCents,
      String(req.body.currency || 'usd').toLowerCase(),
      req.body.service_date || null,
      req.body.due_date || null,
      genericStripeDescription(req.body.generic_description),
      req.body.internal_note ? String(req.body.internal_note).slice(0, 1000) : null,
    );
    const invoice = await requireInvoiceOwner(db, result.lastInsertRowid, req.therapist.id);
    await insertBillingEvent(db, {
      therapistId: req.therapist.id,
      patientId: req.body.patient_id || null,
      invoiceId: result.lastInsertRowid,
      eventType: 'invoice.created',
      status: 'open',
    });
    await persistIfNeeded();
    res.status(201).json(invoice);
  } catch (err) {
    console.error('[billing] create client invoice error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/client-payments/invoices/:id/checkout', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await getTherapistBillingRow(db, req.therapist.id);
    if (!therapist?.stripe_connect_account_id || !therapist.stripe_connect_charges_enabled) {
      return res.status(400).json({ error: 'Connect Stripe and finish payment onboarding before sending payment links.' });
    }
    const invoice = await requireInvoiceOwner(db, req.params.id, req.therapist.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (!['open', 'failed'].includes(invoice.status)) {
      return res.status(400).json({ error: `Invoice is ${invoice.status} and cannot be paid.` });
    }

    const stripe = getStripe();
    let billingProfile = invoice.patient_id
      ? await db.get(
        'SELECT * FROM client_billing_profiles WHERE therapist_id = ? AND patient_id = ?',
        req.therapist.id,
        invoice.patient_id,
      )
      : null;
    if (invoice.patient_id && !billingProfile) {
      const patient = await db.get('SELECT email FROM patients WHERE id = ? AND therapist_id = ?', invoice.patient_id, req.therapist.id);
      const customer = await stripe.customers.create(
        {
          email: req.body.billing_email || patient?.email || undefined,
          metadata: {
            miwa_patient_id: String(invoice.patient_id),
            miwa_therapist_id: String(req.therapist.id),
          },
        },
        { stripeAccount: therapist.stripe_connect_account_id },
      );
      await db.insert(
        `INSERT INTO client_billing_profiles
          (therapist_id, patient_id, billing_email, stripe_customer_id)
         VALUES (?, ?, ?, ?)`,
        req.therapist.id,
        invoice.patient_id,
        req.body.billing_email || patient?.email || null,
        customer.id,
      );
      billingProfile = await db.get(
        'SELECT * FROM client_billing_profiles WHERE therapist_id = ? AND patient_id = ?',
        req.therapist.id,
        invoice.patient_id,
      );
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: billingProfile?.stripe_customer_id || undefined,
        customer_email: billingProfile?.stripe_customer_id ? undefined : (req.body.billing_email || invoice.patient_email || undefined),
        line_items: [{
          price_data: {
            currency: invoice.currency || 'usd',
            unit_amount: invoice.amount_cents,
            product_data: {
              name: genericStripeDescription(invoice.generic_description),
              metadata: { miwa_kind: 'client_payment' },
            },
          },
          quantity: 1,
        }],
        success_url: `${appUrl}/billing?client_payment=success&invoice=${invoice.id}`,
        cancel_url: `${appUrl}/billing?client_payment=canceled&invoice=${invoice.id}`,
        payment_intent_data: {
          metadata: {
            miwa_invoice_id: String(invoice.id),
            miwa_therapist_id: String(req.therapist.id),
            miwa_patient_id: invoice.patient_id ? String(invoice.patient_id) : '',
          },
        },
        metadata: {
          miwa_invoice_id: String(invoice.id),
          miwa_therapist_id: String(req.therapist.id),
          miwa_patient_id: invoice.patient_id ? String(invoice.patient_id) : '',
        },
        allow_promotion_codes: false,
      },
      { stripeAccount: therapist.stripe_connect_account_id },
    );

    await db.run(
      `UPDATE client_invoices
          SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND therapist_id = ?`,
      session.id,
      invoice.id,
      req.therapist.id,
    );
    await insertBillingEvent(db, {
      therapistId: req.therapist.id,
      patientId: invoice.patient_id,
      invoiceId: invoice.id,
      eventType: 'checkout.created',
      status: 'open',
    });
    await persistIfNeeded();
    res.json({ url: session.url, checkout_session_id: session.id });
  } catch (err) {
    console.error('[billing] invoice checkout error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Could not create payment link.' });
  }
});

router.post('/client-payments/patients/:patientId/setup-link', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await getTherapistBillingRow(db, req.therapist.id);
    if (!therapist?.stripe_connect_account_id || !therapist.stripe_connect_charges_enabled) {
      return res.status(400).json({ error: 'Connect Stripe before saving client cards.' });
    }
    if (therapist.billing_card_on_file_enabled === 0) {
      return res.status(400).json({ error: 'Card-on-file is disabled in billing settings.' });
    }
    const patient = await db.get(
      'SELECT id, email FROM patients WHERE id = ? AND therapist_id = ?',
      req.params.patientId,
      req.therapist.id,
    );
    if (!patient) return res.status(404).json({ error: 'Client not found.' });

    const stripe = getStripe();
    let profile = await db.get(
      'SELECT * FROM client_billing_profiles WHERE therapist_id = ? AND patient_id = ?',
      req.therapist.id,
      patient.id,
    );
    if (!profile) {
      const customer = await stripe.customers.create(
        {
          email: req.body.billing_email || patient.email || undefined,
          metadata: {
            miwa_patient_id: String(patient.id),
            miwa_therapist_id: String(req.therapist.id),
          },
        },
        { stripeAccount: therapist.stripe_connect_account_id },
      );
      await db.insert(
        `INSERT INTO client_billing_profiles
          (therapist_id, patient_id, billing_email, stripe_customer_id)
         VALUES (?, ?, ?, ?)`,
        req.therapist.id,
        patient.id,
        req.body.billing_email || patient.email || null,
        customer.id,
      );
      profile = await db.get(
        'SELECT * FROM client_billing_profiles WHERE therapist_id = ? AND patient_id = ?',
        req.therapist.id,
        patient.id,
      );
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'setup',
        customer: profile.stripe_customer_id,
        success_url: `${appUrl}/billing?card_setup=success&patient=${patient.id}`,
        cancel_url: `${appUrl}/billing?card_setup=canceled&patient=${patient.id}`,
        setup_intent_data: {
          metadata: {
            miwa_patient_id: String(patient.id),
            miwa_therapist_id: String(req.therapist.id),
          },
        },
        metadata: {
          miwa_patient_id: String(patient.id),
          miwa_therapist_id: String(req.therapist.id),
        },
      },
      { stripeAccount: therapist.stripe_connect_account_id },
    );
    await insertBillingEvent(db, {
      therapistId: req.therapist.id,
      patientId: patient.id,
      eventType: 'card_setup.created',
      status: 'pending',
      meta: { consent_required: true },
    });
    await persistIfNeeded();
    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing] setup-link error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Could not create card setup link.' });
  }
});

router.post('/client-payments/invoices/:id/charge-card', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await getTherapistBillingRow(db, req.therapist.id);
    if (!therapist?.stripe_connect_account_id || !therapist.stripe_connect_charges_enabled) {
      return res.status(400).json({ error: 'Connect Stripe before charging cards.' });
    }
    const invoice = await requireInvoiceOwner(db, req.params.id, req.therapist.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (!invoice.patient_id) return res.status(400).json({ error: 'Card-on-file charges require a linked client.' });
    if (!['open', 'failed'].includes(invoice.status)) {
      return res.status(400).json({ error: `Invoice is ${invoice.status} and cannot be charged.` });
    }
    const profile = await db.get(
      `SELECT * FROM client_billing_profiles
        WHERE therapist_id = ? AND patient_id = ?
          AND card_on_file_authorized = 1
          AND default_payment_method_id IS NOT NULL`,
      req.therapist.id,
      invoice.patient_id,
    );
    if (!profile) return res.status(400).json({ error: 'No authorized card on file for this client.' });

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create(
      {
        amount: invoice.amount_cents,
        currency: invoice.currency || 'usd',
        customer: profile.stripe_customer_id,
        payment_method: profile.default_payment_method_id,
        off_session: true,
        confirm: true,
        description: genericStripeDescription(invoice.generic_description),
        metadata: {
          miwa_invoice_id: String(invoice.id),
          miwa_therapist_id: String(req.therapist.id),
          miwa_patient_id: String(invoice.patient_id),
        },
      },
      { stripeAccount: therapist.stripe_connect_account_id },
    );
    await db.run(
      `UPDATE client_invoices
          SET status = ?, stripe_payment_intent_id = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      intent.status === 'succeeded' ? 'paid' : 'open',
      intent.id,
      intent.status === 'succeeded' ? 'paid' : 'open',
      invoice.id,
    );
    await db.insert(
      `INSERT INTO client_payments
        (therapist_id, patient_id, invoice_id, stripe_account_id, stripe_payment_intent_id, amount_cents, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.therapist.id,
      invoice.patient_id,
      invoice.id,
      therapist.stripe_connect_account_id,
      intent.id,
      invoice.amount_cents,
      invoice.currency || 'usd',
      intent.status === 'succeeded' ? 'succeeded' : intent.status,
    );
    await insertBillingEvent(db, {
      therapistId: req.therapist.id,
      patientId: invoice.patient_id,
      invoiceId: invoice.id,
      eventType: 'payment_intent.created',
      status: intent.status,
    });
    await persistIfNeeded();
    res.json({ ok: true, status: intent.status });
  } catch (err) {
    console.error('[billing] charge-card error:', sanitizeStripeError(err));
    res.status(402).json({ error: 'Card charge failed. Review the client payment method or send a manual payment link.' });
  }
});

router.post('/client-payments/invoices/:id/refund', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await getTherapistBillingRow(db, req.therapist.id);
    const invoice = await requireInvoiceOwner(db, req.params.id, req.therapist.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (!invoice.stripe_payment_intent_id) {
      return res.status(400).json({ error: 'This invoice does not have a Stripe payment to refund.' });
    }
    const amountCents = req.body.amount_cents ? Number(req.body.amount_cents) : centsFromDollars(req.body.amount_dollars);
    const refundPayload = {
      payment_intent: invoice.stripe_payment_intent_id,
      reason: ['duplicate', 'fraudulent', 'requested_by_customer'].includes(req.body.reason)
        ? req.body.reason
        : 'requested_by_customer',
      metadata: {
        miwa_invoice_id: String(invoice.id),
        miwa_therapist_id: String(req.therapist.id),
        miwa_refund_reason: String(req.body.internal_reason || 'service_adjustment').slice(0, 80),
      },
    };
    if (Number.isInteger(amountCents) && amountCents > 0) refundPayload.amount = amountCents;

    const refund = await getStripe().refunds.create(refundPayload, {
      stripeAccount: therapist.stripe_connect_account_id,
    });
    await db.run(
      `UPDATE client_invoices
          SET status = CASE WHEN ? >= amount_cents OR ? IS NULL THEN 'refunded' ELSE status END,
              refunded_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      amountCents || invoice.amount_cents,
      amountCents || null,
      invoice.id,
    );
    await db.insert(
      `INSERT INTO client_payments
        (therapist_id, patient_id, invoice_id, stripe_account_id, stripe_payment_intent_id, stripe_refund_id,
         amount_cents, refunded_cents, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'refunded')`,
      req.therapist.id,
      invoice.patient_id,
      invoice.id,
      therapist.stripe_connect_account_id,
      invoice.stripe_payment_intent_id,
      refund.id,
      invoice.amount_cents,
      refund.amount || amountCents || invoice.amount_cents,
      invoice.currency || 'usd',
    );
    await insertBillingEvent(db, {
      therapistId: req.therapist.id,
      patientId: invoice.patient_id,
      invoiceId: invoice.id,
      eventType: 'refund.created',
      status: refund.status,
    });
    await persistIfNeeded();
    res.json({ ok: true, refund_status: refund.status });
  } catch (err) {
    console.error('[billing] refund error:', sanitizeStripeError(err));
    res.status(500).json({ error: 'Could not create refund.' });
  }
});

router.get('/client-payments/disputes', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT cp.*, ci.invoice_number, ci.generic_description, p.display_name, p.client_id
         FROM client_payments cp
         LEFT JOIN client_invoices ci ON ci.id = cp.invoice_id
         LEFT JOIN patients p ON p.id = cp.patient_id
        WHERE cp.therapist_id = ? AND cp.stripe_dispute_id IS NOT NULL
        ORDER BY cp.updated_at DESC, cp.created_at DESC
        LIMIT 50`,
      req.therapist.id,
    );
    res.json({
      disputes: rows,
      guidance: [
        'Clinician or practice owns refund and dispute decisions.',
        'Keep evidence generic in Stripe: invoice, authorization, payment policy acknowledgement, appointment date.',
        'Do not submit clinical notes, diagnoses, or PHI unless legal counsel has approved the disclosure.',
      ],
    });
  } catch (err) {
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
