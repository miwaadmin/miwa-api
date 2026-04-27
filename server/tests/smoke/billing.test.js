const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_miwa_smoke';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_miwa_smoke';

const {
  startTestServer,
  stopTestServer,
  api,
  bootstrapAdminAndLogin,
} = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');
const billingRouter = require('../../routes/billing');

test.after(async () => {
  await stopTestServer();
});

test('billing status returns a safe trial shape for a logged-in therapist', async () => {
  await startTestServer();
  const { cookie } = await bootstrapAdminAndLogin({
    email: 'billing-status@miwa.test',
    password: 'test-password-1234',
  });

  const res = await api('GET', '/api/billing/status', null, cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.subscription_status, 'trial');
  assert.equal(res.body.is_trial, true);
  assert.equal(typeof res.body.trial_remaining, 'number');
});

test('admin Stripe status does not expose secrets when Stripe cannot be verified', async () => {
  await startTestServer();
  const { adminCookie } = await bootstrapAdminAndLogin({
    email: 'stripe-admin@miwa.test',
    password: 'test-password-1234',
  });

  const res = await api('GET', '/api/admin/stripe/status', null, adminCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'stripe');
  assert.equal(res.body.mode, 'test');
  assert.equal(res.body.configured, true);
  assert.equal(JSON.stringify(res.body).includes(process.env.STRIPE_SECRET_KEY), false);
  assert.equal(JSON.stringify(res.body).includes(process.env.STRIPE_WEBHOOK_SECRET), false);
});

test('Stripe webhook handler applies subscription lifecycle updates', async () => {
  await startTestServer();
  const { therapist } = await bootstrapAdminAndLogin({
    email: 'stripe-webhook@miwa.test',
    password: 'test-password-1234',
  });

  const db = getAsyncDb();
  await db.run('UPDATE therapists SET stripe_customer_id = ? WHERE id = ?', 'cus_miwa_smoke', therapist.id);

  await billingRouter._test.handleStripeEvent(db, {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_miwa_smoke',
        customer: 'cus_miwa_smoke',
        status: 'active',
        metadata: { plan: 'solo' },
      },
    },
  });

  let row = await db.get(
    'SELECT subscription_status, subscription_tier, stripe_subscription_id FROM therapists WHERE id = ?',
    therapist.id,
  );
  assert.equal(row.subscription_status, 'active');
  assert.equal(row.subscription_tier, 'solo');
  assert.equal(row.stripe_subscription_id, 'sub_miwa_smoke');

  await billingRouter._test.handleStripeEvent(db, {
    type: 'invoice.payment_failed',
    data: { object: { customer: 'cus_miwa_smoke' } },
  });
  row = await db.get('SELECT subscription_status FROM therapists WHERE id = ?', therapist.id);
  assert.equal(row.subscription_status, 'past_due');

  await billingRouter._test.handleStripeEvent(db, {
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_miwa_smoke',
        customer: 'cus_miwa_smoke',
        status: 'canceled',
        metadata: { plan: 'solo' },
      },
    },
  });
  row = await db.get(
    'SELECT subscription_status, subscription_tier, stripe_subscription_id FROM therapists WHERE id = ?',
    therapist.id,
  );
  assert.equal(row.subscription_status, 'expired');
  assert.equal(row.subscription_tier, null);
  assert.equal(row.stripe_subscription_id, null);
});

test('Stripe webhook rejects unsigned payloads without leaking payload content', async () => {
  await startTestServer();
  const payload = JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: { customer: 'cus_secret_payload', metadata: { therapist_id: '123' } } },
  });

  const res = await fetch(`${await startTestServer()}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  const text = await res.text();
  assert.equal(res.status, 400);
  assert.match(text, /Webhook signature verification failed/);
  assert.equal(text.includes('cus_secret_payload'), false);
});
