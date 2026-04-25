const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('demo patient generator creates a comprehensive caseload entry', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin();

  // Generate enough demos to cover most archetypes, then keep going until the
  // assessment-specific archetypes appear. The endpoint is intentionally
  // random, so the smoke test should not depend on probability alone.
  const created = [];
  let foundPcl5 = false;
  let foundCssrs = false;

  async function refreshAssessmentCoverage(demo) {
    const a = await api('GET', `/api/assessments/client/${demo.patient_id}`, null, cookie);
    if (a.status === 200 && Array.isArray(a.body)) {
      foundPcl5 = foundPcl5 || a.body.some(row => row.template_type === 'pcl-5');
      foundCssrs = foundCssrs || a.body.some(row => row.template_type === 'cssrs');
    }
  }

  for (let i = 0; i < 15 || (!(foundPcl5 && foundCssrs) && i < 40); i++) {
    const r = await api('POST', '/api/seed/demo-patient', {}, cookie);
    assert.equal(r.status, 200, `demo create ${i} failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.success, true);
    created.push(r.body);
    await refreshAssessmentCoverage(r.body);
  }

  await t.test('every demo lands on the dashboard stats', async () => {
    const stats = await api('GET', '/api/stats', null, cookie);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totalPatients, created.length);
    assert.ok(
      stats.body.totalSessions >= created.length * 4,
      `expected >= ${created.length * 4} sessions, got ${stats.body.totalSessions}`
    );
    assert.ok(stats.body.sessionsThisWeek >= 1, 'demo guarantees a session in current week');
  });

  await t.test('upcoming appointments populate Today + Schedule', async () => {
    const appts = await api('GET', '/api/agent/appointments', null, cookie);
    assert.equal(appts.status, 200);
    assert.ok(Array.isArray(appts.body));
    const future = appts.body.filter(a => a.scheduled_start > new Date().toISOString() && a.status === 'scheduled');
    assert.ok(future.length >= created.length, `expected many future appts, got ${future.length}`);
  });

  await t.test('demos with trauma archetypes generate PCL-5 records', async () => {
    assert.ok(foundPcl5, `expected at least one of ${created.length} demos to have PCL-5 (trauma archetype)`);
  });

  await t.test('demos with SI flags generate C-SSRS records', async () => {
    assert.ok(foundCssrs, `expected at least one of ${created.length} demos to have C-SSRS (SI-flagged archetype)`);
  });
});
