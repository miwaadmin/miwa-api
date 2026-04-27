const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_REMOTE_API = 'https://api.miwa.care';
const MODE = (process.env.MIWA_SMOKE_MODE || '').toLowerCase();
const REMOTE_MODE = MODE === 'remote' || process.env.MIWA_SMOKE_REMOTE === 'true' || Boolean(process.env.LAUNCH_API_URL);

let baseUrl = (process.env.LAUNCH_API_URL || (REMOTE_MODE ? DEFAULT_REMOTE_API : '')).replace(/\/$/, '');
let server = null;
let cookie = null;
let localTestDir = null;

const results = [];
const context = {
  therapistId: null,
  patientId: null,
  sessionId: null,
  smokeClientId: `SMOKE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
};

function resultDetail(value) {
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null)
  );
}

function safeError(err) {
  const message = err?.safeMessage || err?.message || 'Step failed';
  return String(message)
    .replace(/postgres:\/\/[^@\s]+@/gi, 'postgres://[redacted]@')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/password["']?\s*[:=]\s*["'][^"']+["']/gi, 'password: [redacted]');
}

function cookieHeaderFrom(setCookie) {
  if (!setCookie) return null;
  return String(setCookie)
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function mergeCookies(existing, setCookie) {
  const next = cookieHeaderFrom(setCookie);
  if (!next) return existing;
  const jar = new Map();
  for (const source of [existing, next]) {
    if (!source) continue;
    for (const pair of String(source).split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      jar.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
    }
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function urlFor(urlPath) {
  if (!baseUrl) throw new Error('Base URL is not initialized');
  const normalizedBase = baseUrl.replace(/\/$/, '');
  if (normalizedBase.endsWith('/api') && urlPath.startsWith('/api/')) {
    return `${normalizedBase}${urlPath.slice(4)}`;
  }
  return `${normalizedBase}${urlPath}`;
}

async function request(method, urlPath, body = null, options = {}) {
  const headers = {
    'user-agent': 'miwa-launch-happy-path/1.0',
    ...(options.headers || {}),
  };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (cookie && options.auth !== false) headers.Cookie = cookie;

  const res = await fetch(urlFor(urlPath), {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  cookie = mergeCookies(cookie, res.headers.get('set-cookie'));

  const contentType = res.headers.get('content-type') || '';
  let parsed = null;
  if (contentType.includes('application/json')) {
    parsed = await res.json().catch(() => null);
  } else {
    await res.arrayBuffer().catch(() => null);
  }

  return {
    status: res.status,
    ok: res.ok,
    body: parsed,
    contentType,
  };
}

function assertStatus(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const err = new Error(`${label} returned HTTP ${response.status}`);
    err.safeMessage = `${label} returned HTTP ${response.status}`;
    throw err;
  }
}

function assertBody(condition, label) {
  if (!condition) {
    const err = new Error(label);
    err.safeMessage = label;
    throw err;
  }
}

async function runStep(id, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    results.push({
      id,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...resultDetail(detail),
    });
  } catch (err) {
    results.push({
      id,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: safeError(err),
    });
  }
}

async function startLocalServer() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || `launch-happy-path-${crypto.randomBytes(16).toString('hex')}`;
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'launch-smoke@miwa.test';
  process.env.ENABLE_DIAG = 'true';
  process.env.BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE || 'launch-happy-path-backup-passphrase';

  localTestDir = path.join(os.tmpdir(), 'miwa-launch-happy-path', `${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(localTestDir, { recursive: true });
  process.env.DB_PATH = path.join(localTestDir, 'mftbrain.db');
  process.env.UPLOADS_DIR = path.join(localTestDir, 'uploads');

  const { app, initDb } = require('../index');
  await initDb();

  await new Promise((resolve, reject) => {
    server = app.listen(0, (err) => {
      if (err) return reject(err);
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function stopLocalServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  try {
    const { resetDbForTests } = require('../db');
    resetDbForTests();
  } catch {}
  if (localTestDir) {
    try { fs.rmSync(localTestDir, { recursive: true, force: true }); } catch {}
  }
}

async function loginLocalAdmin() {
  const email = 'launch-smoke@miwa.test';
  const password = `local-${crypto.randomBytes(10).toString('hex')}`;

  const create = await request('POST', '/api/auth/_diag/create-admin', {
    email,
    password,
    first_name: 'Launch',
    last_name: 'Smoke',
  }, {
    auth: false,
    headers: { 'X-Miwa-Diag-Secret': process.env.JWT_SECRET },
  });
  assertStatus(create, [200, 409], 'local admin bootstrap');

  const login = await request('POST', '/api/auth/login', { email, password }, { auth: false });
  assertStatus(login, 200, 'local clinician login');
  assertBody(login.body?.therapist?.id, 'local login did not return a therapist id');
  context.therapistId = login.body.therapist.id;
  return { status: login.status, therapistId: context.therapistId };
}

async function loginRemoteClinician() {
  const email = process.env.MIWA_SMOKE_EMAIL;
  const password = process.env.MIWA_SMOKE_PASSWORD;
  if (!email || !password) {
    const err = new Error('Remote mode needs MIWA_SMOKE_EMAIL and MIWA_SMOKE_PASSWORD');
    err.safeMessage = 'Remote mode needs MIWA_SMOKE_EMAIL and MIWA_SMOKE_PASSWORD';
    throw err;
  }

  const login = await request('POST', '/api/auth/login', { email, password }, { auth: false });
  assertStatus(login, 200, 'remote clinician login');
  assertBody(login.body?.therapist?.id, 'remote login did not return a therapist id');
  context.therapistId = login.body.therapist.id;
  return { status: login.status, therapistId: context.therapistId };
}

async function archiveSmokePatient() {
  if (!context.patientId) return { skipped: true };
  const res = await request('DELETE', `/api/patients/${context.patientId}`, {
    therapy_ended_at: new Date().toISOString().slice(0, 10),
  });
  assertStatus(res, 200, 'archive smoke patient');
  assertBody(res.body?.archived === true || res.body?.patient?.status === 'archived', 'smoke patient was not archived');
  return { status: res.status, archived: true };
}

(async () => {
  if (!REMOTE_MODE) {
    await runStep('local_server_start', async () => {
      await startLocalServer();
      return { mode: 'local', apiBase: baseUrl };
    });
  }

  await runStep('api_health', async () => {
    const res = await request('GET', '/health', null, { auth: false });
    assertStatus(res, 200, 'health');
    assertBody(res.body?.status === 'ok' && res.body?.service === 'miwa-api', 'health response was not ok');
    return { status: res.status, service: res.body.service };
  });

  await runStep('clinician_login', REMOTE_MODE ? loginRemoteClinician : loginLocalAdmin);

  await runStep('current_user_session', async () => {
    const res = await request('GET', '/api/auth/me');
    assertStatus(res, 200, 'current user session');
    assertBody(res.body?.therapist?.id || res.body?.id, 'current user session did not return a therapist');
    return { status: res.status };
  });

  await runStep('create_smoke_patient', async () => {
    const res = await request('POST', '/api/patients', {
      client_id: context.smokeClientId,
      display_name: 'Smoke Test Client',
      age: 30,
      gender: 'not specified',
      presenting_concerns: 'Non-PHI launch verification',
      session_modality: 'telehealth',
      session_duration: 50,
    });
    assertStatus(res, 201, 'create smoke patient');
    assertBody(res.body?.id, 'create smoke patient did not return id');
    context.patientId = res.body.id;
    return { status: res.status, patientCreated: true };
  });

  await runStep('read_smoke_patient', async () => {
    const res = await request('GET', `/api/patients/${context.patientId}`);
    assertStatus(res, 200, 'read smoke patient');
    assertBody(res.body?.id === context.patientId, 'read smoke patient returned the wrong record');
    return { status: res.status };
  });

  await runStep('create_smoke_session', async () => {
    const res = await request('POST', `/api/patients/${context.patientId}/sessions`, {
      note_format: 'SOAP',
      subjective: 'Fictional smoke test note for launch verification.',
      objective: 'No clinical observations; automated launch check.',
      assessment: 'Non-clinical test session created by launch smoke script.',
      plan: 'Archive test record after verification.',
      session_date: new Date().toISOString().slice(0, 10),
      duration_minutes: 50,
      cpt_code: '90834',
    });
    assertStatus(res, 201, 'create smoke session');
    assertBody(res.body?.id, 'create smoke session did not return id');
    context.sessionId = res.body.id;
    return { status: res.status, sessionCreated: true };
  });

  await runStep('list_patient_sessions', async () => {
    const res = await request('GET', `/api/patients/${context.patientId}/sessions`);
    assertStatus(res, 200, 'list patient sessions');
    assertBody(Array.isArray(res.body) && res.body.some((item) => item.id === context.sessionId), 'created session was not listed');
    return { status: res.status, sessionCount: Array.isArray(res.body) ? res.body.length : undefined };
  });

  await runStep('unsigned_notes_tile_data', async () => {
    const res = await request('GET', '/api/sessions/unsigned');
    assertStatus(res, 200, 'unsigned notes');
    assertBody(Array.isArray(res.body?.sessions), 'unsigned notes response did not include sessions array');
    assertBody(res.body.sessions.some((item) => item.id === context.sessionId), 'created unsigned session was not found');
    return { status: res.status, unsignedCount: res.body.count };
  });

  await runStep('dashboard_stats_update', async () => {
    const res = await request('GET', '/api/stats');
    assertStatus(res, 200, 'dashboard stats');
    assertBody(Number(res.body?.totalPatients) >= 1, 'stats did not include the smoke patient');
    assertBody(Number(res.body?.totalSessions) >= 1, 'stats did not include the smoke session');
    assertBody(Number(res.body?.unsignedNotes) >= 1, 'stats did not include the unsigned smoke note');
    return {
      status: res.status,
      totalPatients: res.body.totalPatients,
      totalSessions: res.body.totalSessions,
      unsignedNotes: res.body.unsignedNotes,
    };
  });

  await runStep('archive_smoke_patient', archiveSmokePatient);

  await runStep('active_patient_cleanup_check', async () => {
    const res = await request('GET', '/api/patients');
    assertStatus(res, 200, 'active patient cleanup check');
    assertBody(Array.isArray(res.body), 'active patient list was not an array');
    assertBody(!res.body.some((item) => item.id === context.patientId), 'archived smoke patient still appears active');
    return { status: res.status };
  });

  if (!REMOTE_MODE) {
    await runStep('local_server_stop', async () => {
      await stopLocalServer();
      return { stopped: true };
    });
  }

  const failed = results.filter((item) => !item.ok);
  const output = {
    ok: failed.length === 0,
    mode: REMOTE_MODE ? 'remote' : 'local',
    apiBase: baseUrl,
    time: new Date().toISOString(),
    summary: {
      pass: results.length - failed.length,
      fail: failed.length,
    },
    results,
  };

  console.log(JSON.stringify(output, null, 2));
  if (failed.length) process.exit(1);
})().catch(async (err) => {
  try { if (!REMOTE_MODE) await stopLocalServer(); } catch {}
  console.error(JSON.stringify({
    ok: false,
    mode: REMOTE_MODE ? 'remote' : 'local',
    apiBase: baseUrl || null,
    time: new Date().toISOString(),
    error: safeError(err),
  }, null, 2));
  process.exit(1);
});
