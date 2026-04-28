const { OpenAI, toFile } = require('openai');

const AI_PROVIDER = 'azure-openai';
const GENERIC_AI_MESSAGE = 'The AI service is temporarily unavailable. Please try again in a moment.';

class AIServiceError extends Error {
  constructor(metadata = {}) {
    super(GENERIC_AI_MESSAGE);
    this.name = 'AIServiceError';
    this.statusCode = 502;
    this.expose = true;
    this.ai = {
      provider: AI_PROVIDER,
      deployment: metadata.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || null,
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

function requireAzureConfig() {
  const endpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
    throw sanitizeAIError({
      status: 500,
      code: 'azure_config_missing',
      type: 'configuration_error',
    });
  }

  return { endpoint, apiKey, deployment };
}

let aiClientInstance = null;
let testClient = null;

function getAIClient() {
  if (testClient) return testClient;
  if (aiClientInstance) return aiClientInstance;
  const { endpoint, apiKey } = requireAzureConfig();
  aiClientInstance = new OpenAI({
    apiKey,
    baseURL: `${endpoint}/openai/v1/`,
  });
  return aiClientInstance;
}

// IMPORTANT: ALL PHI MUST GO THROUGH AZURE ONLY
// DO NOT add fallback providers here

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
  const metadata = {
    deployment: overrides.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || null,
    request_id: getRequestId(err),
    status_code: err?.status || err?.statusCode || err?.response?.status || null,
    error_type: err?.type || err?.error?.type || err?.name || null,
    error_code: err?.code || err?.error?.code || null,
    timestamp: new Date().toISOString(),
  };
  const safe = new AIServiceError(metadata);
  console.error('[aiClient] Azure OpenAI request failed', safe.ai);
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
    provider: AI_PROVIDER,
    request_id: err.ai?.request_id || null,
    timestamp: err.ai?.timestamp || new Date().toISOString(),
  };
}

function safeAIErrorMessage(err) {
  return isAIServiceError(err) ? GENERIC_AI_MESSAGE : (err?.message || 'Something went wrong.');
}

async function runAzureRequest(fn, metadata = {}) {
  try {
    return await fn();
  } catch (err) {
    if (isAIServiceError(err)) throw err;
    throw sanitizeAIError(err, metadata);
  }
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
  const { deployment } = requireAzureConfig();
  const request = {
    model: deployment,
    input: messages,
  };

  if (options.maxTokens) request.max_output_tokens = options.maxTokens;
  if (options.jsonMode) {
    request.text = { format: { type: 'json_object' } };
  }

  const response = await runAzureRequest(() => getAIClient().responses.create(request));
  return extractResponseText(response) || '';
}

async function generateAIResponseWithUsage(messages, options = {}) {
  const { deployment } = requireAzureConfig();
  const request = {
    model: deployment,
    input: messages,
  };

  if (options.maxTokens) request.max_output_tokens = options.maxTokens;
  if (options.jsonMode) {
    request.text = { format: { type: 'json_object' } };
  }

  const response = await runAzureRequest(() => getAIClient().responses.create(request));
  return {
    text: extractResponseText(response) || '',
    usage: azureUsage(response),
    raw: response,
  };
}

async function generateAIResponseWithTools(systemPrompt, messages, tools, options = {}) {
  const { deployment } = requireAzureConfig();
  const input = [
    { role: 'system', content: systemPrompt || 'You are a clinical assistant helping therapists.' },
    ...normalizeMessages(messages),
  ];
  const response = await runAzureRequest(() => getAIClient().responses.create({
    model: deployment,
    input,
    max_output_tokens: options.maxTokens || 2000,
    tools: (tools || []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
    })),
    tool_choice: 'auto',
  }));

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
  const deployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT || 'whisper-1';
  const audioFile = await toFile(buffer, filename || 'recording.webm', { type: mimeType || 'application/octet-stream' });
  const result = await runAzureRequest(() => getAIClient().audio.transcriptions.create({
    file: audioFile,
    model: deployment,
    response_format: 'text',
  }), { deployment });
  return typeof result === 'string' ? result.trim() : (result?.text || '').trim();
}

async function generateSpeechBuffer(text, options = {}) {
  const deployment = process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'tts-1';
  const audio = await runAzureRequest(() => getAIClient().audio.speech.create({
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
  AIServiceError,
  isAIServiceError,
  safeAIErrorResponse,
  safeAIErrorMessage,
  _test: {
    setClient(client) { testClient = client; },
    resetClient() { testClient = null; aiClientInstance = null; },
    sanitizeAIError,
    normalizeEndpoint,
  },
};
