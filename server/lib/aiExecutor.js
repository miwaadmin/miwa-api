/**
 * Miwa AI Executor
 *
 * All backend AI text/tool calls route through server/services/aiClient.js,
 * which can use Azure OpenAI or the OpenAI API PHI/ZDR lane.
 */

const {
  generateAIResponse,
  generateAIResponseWithUsage,
  generateAIResponseWithTools,
  getAIConfigStatus,
} = require('../services/aiClient');
const { logCostEvent, assertBudgetOk } = require('../services/costTracker');

const MODELS = {
  AZURE_MAIN: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-main',
  GPT_FLAGSHIP: process.env.OPENAI_PHI_MODEL || 'gpt-5.5',
  GPT_MINI: process.env.OPENAI_PHI_FAST_MODEL || 'gpt-5.4-mini',
  GPT_NANO: process.env.OPENAI_PHI_STRUCTURED_MODEL || process.env.OPENAI_PHI_FAST_MODEL || 'gpt-5.4-mini',
};

function getOpenAIModelPolicy() {
  const fast = String(process.env.OPENAI_PHI_FAST_MODEL || 'gpt-5.4-mini').trim();
  return {
    flagship: String(process.env.OPENAI_PHI_MODEL || 'gpt-5.5').trim(),
    fast,
    tools: String(process.env.OPENAI_PHI_TOOL_MODEL || fast).trim(),
    structured: String(process.env.OPENAI_PHI_STRUCTURED_MODEL || fast).trim(),
  };
}

function selectOpenAIModel(context = {}, options = {}) {
  const policy = getOpenAIModelPolicy();
  const tier = String(context.modelTier || '').trim().toLowerCase();
  if (context.model) return String(context.model).trim();
  if (tier && policy[tier]) return policy[tier];
  if (options.tools) return policy.tools;
  if (options.jsonMode) return policy.structured;

  const kind = String(context.kind || '').toLowerCase();
  if (/(classify|intent|extract|structured|news|summary|title|routing|onboarding)/.test(kind)) {
    return policy.structured;
  }
  if (/(clinical|risk|treatment|supervision|court|report|document|analysis|case|brief|session|notes|lap_md)/.test(kind)) {
    return policy.flagship;
  }
  return policy.fast;
}

function logAzure(context, usage = {}, status = 'ok', model = null) {
  if (!context || !context.therapistId) return;
  const aiStatus = getAIConfigStatus();
  logCostEvent({
    therapistId: context.therapistId,
    kind: context.kind || 'unknown',
    provider: aiStatus.textProvider || aiStatus.provider || 'unknown',
    model: model || (
      aiStatus.textProvider === 'openai-phi-zdr'
        ? aiStatus.openaiPhi?.model
        : (process.env.AZURE_OPENAI_DEPLOYMENT || MODELS.AZURE_MAIN)
    ),
    inputTokens: usage.input || 0,
    outputTokens: usage.output || 0,
    status,
  });
}

function messagesFromPrompts(systemPrompt, userPrompt) {
  return [
    {
      role: 'system',
      content: systemPrompt || 'You are a clinical assistant helping therapists.',
    },
    {
      role: 'user',
      content: userPrompt || '',
    },
  ];
}

async function callAI(_model, systemPrompt, userPrompt, maxTokens = 1200, jsonMode = false, context = {}) {
  if (!context.skipBudgetCheck) assertBudgetOk(context.therapistId);
  const model = selectOpenAIModel(context, { jsonMode });
  const result = await generateAIResponseWithUsage(
    messagesFromPrompts(systemPrompt, userPrompt),
    { maxTokens, jsonMode, model },
  );
  logAzure(context, result.usage, 'ok', result.model);
  return result.text || '';
}

async function* streamAI(_model, systemPrompt, userPrompt, maxTokens = 2000, context = {}) {
  const text = await callAI(_model, systemPrompt, userPrompt, maxTokens, false, context);
  if (text) yield text;
}

async function callAIWithTools(_model, systemPrompt, messages, tools, maxTokens = 2000, context = {}) {
  if (!context.skipBudgetCheck) assertBudgetOk(context.therapistId);
  const model = selectOpenAIModel(context, { tools: true });
  const response = await generateAIResponseWithTools(systemPrompt, messages, tools, { maxTokens, model });
  logAzure(context, response.usage, 'ok', response.model);
  return response;
}

async function clinicalReasoning(systemPrompt, userPrompt, maxTokens = 2000, _escalate = false, context = {}) {
  return callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, false, { kind: 'clinical_reasoning', ...context });
}

async function classifyIntent(systemPrompt, userPrompt, maxTokens = 400, context = {}) {
  return callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, false, { kind: 'classify', ...context });
}

async function extractStructured(systemPrompt, userPrompt, maxTokens = 2200, validateFn = null, context = {}) {
  const result = await callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, true, { kind: 'extract', ...context });
  if (validateFn && !validateFn(result)) {
    return callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, true, { kind: 'extract_retry', ...context });
  }
  return result;
}

async function refineText(systemPrompt, userPrompt, maxTokens = 1000, context = {}) {
  return callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, false, { kind: 'refine', ...context });
}

async function synthesizeResearch(systemPrompt, userPrompt, maxTokens = 1400, context = {}) {
  return callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, false, { kind: 'research_brief', ...context });
}

async function summarizeNews(systemPrompt, userPrompt, maxTokens = 300, context = {}) {
  return callAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, false, { kind: 'news_summary', ...context });
}

async function* streamAnalyzeNotes(systemPrompt, userPrompt, maxTokens = 2000, context = {}) {
  yield* streamAI(MODELS.AZURE_MAIN, systemPrompt, userPrompt, maxTokens, { kind: 'analyze_notes', ...context });
}

module.exports = {
  MODELS,
  generateAIResponse,
  callAI,
  streamAI,
  callAIWithTools,
  clinicalReasoning,
  classifyIntent,
  extractStructured,
  refineText,
  synthesizeResearch,
  summarizeNews,
  streamAnalyzeNotes,
  _test: {
    getOpenAIModelPolicy,
    selectOpenAIModel,
  },
};
