const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('patients + sessions CRUD', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin();
  let patientId;
  let sessionId;

  await t.test('GET /api/patients on fresh account is empty array', async () => {
    const r = await api('GET', '/api/patients', null, cookie);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 0);
  });

  await t.test('POST /api/patients creates a patient', async () => {
    const r = await api('POST', '/api/patients', {
      client_id: 'TEST-001',
      display_name: 'Test Client',
      age: 30,
      gender: 'female',
      presenting_concerns: 'anxiety, sleep difficulties',
    }, cookie);
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
    assert.equal(r.body.client_id, 'TEST-001');
    assert.equal(r.body.display_name, 'Test Client');
    patientId = r.body.id;
  });

  await t.test('GET /api/patients/:id returns the created patient', async () => {
    const r = await api('GET', `/api/patients/${patientId}`, null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, patientId);
    assert.equal(r.body.display_name, 'Test Client');
  });

  await t.test('PUT /api/patients/:id updates display name without losing it on subsequent read', async () => {
    const r = await api('PUT', `/api/patients/${patientId}`, {
      client_id: 'TEST-001',
      display_name: 'Test Client (renamed)',
    }, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.display_name, 'Test Client (renamed)');

    const fresh = await api('GET', `/api/patients/${patientId}`, null, cookie);
    assert.equal(fresh.body.display_name, 'Test Client (renamed)');
  });

  await t.test('POST /api/patients/:id/sessions creates a session', async () => {
    const r = await api('POST', `/api/patients/${patientId}/sessions`, {
      note_format: 'SOAP',
      subjective: 'Client reports increased anxiety this week.',
      objective: 'Affect anxious, mood dysthymic.',
      assessment: 'Symptoms consistent with GAD.',
      plan: 'Continue CBT, assign thought record homework.',
      session_date: new Date().toISOString().slice(0, 10),
    }, cookie);
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
    sessionId = r.body.id;
  });

  await t.test('GET /api/patients/:id/sessions lists the session', async () => {
    const r = await api('GET', `/api/patients/${patientId}/sessions`, null, cookie);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].id, sessionId);
  });

  await t.test('GET /api/sessions/unsigned includes the unsigned session', async () => {
    const r = await api('GET', '/api/sessions/unsigned', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 1);
    assert.equal(r.body.sessions[0].id, sessionId);
    // Bug we shipped + reverted today: this endpoint must include display_name
    assert.equal(r.body.sessions[0].display_name, 'Test Client (renamed)');
  });
});
