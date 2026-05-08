'use strict';

const GOAL_PATTERNS = [
  {
    key: 'risk_review',
    cadence: 'daily',
    re: /\b(risk|safety|suicid|self[-\s]?harm|crisis|danger|lethality)\b/i,
    title: 'Track risk review follow-through',
  },
  {
    key: 'assessment_followup',
    cadence: 'daily',
    re: /\b(assessment|phq|gad|pcl|cssrs|check[-\s]?in|screen)\b/i,
    title: 'Track assessment follow-up',
  },
  {
    key: 'session_prep',
    cadence: 'daily',
    re: /\b(prep|prepare|next session|session brief|before session)\b/i,
    title: 'Track session preparation',
  },
  {
    key: 'documentation_debt',
    cadence: 'daily',
    re: /\b(unsigned|note|documentation|sign|chart)\b/i,
    title: 'Track documentation debt',
  },
];

function slugifyGoalKey(title) {
  return String(title || 'clinical_goal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'clinical_goal';
}

function inferGoalFromPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return null;

  const explicit = text.match(/(?:\/goal|remember this goal|track this|keep watching|keep an eye on|follow this until|until resolved)\s*:?\s*(.+)$/i);
  if (explicit?.[1]) {
    const title = explicit[1].replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      goal_key: `custom_${slugifyGoalKey(title)}`,
      title,
      description: text,
      cadence: 'ongoing',
    };
  }

  for (const pattern of GOAL_PATTERNS) {
    if (pattern.re.test(text)) {
      return {
        goal_key: pattern.key,
        title: pattern.title,
        description: `Inferred from delegated task: ${text.slice(0, 500)}`,
        cadence: pattern.cadence,
      };
    }
  }
  return null;
}

async function ensureGoalForPrompt(db, therapistId, prompt, explicitGoal = null) {
  const goal = explicitGoal || inferGoalFromPrompt(prompt);
  if (!goal) return null;

  const existing = await db.get(
    'SELECT id FROM assistant_goals WHERE therapist_id = ? AND goal_key = ?',
    therapistId,
    goal.goal_key,
  ).catch(() => null);

  const evidence = JSON.stringify({
    source: 'background_task',
    last_prompt: String(prompt || '').slice(0, 1000),
    observed_at: new Date().toISOString(),
  });

  if (existing) {
    await db.run(
      `UPDATE assistant_goals
          SET title = ?, description = COALESCE(NULLIF(description, ''), ?),
              cadence = ?, status = 'active', evidence_json = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      goal.title,
      goal.description || '',
      goal.cadence || 'ongoing',
      evidence,
      existing.id,
    ).catch(() => {});
    return existing.id;
  }

  const inserted = await db.insert(
    `INSERT INTO assistant_goals
      (therapist_id, goal_key, title, description, cadence, status, evidence_json)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    therapistId,
    goal.goal_key,
    goal.title,
    goal.description || '',
    goal.cadence || 'ongoing',
    evidence,
  ).catch(() => null);
  return inserted?.lastInsertRowid || null;
}

async function touchGoal(db, goalId, patch = {}) {
  if (!goalId) return;
  const evidence = patch.evidence ? JSON.stringify(patch.evidence) : null;
  await db.run(
    `UPDATE assistant_goals
        SET last_checked_at = CURRENT_TIMESTAMP,
            next_check_at = COALESCE(?, next_check_at),
            evidence_json = COALESCE(?, evidence_json),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    patch.next_check_at || null,
    evidence,
    goalId,
  ).catch(() => {});
}

async function recordTaskStep(db, task, stepKey, patch = {}) {
  const taskId = typeof task === 'object' ? task.id : task;
  const therapistId = typeof task === 'object' ? task.therapist_id : patch.therapistId;
  if (!taskId || !therapistId) return;

  const existing = await db.get(
    'SELECT id FROM agent_task_steps WHERE task_id = ? AND step_key = ?',
    taskId,
    stepKey,
  ).catch(() => null);

  const now = new Date().toISOString();
  const status = patch.status || 'running';
  const label = patch.label || stepKey.replace(/_/g, ' ');
  const detail = patch.detail || null;
  const attempt = Number.isFinite(patch.attempt) ? patch.attempt : 0;
  const startedAt = status === 'running' ? now : null;
  const completedAt = ['completed', 'failed', 'blocked'].includes(status) ? now : null;

  if (existing) {
    await db.run(
      `UPDATE agent_task_steps
          SET label = COALESCE(?, label),
              status = ?,
              detail = COALESCE(?, detail),
              attempt = ?,
              started_at = COALESCE(started_at, ?),
              completed_at = COALESCE(?, completed_at),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      label,
      status,
      detail,
      attempt,
      startedAt,
      completedAt,
      existing.id,
    );
    return;
  }

  await db.insert(
    `INSERT INTO agent_task_steps
      (task_id, therapist_id, step_key, label, status, detail, attempt, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    taskId,
    therapistId,
    stepKey,
    label,
    status,
    detail,
    attempt,
    startedAt,
    completedAt,
  );
}

function classifyFailure(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (/timeout|aborted|rate|temporarily|econn|fetch|502|503|504/.test(msg)) return 'retryable_transient';
  if (/operator does not exist|syntax|schema|column|table|constraint/.test(msg)) return 'data_adapter';
  if (/permission|unauthorized|forbidden|approval/.test(msg)) return 'permission_or_approval';
  return 'unknown';
}

function shouldRetryFailure(kind) {
  return kind === 'retryable_transient';
}

function buildCheckpoint({ phase, iterations, toolCallLog = [], finalText = '' }) {
  return {
    phase,
    iterations: iterations || 0,
    toolCallCount: toolCallLog.length,
    lastTool: toolCallLog.length ? toolCallLog[toolCallLog.length - 1].tool : null,
    hasFinalText: !!String(finalText || '').trim(),
    at: new Date().toISOString(),
  };
}

function actionVerificationSummary(toolCallLog = [], finalText = '') {
  const text = String(finalText || '');
  const claimsWrite = /\b(created|scheduled|sent|queued|saved|updated|deleted|archived)\b/i.test(text);
  const writeTools = toolCallLog.filter(call => /create|schedule|send|update|delete|archive|cancel|approve/i.test(call.tool || ''));
  const successfulWrites = writeTools.filter(call => !call.needs_input && call.result && !call.result.error);

  if (!claimsWrite) {
    return {
      verified: true,
      note: 'No permanent-action claim detected in final answer.',
    };
  }

  if (successfulWrites.length > 0) {
    return {
      verified: true,
      note: `Verified ${successfulWrites.length} server-side action${successfulWrites.length === 1 ? '' : 's'} in the tool log.`,
      tools: successfulWrites.map(call => call.tool),
    };
  }

  return {
    verified: false,
    note: 'The answer appeared to claim a permanent action, but no confirmed server-side write was found in the tool log.',
  };
}

function appendVerificationNotice(finalText, verification) {
  if (!verification || verification.verified) return finalText;
  return [
    finalText || '',
    '',
    '---',
    '',
    '**Action verification:** I could not verify a permanent record change for one or more claimed actions. Treat this result as a draft/recommendation until you confirm it in Miwa.',
  ].join('\n').trim();
}

module.exports = {
  actionVerificationSummary,
  appendVerificationNotice,
  buildCheckpoint,
  classifyFailure,
  ensureGoalForPrompt,
  inferGoalFromPrompt,
  recordTaskStep,
  shouldRetryFailure,
  touchGoal,
};
