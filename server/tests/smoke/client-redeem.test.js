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
  const patient = await api('POST', '/api/patients', {
    first_name: `Redeem${suffix}`,
    last_name: 'Client',
    email: `redeem-${suffix}@example.test`,
  }, cookie);
  assert.equal(patient.status, 201);
  return patient.body;
}

async function generateInvite(cookie, patientId) {
  const generated = await api('POST', '/api/client-invites', { patient_id: patientId }, cookie);
  assert.equal(generated.status, 201);
  return generated.body.invite;
}

async function redeem(code, email = 'portal-client@example.test') {
  return api('POST', '/api/client-auth/redeem', {
    code,
    email,
    password: 'client-password-1234',
    first_name: 'Portal',
    last_name: 'Client',
  });
}

test('client invite redeem links the portal account to the patient and audits the claim', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist, db } = await createLicensedClinician('client-redeem@miwa.test');
  const patient = await createPatient(cookie, 'happy');
  const invite = await generateInvite(cookie, patient.id);

  const redeemed = await redeem(invite.code);
  assert.equal(redeemed.status, 200);
  assert.ok(redeemed.cookie.includes('miwa_client_auth='));
  assert.equal(redeemed.body.client.patient_id, patient.id);

  const account = await db.get(
    'SELECT * FROM client_portal_accounts WHERE lower(email) = lower(?)',
    'portal-client@example.test',
  );
  assert.equal(account.patient_id, patient.id);
  assert.equal(account.linked_patient_id, patient.id);
  assert.equal(account.therapist_id, therapist.id);

  const claimed = await db.get('SELECT * FROM client_invites WHERE id = ?', invite.id);
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimed_by_client_user_id, account.id);
  assert.ok(claimed.claimed_at);

  const audit = await db.get(
    `SELECT COUNT(*) AS n FROM event_logs
      WHERE therapist_id = ? AND event_type = 'client_invite.redeemed'`,
    therapist.id,
  );
  assert.ok(audit.n >= 1);
});

test('client invite redeem hides revoked, expired, claimed, and unknown code states', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, db } = await createLicensedClinician('client-redeem-states@miwa.test');
  const invalidMessages = [];

  const unknown = await redeem('MIWA-2345-6789', 'unknown-state@example.test');
  assert.equal(unknown.status, 404);
  invalidMessages.push(unknown.body.error);

  const revokedPatient = await createPatient(cookie, 'revoked');
  const revokedInvite = await generateInvite(cookie, revokedPatient.id);
  const revoked = await api('DELETE', `/api/client-invites/${revokedInvite.id}`, null, cookie);
  assert.equal(revoked.status, 200);
  const revokedRedeem = await redeem(revokedInvite.code, 'revoked-state@example.test');
  assert.equal(revokedRedeem.status, 410);
  invalidMessages.push(revokedRedeem.body.error);

  const expiredPatient = await createPatient(cookie, 'expired');
  const expiredInvite = await generateInvite(cookie, expiredPatient.id);
  await db.run(
    "UPDATE client_invites SET expires_at = datetime('now', '-1 day') WHERE id = ?",
    expiredInvite.id,
  );
  const expiredRedeem = await redeem(expiredInvite.code, 'expired-state@example.test');
  assert.equal(expiredRedeem.status, 410);
  invalidMessages.push(expiredRedeem.body.error);

  const claimedPatient = await createPatient(cookie, 'claimed');
  const claimedInvite = await generateInvite(cookie, claimedPatient.id);
  const firstClaim = await redeem(claimedInvite.code, 'claimed-state@example.test');
  assert.equal(firstClaim.status, 200);
  const secondClaim = await redeem(claimedInvite.code, 'claimed-state-2@example.test');
  assert.equal(secondClaim.status, 410);
  invalidMessages.push(secondClaim.body.error);

  assert.equal(new Set(invalidMessages).size, 1);
});

test('client invite redeem rejects duplicate emails with sign-in guidance', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await createLicensedClinician('client-redeem-email@miwa.test');
  const firstPatient = await createPatient(cookie, 'email-first');
  const firstInvite = await generateInvite(cookie, firstPatient.id);
  const firstRedeem = await redeem(firstInvite.code, 'same-client@example.test');
  assert.equal(firstRedeem.status, 200);

  const secondPatient = await createPatient(cookie, 'email-second');
  const secondInvite = await generateInvite(cookie, secondPatient.id);
  const duplicate = await redeem(secondInvite.code, 'same-client@example.test');
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /account with this email already exists/i);
});

test('client invite redeem rate limit blocks brute-force attempts', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  let response = null;
  for (let i = 0; i < 11; i += 1) {
    response = await redeem('MIWA-2345-6789', `brute-${i}@example.test`);
  }
  assert.equal(response.status, 429);
});
