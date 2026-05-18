const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

test('credential tier self-service billing gates', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const db = getAsyncDb();
  const { therapist, cookie, adminCookie } = await bootstrapAdminAndLogin({
    email: 'tier-gate-admin@miwa.test',
    password: 'test-password-1234',
  });

  async function setTier(fields) {
    await db.run(
      `UPDATE therapists
          SET credential_type = ?,
              user_role = ?,
              subscription_status = ?,
              subscription_tier = ?,
              subscription_trial_end = ?
        WHERE id = ?`,
      fields.credential_type,
      fields.credential_type,
      fields.subscription_status || 'trial',
      fields.subscription_tier || null,
      fields.subscription_trial_end || null,
      therapist.id,
    );
  }

  await t.test('trainee cannot self-upgrade to associate without subscription', async () => {
    await setTier({ credential_type: 'trainee' });
    const res = await api('POST', '/api/settings', { key: 'credential_type', value: 'associate' }, cookie);
    assert.equal(res.status, 402);
    assert.equal(res.body.error, 'upgrade_required');
    assert.equal(res.body.upgrade_path, '/settings/billing');
  });

  await t.test('trainee with active associate Stripe subscription can upgrade', async () => {
    await setTier({ credential_type: 'trainee', subscription_status: 'active', subscription_tier: 'associate' });
    const res = await api('POST', '/api/settings', { key: 'credential_type', value: 'associate' }, cookie);
    assert.equal(res.status, 200);
    const row = await db.get('SELECT credential_type FROM therapists WHERE id = ?', therapist.id);
    assert.equal(row.credential_type, 'associate');
  });

  await t.test('trainee with active associate trial can upgrade', async () => {
    await setTier({
      credential_type: 'trainee',
      subscription_status: 'trial',
      subscription_tier: 'associate',
      subscription_trial_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const res = await api('POST', '/api/settings', { key: 'account_stage', value: 'associate' }, cookie);
    assert.equal(res.status, 200);
  });

  await t.test('associate cannot self-downgrade to trainee', async () => {
    await setTier({ credential_type: 'associate', subscription_status: 'active', subscription_tier: 'associate' });
    const res = await api('POST', '/api/settings', { key: 'credential_type', value: 'trainee' }, cookie);
    assert.equal(res.status, 403);
  });

  await t.test('licensed cannot self-change credential_type', async () => {
    await setTier({ credential_type: 'licensed', subscription_status: 'active', subscription_tier: 'solo' });
    const res = await api('POST', '/api/settings', { key: 'credential_type', value: 'associate' }, cookie);
    assert.equal(res.status, 403);
  });

  await t.test('admin route can override credential_type', async () => {
    const res = await api('PATCH', `/api/admin/therapists/${therapist.id}`, { credential_type: 'associate' }, adminCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.credential_type, 'associate');
  });

  await t.test('credential changes write event_logs', async () => {
    await setTier({ credential_type: 'trainee', subscription_status: 'active', subscription_tier: 'associate' });
    const res = await api('POST', '/api/settings', { key: 'credential_type', value: 'associate' }, cookie);
    assert.equal(res.status, 200);
    const log = await db.get(
      `SELECT event_type, meta_json
         FROM event_logs
        WHERE therapist_id = ? AND event_type = 'credential_tier_changed'
        ORDER BY id DESC
        LIMIT 1`,
      therapist.id,
    );
    assert.equal(log.event_type, 'credential_tier_changed');
    assert.match(log.meta_json, /associate/);
  });
});
