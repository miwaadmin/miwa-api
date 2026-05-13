const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = 'sk_test_webhook_rate_limit';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_webhook_rate_limit';
process.env.WEBHOOK_RATE_LIMIT_MAX = '3';

const stripeMock = {
  webhooks: {
    constructEvent: () => {
      throw Object.assign(new Error('bad signature'), { type: 'StripeSignatureVerificationError' });
    },
  },
};

require.cache[require.resolve('stripe')] = {
  id: require.resolve('stripe'),
  filename: require.resolve('stripe'),
  loaded: true,
  exports: () => stripeMock,
};

const { startTestServer, stopTestServer } = require('./_helpers');

async function postWebhook() {
  const baseUrl = await startTestServer();
  return fetch(`${baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'invalid-signature',
    },
    body: JSON.stringify({
      id: 'evt_rate_limit_probe',
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_rate_limit_probe' } },
    }),
  });
}

test('Stripe webhook has a dedicated rate limit', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const responses = [];
  for (let i = 0; i < 4; i += 1) {
    responses.push(await postWebhook());
  }

  assert.deepEqual(responses.slice(0, 3).map((res) => res.status), [400, 400, 400]);
  assert.equal(responses[3].status, 429);
  assert.deepEqual(await responses[3].json(), { error: 'Webhook rate limit exceeded' });
});
