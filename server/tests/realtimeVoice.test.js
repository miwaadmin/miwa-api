const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRealtimeClientSecret,
  getRealtimeConfig,
  realtimeEnabled,
  sessionForMode,
} = require('../services/realtimeVoice');

function phiRealtimeEnv(overrides = {}) {
  return {
    AI_TEXT_PROVIDER: 'openai',
    OPENAI_PHI_API_KEY: 'phi-key',
    OPENAI_PHI_ZDR_ENABLED: 'true',
    HIPAA_OPENAI_ENABLED: 'true',
    OPENAI_REALTIME_PHI_ENABLED: 'true',
    ...overrides,
  };
}

test('realtime voice requires the PHI/ZDR lane and explicit realtime flag', () => {
  assert.equal(realtimeEnabled(phiRealtimeEnv()), true);
  assert.equal(realtimeEnabled(phiRealtimeEnv({ OPENAI_REALTIME_PHI_ENABLED: 'false' })), false);
  assert.equal(realtimeEnabled(phiRealtimeEnv({ OPENAI_PHI_ZDR_ENABLED: 'false' })), false);
  assert.equal(realtimeEnabled(phiRealtimeEnv({ OPENAI_PHI_API_KEY: '' })), false);
});

test('dictation mode creates a transcription session without assistant output instructions', () => {
  const session = sessionForMode({ mode: 'dictation' }, phiRealtimeEnv({
    OPENAI_REALTIME_TRANSCRIPTION_MODEL: 'gpt-realtime-whisper',
  }));

  assert.equal(session.type, 'transcription');
  assert.equal(session.audio.input.transcription.model, 'gpt-realtime-whisper');
  assert.equal(session.instructions, undefined);
});

test('conversation mode includes clinical and page context instructions', () => {
  const session = sessionForMode({
    mode: 'conversation',
    pageContext: { label: 'Patients', surface: 'patients', patientName: 'Sarah Kim' },
  }, phiRealtimeEnv({ OPENAI_REALTIME_MODEL: 'gpt-realtime-2' }));

  assert.equal(session.type, 'realtime');
  assert.equal(session.model, 'gpt-realtime-2');
  assert.match(session.instructions, /HIPAA-focused clinical copilot/);
  assert.match(session.instructions, /Current Miwa UI context: page=Patients/);
  assert.equal(session.audio.output.voice, getRealtimeConfig(phiRealtimeEnv()).voice);
});

test('client secret request sends only session config and returns Miwa connection metadata', async () => {
  const seen = [];
  const fakeFetch = async (url, options) => {
    seen.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async json() {
        return { client_secret: { value: 'ephemeral-secret' } };
      },
    };
  };

  const result = await createRealtimeClientSecret({
    mode: 'conversation',
    pageContext: { label: 'Dashboard' },
  }, phiRealtimeEnv({ OPENAI_REALTIME_MODEL: 'gpt-realtime-2' }), fakeFetch);

  assert.equal(result.client_secret.value, 'ephemeral-secret');
  assert.equal(result.miwa.mode, 'conversation');
  assert.equal(result.miwa.model, 'gpt-realtime-2');
  assert.equal(result.miwa.realtimeUrl, 'https://api.openai.com/v1/realtime/calls');
  assert.equal(seen[0].url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer phi-key');
  assert.doesNotMatch(seen[0].options.body, /OPENAI_PHI_API_KEY|phi-key/);
});
