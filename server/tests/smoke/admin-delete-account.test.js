const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

test('admin can delete a verified test account with auth artifacts', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { adminCookie } = await bootstrapAdminAndLogin({
    email: 'delete-admin@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();

  const inserted = await db.insert(
    `INSERT INTO therapists
       (email, password_hash, first_name, last_name, full_name, referral_code, email_verified, account_status)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'active')`,
    'delete-target@miwa.test',
    'not-a-real-hash',
    'Delete',
    'Target',
    'Delete Target',
    'DELTEST123',
  );
  const therapistId = inserted.lastInsertRowid;

  await db.insert(
    `INSERT INTO email_verification_tokens (therapist_id, token, expires_at, used_at)
     VALUES (?, ?, datetime('now', '+1 day'), CURRENT_TIMESTAMP)`,
    therapistId,
    'delete-target-token',
  );
  await db.insert(
    `INSERT INTO event_logs (therapist_id, event_type, status, message)
     VALUES (?, 'auth.email_verified', 'success', 'Email verified')`,
    therapistId,
  );
  await db.insert(
    `INSERT INTO therapist_self_care_assessments
       (therapist_id, responses, total_score, severity_level, severity_color)
     VALUES (?, '[]', 100, 'Strong self-care consistency', '#10B981')`,
    therapistId,
  );

  const res = await api('DELETE', `/api/admin/therapists/${therapistId}`, {
    confirmation: 'DELETE delete-target@miwa.test',
    reason: 'Cleaning up verified fake test account',
  }, adminCookie);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);

  const row = await db.get('SELECT id FROM therapists WHERE id = ?', therapistId);
  assert.equal(row, undefined);
});
