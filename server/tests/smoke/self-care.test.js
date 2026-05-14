const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('clinician self-care weekly check-in', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie } = await bootstrapAdminAndLogin({
    email: 'self-care@miwa.test',
    password: 'test-password-1234',
  });

  await t.test('GET /api/self-care is private and due before first check-in', async () => {
    const unauth = await api('GET', '/api/self-care');
    assert.equal(unauth.status, 401);

    const res = await api('GET', '/api/self-care', null, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.template.id, 'self-care');
    assert.equal(res.body.weekly.due, true);
    assert.equal(res.body.latest, null);
    assert.ok(Array.isArray(res.body.history));
  });

  await t.test('POST /api/self-care scores and stores clinician-owned responses', async () => {
    const template = (await api('GET', '/api/self-care', null, cookie)).body.template;
    const responses = template.questions.map(question => ({
      id: question.id,
      value: 3,
      label: 'I do this well',
    }));

    const submit = await api('POST', '/api/self-care', { responses }, cookie);
    assert.equal(submit.status, 201);
    assert.equal(submit.body.latest.total_score, 100);
    assert.equal(submit.body.latest.severity_level, 'Strong self-care consistency');
    assert.equal(submit.body.weekly.due, false);

    const after = await api('GET', '/api/self-care', null, cookie);
    assert.equal(after.status, 200);
    assert.equal(after.body.latest.total_score, 100);
    assert.equal(after.body.history.length, 1);
    assert.equal(after.body.weekly.due, false);
    assert.ok(after.body.weekly.next_due_at);
  });
});
