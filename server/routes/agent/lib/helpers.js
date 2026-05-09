const { isAIServiceError, safeAIErrorResponse } = require('../../../services/aiClient');

function sendRouteError(res, err) {
  return res.status(isAIServiceError(err) ? 502 : 500).json(safeAIErrorResponse(err));
}

function safePdfDownloadName(title) {
  const base = String(title || 'miwa-report')
    .replace(/[^a-z0-9\-_. ]/gi, '_')
    .slice(0, 90)
    .trim() || 'miwa-report';
  return `${base}.pdf`;
}

function escapeJsonForPrompt(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function safeJsonParse(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function isInternalModelQuestion(text = '') {
  const normalized = String(text).toLowerCase();
  const asksModel = /\b(model|gpt|gpt-4|gpt4|claude|openai|azure|api|deployment|provider|llm|ai engine|system prompt|prompt)\b/.test(normalized);
  const asksIdentity = /\b(what|which|who|how|show|reveal|disclose|tell)\b/.test(normalized) || normalized.includes('are you using') || normalized.includes('do you use');
  return asksModel && asksIdentity;
}

function internalModelDisclosureReply() {
  return "I'm Miwa, your clinical assistant. I can help with scheduling, documentation, assessments, and practice workflows.";
}

function normalizeImageAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments.slice(0, 3).map((attachment, index) => {
    const dataUrl = String(attachment?.dataUrl || attachment?.image_url || '').trim();
    const mime = String(attachment?.mimeType || '').toLowerCase();
    if (!dataUrl.startsWith('data:image/')) return null;
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(dataUrl)) return null;
    if (dataUrl.length > 8_000_000) return null;
    return {
      type: 'input_image',
      image_url: dataUrl,
      detail: 'auto',
      _safeName: `image-${index + 1}.${mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'}`,
    };
  }).filter(Boolean);
}

function inferAppointmentType(patient, overrideType = '') {
  const normalized = String(overrideType || '').trim().toLowerCase();
  if (normalized) return normalized;
  const caseType = String(patient?.client_type || patient?.case_type || '').toLowerCase();
  if (caseType.includes('couple')) return 'couple session';
  if (caseType.includes('family')) return 'family session';
  if (caseType.includes('group')) return 'group session';
  return 'individual session';
}

module.exports = {
  sendRouteError,
  safePdfDownloadName,
  escapeJsonForPrompt,
  safeJsonParse,
  isInternalModelQuestion,
  internalModelDisclosureReply,
  normalizeImageAttachments,
  inferAppointmentType,
};
