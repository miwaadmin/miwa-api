const { OpenAI, AzureOpenAI, toFile } = require('openai');

const AZURE_AI_PROVIDER = 'azure-openai';
const OPENAI_PHI_PROVIDER = 'openai-phi-zdr';
const GENERIC_AI_MESSAGE = 'The AI service is temporarily unavailable. Please try again in a moment.';
const DEFAULT_AZURE_OPENAI_API_VERSION = '2025-04-01-preview';
const DEFAULT_OPENAI_PHI_MODEL = 'gpt-5.5';
const TRANSCRIPTION_DEPLOYMENT_ENV_NAMES = [
  'AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT',
  'AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT',
  'AZURE_OPENAI_AUDIO_TRANSCRIPTION_DEPLOYMENT',
  'AZURE_OPENAI_AUDIO_TRANSCRIBE_DEPLOYMENT',
  'AZURE_OPENAI_WHISPER_DEPLOYMENT',
];
const TTS_DEPLOYMENT_ENV_NAMES = [
  'AZURE_OPENAI_TTS_DEPLOYMENT',
  'AZURE_OPENAI_SPEECH_DEPLOYMENT',
  'AZURE_OPENAI_AUDIO_SPEECH_DEPLOYMENT',
  'AZURE_OPENAI_VOICE_DEPLOYMENT',
];
const TTS_ENDPOINT_ENV_NAMES = [
  'AZURE_OPENAI_TTS_ENDPOINT',
  'AZURE_OPENAI_SPEECH_ENDPOINT',
  'AZURE_OPENAI_AUDIO_SPEECH_ENDPOINT',
  'AZURE_OPENAI_VOICE_ENDPOINT',
];
const TTS_KEY_ENV_NAMES = [
  'AZURE_OPENAI_TTS_KEY',
  'AZURE_OPENAI_SPEECH_KEY',
  'AZURE_OPENAI_AUDIO_SPEECH_KEY',
  'AZURE_OPENAI_VOICE_KEY',
];

class AIServiceError extends Error {
  constructor(metadata = {}) {
    super(GENERIC_AI_MESSAGE);
    this.name = 'AIServiceError';
    this.statusCode = 502;
    this.expose = true;
    const hasDeploymentMetadata = Object.prototype.hasOwnProperty.call(metadata, 'deployment');
    const provider = metadata.provider || getTextAIProvider();
    this.ai = {
      provider,
      deployment: hasDeploymentMetadata ? metadata.deployment : getDefaultModelForProvider(provider),
      request_id: metadata.request_id || null,
      status_code: metadata.status_code || null,
      error_type: metadata.error_type || null,
      error_code: metadata.error_code || null,
      timestamp: metadata.timestamp || new Date().toISOString(),
    };
  }
}

function normalizeEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function getAzureApiVersion() {
  return String(process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_OPENAI_API_VERSION).trim();
}

function isTruthyEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function getTextAIProvider() {
  const configured = String(process.env.AI_TEXT_PROVIDER || process.env.AI_PROVIDER || 'azure').trim().toLowerCase();
  if (configured === 'openai' || configured === 'openai-phi' || configured === 'openai-phi-zdr') return OPENAI_PHI_PROVIDER;
  if (configured === 'auto') {
    return String(process.env.OPENAI_PHI_API_KEY || '').trim() && isTruthyEnv('OPENAI_PHI_ZDR_ENABLED')
      ? OPENAI_PHI_PROVIDER
      : AZURE_AI_PROVIDER;
  }
  return AZURE_AI_PROVIDER;
}

function getOpenAIModel() {
  return String(process.env.OPENAI_PHI_MODEL || DEFAULT_OPENAI_PHI_MODEL).trim();
}

function getDefaultModelForProvider(provider = getTextAIProvider()) {
  return provider === OPENAI_PHI_PROVIDER
    ? getOpenAIModel()
    : (process.env.AZURE_OPENAI_DEPLOYMENT || null);
}

function requireAzureConfig() {
  const endpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = getAzureApiVersion();

  if (!endpoint || !apiKey || !deployment) {
    throw sanitizeAIError({
      status: 500,
      code: 'azure_config_missing',
      type: 'configuration_error',
    });
  }

  return { endpoint, apiKey, deployment, apiVersion };
}

