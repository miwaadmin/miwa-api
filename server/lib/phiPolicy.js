'use strict';

const OPENAI_PHI_PROVIDER = 'openai-phi-zdr';

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isExplicitlyFalse(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function getTextAIProvider(env = process.env) {
  const configured = String(env.AI_TEXT_PROVIDER || env.AI_PROVIDER || 'azure').trim().toLowerCase();
  if (configured === 'openai' || configured === 'openai-phi' || configured === OPENAI_PHI_PROVIDER) {
    return OPENAI_PHI_PROVIDER;
  }
  if (configured === 'auto') {
    return String(env.OPENAI_PHI_API_KEY || '').trim() && isTruthy(env.OPENAI_PHI_ZDR_ENABLED)
      ? OPENAI_PHI_PROVIDER
      : 'azure-openai';
  }
  return 'azure-openai';
}

function canSendPhiToTextAI(env = process.env) {
  const provider = getTextAIProvider(env);
  const hipaaFlagAllows = !isExplicitlyFalse(env.HIPAA_OPENAI_ENABLED);
  return provider === OPENAI_PHI_PROVIDER
    && Boolean(String(env.OPENAI_PHI_API_KEY || '').trim())
    && isTruthy(env.OPENAI_PHI_ZDR_ENABLED)
    && hipaaFlagAllows;
}

module.exports = {
  OPENAI_PHI_PROVIDER,
  canSendPhiToTextAI,
  getTextAIProvider,
};
