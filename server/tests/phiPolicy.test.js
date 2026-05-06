const test = require('node:test');
const assert = require('node:assert/strict');

const { canSendPhiToTextAI, getTextAIProvider } = require('../lib/phiPolicy');

test('PHI policy enables only the OpenAI PHI ZDR provider', () => {
  const env = {
    AI_TEXT_PROVIDER: 'openai',
    OPENAI_PHI_API_KEY: 'phi-key',
    OPENAI_PHI_ZDR_ENABLED: 'true',
  };

  assert.equal(getTextAIProvider(env), 'openai-phi-zdr');
  assert.equal(canSendPhiToTextAI(env), true);
});

test('PHI policy stays off without ZDR confirmation', () => {
  const env = {
    AI_TEXT_PROVIDER: 'openai',
    OPENAI_PHI_API_KEY: 'phi-key',
  };

  assert.equal(canSendPhiToTextAI(env), false);
});

test('PHI policy can be turned off explicitly', () => {
  const env = {
    AI_TEXT_PROVIDER: 'openai',
    OPENAI_PHI_API_KEY: 'phi-key',
    OPENAI_PHI_ZDR_ENABLED: 'true',
    HIPAA_OPENAI_ENABLED: 'false',
  };

  assert.equal(canSendPhiToTextAI(env), false);
});
