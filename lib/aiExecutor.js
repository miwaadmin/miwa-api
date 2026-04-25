/**
 * Miwa Azure AI Executor
 *
 * All backend AI text/tool calls route through server/services/aiClient.js,
 * which is configured for Azure OpenAI's v1 endpoint only.
 */

const {
  generateAIResponse,
  generateAIResponseWithUsage,
  generateAIResponseWithTools,
} = require('../services/aiClient');
const { logCostEvent, assertBudgetOk } = require('../services/costTracker');

const MODELS = {
  AZURE_MAIN: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-main',
  GPT_FLAGSHIP: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-main',
  GPT_MINI: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-main',
  GPT_NANO: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-main',
};

function logAzure(context, usage = {}, status = 'ok') {
  if (!context || !context.therapistId) return;
  logCostEvent({
    therapistId: context.therapistId,
    kind: context.kind || 'unknown',
    provider: 'azure-openai',
    model: process.env.AZURE_OPENAI_DEPLOYMENT || MODELS.AZURE_MAIN,
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
  const result = await generateAIResponseWithUsage(
    messagesFromPrompts(systemPrompt, userPrompt),
    { maxTokens, jsonMode },
  );
  logAzure(context, result.usage);
  return result.text || '';
}

async function* streamAI(_model, systemPrompt, userPrompt, maxTokens = 2000, context = {}) {
  const text = await callAI(_model, systemPrompt, userPrompt, maxTokens, false, context);
  if (text) yield text;
}

async function callAIWithTools(_model, systemPrompt, messages, tools, maxTokens = 2000, context = {}) {
  if (!context.skipBudgetCheck) assertBudgetOk(context.therapistId);
  const response = await generateAIResponseWithTools(systemPrompt, messages, tools, { maxTokens });
  logAzure(context, response.usage);
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
};
