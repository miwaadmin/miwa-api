const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('dashboard stats endpoint', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin();
  let statsPatientId;

  await t.test('GET /api/stats on fresh account returns 200 with zero counts', async () => {
    const r = await api('GET', '/api/stats', null, cookie);
    assert.equal(r.status, 200, `expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    // Regression guard: today we shipped a query that referenced a non-existent
    // `status` column on patients, which 500'd the entire endpoint and made the
    // whole dashboard show zeros. This test would have caught it immediately.
    assert.equal(typeof r.body.totalPatients, 'number');
    assert.equal(typeof r.body.totalSessions, 'number');
    assert.equal(typeof r.body.sessionsThisWeek, 'number');
    assert.equal(typeof r.body.appointmentsToday, 'number');
    assert.equal(typeof r.body.unsignedNotes, 'number');
    assert.ok(Array.isArray(r.body.recentSessions));
  });

  await t.test('after creating a patient + dated session, stats reflect it', async () => {
    const p = await api('POST', '/api/patients', {
      client_id: 'STATS-001',
      display_name: 'Stats Test',
    }, cookie);
    assert.equal(p.status, 201);
    statsPatientId = p.body.id;

    await api('POST', `/api/patients/${p.body.id}/sessions`, {
      note_format: 'SOAP',
      subjective: 'baseline',
      assessment: 'note',
      session_date: new Date().toISOString().slice(0, 10),
    }, cookie);

    const r = await api('GET', '/api/stats', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.totalPatients, 1);
    assert.equal(r.body.totalSessions, 1);
    assert.ok(r.body.sessionsThisWeek >= 1, 'sessionsThisWeek should count today as this week');
    assert.equal(r.body.recentSessions.length, 1);
    assert.equal(r.body.recentSessions[0].display_name, 'Stats Test');
  });

  await t.test('recent sessions are one latest session per client from the last 14 days', async () => {
    const older = new Date();
    older.setDate(older.getDate() - 20);

    const second = await api('POST', '/api/patients', {
      client_id: 'STATS-002',
      display_name: 'Old Only',
    }, cookie);
    assert.equal(second.status, 201);

    await api('POST', `/api/patients/${statsPatientId}/sessions`, {
      note_format: 'DAP',
      subjective: 'newer duplicate for same client',
      assessment: 'latest client note',
      session_date: new Date().toISOString().slice(0, 10),
    }, cookie);
    await api('POST', `/api/patients/${second.body.id}/sessions`, {
      note_format: 'SOAP',
      subjective: 'too old for dashboard',
      assessment: 'old note',
      session_date: older.toISOString().slice(0, 10),
    }, cookie);

    const r = await api('GET', '/api/stats', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.recentSessions.length, 1);
    assert.equal(r.body.recentSessions[0].display_name, 'Stats Test');
    assert.equal(r.body.recentSessions.filter(s => s.patient_id === statsPatientId).length, 1);
  });

  await t.test('GET /api/sessions/unsigned returns count + sessions array', async () => {
    const r = await api('GET', '/api/sessions/unsigned', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.count, 'number');
    assert.ok(Array.isArray(r.body.sessions));
  });
});
