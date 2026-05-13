const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

const TIERS = [
  {
    credential_type: 'trainee',
    email: 'signup-trainee@example.test',
    extra: { school_email: 'signup-trainee@university.test' },
  },
  {
    credential_type: 'associate',
    email: 'signup-associate@example.test',
    extra: { credential_number: 'AMFT123456' },
  },
  {
    credential_type: 'licensed',
    email: 'signup-licensed@example.test',
    extra: { credential_number: 'LMFT123456' },
  },
];

test('signup creates each clinician tier with safe verification response', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const db = getAsyncDb();

  for (const tier of TIERS) {
    await t.test(`registers ${tier.credential_type}`, async () => {
      const res = await api('POST', '/api/auth/register', {
        email: tier.email,
        password: 'password1234',
        first_name: 'Smoke',
        last_name: tier.credential_type,
        credential_type: tier.credential_type,
        ...tier.extra,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.pendingVerification, true);
      assert.match(res.body.message, /verification link/i);
      assert.equal(res.cookie, null);

      const row = await db.get(
        `SELECT email, credential_type, user_role, school_email, credential_number,
                password_hash, subscription_tier
           FROM therapists
          WHERE email = ?`,
        tier.email,
      );
      assert.ok(row);
      assert.equal(row.credential_type, tier.credential_type);
      assert.equal(row.user_role, tier.credential_type);
      assert.equal(row.subscription_tier, null);
      assert.notEqual(row.password_hash, 'password1234');

      if (tier.credential_type === 'trainee') {
        assert.equal(row.school_email, tier.extra.school_email);
      } else {
        assert.equal(row.credential_number, tier.extra.credential_number);
      }

      const responseText = JSON.stringify(res.body);
      assert.equal(responseText.includes('password1234'), false);
      assert.equal(responseText.includes('credential_number'), false);
      assert.equal(responseText.includes('school_email'), false);
      assert.equal(responseText.includes('LMFT123456'), false);
      assert.equal(responseText.includes('AMFT123456'), false);
    });
  }
});
