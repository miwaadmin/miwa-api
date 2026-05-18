const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('demo patient generator creates a comprehensive caseload entry', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin();

  // Generate a deterministic baseline set, including one trauma/SI archetype
  // so the assessment assertions below never depend on random chance.
  const created = [];
  for (let i = 0; i < 15; i++) {
    const body = i === 0 ? { archetype: 'trauma_ptsd' } : {};
    const r = await api('POST', '/api/seed/demo-patient', body, cookie);
    assert.equal(r.status, 200, `demo create ${i} failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.success, true);
    created.push(r.body);
  }

  await t.test('every demo lands on the dashboard stats', async () => {
    const stats = await api('GET', '/api/stats', null, cookie);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totalPatients, 15);
    assert.ok(stats.body.totalSessions >= 60, `expected >= 60 sessions, got ${stats.body.totalSessions}`);
    assert.ok(stats.body.sessionsThisWeek >= 1, 'demo guarantees a session in current week');
  });

  await t.test('upcoming appointments populate Today + Schedule', async () => {
    // Each demo creates 2 future appointments (2d out, 9d out) → 30 future appts
    const appts = await api('GET', '/api/agent/appointments', null, cookie);
    assert.equal(appts.status, 200);
    assert.ok(Array.isArray(appts.body));
    const future = appts.body.filter(a => a.scheduled_start > new Date().toISOString() && a.status === 'scheduled');
    assert.ok(future.length >= 20, `expected many future appts, got ${future.length}`);
  });

  await t.test('demos with trauma archetypes generate PCL-5 records', async () => {
    // Inspect each demo via /api/patients/:id/assessments — at least ONE of the
    // 15 demos should have produced PCL-5 (trauma archetypes are in the pool).
    let foundPcl5 = false;
    for (const d of created) {
      const a = await api('GET', `/api/assessments/client/${d.patient_id}`, null, cookie);
      if (a.status === 200 && Array.isArray(a.body) && a.body.some(row => row.template_type === 'pcl-5')) {
        foundPcl5 = true;
        break;
      }
    }
    assert.ok(foundPcl5, 'expected at least one of 15 demos to have PCL-5 (trauma archetype)');
  });

  await t.test('demos with SI flags generate C-SSRS records', async () => {
    let foundCssrs = false;
    for (const d of created) {
      const a = await api('GET', `/api/assessments/client/${d.patient_id}`, null, cookie);
      if (a.status === 200 && Array.isArray(a.body) && a.body.some(row => row.template_type === 'cssrs')) {
        foundCssrs = true;
        break;
      }
    }
    assert.ok(foundCssrs, 'expected at least one of 15 demos to have C-SSRS (SI-flagged archetype)');
  });
});

test('demo relational cases preserve participant/system language in notes', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'relational-demo@miwa.test',
  });

  const family = await api('POST', '/api/seed/demo-patient', { archetype: 'family_blended' }, cookie);
  assert.equal(family.status, 200, `family demo create failed: ${JSON.stringify(family.body)}`);

  const familyPatient = await api('GET', `/api/patients/${family.body.patient_id}`, null, cookie);
  assert.equal(familyPatient.status, 200);
  assert.equal(familyPatient.body.client_type, 'family');
  assert.ok(JSON.parse(familyPatient.body.members).length >= 3);

  const familySessions = await api('GET', `/api/patients/${family.body.patient_id}/sessions`, null, cookie);
  assert.equal(familySessions.status, 200);
  const familyText = familySessions.body.map((session) => [session.subjective, session.objective, session.assessment].join(' ')).join(' ');
  assert.match(familyText, /family members|stepparent|adolescent|parent-stepparent/i);
  assert.doesNotMatch(familyText, /^Client reports/);

  const couple = await api('POST', '/api/seed/demo-patient', { archetype: 'couple_communication' }, cookie);
  assert.equal(couple.status, 200, `couple demo create failed: ${JSON.stringify(couple.body)}`);

  const couplePatient = await api('GET', `/api/patients/${couple.body.patient_id}`, null, cookie);
  assert.equal(couplePatient.status, 200);
  assert.equal(couplePatient.body.client_type, 'couple');
  assert.equal(JSON.parse(couplePatient.body.members).length, 2);

  const coupleSessions = await api('GET', `/api/patients/${couple.body.patient_id}/sessions`, null, cookie);
  assert.equal(coupleSessions.status, 200);
  const coupleText = coupleSessions.body.map((session) => [session.subjective, session.objective, session.assessment].join(' ')).join(' ');
  assert.match(coupleText, /both partners|couple|partner/i);
  assert.doesNotMatch(coupleText, /^Client reports/);
});
