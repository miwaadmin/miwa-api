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
  assert.ok(res.body.prices.every((price) => typeof price.status === 'string'));
  assert.ok(res.body.prices.every((price) => typeof price.review_reason === 'string'));
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

test('client payment status blocks trainee and associate direct billing but allows licensed clinicians', async () => {
  await startTestServer();
  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'client-billing-licensed@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);

  let res = await api('GET', '/api/billing/client-payments/status', null, cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.eligibility.eligible, true);
  assert.equal(res.body.connect.status, 'not_connected');

  await db.run("UPDATE therapists SET credential_type = 'trainee' WHERE id = ?", therapist.id);
  res = await api('POST', '/api/billing/client-payments/settings', {
    default_rate_dollars: 125,
  }, cookie);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Trainee accounts cannot collect client payments directly/);

  await db.run("UPDATE therapists SET credential_type = 'associate' WHERE id = ?", therapist.id);
  res = await api('POST', '/api/billing/client-payments/settings', {
    default_rate_dollars: 125,
  }, cookie);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Associate accounts cannot connect their own Stripe account/);
});

test('client invoice creation stores generic Stripe-visible billing data', async () => {
  await startTestServer();
  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'client-invoice@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);

  const patientRes = await api('POST', '/api/patients', {
    first_name: 'Billing',
    last_name: 'Client',
    display_name: 'Billing Client',
    email: 'client@example.test',
    presenting_concerns: 'panic symptoms',
  }, cookie);
  assert.equal(patientRes.status, 201);

  const invoiceRes = await api('POST', '/api/billing/client-payments/invoices', {
    patient_id: patientRes.body.id,
    amount_dollars: 150,
    service_date: '2026-04-30',
    generic_description: 'Professional services',
    internal_note: 'Internal note can reference the appointment context but is never sent to Stripe.',
  }, cookie);
  assert.equal(invoiceRes.status, 201);
  assert.equal(invoiceRes.body.amount_cents, 15000);
  assert.equal(invoiceRes.body.status, 'open');
  assert.equal(invoiceRes.body.generic_description, 'Professional services');
  assert.ok(invoiceRes.body.invoice_number.startsWith(`MIWA-${therapist.id}-`));
});

test('client payment webhook marks invoices paid', async () => {
  await startTestServer();
  const { therapist } = await bootstrapAdminAndLogin({
    email: 'client-payment-webhook@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);
  const patientInsert = await db.insert(
    `INSERT INTO patients (client_id, display_name, therapist_id) VALUES (?, ?, ?)`,
    'PAY-001',
    'Payment Client',
    therapist.id,
  );
  const invoiceInsert = await db.insert(
    `INSERT INTO client_invoices
      (therapist_id, patient_id, invoice_number, status, amount_cents, generic_description)
     VALUES (?, ?, ?, 'open', 15000, 'Professional services')`,
    therapist.id,
    patientInsert.lastInsertRowid,
    `MIWA-${therapist.id}-TEST`,
  );

  await billingRouter._test.handleStripeEvent(db, {
    id: 'evt_client_payment_paid',
    type: 'checkout.session.completed',
    account: 'acct_connected_test',
    data: {
      object: {
        id: 'cs_test_client',
        mode: 'payment',
        payment_intent: 'pi_client_paid',
        amount_total: 15000,
        currency: 'usd',
        metadata: {
          miwa_invoice_id: String(invoiceInsert.lastInsertRowid),
          miwa_therapist_id: String(therapist.id),
          miwa_patient_id: String(patientInsert.lastInsertRowid),
        },
      },
    },
  });

  const invoice = await db.get('SELECT status, stripe_payment_intent_id, paid_at FROM client_invoices WHERE id = ?', invoiceInsert.lastInsertRowid);
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.stripe_payment_intent_id, 'pi_client_paid');
  assert.ok(invoice.paid_at);

  const payment = await db.get('SELECT status, stripe_account_id, amount_cents FROM client_payments WHERE invoice_id = ?', invoiceInsert.lastInsertRowid);
  assert.equal(payment.status, 'succeeded');
  assert.equal(payment.stripe_account_id, 'acct_connected_test');
  assert.equal(payment.amount_cents, 15000);
});
