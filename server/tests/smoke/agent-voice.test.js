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
