'use strict';

const ACTION_KINDS = Object.freeze([
  'show_client',
  'open_case',
  'schedule_picker',
  'draft_letter',
  'risk_review',
  'assessment_batch_preview',
  'create_follow_up_task',
  'prepare_session',
]);

const ACTION_STATUSES = Object.freeze([
  'ready',
  'loading',
  'empty',
  'error',
  'needs_permission',
  'completed',
]);

function makeActionId(kind) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function validateAssistantAction(action) {
  const errors = [];
  if (!action || typeof action !== 'object') {
    return { ok: false, errors: ['action must be an object'] };
  }
  if (!ACTION_KINDS.includes(action.kind)) errors.push(`unsupported action kind: ${action.kind}`);
  if (!ACTION_STATUSES.includes(action.status || 'ready')) errors.push(`unsupported action status: ${action.status}`);
  if (!normalizeString(action.title)) errors.push('title is required');
  if (action.payload !== undefined && (action.payload === null || typeof action.payload !== 'object' || Array.isArray(action.payload))) {
    errors.push('payload must be an object');
  }
  if (action.actions !== undefined && !Array.isArray(action.actions)) errors.push('actions must be an array');
  return { ok: errors.length === 0, errors };
}

function createAssistantAction(kind, options = {}) {
  const action = {
    id: normalizeString(options.id, makeActionId(kind)),
    kind,
    status: options.status || 'ready',
    title: normalizeString(options.title, kind.replace(/_/g, ' ')),
    summary: normalizeString(options.summary, ''),
    payload: options.payload && typeof options.payload === 'object' && !Array.isArray(options.payload) ? options.payload : {},
    actions: Array.isArray(options.actions) ? options.actions : [],
    meta: options.meta && typeof options.meta === 'object' && !Array.isArray(options.meta) ? options.meta : {},
  };
  const validation = validateAssistantAction(action);
  if (!validation.ok) {
    action.status = 'error';
    action.title = action.title || 'Clinical action';
    action.summary = validation.errors.join('; ');
  }
  return action;
}

function emitAssistantAction(send, action) {
  const validation = validateAssistantAction(action);
  if (!validation.ok || typeof send !== 'function') return false;
  send({ type: 'assistant_action', action });
  return true;
}

module.exports = {
  ACTION_KINDS,
  ACTION_STATUSES,
  createAssistantAction,
  emitAssistantAction,
  validateAssistantAction,
};
