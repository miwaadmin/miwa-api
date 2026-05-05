export const ASSISTANT_ACTION_KINDS = [
  'show_client',
  'open_case',
  'schedule_picker',
  'draft_letter',
  'risk_review',
  'assessment_batch_preview',
  'create_follow_up_task',
  'prepare_session',
]

export const ASSISTANT_ACTION_STATUSES = [
  'ready',
  'loading',
  'empty',
  'error',
  'needs_permission',
  'completed',
]

export function validateAssistantAction(action) {
  const errors = []
  if (!action || typeof action !== 'object') {
    return { ok: false, errors: ['action must be an object'] }
  }
  if (!ASSISTANT_ACTION_KINDS.includes(action.kind)) errors.push(`unsupported action kind: ${action.kind}`)
  if (!ASSISTANT_ACTION_STATUSES.includes(action.status || 'ready')) errors.push(`unsupported action status: ${action.status}`)
  if (!String(action.title || '').trim()) errors.push('title is required')
  if (action.payload !== undefined && (action.payload === null || typeof action.payload !== 'object' || Array.isArray(action.payload))) {
    errors.push('payload must be an object')
  }
  if (action.actions !== undefined && !Array.isArray(action.actions)) errors.push('actions must be an array')
  return { ok: errors.length === 0, errors }
}

export function normalizeAssistantAction(action) {
  const validation = validateAssistantAction(action)
  if (!validation.ok) {
    return {
      id: `invalid-action-${Date.now()}`,
      kind: 'open_case',
      status: 'error',
      title: 'Action unavailable',
      summary: validation.errors.join('; '),
      payload: {},
      actions: [],
      meta: {},
    }
  }
  return {
    id: action.id || `${action.kind}-${Date.now()}`,
    kind: action.kind,
    status: action.status || 'ready',
    title: action.title,
    summary: action.summary || '',
    payload: action.payload || {},
    actions: Array.isArray(action.actions) ? action.actions : [],
    meta: action.meta || {},
  }
}
