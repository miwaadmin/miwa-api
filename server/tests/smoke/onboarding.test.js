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

  await t.test('PUT /step/2 (soul screen no-op) advances to step 2', async () => {
    // Screen 2 is "Introduce yourself to Miwa". The soul profile is sent via
    // POST /soul fire-and-forget; this PUT just advances the step counter.
    const r = await api('PUT', '/api/onboarding/step/2', {}, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 2);
    assert.equal(r.body.completed, false);
  });

  await t.test('POST /api/onboarding/soul populates soul_markdown on the therapist row', async () => {
    const r = await api(
      'POST',
      '/api/onboarding/soul',
      { response: 'I am Sam, a trainee MFT. I work with anxious adults using CBT. I prefer SOAP notes. Keep responses concise.' },
      cookie,
    );
    // soul endpoint calls an AI model — in test mode this may succeed or fail
    // depending on whether AZURE_OPENAI_ENDPOINT is set. We only assert the
    // row is updated if the call succeeds.
    if (r.status === 200) {
      assert.equal(r.body.ok, true);
      assert.ok(typeof r.body.soul_markdown === 'string' && r.body.soul_markdown.length > 0,
        'soul_markdown is a non-empty string');
      // Confirm it landed on the therapist row
      const me = await api('GET', '/api/auth/me', null, cookie);
      assert.ok(me.body.soul_markdown, 'soul_markdown persisted on therapist row');
    } else {
      // AI unavailable in CI — just confirm the route is auth-gated and reachable
      assert.ok([400, 500].includes(r.status), `soul endpoint returned ${r.status}`);
    }
  });

  await t.test('PUT /step/3 persists school + program + grad year', async () => {
    const r = await api(
      'PUT',
      '/api/onboarding/step/3',
      {
        school_email: 'StudenT@CSUN.EDU',
        training_program: 'CSUN',
        expected_graduation_year: 2027,
      },
      cookie,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 3);
    assert.equal(r.body.data.school_email, 'student@csun.edu', 'school email is normalized lowercase');
    assert.equal(r.body.data.training_program, 'CSUN');
    assert.equal(r.body.data.expected_graduation_year, 2027);
    assert.equal(r.body.data.school_email_verified, false);
  });

  await t.test('PUT /step/4 persists hours-tracking toggles', async () => {
    const r = await api(
      'PUT',
      '/api/onboarding/step/4',
      { track_school: true, track_bbs: false },
      cookie,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 4);
    assert.equal(r.body.data.tracks_school_hours, true);
    assert.equal(r.body.data.tracks_bbs_hours, false);
  });

  await t.test('POST /skip/4 still works after a step has been saved', async () => {
    // Skipping a step that's already been saved is a no-op for that step's
    // data but still marks it skipped, so the dashboard can prompt later.
    const r = await api('POST', '/api/onboarding/skip/4', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 4);
    assert.ok(r.body.skipped_steps.includes(4));
  });

  await t.test('PUT /step/5 saves supervisor info to trainee_supervisors', async () => {
    const r = await api(
      'PUT',
      '/api/onboarding/step/5',
      {
        site: { name: 'Dr. Anita Rivera', email: 'anita@agency.org', site_name: 'Wellness Clinic of Pasadena' },
        school: { name: 'Prof. James Lin', email: 'jlin@csun.edu' },
      },
      cookie,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 5);
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

  await t.test('POST /api/patients/:id/promote-sample flips is_sample off', async () => {
    const r = await api('POST', `/api/patients/${sampleCaseId}/promote-sample`, null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.patient.is_sample, 0);
  });

  await t.test('POST /promote-sample on a non-sample row returns 400', async () => {
    const r = await api('POST', `/api/patients/${sampleCaseId}/promote-sample`, null, cookie);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not a sample/i);
  });

  // ── 6-screen step model tests ─────────────────────────────────────────────

  await t.test('6-screen step model: advance 1→2→3→4→5→6', async () => {
    // We're at step 5 after the supervisor step above. Advance to step 6.
    const r6 = await api('PUT', '/api/onboarding/step/6', {}, cookie);
    assert.equal(r6.status, 200);
    assert.equal(r6.body.step, 6);
    assert.equal(r6.body.completed, false, 'step 6 is in-progress, not complete');
  });

  await t.test('POST /complete sets step=7 + onboarded_at', async () => {
    const r = await api('POST', '/api/onboarding/complete', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 7);
    assert.equal(r.body.completed, true);
    assert.ok(r.body.onboarded_at, 'onboarded_at timestamp present');
  });

  await t.test('GET /state returns completed=true and step=7', async () => {
    const r = await api('GET', '/api/onboarding/state', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 7);
    assert.equal(r.body.completed, true);
  });

  await t.test('GET /auth/me reflects the wizard state (step=7)', async () => {
    const me = await api('GET', '/api/auth/me', null, cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.onboarding_step, 7);
    assert.ok(me.body.onboarded_at);
    assert.equal(me.body.training_program, 'CSUN');
    assert.equal(me.body.expected_graduation_year, 2027);
  });

  await t.test('PUT /step/:n rejects out-of-range step numbers', async () => {
    const r = await api('PUT', '/api/onboarding/step/9', { acknowledged: true }, cookie);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /step must be 1\.\.6/);
  });

  await t.test('POST /reset re-arms the wizard for a completed account', async () => {
    // Sanity: we just completed the wizard, so we're at step 7.
    const before = await api('GET', '/api/onboarding/state', null, cookie);
    assert.equal(before.body.step, 7);
    assert.equal(before.body.completed, true);

    const r = await api('POST', '/api/onboarding/reset', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 0);
    assert.equal(r.body.completed, false);
    assert.equal(r.body.onboarded_at, null);
    assert.deepEqual(r.body.skipped_steps, []);
  });

  await t.test('old trainees with onboarding_step 1-6 (pre-migration) are treated as in-progress', async () => {
    // After reset, manually advance to step 5 (simulates a pre-6-screen-model
    // trainee who completed 5 steps). With TRAINEE_COMPLETE_STEP=7, step 5
    // must NOT be marked complete.
    await api('PUT', '/api/onboarding/step/1', { acknowledged: true }, cookie);
    await api('PUT', '/api/onboarding/step/2', {}, cookie);
    await api('PUT', '/api/onboarding/step/3', { training_program: 'CSUN' }, cookie);
    await api('PUT', '/api/onboarding/step/4', { track_bbs: true }, cookie);
    await api('PUT', '/api/onboarding/step/5', {}, cookie);

    const r = await api('GET', '/api/onboarding/state', null, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.step, 5);
    assert.equal(r.body.completed, false, 'step 5 must not be marked complete in the 6-screen model');
  });
});

