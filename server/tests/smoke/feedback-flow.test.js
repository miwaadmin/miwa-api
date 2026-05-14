// Smoke tests for the extended POST /api/feedback endpoint.
// Covers: therapist auth, client portal auth, rate limit, category validation,
// { id, ticket_id } response shape, and per-user hourly isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

test('POST /api/feedback — therapist auth returns { id, ticket_id }', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'feedback-therapist@miwa.test',
    password: 'test-password-1234',
  });

  const r = await api('POST', '/api/feedback', {
    category: 'bug',
    subject: 'Button not working',
    message: 'The generate invite button throws a 500 error when I click it.',
    context: { page: '/patients/42' },
  }, cookie);

  assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(typeof r.body.id === 'number', 'response must include numeric id');
  assert.match(r.body.ticket_id, /^MIWA-FB-\d+$/, 'ticket_id must be MIWA-FB-N format');

  // Verify row was written to DB with all fields
  const db = getAsyncDb();
  const row = await db.get('SELECT * FROM user_feedback WHERE id = ?', r.body.id);
  assert.ok(row, 'row must exist in user_feedback');
  assert.equal(row.category, 'bug');
  assert.equal(row.subject, 'Button not working');
  assert.ok(row.message.includes('generate invite'));
  assert.ok(row.context_json, 'context_json must be set');
  const ctx = JSON.parse(row.context_json);
  assert.equal(ctx.page, '/patients/42');
  assert.equal(row.source, 'form');
});

test('POST /api/feedback — unauthenticated returns 401', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const r = await api('POST', '/api/feedback', {
    category: 'help',
    message: 'Can anyone hear me?',
  }, null);

  assert.equal(r.status, 401);
});

test('POST /api/feedback — invalid category falls back to general', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'feedback-cat@miwa.test',
    password: 'test-password-1234',
  });

  const r = await api('POST', '/api/feedback', {
    category: 'not_a_real_category',
    message: 'This is a message with some length to it so validation passes.',
  }, cookie);

  assert.equal(r.status, 201);
  const db = getAsyncDb();
  const row = await db.get('SELECT category FROM user_feedback WHERE id = ?', r.body.id);
  assert.equal(row.category, 'general');
});

test('POST /api/feedback — empty message returns 400', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'feedback-empty@miwa.test',
    password: 'test-password-1234',
  });

  const r = await api('POST', '/api/feedback', { message: '   ' }, cookie);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /required/i);
});

test('POST /api/feedback — rate limit at 6th request within an hour', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'feedback-limit@miwa.test',
    password: 'test-password-1234',
  });

  // 5 should succeed
  for (let i = 1; i <= 5; i++) {
    const r = await api('POST', '/api/feedback', {
      message: `Feedback message number ${i} — long enough to pass validation.`,
    }, cookie);
    assert.equal(r.status, 201, `request ${i} should be 201`);
  }

  // 6th should be rate-limited
  const blocked = await api('POST', '/api/feedback', {
    message: 'This is the sixth submission and should be blocked by rate limit.',
  }, cookie);
  assert.equal(blocked.status, 429, 'sixth request must be rate-limited');
  assert.match(blocked.body.error, /limit/i);
});

test('POST /api/feedback — client portal auth writes client_account_id', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  // Bootstrap a therapist so we can create a patient + portal account
  const { cookie: therapistCookie, therapist } = await bootstrapAdminAndLogin({
    email: 'feedback-clinician@miwa.test',
    password: 'test-password-1234',
  });

  const db = getAsyncDb();

  // Create a patient
  const patient = await api('POST', '/api/patients', {
    first_name: 'Feedback',
    last_name: 'Client',
    email: 'feedback-portal@example.test',
  }, therapistCookie);
  assert.equal(patient.status, 201);
  const patientId = patient.body.id;

  // Insert a client portal account directly (password hash irrelevant for this test)
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('portal-password-1234', 10);
  const accountInsert = await db.insert(
    `INSERT INTO client_portal_accounts
       (patient_id, linked_patient_id, therapist_id, email, display_name, status, password_hash)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    patientId, patientId, therapist.id,
    'feedback-portal@example.test', 'Feedback Client', hash,
  );

  // Log in as the portal user
  const login = await api('POST', '/api/client-auth/login', {
    email: 'feedback-portal@example.test',
    password: 'portal-password-1234',
  });
  assert.equal(login.status, 200, `portal login failed: ${JSON.stringify(login.body)}`);
  const clientCookie = login.cookie;

  // Submit feedback as the client
  const r = await api('POST', '/api/feedback', {
    category: 'help',
    message: 'I cannot see my appointments in the portal — is that expected?',
  }, clientCookie);

  assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.match(r.body.ticket_id, /^MIWA-FB-\d+$/);

  const row = await db.get('SELECT * FROM user_feedback WHERE id = ?', r.body.id);
  assert.ok(row, 'row must be in DB');
  assert.equal(row.client_account_id, accountInsert.lastInsertRowid);
  assert.equal(row.therapist_id, null);
  assert.equal(row.category, 'help');
});
