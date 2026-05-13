const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = 'sk_test_payment_flow';
process.env.STRIPE_PRICE_TRAINEE = 'price_trainee_smoke';
process.env.STRIPE_PRICE_ASSOCIATE = 'price_associate_smoke';
process.env.STRIPE_PRICE_SOLO = 'price_solo_smoke';
process.env.STRIPE_PRICE_GROUP_BASE = 'price_group_base_smoke';
process.env.STRIPE_PRICE_GROUP_PER_SEAT = 'price_group_seat_smoke';

const stripeState = {
  customers: [],
  sessions: [],
};

const stripeMock = {
  customers: {
    create: async (payload) => {
      const customer = { id: `cus_smoke_${stripeState.customers.length + 1}`, ...payload };
      stripeState.customers.push(customer);
      return customer;
    },
  },
  checkout: {
    sessions: {
      create: async (payload) => {
        const session = {
          id: `cs_smoke_${stripeState.sessions.length + 1}`,
          url: `https://checkout.stripe.test/session/${stripeState.sessions.length + 1}`,
          ...payload,
        };
        stripeState.sessions.push(session);
        return session;
      },
    },
  },
};

require.cache[require.resolve('stripe')] = {
  id: require.resolve('stripe'),
  filename: require.resolve('stripe'),
  loaded: true,
  exports: () => stripeMock,
};

const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

test('subscription checkout creates Stripe customers and sessions for purchasable tiers', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const tiers = [
    ['trainee', 'price_trainee_smoke'],
    ['associate', 'price_associate_smoke'],
    ['solo', 'price_solo_smoke'],
  ];

  for (const [plan, expectedPrice] of tiers) {
    await t.test(`creates checkout for ${plan}`, async () => {
      const { cookie, therapist } = await bootstrapAdminAndLogin({
        email: `payment-${plan}@miwa.test`,
        password: 'test-password-1234',
      });

      const res = await api('POST', '/api/billing/checkout', { plan }, cookie);
      assert.equal(res.status, 200);
      assert.match(res.body.url, /^https:\/\/checkout\.stripe\.test\/session\//);

      const row = await getAsyncDb().get(
        'SELECT stripe_customer_id, stripe_subscription_id, subscription_tier FROM therapists WHERE id = ?',
        therapist.id,
      );
      assert.match(row.stripe_customer_id, /^cus_smoke_/);
      assert.equal(row.stripe_subscription_id, null);
      assert.equal(row.subscription_tier, null);

      const session = stripeState.sessions.at(-1);
      assert.equal(session.customer, row.stripe_customer_id);
      assert.deepEqual(session.line_items, [{ price: expectedPrice, quantity: 1 }]);
      assert.equal(session.subscription_data.metadata.therapist_id, String(therapist.id));
      assert.equal(session.subscription_data.metadata.plan, plan);
    });
  }
});

test('subscription checkout validates plan names and rejects group from self-serve checkout', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'payment-validation@miwa.test',
    password: 'test-password-1234',
  });

  const invalid = await api('POST', '/api/billing/checkout', { plan: 'family' }, cookie);
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /Invalid plan/);

  const group = await api('POST', '/api/billing/checkout', {
    plan: 'group',
    additionalSeats: 2,
  }, cookie);
  assert.equal(group.status, 400);
  assert.match(group.body.error, /Invalid plan/);
  assert.equal(group.body.error.includes('group'), false);
});
