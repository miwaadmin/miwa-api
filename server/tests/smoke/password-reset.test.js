const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

test('clinician password reset covers request, expiry, reuse rejection, and password update', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const email = 'password-reset@miwa.test';
  const oldPassword = 'old-password-1234';
  await bootstrapAdminAndLogin({ email, password: oldPassword });
  const db = getAsyncDb();

  const request = await api('POST', '/api/auth/forgot-password', { email });
  assert.equal(request.status, 200);
  assert.equal(request.body.ok, true);

  let tokenRow = await db.get(
    `SELECT prt.token, prt.used_at, t.email
       FROM password_reset_tokens prt
       JOIN therapists t ON t.id = prt.therapist_id
      WHERE lower(t.email) = lower(?)`,
    email,
  );
  assert.ok(tokenRow?.token);
  assert.equal(tokenRow.used_at, null);

  await db.run("UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 minute') WHERE token = ?", tokenRow.token);
  const expired = await api('POST', '/api/auth/reset-password', {
    token: tokenRow.token,
    password: 'new-password-1234',
  });
  assert.equal(expired.status, 400);
  assert.match(expired.body.error, /invalid or has expired/i);

  const secondRequest = await api('POST', '/api/auth/forgot-password', { email });
  assert.equal(secondRequest.status, 200);
  tokenRow = await db.get(
    `SELECT prt.token
       FROM password_reset_tokens prt
       JOIN therapists t ON t.id = prt.therapist_id
      WHERE lower(t.email) = lower(?)`,
    email,
  );

  const reset = await api('POST', '/api/auth/reset-password', {
    token: tokenRow.token,
    password: 'new-password-1234',
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.ok, true);

  const reuse = await api('POST', '/api/auth/reset-password', {
    token: tokenRow.token,
    password: 'another-password-1234',
  });
  assert.equal(reuse.status, 400);
  assert.match(reuse.body.error, /invalid or has expired/i);

  const oldLogin = await api('POST', '/api/auth/login', { email, password: oldPassword });
  assert.equal(oldLogin.status, 401);

  const newLogin = await api('POST', '/api/auth/login', { email, password: 'new-password-1234' });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.body.therapist.email, email);
});
