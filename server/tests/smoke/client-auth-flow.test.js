const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

async function createLicensedClinician(email) {
  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email,
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);
  return { cookie, therapist, db };
}

async function createPatient(cookie, suffix) {
  const res = await api('POST', '/api/patients', {
    first_name: `Client${suffix}`,
    last_name: 'Portal',
    email: `client-auth-${suffix}@example.test`,
  }, cookie);
  assert.equal(res.status, 201);
  return res.body;
}

async function generateInvite(cookie, patientId) {
  const res = await api('POST', '/api/client-invites', { patient_id: patientId }, cookie);
  assert.equal(res.status, 201);
  return res.body.invite;
}

async function redeem(code, email) {
  return api('POST', '/api/client-auth/redeem', {
    code,
    email,
    password: 'client-password-1234',
    first_name: 'Portal',
    last_name: 'Client',
  });
}

test('client portal redeem creates account, links patient, returns token, and hides invalid code state', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist, db } = await createLicensedClinician('client-auth-flow@miwa.test');

  const patient = await createPatient(cookie, 'happy');
  const invite = await generateInvite(cookie, patient.id);
  const happy = await redeem(invite.code, 'happy-client@example.test');
  assert.equal(happy.status, 200);
  assert.ok(happy.body.token);
  assert.ok(happy.cookie.includes('miwa_client_auth='));
  assert.equal(happy.body.client.patient_id, patient.id);
  assert.equal(happy.body.client.therapist_id, therapist.id);

  const account = await db.get('SELECT * FROM client_portal_accounts WHERE lower(email) = lower(?)', 'happy-client@example.test');
  assert.equal(account.patient_id, patient.id);
  assert.equal(account.linked_patient_id, patient.id);
  assert.equal(account.therapist_id, therapist.id);

  const invalidMessages = [];
  const unknown = await redeem('MIWA-0000-0000', 'unknown-client@example.test');
  assert.equal(unknown.status, 404);
  invalidMessages.push(unknown.body.error);

  const expiredPatient = await createPatient(cookie, 'expired');
  const expiredInvite = await generateInvite(cookie, expiredPatient.id);
  await db.run("UPDATE client_invites SET expires_at = datetime('now', '-1 day') WHERE id = ?", expiredInvite.id);
  const expired = await redeem(expiredInvite.code, 'expired-client@example.test');
  assert.equal(expired.status, 410);
  invalidMessages.push(expired.body.error);

  const claimed = await redeem(invite.code, 'claimed-client@example.test');
  assert.equal(claimed.status, 410);
  invalidMessages.push(claimed.body.error);

  const revokedPatient = await createPatient(cookie, 'revoked');
  const revokedInvite = await generateInvite(cookie, revokedPatient.id);
  const revokedDelete = await api('DELETE', `/api/client-invites/${revokedInvite.id}`, null, cookie);
  assert.equal(revokedDelete.status, 200);
  const revoked = await redeem(revokedInvite.code, 'revoked-client@example.test');
  assert.equal(revoked.status, 410);
  invalidMessages.push(revoked.body.error);

  assert.equal(new Set(invalidMessages).size, 1);
});

test('client portal redeem rate limit blocks repeated invalid attempts', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  let response;
  for (let i = 0; i < 11; i += 1) {
    response = await redeem('MIWA-1111-2222', `rate-limit-${i}@example.test`);
  }
  assert.equal(response.status, 429);
  assert.match(response.body.error, /too many invite-code attempts/i);
});
