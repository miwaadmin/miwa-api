const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRealtimeCallAnswer,
  createRealtimeClientSecret,
  getRealtimeConfig,
  getRealtimeStatus,
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

test('realtime status reports safe diagnostics without secrets', () => {
  const status = getRealtimeStatus(phiRealtimeEnv({
    OPENAI_REALTIME_MODEL: 'gpt-realtime-2',
    OPENAI_REALTIME_TRANSCRIPTION_MODEL: 'gpt-realtime-whisper',
  }));

  assert.equal(status.enabled, true);
  assert.equal(status.textProvider, 'openai-phi-zdr');
  assert.equal(status.openaiPhiKeyConfigured, true);
  // status.model honors the explicit override above
  assert.equal(status.model, 'gpt-realtime-2');
  // The default fallback flipped when we made gpt-realtime-1.5 the primary
  // (gpt-realtime-2 demoted to fallback). No env override for fallback in
  // this test, so we expect the new default.
  assert.equal(status.fallbackModel, 'gpt-realtime-2');
  assert.equal(status.transcriptionModel, 'gpt-realtime-whisper');
  assert.doesNotMatch(JSON.stringify(status), /phi-key|OPENAI_PHI_API_KEY/);
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
  assert.match(session.instructions, /one continuous response/);
  assert.match(session.instructions, /Current Miwa UI context: page=Patients/);
  assert.equal(session.audio.output.voice, getRealtimeConfig(phiRealtimeEnv()).voice);
  assert.equal(session.audio.input.transcription.model, getRealtimeConfig(phiRealtimeEnv()).transcriptionModel);
  assert.equal(session.audio.input.noise_reduction.type, 'near_field');
  assert.equal(session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(session.audio.input.turn_detection.silence_duration_ms, 800);
  assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.equal(session.audio.input.turn_detection.interrupt_response, false);
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

test('unified realtime call sends SDP and session config from the server', async () => {
  const seen = [];
  const fakeFetch = async (url, options) => {
    seen.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async text() {
        return 'v=0\r\no=openai-answer\r\n';
      },
    };
  };

  const result = await createRealtimeCallAnswer('v=0\r\no=browser-offer\r\n', {
    mode: 'conversation',
    pageContext: { label: 'Dashboard' },
    safetyIdentifier: 'hashed-user-id',
  }, phiRealtimeEnv({ OPENAI_REALTIME_MODEL: 'gpt-realtime-2' }), fakeFetch);

  assert.equal(result.answer, 'v=0\r\no=openai-answer\r\n');
  assert.equal(result.model, 'gpt-realtime-2');
  assert.equal(seen[0].url, 'https://api.openai.com/v1/realtime/calls');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer phi-key');
  assert.equal(seen[0].options.headers['OpenAI-Safety-Identifier'], 'hashed-user-id');
  // Forward the SDP byte-for-byte preserving the trailing CRLF — Pion
  // (OpenAI's SDP parser) errors with "failed to unmarshal SDP: EOF" if
  // the final line isn't terminated.
  assert.equal(await seen[0].options.body.get('sdp'), 'v=0\r\no=browser-offer\r\n');
  const session = JSON.parse(await seen[0].options.body.get('session'));
  assert.equal(session.type, 'realtime');
  assert.equal(session.model, 'gpt-realtime-2');
  assert.deepEqual(Object.keys(session.audio).sort(), ['input', 'output']);
  assert.equal(session.audio.input.transcription.model, getRealtimeConfig(phiRealtimeEnv()).transcriptionModel);
  assert.equal(session.audio.input.noise_reduction.type, 'near_field');
  assert.equal(session.audio.input.turn_detection.silence_duration_ms, 800);
  assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.equal(session.audio.input.turn_detection.interrupt_response, false);
  assert.doesNotMatch(JSON.stringify(session), /OPENAI_PHI_API_KEY|phi-key/);
});

test('consult live voice uses trainee supervision style in agency companion mode', () => {
  const session = sessionForMode({
    mode: 'conversation',
    pageContext: {
      label: 'Consult',
      surface: 'consult',
      credentialType: 'trainee',
      workspaceMode: 'agency_companion',
      responseStyle: 'concise',
    },
  }, phiRealtimeEnv());

  assert.match(session.instructions, /page=Consult/);
  assert.match(session.instructions, /credential=trainee/);
  assert.match(session.instructions, /supportive clinical supervisor/);
  assert.match(session.instructions, /Socratic prompts/);
  assert.match(session.instructions, /avoid long monologues/);
});

test('consult live voice uses peer consultant style for licensed clinicians', () => {
  const session = sessionForMode({
    mode: 'conversation',
    pageContext: {
      label: 'Consult',
      surface: 'consult',
      credentialType: 'licensed',
      workspaceMode: 'private_practice',
    },
  }, phiRealtimeEnv());

  assert.match(session.instructions, /collaborative peer consultant/);
  assert.doesNotMatch(session.instructions, /supportive clinical supervisor/);
});

test('unified realtime call retries configured fallback model for model access failures', async () => {
  const seen = [];
  const fakeFetch = async (url, options) => {
    const session = JSON.parse(await options.body.get('session'));
    seen.push(session.model);
    if (seen.length === 1) {
      return {
        ok: false,
        status: 400,
        headers: { get: (name) => name === 'x-request-id' ? 'req_primary' : null },
        async text() {
          return JSON.stringify({ error: { type: 'invalid_request_error', code: 'invalid_model' } });
        },
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async text() {
        return 'v=0\r\no=openai-fallback-answer\r\n';
      },
    };
  };

  const result = await createRealtimeCallAnswer('v=0\r\no=browser-offer\r\n', {
    mode: 'conversation',
  }, phiRealtimeEnv({
    OPENAI_REALTIME_MODEL: 'gpt-realtime-2',
    OPENAI_REALTIME_FALLBACK_MODEL: 'gpt-realtime',
  }), fakeFetch);

  assert.deepEqual(seen, ['gpt-realtime-2', 'gpt-realtime']);
  assert.equal(result.answer, 'v=0\r\no=openai-fallback-answer\r\n');
  assert.equal(result.model, 'gpt-realtime');
  assert.equal(result.fallbackFrom, 'gpt-realtime-2');
});

test('unified realtime call retries configured fallback model for upstream timeouts', async () => {
  const seen = [];
  const fakeFetch = async (url, options) => {
    const session = JSON.parse(await options.body.get('session'));
    seen.push(session.model);
    if (seen.length === 1) {
      return {
        ok: false,
        status: 504,
        headers: { get: () => null },
        async text() {
          return '';
        },
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async text() {
        return 'v=0\r\no=openai-fallback-answer\r\n';
      },
    };
  };

  const result = await createRealtimeCallAnswer('v=0\r\no=browser-offer\r\n', {
    mode: 'conversation',
  }, phiRealtimeEnv({
    OPENAI_REALTIME_MODEL: 'gpt-realtime-2',
    OPENAI_REALTIME_FALLBACK_MODEL: 'gpt-realtime',
  }), fakeFetch);

  assert.deepEqual(seen, ['gpt-realtime-2', 'gpt-realtime']);
  assert.equal(result.answer, 'v=0\r\no=openai-fallback-answer\r\n');
  assert.equal(result.model, 'gpt-realtime');
  assert.equal(result.fallbackFrom, 'gpt-realtime-2');
});

test('unified realtime call exposes safe OpenAI error metadata', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    headers: { get: (name) => name === 'x-request-id' ? 'req_test_123' : null },
    async text() {
      return JSON.stringify({
        error: {
          type: 'invalid_request_error',
          code: 'invalid_model',
          message: 'Model is not available',
        },
      });
    },
  });

  await assert.rejects(
    () => createRealtimeCallAnswer('v=0\r\no=browser-offer\r\n', {}, phiRealtimeEnv(), fakeFetch),
    (err) => {
      assert.equal(err.code, 'REALTIME_CALL_FAILED');
      assert.equal(err.statusCode, 400);
      assert.equal(err.openai.request_id, 'req_test_123');
      assert.equal(err.openai.error_type, 'invalid_request_error');
      assert.equal(err.openai.error_code, 'invalid_model');
      assert.doesNotMatch(JSON.stringify(err.openai), /phi-key|OPENAI_PHI_API_KEY/);
      return true;
    }
  );
});
