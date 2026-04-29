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

  await t.test('diag reset-password can recover admin by email', async () => {
    const reset = await api('POST', '/api/auth/_diag/reset-password', {
      email: 'admin@miwa.test',
      new_password: 'new-admin-password-1234',
      diag_secret: ` ${process.env.JWT_SECRET}\n`,
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.ok, true);
    assert.equal(reset.body.email, 'admin@miwa.test');
    assert.equal(reset.body.is_admin, true);

    const login = await api('POST', '/api/auth/admin-login', {
      email: 'admin@miwa.test',
      password: 'new-admin-password-1234',
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.therapist.is_admin, true);
  });

  await t.test('admin recovery create works without enabling broad diagnostics', async () => {
    const original = process.env.ENABLE_DIAG;
    process.env.ENABLE_DIAG = 'false';
    try {
      const create = await api('POST', '/api/auth/_diag/create-admin', {
        email: 'second-admin@miwa.test',
        password: 'second-admin-password-1234',
        first_name: 'Second',
        last_name: 'Admin',
        diag_secret: `\n${process.env.JWT_SECRET} `,
      });
      assert.equal(create.status, 200);
      assert.equal(create.body.ok, true);
      assert.equal(create.body.is_admin, true);
    } finally {
      process.env.ENABLE_DIAG = original;
    }
  });

  await t.test('admin recovery accepts temporary ADMIN_RECOVERY_SECRET', async () => {
    const original = process.env.ADMIN_RECOVERY_SECRET;
    process.env.ADMIN_RECOVERY_SECRET = 'temporary-admin-recovery-secret-1234';
    try {
      const reset = await api('POST', '/api/auth/_diag/reset-password', {
        email: 'admin@miwa.test',
        new_password: 'second-new-admin-password-1234',
        diag_secret: `"${process.env.ADMIN_RECOVERY_SECRET}"`,
      });
      assert.equal(reset.status, 200);
      assert.equal(reset.body.ok, true);

      const login = await api('POST', '/api/auth/admin-login', {
        email: 'admin@miwa.test',
        password: 'second-new-admin-password-1234',
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.therapist.is_admin, true);
    } finally {
      if (original === undefined) delete process.env.ADMIN_RECOVERY_SECRET;
      else process.env.ADMIN_RECOVERY_SECRET = original;
    }
  });

  await t.test('admin recovery mismatch returns safe length diagnostics', async () => {
    const reset = await api('POST', '/api/auth/_diag/reset-password', {
      email: 'admin@miwa.test',
      new_password: 'will-not-apply-1234',
      diag_secret: 'wrong-secret',
    });
    assert.equal(reset.status, 404);
    assert.equal(reset.body.code, 'RECOVERY_SECRET_MISMATCH');
    assert.equal(reset.body.provided_length, 'wrong-secret'.length);
    assert.ok(reset.body.expected_lengths.includes(process.env.JWT_SECRET.length));
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