function requireOpenAIConfig() {
  const apiKey = String(process.env.OPENAI_PHI_API_KEY || '').trim();
  const model = getOpenAIModel();

  if (!apiKey || !model) {
    throw sanitizeAIError({
      status: 500,
      code: 'openai_phi_config_missing',
      type: 'configuration_error',
    }, {
      provider: OPENAI_PHI_PROVIDER,
      deployment: model || null,
    });
  }

  if (!isTruthyEnv('OPENAI_PHI_ZDR_ENABLED')) {
    throw sanitizeAIError({
      status: 500,
      code: 'openai_phi_zdr_not_confirmed',
      type: 'configuration_error',
    }, {
      provider: OPENAI_PHI_PROVIDER,
      deployment: model,
    });
  }

  return { apiKey, model };
}

let aiClientInstance = null;
let openAIClientInstance = null;
let audioClientInstance = null;
let ttsClientInstance = null;
let testClient = null;
let testAudioClient = null;

function getAIClient() {
  if (testClient) return testClient;
  if (getTextAIProvider() === OPENAI_PHI_PROVIDER) return getOpenAIClient();
  if (aiClientInstance) return aiClientInstance;
  const { endpoint, apiKey } = requireAzureConfig();
  aiClientInstance = new OpenAI({
    apiKey,
    baseURL: `${endpoint}/openai/v1/`,
  });
  return aiClientInstance;
}

function getOpenAIClient() {
  if (testClient) return testClient;
  if (openAIClientInstance) return openAIClientInstance;
  const { apiKey } = requireOpenAIConfig();
  openAIClientInstance = new OpenAI({ apiKey });
  return openAIClientInstance;
}

function getAudioAIClient() {
  if (testAudioClient) return testAudioClient;
  if (testClient) return testClient;
  if (audioClientInstance) return audioClientInstance;
  const { endpoint, apiKey, apiVersion } = requireAzureConfig();
  audioClientInstance = new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion,
  });
  return audioClientInstance;
}

function requireTTSAzureConfig() {
  const base = requireAzureConfig();
  const endpointMatch = getFirstEnvMatch(TTS_ENDPOINT_ENV_NAMES);
  const keyMatch = getFirstEnvMatch(TTS_KEY_ENV_NAMES);
  const hasDedicatedEndpoint = Boolean(endpointMatch.value);
  const hasDedicatedKey = Boolean(keyMatch.value);

  if (hasDedicatedEndpoint !== hasDedicatedKey) {
    throw sanitizeAIError({
      status: 500,
      code: 'azure_tts_config_incomplete',
      type: 'configuration_error',
    });
  }

  return {
    endpoint: hasDedicatedEndpoint ? normalizeEndpoint(endpointMatch.value) : base.endpoint,
    apiKey: hasDedicatedKey ? keyMatch.value : base.apiKey,
    apiVersion: base.apiVersion,
    endpointEnvVar: endpointMatch.name,
    keyEnvVar: keyMatch.name,
    usesDedicatedResource: hasDedicatedEndpoint && hasDedicatedKey,
  };
}

function getTTSAIClient() {
  if (testAudioClient) return testAudioClient;
  if (testClient) return testClient;
  if (ttsClientInstance) return ttsClientInstance;
  const { endpoint, apiKey, apiVersion } = requireTTSAzureConfig();
  ttsClientInstance = new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion,
  });
  return ttsClientInstance;
}

// IMPORTANT: PHI may only use BAA-backed, approved providers.
// Text calls can use Azure OpenAI or OpenAI API with BAA + ZDR enabled.
// Audio remains on the Azure path unless explicitly reviewed later.

function getRequestId(err) {
  return err?.request_id
    || err?.requestId
    || err?.headers?.['x-request-id']
    || err?.headers?.['apim-request-id']
    || err?.headers?.get?.('x-request-id')
    || err?.headers?.get?.('apim-request-id')
    || null;
}

function sanitizeAIError(err, overrides = {}) {
  const hasDeploymentOverride = Object.prototype.hasOwnProperty.call(overrides, 'deployment');
  const provider = overrides.provider || getTextAIProvider();
  const metadata = {
    provider,
    deployment: hasDeploymentOverride ? overrides.deployment : getDefaultModelForProvider(provider),
    request_id: getRequestId(err),
    status_code: err?.status || err?.statusCode || err?.response?.status || null,
    error_type: err?.type || err?.error?.type || err?.name || null,
    error_code: err?.code || err?.error?.code || null,
    timestamp: new Date().toISOString(),
  };
  const safe = new AIServiceError(metadata);
  console.error('[aiClient] AI request failed', safe.ai);
  return safe;
}

function isAIServiceError(err) {
  return err instanceof AIServiceError || err?.name === 'AIServiceError';
}

