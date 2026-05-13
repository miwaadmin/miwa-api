const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = 'sk_test_webhook_flow';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_webhook_flow';

const stripeState = {
  constructed: [],
};

const stripeMock = {
  webhooks: {
    constructEvent: (payload, sig, secret) => {
      if (secret !== 'whsec_webhook_flow' || sig !== 'valid-signature') {
        throw Object.assign(new Error('bad signature'), { type: 'StripeSignatureVerificationError' });
      }
      const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
      const event = JSON.parse(text);
      stripeState.constructed.push(event);
      return event;
    },
  },
};

require.cache[require.resolve('stripe')] = {
  id: require.resolve('stripe'),
  filename: require.resolve('stripe'),
  loaded: true,
  exports: () => stripeMock,
};

const { startTestServer, stopTestServer, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');
const billingRouter = require('../../routes/billing');

async function postWebhook(event, signature = 'valid-signature') {
  const baseUrl = await startTestServer();
  const res = await fetch(`${baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: JSON.stringify(event),
  });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

test('Stripe webhook validates signatures before processing', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { therapist } = await bootstrapAdminAndLogin({
    email: 'webhook-signature@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run('UPDATE therapists SET stripe_customer_id = ? WHERE id = ?', 'cus_webhook_sig', therapist.id);

  const invalid = await postWebhook({
    id: 'evt_invalid_signature',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_invalid', customer: 'cus_webhook_sig', status: 'active', metadata: { plan: 'solo' } } },
  }, 'invalid-signature');
  assert.equal(invalid.status, 400);

  let row = await db.get('SELECT subscription_status, stripe_subscription_id FROM therapists WHERE id = ?', therapist.id);
  assert.notEqual(row.subscription_status, 'active');
  assert.equal(row.stripe_subscription_id, null);

  const valid = await postWebhook({
    id: 'evt_valid_signature',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_valid', customer: 'cus_webhook_sig', status: 'active', metadata: { plan: 'solo' } } },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.received, true);

  row = await db.get('SELECT subscription_status, subscription_tier, stripe_subscription_id FROM therapists WHERE id = ?', therapist.id);
  assert.equal(row.subscription_status, 'active');
  assert.equal(row.subscription_tier, 'solo');
  assert.equal(row.stripe_subscription_id, 'sub_valid');
});

test('Stripe webhook handles checkout and subscription lifecycle events', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { therapist } = await bootstrapAdminAndLogin({
    email: 'webhook-lifecycle@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run('UPDATE therapists SET stripe_customer_id = ? WHERE id = ?', 'cus_webhook_lifecycle', therapist.id);

  const patient = await db.insert(
    'INSERT INTO patients (client_id, display_name, therapist_id) VALUES (?, ?, ?)',
    'WEBHOOK-001',
    'Webhook Client',
    therapist.id,
  );
  const invoice = await db.insert(
    `INSERT INTO client_invoices
       (therapist_id, patient_id, invoice_number, status, amount_cents, generic_description)
     VALUES (?, ?, ?, 'open', 12900, 'Professional services')`,
    therapist.id,
    patient.lastInsertRowid,
    `MIWA-${therapist.id}-WEBHOOK`,
  );

  const checkout = await postWebhook({
    id: 'evt_checkout_completed',
    type: 'checkout.session.completed',
    account: 'acct_webhook_connected',
    data: {
      object: {
        id: 'cs_webhook_paid',
        mode: 'payment',
        payment_intent: 'pi_webhook_paid',
        amount_total: 12900,
        currency: 'usd',
        metadata: {
          miwa_invoice_id: String(invoice.lastInsertRowid),
          miwa_therapist_id: String(therapist.id),
          miwa_patient_id: String(patient.lastInsertRowid),
        },
      },
    },
  });
  assert.equal(checkout.status, 200);

  let invoiceRow = await db.get('SELECT status, stripe_payment_intent_id FROM client_invoices WHERE id = ?', invoice.lastInsertRowid);
  assert.equal(invoiceRow.status, 'paid');
  assert.equal(invoiceRow.stripe_payment_intent_id, 'pi_webhook_paid');

  const updated = await postWebhook({
    id: 'evt_subscription_updated',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_lifecycle', customer: 'cus_webhook_lifecycle', status: 'active', metadata: { plan: 'associate' } } },
  });
  assert.equal(updated.status, 200);
  let therapistRow = await db.get('SELECT subscription_status, subscription_tier, stripe_subscription_id FROM therapists WHERE id = ?', therapist.id);
  assert.equal(therapistRow.subscription_status, 'active');
  assert.equal(therapistRow.subscription_tier, 'associate');
  assert.equal(therapistRow.stripe_subscription_id, 'sub_lifecycle');

  const deleted = await postWebhook({
    id: 'evt_subscription_deleted',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_lifecycle', customer: 'cus_webhook_lifecycle', status: 'canceled', metadata: { plan: 'associate' } } },
  });
  assert.equal(deleted.status, 200);
  therapistRow = await db.get('SELECT subscription_status, subscription_tier, stripe_subscription_id FROM therapists WHERE id = ?', therapist.id);
  assert.equal(therapistRow.subscription_status, 'expired');
  assert.equal(therapistRow.subscription_tier, null);
  assert.equal(therapistRow.stripe_subscription_id, null);
});

test('Stripe webhook ignores duplicate event ids after first processing', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { therapist } = await bootstrapAdminAndLogin({
    email: 'webhook-duplicate@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);

  const patient = await db.insert(
    'INSERT INTO patients (client_id, display_name, therapist_id) VALUES (?, ?, ?)',
    'DUP-001',
    'Duplicate Webhook Client',
    therapist.id,
  );
  const invoice = await db.insert(
    `INSERT INTO client_invoices
       (therapist_id, patient_id, invoice_number, status, amount_cents, generic_description)
     VALUES (?, ?, ?, 'open', 9900, 'Professional services')`,
    therapist.id,
    patient.lastInsertRowid,
    `MIWA-${therapist.id}-DUP`,
  );

  const event = {
    id: 'evt_duplicate_checkout',
    type: 'checkout.session.completed',
    account: 'acct_duplicate_connected',
    data: {
      object: {
        id: 'cs_duplicate_paid',
        mode: 'payment',
        payment_intent: 'pi_duplicate_paid',
        amount_total: 9900,
        currency: 'usd',
        metadata: {
          miwa_invoice_id: String(invoice.lastInsertRowid),
          miwa_therapist_id: String(therapist.id),
          miwa_patient_id: String(patient.lastInsertRowid),
        },
      },
    },
  };

  const first = await postWebhook(event);
  const second = await postWebhook(event);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const payments = await db.get(
    'SELECT COUNT(*) AS count FROM client_payments WHERE invoice_id = ?',
    invoice.lastInsertRowid,
  );
  assert.equal(payments.count, 1);

  const tracked = await db.get(
    'SELECT status, processed_at FROM stripe_webhook_events WHERE stripe_event_id = ?',
    event.id,
  );
  assert.equal(tracked.status, 'processed');
  assert.ok(tracked.processed_at);
});

test('Stripe webhook handler exceptions return 500 and mark event failed', async (t) => {
  await startTestServer();
  t.after(() => {
    billingRouter._test._forceHandlerError(null);
    return stopTestServer();
  });

  billingRouter._test._forceHandlerError(Object.assign(new Error('forced webhook handler failure'), { code: 'forced_test' }));
  const db = getAsyncDb();

  const res = await postWebhook({
    id: 'evt_forced_handler_failure',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_forced_failure', customer: 'cus_forced_failure', status: 'active', metadata: { plan: 'solo' } } },
  });

  assert.equal(res.status, 500);
  assert.match(res.body, /Webhook handler error/);

  const tracked = await db.get(
    'SELECT status, error_message FROM stripe_webhook_events WHERE stripe_event_id = ?',
    'evt_forced_handler_failure',
  );
  assert.equal(tracked.status, 'failed');
  assert.match(tracked.error_message, /forced_test/);
  assert.equal(tracked.error_message.includes('forced webhook handler failure'), false);
});

test('Stripe webhook signature failures are written to event_logs', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const db = getAsyncDb();
  const res = await postWebhook({
    id: 'evt_audit_signature_failure',
    type: 'customer.subscription.updated',
    data: { object: { customer: 'cus_should_not_process' } },
  }, 'invalid-signature-for-audit-test');

  assert.equal(res.status, 400);

  const audit = await db.get(
    `SELECT event_type, status, meta_json
       FROM event_logs
      WHERE event_type = 'stripe_webhook_signature_failure'
      ORDER BY id DESC
      LIMIT 1`,
  );
  assert.equal(audit.event_type, 'stripe_webhook_signature_failure');
  assert.equal(audit.status, 'blocked');
  const meta = JSON.parse(audit.meta_json);
  assert.equal(meta.signature_prefix, 'invalid-signature-fo...');
  assert.match(meta.error, /StripeSignatureVerificationError/);
});
