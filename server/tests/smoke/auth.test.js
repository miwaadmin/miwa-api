const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');

test('auth flow', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  await t.test('GET /api/auth/me without cookie returns 401', async () => {
    const r = await api('GET', '/api/auth/me');
    assert.equal(r.status, 401);
  });

  await t.test('register returns generic check-your-email response', async () => {
    const r = await api('POST', '/api/auth/register', {
      email: 'newuser@example.com',
      password: 'password1234',
      first_name: 'New',
      last_name: 'User',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.pendingVerification, true);
    assert.match(r.body.message, /verification link/i);
  });

  await t.test('register on existing email returns the SAME generic response (no enumeration leak)', async () => {
    const first = await api('POST', '/api/auth/register', {
      email: 'dup@example.com', password: 'password1234', first_name: 'Dup',
    });
    const second = await api('POST', '/api/auth/register', {
      email: 'dup@example.com', password: 'password1234', first_name: 'Dup',
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.message, second.body.message);
  });

  await t.test('login with bad creds returns 401 invalid', async () => {
    const r = await api('POST', '/api/auth/login', {
      email: 'nobody@example.com', password: 'whatever',
    });
    assert.equal(r.status, 401);
    assert.match(r.body.error, /invalid/i);
  });

  await t.test('bootstrap admin via _diag, then login, then /me round-trip', async () => {
    const { therapist, cookie } = await bootstrapAdminAndLogin();
    assert.ok(therapist);
    assert.equal(therapist.email, 'admin@miwa.test');
    assert.equal(therapist.is_admin, true);
    assert.equal(therapist.email_verified, true);

    const me = await api('GET', '/api/auth/me', null, cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'admin@miwa.test');
    assert.equal(me.body.is_admin, true);
  });

  await t.test('forgot-password returns ok regardless of email existence', async () => {
    const known = await api('POST', '/api/auth/forgot-password', { email: 'admin@miwa.test' });
    const unknown = await api('POST', '/api/auth/forgot-password', { email: 'noone@nowhere.com' });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.body.ok, true);
    assert.equal(unknown.body.ok, true);
  });
});