function safeAIErrorResponse(err) {
  if (!isAIServiceError(err)) {
    return { error: err?.message || 'Something went wrong.' };
  }
  return {
    error: 'AI_SERVICE_UNAVAILABLE',
    message: GENERIC_AI_MESSAGE,
    provider: err.ai?.provider || getTextAIProvider(),
    request_id: err.ai?.request_id || null,
    timestamp: err.ai?.timestamp || new Date().toISOString(),
  };
}

function safeAIErrorMessage(err) {
  return isAIServiceError(err) ? GENERIC_AI_MESSAGE : (err?.message || 'Something went wrong.');
}

async function runAIRequest(fn, metadata = {}) {
  try {
    return await fn();
  } catch (err) {
    if (isAIServiceError(err)) throw err;
    throw sanitizeAIError(err, metadata);
  }
}

async function runAzureRequest(fn, metadata = {}) {
  return runAIRequest(fn, { provider: AZURE_AI_PROVIDER, ...metadata });
}

async function runTextAIRequest(fn, metadata = {}) {
  return runAIRequest(fn, { provider: getTextAIProvider(), ...metadata });
}

function getFirstEnvMatch(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return { name, value };
  }
  return { name: null, value: '' };
}

function getFirstEnvValue(names) {
  return getFirstEnvMatch(names).value;
}

function getEndpointHost(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) return null;
  try {
    return new URL(normalized).host;
  } catch {
    return null;
  }
}

function getAIConfigStatus() {
  const textProvider = getTextAIProvider();
  const endpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
  const transcription = getFirstEnvMatch(TRANSCRIPTION_DEPLOYMENT_ENV_NAMES);
  const tts = getFirstEnvMatch(TTS_DEPLOYMENT_ENV_NAMES);
  const ttsEndpoint = getFirstEnvMatch(TTS_ENDPOINT_ENV_NAMES);
  const ttsKey = getFirstEnvMatch(TTS_KEY_ENV_NAMES);
  const ttsUsesDedicatedResource = Boolean(ttsEndpoint.value && ttsKey.value);

  return {
    provider: textProvider,
    textProvider,
    openaiPhi: {
      configured: Boolean(String(process.env.OPENAI_PHI_API_KEY || '').trim()),
      zdrConfirmed: isTruthyEnv('OPENAI_PHI_ZDR_ENABLED'),
      model: getOpenAIModel(),
      projectIdConfigured: Boolean(String(process.env.OPENAI_PHI_PROJECT_ID || '').trim()),
    },
    azureConfigured: Boolean(endpoint && String(process.env.AZURE_OPENAI_KEY || '').trim() && String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim()),
    endpointHost: getEndpointHost(endpoint),
    hasApiKey: Boolean(String(process.env.AZURE_OPENAI_KEY || '').trim()),
    mainDeployment: String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim() || null,
    transcriptionDeployment: transcription.value || null,
    transcriptionEnvVar: transcription.name,
    ttsDeployment: tts.value || null,
    ttsEnvVar: tts.name,
    ttsEndpointHost: ttsUsesDedicatedResource ? getEndpointHost(ttsEndpoint.value) : getEndpointHost(endpoint),
    ttsEndpointEnvVar: ttsEndpoint.name,
    ttsHasApiKey: ttsUsesDedicatedResource ? true : Boolean(String(process.env.AZURE_OPENAI_KEY || '').trim()),
    ttsKeyEnvVar: ttsKey.name,
    ttsUsesDedicatedResource,
    apiVersion: getAzureApiVersion(),
  };
}

function requireAudioDeployment(kind, envNames) {
  const deployment = getFirstEnvValue(envNames);
  if (deployment) return deployment;

  throw sanitizeAIError({
    status: 500,
    code: `azure_${kind}_deployment_missing`,
    type: 'configuration_error',
  }, {
    deployment: null,
  });
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');

  return content.map((block) => {
    if (!block) return '';
    if (block.type === 'text') return block.text || '';
    if (block.type === 'tool_result') return `Tool result (${block.tool_use_id || 'unknown'}): ${block.content || ''}`;
    if (block.type === 'tool_use') return `Tool call (${block.name || 'unknown'}): ${JSON.stringify(block.input || {})}`;
    return typeof block === 'string' ? block : JSON.stringify(block);
  }).filter(Boolean).join('\n');
}

function normalizeMessages(messages) {
  return (messages || []).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: normalizeMessageContent(message.content),
  }));
}

function extractResponseText(response) {
  if (response?.output_text) return response.output_text;

  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content.text) chunks.push(content.text);
      if (content?.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('');
}

function azureUsage(response) {
  return {
    input: response?.usage?.input_tokens || 0,
    output: response?.usage?.output_tokens || 0,
  };
}

