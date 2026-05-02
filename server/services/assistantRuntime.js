const crypto = require('crypto');
const { normalizeAssistantProfile, parseAssistantPermissions } = require('../lib/assistant');

const DEFAULT_TOOLSETS = [
  'clients',
  'schedule',
  'notes',
  'assessments',
  'outcomes',
  'billing',
  'resources',
  'briefs',
  'hours',
];

const SYSTEM_SKILLS = [
  {
    skill_key: 'dmh-sir-notes',
    name: 'DMH SIR Progress Notes',
    category: 'documentation',
    description: 'Structures ongoing notes around Situation, Intervention, and Response with medical necessity and plan.',
    instructions: [
      'Use SIR structure when drafting or improving progress notes.',
      'Situation: presentation, stressors, risk/safety update, functioning, and session focus.',
      'Intervention: specific clinical interventions, psychoeducation, skills practice, collateral work, safety planning, or linkage.',
      'Response: client engagement, regulation, insight, resistance, skill use, and progress toward goals.',
      'Close with plan, homework, follow-up, and next-session focus.',
    ].join('\n'),
  },
  {
    skill_key: 'clinical-assistant-safety',
    name: 'Clinical Assistant Safety',
    category: 'safety',
    description: 'Keeps Miwa in an assistant role with auditability, approval checks, and clinically grounded language.',
    instructions: [
      'Act as a clinical support assistant, not a replacement for licensed judgment.',
      'Do not invent diagnoses, scores, appointments, signatures, or completed actions.',
      'Ask for approval before record-changing, billing, messaging, or external-sharing actions unless the clinician has explicitly enabled safe automation.',
      'Use client display names in the app; reserve chart codes for exports, disambiguation, and de-identified workflows.',
    ].join('\n'),
  },
  {
    skill_key: 'morning-brief',
    name: 'Morning Clinical Brief',
    category: 'automation',
    description: 'Summarizes the clinician day: schedule, unsigned notes, overdue assessments, risk, and prep priorities.',
    instructions: [
      'Prioritize today’s appointments, urgent risk alerts, unsigned documentation, overdue measures, and stalled cases.',
      'Keep the brief concise and action-oriented.',
      'Name the exact suggested next action for each item.',
    ].join('\n'),
  },
];

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildSessionId() {
  return `asst_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

async function seedSystemSkills(db) {
  for (const skill of SYSTEM_SKILLS) {
    const existing = await db.get(
      'SELECT id FROM assistant_skills WHERE therapist_id IS NULL AND skill_key = ?',
      skill.skill_key,
    );
    if (existing) {
      await db.run(
        `UPDATE assistant_skills
            SET name = ?, category = ?, description = ?, instructions = ?, enabled = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        skill.name,
        skill.category,
        skill.description,
        skill.instructions,
        existing.id,
      );
    } else {
      await db.insert(
        `INSERT INTO assistant_skills
          (therapist_id, skill_key, name, category, description, instructions, enabled, source)
         VALUES (NULL, ?, ?, ?, ?, ?, 1, 'system')`,
        skill.skill_key,
        skill.name,
        skill.category,
        skill.description,
        skill.instructions,
      );
    }
  }
}

async function ensureAssistantProfile(db, therapistId) {
  await seedSystemSkills(db);

  const therapist = await db.get(
    `SELECT id, first_name, full_name, user_role, assistant_action_mode,
            assistant_tone, assistant_orientation, assistant_verbosity,
            assistant_memory, assistant_permissions_json, soul_markdown
       FROM therapists WHERE id = ?`,
    therapistId,
  );
  if (!therapist) return null;

  const legacy = normalizeAssistantProfile(therapist);
  let profile = await db.get('SELECT * FROM assistant_profiles WHERE therapist_id = ?', therapistId);

  if (!profile) {
    const result = await db.insert(
      `INSERT INTO assistant_profiles
        (therapist_id, agent_name, agent_subtitle, action_mode, tone, orientation,
         verbosity, personality_json, permissions_json, toolsets_json, gateway_json)
       VALUES (?, 'Miwa', 'Clinical assistant', ?, ?, ?, ?, ?, ?, ?, ?)`,
      therapistId,
      legacy.action_mode,
      legacy.tone,
      legacy.orientation,
      legacy.verbosity,
      JSON.stringify({
        soul_markdown: therapist.soul_markdown || '',
        clinician_name: therapist.first_name || therapist.full_name || '',
      }),
      JSON.stringify(legacy.permissions),
      JSON.stringify(DEFAULT_TOOLSETS),
      JSON.stringify({ in_app: true, external_channels: [] }),
    );
    profile = await db.get('SELECT * FROM assistant_profiles WHERE id = ?', result.lastInsertRowid);
  }

  return normalizeRuntimeProfile(profile, therapist);
}

