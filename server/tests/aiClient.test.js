'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const aiClient = require(path.join(__dirname, '..', 'services', 'aiClient'));

const ORIGINAL_ENV = {
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
  AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT: process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT,
  AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT: process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT,
  AZURE_OPENAI_AUDIO_TRANSCRIPTION_DEPLOYMENT: process.env.AZURE_OPENAI_AUDIO_TRANSCRIPTION_DEPLOYMENT,
  AZURE_OPENAI_AUDIO_TRANSCRIBE_DEPLOYMENT: process.env.AZURE_OPENAI_AUDIO_TRANSCRIBE_DEPLOYMENT,
  AZURE_OPENAI_WHISPER_DEPLOYMENT: process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT,
  AZURE_OPENAI_TTS_DEPLOYMENT: process.env.AZURE_OPENAI_TTS_DEPLOYMENT,
  AZURE_OPENAI_TTS_ENDPOINT: process.env.AZURE_OPENAI_TTS_ENDPOINT,
  AZURE_OPENAI_TTS_KEY: process.env.AZURE_OPENAI_TTS_KEY,
  AZURE_OPENAI_SPEECH_DEPLOYMENT: process.env.AZURE_OPENAI_SPEECH_DEPLOYMENT,
  AZURE_OPENAI_AUDIO_SPEECH_DEPLOYMENT: process.env.AZURE_OPENAI_AUDIO_SPEECH_DEPLOYMENT,
  AZURE_OPENAI_VOICE_DEPLOYMENT: process.env.AZURE_OPENAI_VOICE_DEPLOYMENT,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function captureConsoleError(fn) {
  const original = console.error;
  const calls = [];
  console.error = (...args) => { calls.push(args); };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return calls;
}

afterEach(() => {
  aiClient._test.resetClient();
  restoreEnv();
});

describe('Azure OpenAI client error handling', () => {
  test('missing Azure env vars produce a sanitized AI error', async () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_KEY;
    delete process.env.AZURE_OPENAI_DEPLOYMENT;

    let thrown;
    const logs = await captureConsoleError(async () => {
      try {
        await aiClient.generateAIResponse([
          { role: 'user', content: 'FICTIONAL_SECRET_PROMPT_MARKER missing config test' },
        ]);
      } catch (err) {
        thrown = err;
      }
    });

    assert.ok(aiClient.isAIServiceError(thrown));
    assert.equal(thrown.message, 'The AI service is temporarily unavailable. Please try again in a moment.');
    assert.equal(thrown.ai.provider, 'azure-openai');
    assert.equal(thrown.ai.status_code, 500);
    assert.equal(thrown.ai.error_code, 'azure_config_missing');

    const response = aiClient.safeAIErrorResponse(thrown);
    assert.deepEqual(Object.keys(response).sort(), ['error', 'message', 'provider', 'request_id', 'timestamp'].sort());
    assert.equal(response.error, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(response.provider, 'azure-openai');
    assert.ok(!JSON.stringify(response).includes('FICTIONAL_SECRET_PROMPT_MARKER'));
    assert.ok(!JSON.stringify(logs).includes('FICTIONAL_SECRET_PROMPT_MARKER'));
  });

  test('invalid deployment SDK error is sanitized and preserves metadata only', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com/openai/deployments/gpt-main/chat/completions?api-version=2024-10-21';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';

    const marker = 'FICTIONAL_AZURE_PROMPT_MARKER_99117';
    aiClient._test.setClient({
      responses: {
        create: async () => {
          const err = new Error(`Deployment missing while handling prompt ${marker} at https://example-resource.openai.azure.com`);
          err.status = 404;
          err.code = 'DeploymentNotFound';
          err.type = 'invalid_request_error';
          err.headers = {
            get(name) {
              return name === 'apim-request-id' ? 'req-test-123' : null;
            },
          };
          throw err;
        },
      },
    });

    let thrown;
    const logs = await captureConsoleError(async () => {
      try {
        await aiClient.generateAIResponse([
          { role: 'user', content: `Use this fictional prompt marker: ${marker}` },
        ]);
      } catch (err) {
        thrown = err;
      }
    });

    assert.ok(aiClient.isAIServiceError(thrown));
    assert.equal(thrown.message, 'The AI service is temporarily unavailable. Please try again in a moment.');
    assert.equal(thrown.ai.provider, 'azure-openai');
    assert.equal(thrown.ai.deployment, 'gpt-main');
    assert.equal(thrown.ai.request_id, 'req-test-123');
    assert.equal(thrown.ai.status_code, 404);
    assert.equal(thrown.ai.error_type, 'invalid_request_error');
    assert.equal(thrown.ai.error_code, 'DeploymentNotFound');

    const serializedLogs = JSON.stringify(logs);
    assert.ok(serializedLogs.includes('azure-openai'));
    assert.ok(serializedLogs.includes('req-test-123'));
    assert.ok(!serializedLogs.includes(marker));
    assert.ok(!serializedLogs.includes('example-resource.openai.azure.com'));

    const response = aiClient.safeAIErrorResponse(thrown);
    const serializedResponse = JSON.stringify(response);
    assert.equal(response.error, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(response.message, 'The AI service is temporarily unavailable. Please try again in a moment.');
    assert.equal(response.provider, 'azure-openai');
    assert.equal(response.request_id, 'req-test-123');
    assert.ok(!serializedResponse.includes(marker));
    assert.ok(!serializedResponse.includes('gpt-main'));
    assert.ok(!serializedResponse.includes('DeploymentNotFound'));
  });

  test('audio calls use dedicated Azure deployment names and sanitize failures', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'whisper-main';
    process.env.AZURE_OPENAI_TTS_DEPLOYMENT = 'tts-main';

    const seen = [];
    aiClient._test.setClient({
      audio: {
        transcriptions: {
          create: async (request) => {
            seen.push(['transcribe', request.model]);
            return 'fictional transcript';
          },
        },
        speech: {
          create: async (request) => {
            seen.push(['tts', request.model, request.input]);
            return {
              async arrayBuffer() {
                return Buffer.from('fake-mp3');
              },
            };
          },
        },
      },
    });

    const transcript = await aiClient.transcribeAudioBuffer(Buffer.from('fake audio'), 'recording.webm', 'audio/webm');
    const audio = await aiClient.generateSpeechBuffer('hello fictional client');

    assert.equal(transcript, 'fictional transcript');
    assert.equal(audio.toString(), 'fake-mp3');
    assert.deepEqual(seen.map(row => row.slice(0, 2)), [
      ['transcribe', 'whisper-main'],
      ['tts', 'tts-main'],
    ]);
  });

  test('missing audio deployment env vars fail safely before sending audio', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    delete process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_AUDIO_TRANSCRIPTION_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_AUDIO_TRANSCRIBE_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT;

    const marker = 'FICTIONAL_UNSENT_AUDIO_MARKER_11873';
    let wasCalled = false;
    aiClient._test.setClient({
      audio: {
        transcriptions: {
          create: async () => {
            wasCalled = true;
            return 'should not happen';
          },
        },
      },
    });

    let thrown;
    const logs = await captureConsoleError(async () => {
      try {
        await aiClient.transcribeAudioBuffer(Buffer.from(marker), 'recording.webm', 'audio/webm');
      } catch (err) {
        thrown = err;
      }
    });

    assert.equal(wasCalled, false);
    assert.ok(aiClient.isAIServiceError(thrown));
    assert.equal(thrown.ai.provider, 'azure-openai');
    assert.equal(thrown.ai.deployment, null);
    assert.equal(thrown.ai.status_code, 500);
    assert.equal(thrown.ai.error_type, 'configuration_error');
    assert.equal(thrown.ai.error_code, 'azure_transcription_deployment_missing');
    assert.ok(!JSON.stringify(logs).includes(marker));
    assert.ok(!JSON.stringify(aiClient.safeAIErrorResponse(thrown)).includes(marker));
  });

  test('alternate audio deployment env names are accepted', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    delete process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_AUDIO_TRANSCRIPTION_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_TTS_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_SPEECH_DEPLOYMENT;
    process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT = 'transcribe-alt';
    process.env.AZURE_OPENAI_AUDIO_SPEECH_DEPLOYMENT = 'speech-alt';

    const seen = [];
    aiClient._test.setClient({
      audio: {
        transcriptions: {
          create: async (request) => {
            seen.push(['transcribe', request.model]);
            return { text: 'fictional transcript' };
          },
        },
        speech: {
          create: async (request) => {
            seen.push(['tts', request.model]);
            return {
              async arrayBuffer() {
                return Buffer.from('fake-audio');
              },
            };
          },
        },
      },
    });

    await aiClient.transcribeAudioBuffer(Buffer.from('fake audio'), 'recording.webm', 'audio/webm');
    await aiClient.generateSpeechBuffer('hello');
    assert.deepEqual(seen, [
      ['transcribe', 'transcribe-alt'],
      ['tts', 'speech-alt'],
    ]);
  });

  test('AI config status exposes deployment wiring without secrets', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com/openai/deployments/gpt-main/chat/completions?api-version=2024-10-21';
    process.env.AZURE_OPENAI_KEY = 'super-secret-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main-5-4-mini';
    process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'transcribe-main';
    process.env.AZURE_OPENAI_TTS_DEPLOYMENT = 'voice-main';
    process.env.AZURE_OPENAI_API_VERSION = '2025-04-01-preview';

    const status = aiClient.getAIConfigStatus();

    assert.equal(status.provider, 'azure-openai');
    assert.equal(status.endpointHost, 'example-resource.openai.azure.com');
    assert.equal(status.hasApiKey, true);
    assert.equal(status.mainDeployment, 'gpt-main-5-4-mini');
    assert.equal(status.transcriptionDeployment, 'transcribe-main');
    assert.equal(status.transcriptionEnvVar, 'AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT');
    assert.equal(status.ttsDeployment, 'voice-main');
    assert.equal(status.ttsEnvVar, 'AZURE_OPENAI_TTS_DEPLOYMENT');
    assert.equal(status.ttsEndpointHost, 'example-resource.openai.azure.com');
    assert.equal(status.ttsUsesDedicatedResource, false);
    assert.equal(status.apiVersion, '2025-04-01-preview');

    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes('super-secret-key'));
    assert.ok(!serialized.includes('/openai/deployments'));
  });

  test('TTS can use a dedicated Azure OpenAI endpoint and key without exposing secrets', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://chat-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'main-secret-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    process.env.AZURE_OPENAI_TTS_DEPLOYMENT = 'voice-main';
    process.env.AZURE_OPENAI_TTS_ENDPOINT = 'https://voice-resource.cognitiveservices.azure.com/openai/deployments/voice-main/audio/speech';
    process.env.AZURE_OPENAI_TTS_KEY = 'tts-secret-key';

    const config = aiClient._test.requireTTSAzureConfig();
    const status = aiClient.getAIConfigStatus();

    assert.equal(config.endpoint, 'https://voice-resource.cognitiveservices.azure.com');
    assert.equal(config.apiKey, 'tts-secret-key');
    assert.equal(config.usesDedicatedResource, true);
    assert.equal(status.endpointHost, 'chat-resource.openai.azure.com');
    assert.equal(status.ttsEndpointHost, 'voice-resource.cognitiveservices.azure.com');
    assert.equal(status.ttsEndpointEnvVar, 'AZURE_OPENAI_TTS_ENDPOINT');
    assert.equal(status.ttsKeyEnvVar, 'AZURE_OPENAI_TTS_KEY');
    assert.equal(status.ttsUsesDedicatedResource, true);
    assert.equal(status.ttsHasApiKey, true);
    assert.ok(!JSON.stringify(status).includes('main-secret-key'));
    assert.ok(!JSON.stringify(status).includes('tts-secret-key'));
    assert.ok(!JSON.stringify(status).includes('/openai/deployments'));
  });

  test('TTS dedicated resource requires endpoint and key together', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://chat-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'main-secret-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    process.env.AZURE_OPENAI_TTS_DEPLOYMENT = 'voice-main';
    process.env.AZURE_OPENAI_TTS_ENDPOINT = 'https://voice-resource.cognitiveservices.azure.com';
    delete process.env.AZURE_OPENAI_TTS_KEY;

    let thrown;
    const logs = await captureConsoleError(async () => {
      try {
        aiClient._test.requireTTSAzureConfig();
      } catch (err) {
        thrown = err;
      }
    });

    assert.ok(aiClient.isAIServiceError(thrown));
    assert.equal(thrown.ai.error_code, 'azure_tts_config_incomplete');
    assert.ok(!JSON.stringify(logs).includes('main-secret-key'));
  });

  test('AI config status reports the default Azure API version when unset', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'super-secret-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    delete process.env.AZURE_OPENAI_API_VERSION;

    const status = aiClient.getAIConfigStatus();

    assert.equal(status.apiVersion, '2025-04-01-preview');
    assert.equal(aiClient._test.getAzureApiVersion(), '2025-04-01-preview');
    assert.ok(!JSON.stringify(status).includes('super-secret-key'));
  });

  test('audio deployment errors log deployment metadata without prompt or audio text', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-main';
    process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'whisper-main';

    const marker = 'FICTIONAL_AUDIO_MARKER_33881';
    aiClient._test.setClient({
      audio: {
        transcriptions: {
          create: async () => {
            const err = new Error(`Bad audio deployment while processing ${marker}`);
            err.status = 404;
            err.code = 'DeploymentNotFound';
            throw err;
          },
        },
      },
    });

    let thrown;
    const logs = await captureConsoleError(async () => {
      try {
        await aiClient.transcribeAudioBuffer(Buffer.from(marker), 'recording.webm', 'audio/webm');
      } catch (err) {
        thrown = err;
      }
    });

    assert.ok(aiClient.isAIServiceError(thrown));
    assert.equal(thrown.ai.deployment, 'whisper-main');
    const serializedLogs = JSON.stringify(logs);
    assert.ok(serializedLogs.includes('whisper-main'));
    assert.ok(!serializedLogs.includes(marker));
    assert.ok(!JSON.stringify(aiClient.safeAIErrorResponse(thrown)).includes('whisper-main'));
  });
});
