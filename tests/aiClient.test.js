'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const aiClient = require(path.join(__dirname, '..', 'services', 'aiClient'));

const ORIGINAL_ENV = {
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
  AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
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
});
