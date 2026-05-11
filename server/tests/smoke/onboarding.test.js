const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('trainee onboarding wizard backend flow', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  await t.test('onboarding routes are auth-gated', async () => {
    const state = await api('GET', '/api/onboarding/state');
    assert.equal(state.status, 401);
    const step = await api('PUT', '/api/onboarding/step/1', { acknowledged: true });
    assert.equal(step.status, 401);
    const skip = await api('POST', '/api/onboarding/skip/1');
    assert.equal(skip.status, 401);
    const complete = await api('POST', '/api/onboarding/complete');
    assert.equal(complete.status, 401);
  });

  // Spin up an authenticated session to drive the rest of the flow
  const { cookie } = await bootstrapAdminAndLogin();

  await t.test('GET /state returns step 0 for a fresh account', async () => {
    const r = await api('GET', '/api/onboarding/state', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 0);
    assert.equal(r.body.completed, false);
    assert.deepEqual(r.body.skipped_steps, []);
    assert.ok(r.body.data && typeof r.body.data === 'object');
    assert.deepEqual(r.body.data.supervisors, []);
  });

  await t.test('PUT /step/1 requires acknowledgment', async () => {
    const r = await api('PUT', '/api/onboarding/step/1', { acknowledged: false }, cookie);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /acknowledge/i);
  });

  await t.test('PUT /step/1 with acknowledgment advances to step 1', async () => {
    const r = await api('PUT', '/api/onboarding/step/1', { acknowledged: true }, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 1);
    assert.equal(r.body.completed, false);
  });

  await t.test('PUT /step/2 persists school + program + grad year', async () => {
    const r = await api(
      'PUT',
      '/api/onboarding/step/2',
      {
        school_email: 'StudenT@CSUN.EDU',
        training_program: 'CSUN',
        expected_graduation_year: 2027,
      },
      cookie,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 2);
    assert.equal(r.body.data.school_email, 'student@csun.edu', 'school email is normalized lowercase');
    assert.equal(r.body.data.training_program, 'CSUN');
    assert.equal(r.body.data.expected_graduation_year, 2027);
    assert.equal(r.body.data.school_email_verified, false);
  });

  await t.test('POST /skip/3 marks step 3 as skipped but advances', async () => {
    const r = await api('POST', '/api/onboarding/skip/3', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 3);
    assert.ok(r.body.skipped_steps.includes(3));
  });

  await t.test('PUT /step/4 saves supervisor info to trainee_supervisors', async () => {
    const r = await api(
      'PUT',
      '/api/onboarding/step/4',
      {
        site: { name: 'Dr. Anita Rivera', email: 'anita@agency.org', site_name: 'Wellness Clinic of Pasadena' },
        school: { name: 'Prof. James Lin', email: 'jlin@csun.edu' },
      },
      cookie,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 4);
    const supervisors = r.body.data.supervisors;
    assert.equal(supervisors.length, 2, `expected 2 supervisors, got ${JSON.stringify(supervisors)}`);
    const site = supervisors.find((s) => s.role === 'site');
    const school = supervisors.find((s) => s.role === 'school');
    assert.ok(site && school, 'both roles present');
    assert.equal(site.name, 'Dr. Anita Rivera');
    assert.equal(site.email, 'anita@agency.org');
    assert.equal(site.site_name, 'Wellness Clinic of Pasadena');
    assert.equal(school.email, 'jlin@csun.edu');
  });

  let sampleCaseId;

  await t.test('POST /sample-case creates a badged sample patient (idempotent)', async () => {
    const first = await api('POST', '/api/onboarding/sample-case', null, cookie);
    assert.equal(first.status, 201);
    assert.equal(first.body.ok, true);
    assert.ok(first.body.patient);
    assert.equal(first.body.patient.is_sample, 1, 'is_sample flag set on patient row');
    sampleCaseId = first.body.patient.id;

    const second = await api('POST', '/api/onboarding/sample-case', null, cookie);
    assert.equal(second.status, 200, 'second call returns 200, not a new 201');
    assert.equal(second.body.reused, true);
    assert.equal(second.body.patient.id, sampleCaseId, 'same sample patient returned');
  });

  await t.test('GET /api/patients exposes is_sample on the badged row', async () => {
    const r = await api('GET', '/api/patients', null, cookie);
    assert.equal(r.status, 200);
    const sample = r.body.find((p) => p.id === sampleCaseId);
    assert.ok(sample, 'sample patient appears in patient list');
    assert.equal(sample.is_sample, 1);
  });

  await t.test('POST /complete sets step=6 + onboarded_at', async () => {
    const r = await api('POST', '/api/onboarding/complete', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 6);
    assert.equal(r.body.completed, true);
    assert.ok(r.body.onboarded_at, 'onboarded_at timestamp present');
  });

  await t.test('GET /auth/me reflects the wizard state', async () => {
    const me = await api('GET', '/api/auth/me', null, cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.onboarding_step, 6);
    assert.ok(me.body.onboarded_at);
    assert.equal(me.body.training_program, 'CSUN');
    assert.equal(me.body.expected_graduation_year, 2027);
  });

  await t.test('PUT /step/:n rejects out-of-range step numbers', async () => {
    const r = await api('PUT', '/api/onboarding/step/9', { acknowledged: true }, cookie);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /step must be 1\.\.5/);
  });
});
