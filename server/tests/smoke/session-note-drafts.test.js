const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('session note draft cloud autosave endpoint', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'draft-autosave@miwa.test',
  });

  await t.test('draft routes require therapist auth', async () => {
    const r = await api('PUT', '/api/session-note-drafts/miwa.workspaceDraft%3A99%3Anew', {
      draft: { sessionType: 'ongoing', form: { sessionNotes: 'Unsaved note' } },
    });
    assert.equal(r.status, 401);
  });

  await t.test('PUT upserts a draft and GET returns it', async () => {
    const patient = await api('POST', '/api/patients', {
      client_id: 'DRAFT-001',
      display_name: 'Draft Client',
    }, cookie);
    assert.equal(patient.status, 201);

    const draftKey = `miwa.workspaceDraft:cloud:${patient.body.id}`;
    const save = await api('PUT', `/api/session-note-drafts/${encodeURIComponent(draftKey)}`, {
      patient_id: patient.body.id,
      draft: {
        sessionType: 'ongoing',
        form: { sessionNotes: 'Cloud autosaved clinical draft.' },
        activeTab: 'documentation',
      },
    }, cookie);
    assert.equal(save.status, 200);
    assert.match(save.body.saved_at, /^\d{4}-\d{2}-\d{2}T/);

    const get = await api('GET', `/api/session-note-drafts/${encodeURIComponent(draftKey)}`, null, cookie);
    assert.equal(get.status, 200);
    assert.equal(get.body.patient_id, patient.body.id);
    assert.equal(get.body.draft.form.sessionNotes, 'Cloud autosaved clinical draft.');
    assert.equal(get.body.draft.activeTab, 'documentation');
  });
});
