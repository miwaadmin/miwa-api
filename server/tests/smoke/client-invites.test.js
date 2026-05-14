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

test('POST /unlink detaches a claimed portal account and audits to event_logs', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'client-invites-unlink@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);

  const patient = await api('POST', '/api/patients', {
    first_name: 'Unlink',
    last_name: 'Client',
    email: 'unlink-client@example.test',
  }, cookie);
  assert.equal(patient.status, 201);
  const patientId = patient.body.id;

  // Simulate a claimed portal account directly in the DB (avoids the full
  // redeem flow which requires a hashed password and cookie dance).
  const accountInsert = await db.insert(
    `INSERT INTO client_portal_accounts
       (patient_id, linked_patient_id, therapist_id, email, display_name, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    patientId, patientId, therapist.id, 'portal@example.test', 'Unlink Client',
  );
  // Mark an invite as claimed pointing to this account
  const inviteInsert = await db.insert(
    `INSERT INTO client_invites
       (patient_id, therapist_id, code, expires_at, status, claimed_by_client_user_id, claimed_at)
     VALUES (?, ?, 'MIWA-UNLK-TEST', datetime('now', '+7 days'), 'claimed', ?, CURRENT_TIMESTAMP)`,
    patientId, therapist.id, accountInsert.lastInsertRowid,
  );

  // Happy path — unlink succeeds
  const r = await api('POST', '/api/client-invites/unlink', { patient_id: patientId }, cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  // Portal account is deactivated and link cleared
  const account = await db.get('SELECT status, linked_patient_id FROM client_portal_accounts WHERE id = ?', accountInsert.lastInsertRowid);
  assert.equal(account.status, 'deactivated');
  assert.equal(account.linked_patient_id, null);

  // Invite flipped to revoked
  const invite = await db.get('SELECT status FROM client_invites WHERE id = ?', inviteInsert.lastInsertRowid);
  assert.equal(invite.status, 'revoked');

  // Audit row written
  const audit = await db.get(
    "SELECT COUNT(*) AS n FROM event_logs WHERE therapist_id = ? AND event_type = 'portal_account_unlinked'",
    therapist.id,
  );
  assert.ok(audit.n >= 1, 'unlink must write an event_logs audit row');
});

test('POST /unlink returns 403 for another clinician\'s patient', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  // Clinician A owns the patient
  const { therapist: therapistA } = await bootstrapAdminAndLogin({
    email: 'unlink-clinician-a@miwa.test',
    password: 'test-password-1234',
  });
  // Clinician B tries to unlink
  const { cookie: cookieB } = await bootstrapAdminAndLogin({
    email: 'unlink-clinician-b@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();

  const patientInsert = await db.insert(
    `INSERT INTO patients (client_id, display_name, therapist_id) VALUES (?, ?, ?)`,
    'UNLINK-CROSS', 'Cross-Unlink Patient', therapistA.id,
  );

  const r = await api('POST', '/api/client-invites/unlink', { patient_id: patientInsert.lastInsertRowid }, cookieB);
  assert.equal(r.status, 403);
});

test('invite generation is open to associates and blocked for trainees', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'invite-gating@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();

  const patient = await api('POST', '/api/patients', {
    first_name: 'Gating',
    last_name: 'Client',
  }, cookie);
  assert.equal(patient.status, 201);
  const patientId = patient.body.id;

  // Licensed therapist (default): 201
  await db.run("UPDATE therapists SET credential_type = 'licensed' WHERE id = ?", therapist.id);
  const asLicensed = await api('POST', '/api/client-invites', { patient_id: patientId }, cookie);
  assert.equal(asLicensed.status, 201, 'licensed must be able to generate an invite');

  // Associate: 201 — new behavior
  await db.run("UPDATE therapists SET credential_type = 'associate' WHERE id = ?", therapist.id);
  const asAssociate = await api('POST', '/api/client-invites', { patient_id: patientId }, cookie);
  assert.equal(asAssociate.status, 201, 'associate must now be able to generate an invite');

  // Trainee: 403 — still blocked
  await db.run("UPDATE therapists SET credential_type = 'trainee' WHERE id = ?", therapist.id);
  const asTrainee = await api('POST', '/api/client-invites', { patient_id: patientId }, cookie);
  assert.equal(asTrainee.status, 403, 'trainee must still be blocked from generating invites');
  assert.match(asTrainee.body.error, /clinician account/i);
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
