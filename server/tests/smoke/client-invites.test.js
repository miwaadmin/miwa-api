const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

test('client invite generation/list/revoke lifecycle is licensed-only and audited', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'client-invites@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);

  const patient = await api('POST', '/api/patients', {
    first_name: 'Invite',
    last_name: 'Client',
    email: 'invite-client@example.test',
  }, cookie);
  assert.equal(patient.status, 201);

  const generated = await api('POST', '/api/client-invites', {
    patient_id: patient.body.id,
  }, cookie);
  assert.equal(generated.status, 201);
  assert.match(generated.body.invite.code, /^MIWA-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.equal(generated.body.invite.status, 'pending');

  const listed = await api('GET', `/api/client-invites?patient_id=${patient.body.id}`, null, cookie);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.invites.some(invite => invite.id === generated.body.invite.id), true);

  const revoked = await api('DELETE', `/api/client-invites/${generated.body.invite.id}`, null, cookie);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.invite.status, 'revoked');

  const audit = await db.get(
    `SELECT COUNT(*) AS n FROM event_logs
      WHERE therapist_id = ? AND event_type IN ('client_invite.generated', 'client_invite.revoked')`,
    therapist.id,
  );
  assert.ok(audit.n >= 2);

  await db.run("UPDATE therapists SET credential_type = 'trainee' WHERE id = ?", therapist.id);
  const blocked = await api('POST', '/api/client-invites', {
    patient_id: patient.body.id,
  }, cookie);
  assert.equal(blocked.status, 403);
});

test('client invite generation enforces clinician daily limit', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'client-invites-limit@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);

  const patient = await api('POST', '/api/patients', {
    first_name: 'Limit',
    last_name: 'Client',
  }, cookie);
  assert.equal(patient.status, 201);

  for (let i = 0; i < 20; i += 1) {
    const generated = await api('POST', '/api/client-invites', { patient_id: patient.body.id }, cookie);
    assert.equal(generated.status, 201);
  }

  const limited = await api('POST', '/api/client-invites', { patient_id: patient.body.id }, cookie);
  assert.equal(limited.status, 429);
});
