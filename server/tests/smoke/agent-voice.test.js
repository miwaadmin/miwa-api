const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer,
  stopTestServer,
  api,
  bootstrapAdminAndLogin,
} = require('./_helpers');

test.after(async () => {
  await stopTestServer();
});

test('agent TTS reports voice-only configuration failures without breaking text chat', async () => {
  await startTestServer();
  const { cookie } = await bootstrapAdminAndLogin({
    email: 'voice-tts@miwa.test',
    password: 'test-password-1234',
  });

  process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com';
  process.env.AZURE_OPENAI_KEY = 'test-key';
  process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
  delete process.env.AZURE_OPENAI_TTS_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_SPEECH_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_AUDIO_SPEECH_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_VOICE_DEPLOYMENT;

  const res = await api('POST', '/api/agent/tts', { text: 'Hello from Miwa.' }, cookie);

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'VOICE_UNAVAILABLE');
  assert.match(res.body.message, /Text chat still works/);
});

test('agent realtime session stays disabled until PHI/ZDR realtime is explicitly enabled', async () => {
  await startTestServer();
  const { cookie } = await bootstrapAdminAndLogin({
    email: 'voice-realtime-disabled@miwa.test',
    password: 'test-password-1234',
  });

  process.env.AI_TEXT_PROVIDER = 'openai';
  process.env.OPENAI_PHI_API_KEY = 'test-openai-key';
  process.env.OPENAI_PHI_ZDR_ENABLED = 'true';
  delete process.env.OPENAI_REALTIME_PHI_ENABLED;

  const res = await api('POST', '/api/agent/realtime/session', {
    mode: 'conversation',
    pageContext: { label: 'Dashboard', surface: 'dashboard' },
  }, cookie);

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'REALTIME_VOICE_UNAVAILABLE');
  assert.match(res.body.message, /Classic dictation and text chat still work/);
  assert.equal(res.body.requirements.realtimePhiFlag, 'OPENAI_REALTIME_PHI_ENABLED=true');
});

test('app CSP allows Miwa Live Voice browser connection to OpenAI realtime', async () => {
  const baseUrl = await startTestServer();
  const res = await fetch(`${baseUrl}/t/dashboard`);
  const csp = res.headers.get('content-security-policy') || '';

  assert.equal(res.status, 200);
  assert.match(csp, /connect-src/);
  assert.match(csp, /https:\/\/api\.openai\.com/);
  assert.match(csp, /wss:\/\/api\.openai\.com/);
});
