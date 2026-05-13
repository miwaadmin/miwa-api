const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('client portal auth boundary and vertical slice', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie: therapistCookie, therapist } = await bootstrapAdminAndLogin();

  const created = await api('POST', '/api/patients', {
    first_name: 'Client',
    last_name: 'Portal',
    display_name: 'Client Portal',
    email: 'client.portal@example.com',
  }, therapistCookie);
  assert.equal(created.status, 201);
  const patientId = created.body.id;
  const db = require('../../db/asyncDb').getAsyncDb();
  const automaticAccount = await db.get('SELECT id FROM client_portal_accounts WHERE patient_id = ?', patientId);
  assert.equal(automaticAccount, undefined);

  const invite = await api('POST', `/api/patients/${patientId}/client-portal/invite`, {
    email: 'client.portal@example.com',
  }, therapistCookie);
  assert.equal(invite.status, 200);
  assert.match(invite.body.invite_url, /\/client\/accept-invite\?token=/);
  const inviteToken = new URL(invite.body.invite_url).searchParams.get('token');
  assert.ok(inviteToken);

  const accepted = await api('POST', '/api/client-auth/accept-invite', {
    code: inviteToken,
    password: 'client-password-1234',
    display_name: 'Client',
    accepted_terms: true,
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.client.role, 'client');
  const clientCookie = accepted.cookie;

  const blocked = await api('GET', '/api/patients', null, clientCookie);
  assert.equal(blocked.status, 401);

  const blockedTherapistMe = await api('GET', '/api/auth/me', null, clientCookie);
  assert.equal(blockedTherapistMe.status, 401);

  const therapistBlockedFromClientApi = await api('GET', '/api/client-portal/home', null, therapistCookie);
  assert.equal(therapistBlockedFromClientApi.status, 401);

  const therapistMessage = await api('POST', `/api/patients/${patientId}/client-portal/messages`, {
    content: 'Please complete the check-in before session.',
  }, therapistCookie);
  assert.equal(therapistMessage.status, 200);

  const homeWithUnread = await api('GET', '/api/client-portal/home', null, clientCookie);
  assert.equal(homeWithUnread.status, 200);
  assert.ok(homeWithUnread.body.unread_counts.messages >= 1);

  const clientMessages = await api('GET', '/api/client-portal/messages', null, clientCookie);
  assert.equal(clientMessages.status, 200);
  assert.ok(clientMessages.body.messages.length >= 2);
  assert.equal(clientMessages.body.messages.at(-1).sender_type, 'therapist');

  const homeAfterRead = await api('GET', '/api/client-portal/home', null, clientCookie);
  assert.equal(homeAfterRead.status, 200);
  assert.equal(homeAfterRead.body.unread_counts.messages, 0);

  const reply = await api('POST', '/api/client-portal/messages', { content: 'I will do that today.' }, clientCookie);
  assert.equal(reply.status, 200);

  const riskReply = await api('POST', '/api/client-portal/messages', { content: 'I want to die.' }, clientCookie);
  assert.equal(riskReply.status, 200);
  assert.match(riskReply.body.safety_guidance, /988/);

  const inbox = await api('GET', '/api/inbox/summary', null, therapistCookie);
  assert.equal(inbox.status, 200);
  assert.ok(inbox.body.unread >= 2);
  assert.ok(inbox.body.risk_unread >= 1);

  const homework = await api('POST', `/api/patients/${patientId}/client-portal/homework`, {
    title: 'Read grounding handout',
    description: 'Try one exercise.',
  }, therapistCookie);
  assert.equal(homework.status, 201);

  const clientHomework = await api('GET', '/api/client-portal/homework', null, clientCookie);
  assert.equal(clientHomework.status, 200);
  assert.equal(clientHomework.body.homework.length, 1);
  const complete = await api('POST', `/api/client-portal/homework/${clientHomework.body.homework[0].id}/complete`, {}, clientCookie);
  assert.equal(complete.status, 200);

  const assessment = await api('POST', `/api/patients/${patientId}/client-portal/assessments`, {
    template_type: 'gad-7',
  }, therapistCookie);
  assert.equal(assessment.status, 200);

  const assessmentTemplate = await api('GET', `/api/client-portal/assessments/${assessment.body.token}`, null, clientCookie);
  assert.equal(assessmentTemplate.status, 200);
  const assessmentComplete = await api('POST', `/api/client-portal/assessments/${assessment.body.token}`, {
    responses: assessmentTemplate.body.questions.map((q) => ({ question_id: q.id, value: 1 })),
  }, clientCookie);
  assert.equal(assessmentComplete.status, 200);

  const outcomes = await api('GET', '/api/client-portal/outcomes', null, clientCookie);
  assert.equal(outcomes.status, 200);
  assert.equal(outcomes.body.outcomes.assessments.some(a => a.template_type === 'gad-7' && a.points.length === 1), true);
  assert.equal(outcomes.body.outcomes.practice.completed, 1);

  const home = await api('GET', '/api/client-portal/home', null, clientCookie);
  assert.equal(home.status, 200);
  assert.equal(home.body.client.email, 'client.portal@example.com');
  assert.equal(home.body.assessments.some(a => a.template_type === 'gad-7'), true);
  assert.equal(home.body.outcomes.assessments.some(a => a.template_type === 'gad-7'), true);

  const patientRow = await db.get('SELECT client_id FROM patients WHERE id = ?', patientId);
  const appointmentInsert = await db.insert(
    `INSERT INTO appointments
       (therapist_id, patient_id, client_code, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, meet_url, status)
     VALUES (?, ?, ?, 'therapy_session', ?, ?, 50, 'Telehealth', 'https://meet.test/client-portal', 'scheduled')`,
    therapist.id,
    patientId,
    patientRow.client_id,
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 50 * 60 * 1000).toISOString(),
  );

  const appointmentRequest = await api('POST', `/api/client-portal/appointments/${appointmentInsert.lastInsertRowid}/request`, {
    request_type: 'reschedule',
    message: 'Could we move this appointment?',
  }, clientCookie);
  assert.equal(appointmentRequest.status, 200);
  assert.equal(appointmentRequest.body.status, 'pending');

  const clientAppointments = await api('GET', '/api/client-portal/appointments', null, clientCookie);
  assert.equal(clientAppointments.status, 200);
  assert.equal(clientAppointments.body.requests.some(r => r.id === appointmentRequest.body.request_id && r.status === 'pending'), true);

  const inboxWithAppointment = await api('GET', '/api/inbox/summary', null, therapistCookie);
  assert.equal(inboxWithAppointment.status, 200);
  assert.ok(inboxWithAppointment.body.appointment_requests >= 1);

  const resolvedRequest = await api('PATCH', `/api/inbox/appointment-requests/${appointmentRequest.body.request_id}`, {
    status: 'approved',
    therapist_response: 'Yes, I will follow up with a new time.',
  }, therapistCookie);
  assert.equal(resolvedRequest.status, 200);

  const updatedAppointments = await api('GET', '/api/client-portal/appointments', null, clientCookie);
  assert.equal(updatedAppointments.status, 200);
  assert.equal(updatedAppointments.body.requests.some(r => r.status === 'approved' && /new time/.test(r.therapist_response)), true);

  const settings = await api('PUT', '/api/client-portal/settings', {
    notification_email_enabled: false,
    notification_sms_enabled: true,
    appointment_reminders_enabled: true,
    assessment_reminders_enabled: false,
    homework_reminders_enabled: true,
  }, clientCookie);
  assert.equal(settings.status, 200);

  const documents = await api('GET', '/api/client-portal/documents', null, clientCookie);
  assert.equal(documents.status, 200);
  assert.deepEqual(documents.body.documents, []);

  const recovery = await api('POST', '/api/client-auth/forgot-password', {
    email: 'client.portal@example.com',
  });
  assert.equal(recovery.status, 200);
  const resetRow = await db.get(
    `SELECT * FROM client_portal_password_resets
     WHERE client_account_id = ? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    accepted.body.client.id,
  );
  assert.ok(resetRow);
});

test('client portal invite invalidation paths', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie: therapistCookie } = await bootstrapAdminAndLogin();
  const created = await api('POST', '/api/patients', {
    first_name: 'Invite',
    last_name: 'Paths',
    display_name: 'Invite Paths',
  }, therapistCookie);
  const patientId = created.body.id;

  const invite = await api('POST', `/api/patients/${patientId}/client-portal/invite`, {
    email: 'invite.paths@example.com',
  }, therapistCookie);
  const inviteToken = new URL(invite.body.invite_url).searchParams.get('token');

  const revoked = await api('POST', `/api/patients/${patientId}/client-portal/revoke`, {}, therapistCookie);
  assert.equal(revoked.status, 200);
  const revokedAccept = await api('POST', '/api/client-auth/accept-invite', {
    token: inviteToken,
    password: 'client-password-1234',
    display_name: 'Client',
    accepted_terms: true,
  });
  assert.equal(revokedAccept.status, 404);

  const db = require('../../db/asyncDb').getAsyncDb();
  const expiredToken = 'expired-test-token';
  const crypto = require('crypto');
  await db.insert(
    `INSERT INTO client_portal_invites
       (patient_id, therapist_id, email, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    patientId,
    1,
    'expired@example.com',
    crypto.createHash('sha256').update(expiredToken).digest('hex'),
    new Date(Date.now() - 1000).toISOString(),
  );
  const expiredAccept = await api('POST', '/api/client-auth/accept-invite', {
    token: expiredToken,
    password: 'client-password-1234',
    display_name: 'Client',
    accepted_terms: true,
  });
  assert.equal(expiredAccept.status, 410);
});
