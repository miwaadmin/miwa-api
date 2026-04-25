const DEFAULT_PERMISSION_SCOPES = ['history', 'patient_context', 'session_context', 'documents']
const VALID_PERMISSION_SCOPES = new Set([
  'history',
  'patient_context',
  'session_context',
  'documents',
  'assessments',
  'supervision_notes',
])

const DEFAULT_ASSISTANT_PROFILE = {
  action_mode: 'draft_only',
  tone: 'calm, clinical, and collaborative',
  orientation: 'integrative',
  verbosity: 'balanced',
  memory: '',
  permissions: DEFAULT_PERMISSION_SCOPES,
}

function parseAssistantPermissions(raw) {
  if (!raw) return [...DEFAULT_PERMISSION_SCOPES]

  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      value = raw.split(',').map(s => s.trim()).filter(Boolean)
    }
  }

  if (!Array.isArray(value)) return [...DEFAULT_PERMISSION_SCOPES]

  const scopes = value
    .map(scope => String(scope || '').trim())
    .filter(scope => VALID_PERMISSION_SCOPES.has(scope))

  return scopes.length ? [...new Set(scopes)] : [...DEFAULT_PERMISSION_SCOPES]
}

function normalizeAssistantProfile(row = {}) {
  return {
    action_mode: row.assistant_action_mode || DEFAULT_ASSISTANT_PROFILE.action_mode,
    tone: row.assistant_tone || DEFAULT_ASSISTANT_PROFILE.tone,
    orientation: row.assistant_orientation || DEFAULT_ASSISTANT_PROFILE.orientation,
    verbosity: row.assistant_verbosity || DEFAULT_ASSISTANT_PROFILE.verbosity,
    memory: row.assistant_memory || '',
    permissions: parseAssistantPermissions(row.assistant_permissions_json),
  }
}

function serializeAssistantPermissions(value) {
  return JSON.stringify(parseAssistantPermissions(value))
}

function assistantVerbosityInstruction(verbosity) {
  switch (verbosity) {
    case 'concise':
      return 'Be brief, skimmable, and direct. Prioritize the highest-value clinical point first. Use short bullets or compact paragraphs.'
    case 'detailed':
      return 'Be thorough, nuanced, and explanatory. Show reasoning clearly, but avoid filler.'
    default:
      return 'Balance brevity with enough detail to be clinically useful. Keep the answer easy to scan.'
  }
}

function assistantActionModeInstruction(actionMode) {
  switch (actionMode) {
    case 'read_only':
      return 'Operate in read-only mode. Analyze, explain, and summarize. Do not propose changes that imply you can modify records, send messages, or perform actions on the user\'s behalf.'
    case 'approve_to_act':
      return 'Operate in approve-to-act mode. You may draft and prepare actions, but you must clearly label anything that still requires explicit clinician approval before it is executed.'
    default:
      return 'Operate in draft-only mode. You may draft, suggest, and organize, but never act independently or present drafts as completed actions.'
  }
}

function buildAssistantAddendum(profile = {}, { userRole = 'licensed', therapistName = null, responseStyle = null } = {}) {
  const normalized = {
    ...DEFAULT_ASSISTANT_PROFILE,
    ...profile,
    permissions: profile.permissions || DEFAULT_ASSISTANT_PROFILE.permissions,
  }

  const permissionLine = normalized.permissions.length
    ? `Allowed scopes: ${normalized.permissions.join(', ')}.`
    : 'Allowed scopes are limited.'

  const memoryLine = normalized.memory
    ? `Stable clinician preferences and workflow memory: ${normalized.memory}`
    : ''

  const roleLine = userRole === 'trainee'
    ? 'The clinician is a pre-licensed trainee. Use Socratic questioning, developmental guidance, and gentle challenge.'
    : 'The clinician is a licensed clinician. Act like a collegial consultant and be direct.'

  const nameLine = therapistName
    ? `The clinician's name is ${therapistName}. Address them naturally by name when appropriate.`
    : ''

  const toneLine = normalized.tone
    ? `Preferred assistant tone: ${normalized.tone}.`
    : ''

  const orientationLine = normalized.orientation
    ? `Preferred clinical orientation: ${normalized.orientation}.`
    : ''

  const verbosityLine = responseStyle || normalized.verbosity
    ? `Preferred response style: ${responseStyle || normalized.verbosity}. ${assistantVerbosityInstruction(responseStyle || normalized.verbosity)}`
    : ''

  return [
    'PERSONALIZED ASSISTANT CONTEXT:',
    roleLine,
    nameLine,
    toneLine,
    orientationLine,
    verbosityLine,
    assistantActionModeInstruction(normalized.action_mode),
    permissionLine,
    'If a requested context is outside the allowed scopes, say so plainly and do not pretend to have access.',
    memoryLine,
  ].filter(Boolean).join('\n')
}

function applyAssistantPayloadUpdates(row = {}, payload = {}) {
  const next = {
    full_name: payload.full_name !== undefined ? payload.full_name : row.full_name,
    user_role: payload.user_role !== undefined ? payload.user_role : row.user_role,
    api_key: payload.api_key !== undefined ? (payload.api_key || null) : row.api_key,
    avatar_url: payload.avatar_url !== undefined ? (payload.avatar_url || null) : row.avatar_url,
    assistant_action_mode: payload.assistant_action_mode !== undefined ? payload.assistant_action_mode : row.assistant_action_mode,
    assistant_tone: payload.assistant_tone !== undefined ? (payload.assistant_tone || null) : row.assistant_tone,
    assistant_orientation: payload.assistant_orientation !== undefined ? (payload.assistant_orientation || null) : row.assistant_orientation,
    assistant_verbosity: payload.assistant_verbosity !== undefined ? (payload.assistant_verbosity || null) : row.assistant_verbosity,
    assistant_memory: payload.assistant_memory !== undefined ? (payload.assistant_memory || null) : row.assistant_memory,
    assistant_permissions_json: payload.assistant_permissions !== undefined
      ? serializeAssistantPermissions(payload.assistant_permissions)
      : (payload.assistant_permissions_json !== undefined
        ? serializeAssistantPermissions(payload.assistant_permissions_json)
        : row.assistant_permissions_json),
  }

  return next
}

module.exports = {
  DEFAULT_ASSISTANT_PROFILE,
  DEFAULT_PERMISSION_SCOPES,
  VALID_PERMISSION_SCOPES,
  parseAssistantPermissions,
  normalizeAssistantProfile,
  serializeAssistantPermissions,
  buildAssistantAddendum,
  applyAssistantPayloadUpdates,
}