function normalizeRuntimeProfile(profile, therapist = {}) {
  if (!profile) return null;
  const legacy = normalizeAssistantProfile(therapist);
  const permissions = parseAssistantPermissions(profile.permissions_json || therapist.assistant_permissions_json);
  return {
    id: profile.id,
    therapist_id: profile.therapist_id,
    agent_name: profile.agent_name || 'Miwa',
    agent_subtitle: profile.agent_subtitle || 'Clinical assistant',
    action_mode: profile.action_mode || legacy.action_mode,
    tone: profile.tone || legacy.tone,
    orientation: profile.orientation || legacy.orientation,
    verbosity: profile.verbosity || legacy.verbosity,
    memory: therapist.assistant_memory || '',
    permissions,
    personality: safeJsonParse(profile.personality_json, {}),
    toolsets: safeJsonParse(profile.toolsets_json, DEFAULT_TOOLSETS),
    gateway: safeJsonParse(profile.gateway_json, { in_app: true, external_channels: [] }),
    status: profile.status || 'active',
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

function normalizeMemoryScope({ context_type = null, context_id = null, scope_type = null, scope_id = null } = {}) {
  if (scope_type) return { scope_type, scope_id: scope_id || null };
  if (context_type === 'patient' && context_id) return { scope_type: 'patient', scope_id: Number(context_id) };
  if (context_type === 'session' && context_id) return { scope_type: 'session', scope_id: Number(context_id) };
  return { scope_type: 'clinician', scope_id: null };
}

function normalizeSurface(surface, contextType) {
  if (surface) return surface;
  return contextType === 'agent' ? 'miwa_chat' : 'consult';
}

function formatRuntimeForPrompt(runtime) {
  if (!runtime?.profile) return '';
  const profile = runtime.profile;
  const lines = [
    'MIWA ASSISTANT MEMORY POLICY:',
    '- Shared: clinician-level preferences, style, durable corrections, and assistant skills.',
    '- Separate: raw MiwaChat and Consult transcripts are not shared across surfaces by default.',
    '- Scoped: client/session memories apply only when that client/session is in focus.',
    'MIWA ASSISTANT RUNTIME:',
    `- Identity: ${profile.agent_name || 'Miwa'} (${profile.agent_subtitle || 'Clinical assistant'})`,
    `- Mode: ${profile.action_mode || 'draft_only'}; tone: ${profile.tone || 'calm, clinical, and collaborative'}; orientation: ${profile.orientation || 'integrative'}; verbosity: ${profile.verbosity || 'balanced'}`,
  ];

  if (profile.memory) lines.push(`- Persistent instruction: ${String(profile.memory).slice(0, 500)}`);
  if (Array.isArray(profile.toolsets) && profile.toolsets.length) {
    lines.push(`- Enabled toolsets: ${profile.toolsets.join(', ')}`);
  }
  if (runtime.memories?.length) {
    lines.push('RELEVANT ASSISTANT MEMORIES:');
    for (const memory of runtime.memories.slice(0, 14)) {
      const scope = memory.scope_type && memory.scope_type !== 'clinician'
        ? `${memory.scope_type}:${memory.scope_id}`
        : 'clinician';
      lines.push(`- [${scope}/${memory.category || memory.memory_type || 'general'}] ${memory.content}`);
    }
  }
  if (runtime.skills?.length) {
    lines.push('ACTIVE ASSISTANT SKILLS:');
    for (const skill of runtime.skills.slice(0, 8)) {
      const summary = skill.description || String(skill.instructions || '').split('\n')[0] || '';
      lines.push(`- ${skill.name}: ${summary}`);
    }
  }
  if (runtime.scheduledTasks?.length) {
    lines.push(`PENDING ASSISTANT TASKS: ${runtime.scheduledTasks.length}`);
  }
  return lines.join('\n');
}

async function getRelevantMemories(db, therapistId, options = {}) {
  const scope = normalizeMemoryScope(options);
  const params = [therapistId];
  let scopedClause = '';

  if (scope.scope_type !== 'clinician' && scope.scope_id) {
    scopedClause = ` OR (scope_type = ? AND scope_id = ?)`;
    params.push(scope.scope_type, scope.scope_id);
  }

  return db.all(
    `SELECT id, memory_type, category, content, source, scope_type, scope_id, surface,
            confidence, pinned, last_observed_at, created_at, updated_at
       FROM assistant_memories
       WHERE therapist_id = ?
         AND archived_at IS NULL
         AND (scope_type = 'clinician'${scopedClause})
       ORDER BY pinned DESC,
                CASE WHEN scope_type = 'clinician' THEN 1 ELSE 0 END ASC,
                last_observed_at DESC,
                created_at DESC
       LIMIT 50`,
    ...params,
  );
}

async function getRuntimeSnapshot(db, therapistId, options = {}) {
  const profile = await ensureAssistantProfile(db, therapistId);
  const memories = await getRelevantMemories(db, therapistId, options);
  const preferences = await db.all(
    `SELECT id, category, key, value, source, confidence, last_observed_at
       FROM therapist_preferences
       WHERE therapist_id = ?
       ORDER BY category, last_observed_at DESC
       LIMIT 50`,
    therapistId,
  );
  const skills = await db.all(
    `SELECT id, therapist_id, skill_key, name, category, description, instructions, enabled, version, source
       FROM assistant_skills
       WHERE (therapist_id IS NULL OR therapist_id = ?) AND enabled = 1
       ORDER BY source DESC, category ASC, name ASC`,
    therapistId,
  );
  const scheduledTasks = await db.all(
    `SELECT id, task_type, description, scheduled_for, recurring, status, created_at, completed_at
       FROM agent_scheduled_tasks
       WHERE therapist_id = ? AND status IN ('pending', 'running')
       ORDER BY scheduled_for ASC
       LIMIT 20`,
    therapistId,
  );

  return {
    profile,
    memories,
    preferences,
    skills,
    scheduledTasks,
    memoryPolicy: {
      sharedClinicianMemory: true,
      rawHistorySharedAcrossSurfaces: false,
      scopedMemory: options.context_type === 'patient' || options.context_type === 'session',
      surface: normalizeSurface(options.surface, options.context_type),
    },
  };
}

async function updateRuntimeProfile(db, therapistId, updates = {}) {
  await ensureAssistantProfile(db, therapistId);
  const current = await db.get('SELECT * FROM assistant_profiles WHERE therapist_id = ?', therapistId);
  const nextPermissions = updates.permissions !== undefined
    ? JSON.stringify(parseAssistantPermissions(updates.permissions))
    : current.permissions_json;
  const nextToolsets = updates.toolsets !== undefined
    ? JSON.stringify(Array.isArray(updates.toolsets) ? updates.toolsets : DEFAULT_TOOLSETS)
    : current.toolsets_json;
  const nextGateway = updates.gateway !== undefined
    ? JSON.stringify(updates.gateway || { in_app: true, external_channels: [] })
    : current.gateway_json;
  const nextPersonality = updates.personality !== undefined
    ? JSON.stringify(updates.personality || {})
    : current.personality_json;

  await db.run(
    `UPDATE assistant_profiles
        SET agent_name = ?, agent_subtitle = ?, action_mode = ?, tone = ?,
            orientation = ?, verbosity = ?, personality_json = ?, permissions_json = ?,
            toolsets_json = ?, gateway_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE therapist_id = ?`,
    updates.agent_name || current.agent_name || 'Miwa',
    updates.agent_subtitle || current.agent_subtitle || 'Clinical assistant',
    updates.action_mode || current.action_mode || 'draft_only',
    updates.tone !== undefined ? updates.tone : current.tone,
    updates.orientation !== undefined ? updates.orientation : current.orientation,
    updates.verbosity !== undefined ? updates.verbosity : current.verbosity,
    nextPersonality,
    nextPermissions,
    nextToolsets,
    nextGateway,
    therapistId,
  );

  if (updates.action_mode !== undefined || updates.tone !== undefined || updates.orientation !== undefined || updates.verbosity !== undefined || updates.permissions !== undefined) {
    await db.run(
      `UPDATE therapists
          SET assistant_action_mode = ?, assistant_tone = ?, assistant_orientation = ?,
              assistant_verbosity = ?, assistant_permissions_json = ?
        WHERE id = ?`,
      updates.action_mode || current.action_mode || 'draft_only',
      updates.tone !== undefined ? updates.tone : current.tone,
      updates.orientation !== undefined ? updates.orientation : current.orientation,
      updates.verbosity !== undefined ? updates.verbosity : current.verbosity,
      nextPermissions,
      therapistId,
    );
  }

  return ensureAssistantProfile(db, therapistId);
}

async function addMemory(db, therapistId, payload = {}) {
  const content = String(payload.content || '').trim();
  if (!content) {
    const err = new Error('content is required');
    err.status = 400;
    throw err;
  }
  const scope = normalizeMemoryScope(payload);
  const result = await db.insert(
    `INSERT INTO assistant_memories
      (therapist_id, memory_type, category, content, source, scope_type, scope_id, surface, confidence, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    therapistId,
    payload.memory_type || 'preference',
    payload.category || 'general',
    content,
    payload.source || 'explicit',
    scope.scope_type,
    scope.scope_id,
    normalizeSurface(payload.surface, payload.context_type),
    Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : 1,
    payload.pinned ? 1 : 0,
  );
  return db.get('SELECT * FROM assistant_memories WHERE id = ?', result.lastInsertRowid);
}

async function archiveMemory(db, therapistId, memoryId) {
  const result = await db.run(
    `UPDATE assistant_memories
        SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND therapist_id = ?`,
    memoryId,
    therapistId,
  );
  return (result?.changes || result?.rowCount || 0) > 0;
}

async function startAssistantSession(db, therapistId, { source = 'in_app', context_type = null, context_id = null, title = null, meta = null } = {}) {
  const id = buildSessionId();
  await db.insert(
    `INSERT INTO assistant_sessions (id, therapist_id, source, title, context_type, context_id, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    therapistId,
    source,
    title,
    context_type,
    context_id,
    meta ? JSON.stringify(meta) : null,
  );
  return id;
}

async function touchAssistantSession(db, therapistId, sessionId) {
  if (!sessionId) return null;
  await db.run(
    'UPDATE assistant_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ? AND therapist_id = ?',
    sessionId,
    therapistId,
  );
  return sessionId;
}

async function auditAction(db, therapistId, { session_id = null, tool_name, action_type = 'tool_call', status = 'started', request = null, result = null, requires_approval = false } = {}) {
  if (!tool_name) return null;
  const inserted = await db.insert(
    `INSERT INTO assistant_action_audit
      (therapist_id, session_id, tool_name, action_type, status, request_json, result_json, requires_approval,
       completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    therapistId,
    session_id,
    tool_name,
    action_type,
    status,
    request ? JSON.stringify(request) : null,
    result ? JSON.stringify(result) : null,
    requires_approval ? 1 : 0,
    status,
  );
  return inserted.lastInsertRowid;
}

function summarizeExchange(surface, userMessage, assistantResponse) {
  const user = String(userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const assistant = String(assistantResponse || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!user && !assistant) return '';
  const label = surface === 'miwa_chat' ? 'MiwaChat' : 'Consult';
  return `${label} signal: clinician asked "${user || 'no user text'}"; Miwa responded with "${assistant || 'no response text'}".`;
}

async function recordConversationSignal(db, therapistId, { surface, context_type = null, context_id = null, userMessage, assistantResponse } = {}) {
  const scope = normalizeMemoryScope({ context_type, context_id });
  if (scope.scope_type === 'clinician') return null;
  const content = summarizeExchange(surface, userMessage, assistantResponse);
  if (!content) return null;
  return addMemory(db, therapistId, {
    memory_type: 'conversation_signal',
    category: normalizeSurface(surface, context_type),
    content,
    source: 'conversation_summary',
    context_type,
    context_id,
    surface: normalizeSurface(surface, context_type),
    confidence: 0.6,
  });
}

module.exports = {
  DEFAULT_TOOLSETS,
  SYSTEM_SKILLS,
  addMemory,
  archiveMemory,
  auditAction,
  ensureAssistantProfile,
  formatRuntimeForPrompt,
  getRelevantMemories,
  getRuntimeSnapshot,
  recordConversationSignal,
  startAssistantSession,
  touchAssistantSession,
  updateRuntimeProfile,
};
