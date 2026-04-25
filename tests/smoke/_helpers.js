/**
 * Shared smoke-test plumbing.
 *
 * Each test file requires this BEFORE requiring anything else from server/,
 * because we have to set the env vars (JWT_SECRET, DB_PATH, etc.) before the
 * server modules load and read them at top-level.
 *
 * The harness:
 *   - Picks an isolated tmp DB path so parallel tests don't collide.
 *   - Sets a fixed JWT_SECRET, ENABLE_DIAG=true, and a backup passphrase.
 *   - Spins the express app up on a random port via app.listen(0).
 *   - Provides an `api()` helper that does fetch + JSON parsing + cookie
 *     handling so individual tests stay terse.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// ── Env bootstrap (must happen before requiring ../../server) ────────────────
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-smoke-tests-only';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@miwa.test';
process.env.ENABLE_DIAG = 'true';
process.env.BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE || 'smoke-test-backup-passphrase';

const TEST_DIR = path.join(os.tmpdir(), 'miwa-smoke-tests', `${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = path.join(TEST_DIR, 'mftbrain.db');
process.env.UPLOADS_DIR = path.join(TEST_DIR, 'uploads');

const { app, initDb } = require('../../server');
const { resetDbForTests } = require('../../db');

let server = null;
let baseUrl = null;

async function startTestServer() {
  if (server) return baseUrl;
  fs.mkdirSync(TEST_DIR, { recursive: true });
  await initDb();
  return new Promise((resolve, reject) => {
    server = app.listen(0, (err) => {
      if (err) return reject(err);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve(baseUrl);
    });
  });
}

async function stopTestServer() {
  if (!server) return;
  await new Promise(r => server.close(r));
  server = null;
  baseUrl = null;
  resetDbForTests();
  // Best-effort cleanup of the isolated DB + uploads dir
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

/**
 * Generic API helper. Returns { status, body, cookie }.
 *   - method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
 *   - urlPath: starts with '/api/...'
 *   - body:    object → JSON.stringify, or null
 *   - cookie:  Cookie header value to forward (use response.cookie from prior call)
 */
async function api(method, urlPath, body = null, cookie = null) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { json = await res.json(); } catch {}
  }
  return { status: res.status, body: json, cookie: setCookie || cookie };
}

/**
 * Bootstrap a verified admin via _diag/create-admin then log them in.
 * Returns { therapist, cookie } for use in subsequent authenticated calls.
 */
async function bootstrapAdminAndLogin({
  email = 'admin@miwa.test',
  password = 'test-password-1234',
  first_name = 'Smoke',
  last_name = 'Tester',
} = {}) {
  const createRes = await fetch(`${baseUrl}/api/auth/_diag/create-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Miwa-Diag-Secret': process.env.JWT_SECRET,
    },
    body: JSON.stringify({ email, password, first_name, last_name }),
  });
  const create = {
    status: createRes.status,
    body: await createRes.json().catch(() => null),
  };
  if (create.status !== 200 && create.status !== 409) {
    throw new Error(`bootstrap create-admin failed: ${create.status} ${JSON.stringify(create.body)}`);
  }
  const login = await api('POST', '/api/auth/login', { email, password });
  if (login.status !== 200) {
    throw new Error(`bootstrap login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  // Admin endpoints (/api/admin/*) sit behind a separate cookie set by
  // /api/auth/admin-login. We always log into both so callers can use
  // `cookie` for therapist endpoints and `adminCookie` for admin ones.
  const adminLogin = await api('POST', '/api/auth/admin-login', { email, password });
  if (adminLogin.status !== 200) {
    throw new Error(`bootstrap admin-login failed: ${adminLogin.status} ${JSON.stringify(adminLogin.body)}`);
  }
  return {
    therapist: login.body.therapist,
    cookie: login.cookie,
    adminCookie: adminLogin.cookie,
  };
}

module.exports = {
  startTestServer,
  stopTestServer,
  api,
  bootstrapAdminAndLogin,
  TEST_DIR,
};
