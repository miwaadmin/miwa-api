const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('admin reset-data wipes one therapist without touching the account', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { therapist, cookie, adminCookie } = await bootstrapAdminAndLogin();

  // Seed a patient + session under the admin account
  const p = await api('POST', '/api/patients', {
    client_id: 'WIPE-001', display_name: 'Wipe Test Client',
  }, cookie);
  assert.equal(p.status, 201);
  await api('POST', `/api/patients/${p.body.id}/sessions`, {
    note_format: 'SOAP', subjective: 'x', assessment: 'y',
  }, cookie);

  // Confirm stats see the patient
  let stats = await api('GET', '/api/stats', null, cookie);
  assert.equal(stats.body.totalPatients, 1);
  assert.equal(stats.body.totalSessions, 1);

  // Wipe data for THIS therapist via the new per-account endpoint
  const wipe = await api('POST', `/api/admin/therapists/${therapist.id}/reset-data`, null, adminCookie);
  assert.equal(wipe.status, 200, `wipe failed: ${JSON.stringify(wipe.body)}`);
  assert.equal(wipe.body.ok, true);
  assert.equal(wipe.body.patients_deleted, 1);

  // Patients + sessions gone, but the account row + login still work
  stats = await api('GET', '/api/stats', null, cookie);
  assert.equal(stats.body.totalPatients, 0);
  assert.equal(stats.body.totalSessions, 0);

  const me = await api('GET', '/api/auth/me', null, cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.email, therapist.email);
});

test('feedback flow', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, adminCookie } = await bootstrapAdminAndLogin();

  let createdId;

  await t.test('POST /api/feedback rejects empty message', async () => {
    const r = await api('POST', '/api/feedback', { message: '   ' }, cookie);
    assert.equal(r.status, 400);
  });

  await t.test('POST /api/feedback writes a row', async () => {
    const r = await api('POST', '/api/feedback', {
      message: 'The Schedule modal cuts off on small screens.',
      category: 'bug',
      source: 'chat',
    }, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.message, /thank you/i);
  });

  await t.test('POST /api/feedback coerces unknown category to general', async () => {
    const r = await api('POST', '/api/feedback', {
      message: 'I love the new backup card.',
      category: 'compliment', // not in the allowlist
    }, cookie);
    assert.equal(r.status, 200);
  });

  await t.test('GET /api/admin/support returns the feedback we just wrote', async () => {
    const r = await api('GET', '/api/admin/support', null, adminCookie);
    assert.equal(r.status, 200, `expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.feedback));
    assert.ok(r.body.feedback.length >= 2, `expected at least 2 feedback rows, got ${r.body.feedback.length}`);
    const bug = r.body.feedback.find(f => f.category === 'bug');
    assert.ok(bug);
    assert.match(bug.message, /Schedule modal/);
    assert.equal(bug.therapist_email, 'admin@miwa.test');
    assert.equal(bug.status, 'new');
    createdId = bug.id;
  });

  await t.test('GET /api/admin/postgres/status is sanitized when DATABASE_URL is absent', async () => {
    const r = await api('GET', '/api/admin/postgres/status', null, adminCookie);
    assert.equal(r.status, 503);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.provider, 'azure-postgresql');
    assert.equal(r.body.configured, false);
    assert.match(r.body.message, /DATABASE_URL/);
    assert.equal(JSON.stringify(r.body).includes('postgres://'), false);
  });

  await t.test('PATCH /api/admin/feedback/:id resolves + emails + drops in-app chat message', async () => {
    const r = await api('PATCH', `/api/admin/feedback/${createdId}`, {
      status: 'resolved',
      admin_response: 'Fixed in commit 1a2b3c4.',
    }, adminCookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.emailed_user, true, 'expected resolution email on new→resolved transition');
    assert.equal(r.body.chat_notified, true, 'expected in-app chat message dropped');

    const after = await api('GET', '/api/admin/support', null, adminCookie);
    const updated = after.body.feedback.find(f => f.id === createdId);
    assert.equal(updated.status, 'resolved');
    assert.match(updated.admin_response, /1a2b3c4/);
    assert.ok(updated.resolved_at);
  });

  await t.test('PATCH does NOT re-notify if row is already resolved (no spam)', async () => {
    const r = await api('PATCH', `/api/admin/feedback/${createdId}`, {
      admin_response: 'Updated note — typo fix only.',
    }, adminCookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.emailed_user, false);
    assert.equal(r.body.chat_notified, false);
  });
});