async function generateAIResponse(messages, options = {}) {
  const provider = getTextAIProvider();
  const deployment = provider === OPENAI_PHI_PROVIDER ? requireOpenAIConfig().model : requireAzureConfig().deployment;
  const request = {
    model: deployment,
    input: messages,
    store: false,
  };

  if (options.maxTokens) request.max_output_tokens = options.maxTokens;
  if (options.jsonMode) {
    request.text = { format: { type: 'json_object' } };
  }

  const response = await runTextAIRequest(() => getAIClient().responses.create(request), { deployment });
  return extractResponseText(response) || '';
}

async function generateAIResponseWithUsage(messages, options = {}) {
  const provider = getTextAIProvider();
  const deployment = provider === OPENAI_PHI_PROVIDER ? requireOpenAIConfig().model : requireAzureConfig().deployment;
  const request = {
    model: deployment,
    input: messages,
    store: false,
  };

  if (options.maxTokens) request.max_output_tokens = options.maxTokens;
  if (options.jsonMode) {
    request.text = { format: { type: 'json_object' } };
  }

  const response = await runTextAIRequest(() => getAIClient().responses.create(request), { deployment });
  return {
    text: extractResponseText(response) || '',
    usage: azureUsage(response),
    raw: response,
  };
}

async function generateAIResponseWithTools(systemPrompt, messages, tools, options = {}) {
  const provider = getTextAIProvider();
  const deployment = provider === OPENAI_PHI_PROVIDER ? requireOpenAIConfig().model : requireAzureConfig().deployment;
  const input = [
    { role: 'system', content: systemPrompt || 'You are a clinical assistant helping therapists.' },
    ...normalizeMessages(messages),
  ];
  const response = await runTextAIRequest(() => getAIClient().responses.create({
    model: deployment,
    input,
    store: false,
    max_output_tokens: options.maxTokens || 2000,
    tools: (tools || []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
    })),
    tool_choice: 'auto',
  }), { provider, deployment });

  const content = [];
  const text = extractResponseText(response);
  if (text) content.push({ type: 'text', text });

  for (const item of response?.output || []) {
    if (item?.type === 'function_call') {
      let inputArgs = {};
      try {
        inputArgs = JSON.parse(item.arguments || '{}');
      } catch {
        inputArgs = {};
      }
      content.push({
        type: 'tool_use',
        id: item.call_id || item.id,
        name: item.name,
        input: inputArgs,
      });
    }
  }

  return {
    content,
    stop_reason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: azureUsage(response),
    raw: response,
  };
}

async function transcribeAudioBuffer(buffer, filename, mimeType) {
  const deployment = requireAudioDeployment('transcription', TRANSCRIPTION_DEPLOYMENT_ENV_NAMES);
  const audioFile = await toFile(buffer, filename || 'recording.webm', { type: mimeType || 'application/octet-stream' });
  const result = await runAzureRequest(() => getAudioAIClient().audio.transcriptions.create({
    file: audioFile,
    model: deployment,
    response_format: 'text',
  }), { deployment });
  return typeof result === 'string' ? result.trim() : (result?.text || '').trim();
}

async function generateSpeechBuffer(text, options = {}) {
  const deployment = requireAudioDeployment('tts', TTS_DEPLOYMENT_ENV_NAMES);
  const audio = await runAzureRequest(() => getTTSAIClient().audio.speech.create({
    model: deployment,
    voice: options.voice || 'nova',
    input: text,
    response_format: options.responseFormat || 'mp3',
  }), { deployment });
  return Buffer.from(await audio.arrayBuffer());
}

module.exports = {
  aiClient: new Proxy({}, {
    get(_target, prop) {
      return getAIClient()[prop];
    },
  }),
  generateAIResponse,
  generateAIResponseWithUsage,
  generateAIResponseWithTools,
  transcribeAudioBuffer,
  generateSpeechBuffer,
  getAIConfigStatus,
  AIServiceError,
  isAIServiceError,
  safeAIErrorResponse,
  safeAIErrorMessage,
  _test: {
    setClient(client) { testClient = client; },
    setAudioClient(client) { testAudioClient = client; },
    resetClient() {
      testClient = null;
      testAudioClient = null;
      aiClientInstance = null;
      openAIClientInstance = null;
      audioClientInstance = null;
      ttsClientInstance = null;
    },
    sanitizeAIError,
    normalizeEndpoint,
    requireTTSAzureConfig,
    requireOpenAIConfig,
    getAzureApiVersion,
    getTextAIProvider,
  },
};