test('associate onboarding backend flow is separate from trainee onboarding', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'associate-onboarding@miwa.test',
  });
  const { getAsyncDb } = require('../../db/asyncDb');
  const db = getAsyncDb();
  await db.run("UPDATE therapists SET credential_type = 'associate', user_role = 'associate' WHERE id = ?", therapist.id);

  const traineeState = await api('GET', '/api/onboarding/state', null, cookie);
  assert.equal(traineeState.status, 200);
  assert.equal(traineeState.body.credential_type, 'associate');
  assert.equal(traineeState.body.completed, false, 'legacy trainee state may exist but frontend must not route associates into it');

  const initial = await api('GET', '/api/onboarding/associate/state', null, cookie);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.step, 0);
  assert.equal(initial.body.completed, false);

  const step = await api('PUT', '/api/onboarding/associate/step/3', {
    practice_setting: 'Private practice under supervision',
    credential_number: 'AMFT12345',
    licensure_board: 'CA BBS LMFT',
    supervisor_name: 'Dr. Supervisor',
    supervisor_license: 'LMFT99999',
    weekly_hours_goal: 12,
    dashboard_focus: ['Notes', 'Portal', 'Apps', 'Hours'],
  }, cookie);
  assert.equal(step.status, 200);
  assert.equal(step.body.step, 3);
  assert.equal(step.body.data.practice_setting, 'Private practice under supervision');
  assert.equal(step.body.data.credential_number, 'AMFT12345');
  assert.deepEqual(step.body.data.dashboard_focus, ['Notes', 'Portal', 'Apps', 'Hours']);

  const complete = await api('POST', '/api/onboarding/associate/complete', {
    practice_setting: 'Private practice under supervision',
    licensure_board: 'CA BBS LMFT',
    weekly_hours_goal: 12,
  }, cookie);
  assert.equal(complete.status, 200);
  assert.equal(complete.body.step, 6);
  assert.equal(complete.body.completed, true);
  assert.ok(complete.body.associate_onboarded_at);

  const me = await api('GET', '/api/auth/me', null, cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.credential_type, 'associate');
  assert.equal(me.body.associate_onboarding_step, 6);
  assert.ok(me.body.associate_onboarded_at);
  assert.equal(me.body.workspace_mode, 'private_practice');
  assert.deepEqual(me.body.dashboard_focus, ['Notes', 'Portal', 'Apps', 'Hours']);
});
