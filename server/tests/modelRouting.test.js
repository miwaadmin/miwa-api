'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const aiExecutor = require(path.join(__dirname, '..', 'lib', 'aiExecutor'));

const ORIGINAL_ENV = {
  OPENAI_PHI_MODEL: process.env.OPENAI_PHI_MODEL,
  OPENAI_PHI_FAST_MODEL: process.env.OPENAI_PHI_FAST_MODEL,
  OPENAI_PHI_TOOL_MODEL: process.env.OPENAI_PHI_TOOL_MODEL,
  OPENAI_PHI_STRUCTURED_MODEL: process.env.OPENAI_PHI_STRUCTURED_MODEL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);

describe('OpenAI PHI model routing policy', () => {
  test('uses flagship only for high-stakes clinical reasoning categories', () => {
    process.env.OPENAI_PHI_MODEL = 'gpt-5.5-custom';
    process.env.OPENAI_PHI_FAST_MODEL = 'gpt-5.4-mini-custom';
    process.env.OPENAI_PHI_TOOL_MODEL = 'gpt-5.4-mini-tools';
    process.env.OPENAI_PHI_STRUCTURED_MODEL = 'gpt-5.4-mini-structured';

    assert.equal(
      aiExecutor._test.selectOpenAIModel({ kind: 'risk_review' }),
      'gpt-5.5-custom',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ kind: 'clinical_report' }),
      'gpt-5.5-custom',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ kind: 'classify_intent' }),
      'gpt-5.4-mini-structured',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ kind: 'extract_assessment' }, { jsonMode: true }),
      'gpt-5.4-mini-structured',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ kind: 'agent_chat' }, { tools: true }),
      'gpt-5.4-mini-tools',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ kind: 'page_suggestions' }),
      'gpt-5.4-mini-custom',
    );
  });

  test('allows explicit model and model tier overrides from server context', () => {
    process.env.OPENAI_PHI_MODEL = 'gpt-5.5';
    process.env.OPENAI_PHI_FAST_MODEL = 'gpt-5.4-mini';

    assert.equal(
      aiExecutor._test.selectOpenAIModel({ model: 'gpt-5.5-audit' }),
      'gpt-5.5-audit',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ modelTier: 'fast', kind: 'clinical_report' }),
      'gpt-5.4-mini',
    );
    assert.equal(
      aiExecutor._test.selectOpenAIModel({ modelTier: 'flagship', kind: 'classify' }),
      'gpt-5.5',
    );
  });
});
