/**
 * workflow-engine.js
 *
 * Multi-step workflow engine for Miwa therapist SaaS.
 *
 * Executes clinical workflows (client onboarding, case closure, quarterly
 * review, court testimony prep) as an ordered chain of tool calls.  Each
 * step can optionally require therapist approval before it runs, which
 * pauses the workflow until the therapist explicitly approves.
 *
 * Previous-step results are forwarded to later steps via the
 * __PREV_RESULT__ placeholder convention (e.g. '__PREV_RESULT__.patient_id'
 * is replaced with the actual patient_id returned by the prior step).
 *
 * Tables used (already exist in SQLite):
 *   workflows       - top-level workflow record
 *   workflow_steps   - individual step records
 */

const { getDb, persist } = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Templates
// ─────────────────────────────────────────────────────────────────────────────
// Each template exposes:
//   type          – unique key (the object key itself)
//   label         – human-friendly name
//   description   – one-line summary shown in the UI
//   buildSteps(p) – produces the ordered step array for given params
//
// Step shape:
//   tool_name         – registered tool to call
//   args              – static argument map
//   requiresApproval  – if true, the engine pauses before executing
//   description       – human-readable label for the step
// ─────────────────────────────────────────────────────────────────────────────

const WORKFLOW_TEMPLATES = {

  /* ── Client Onboarding ────────────────────────────────────────────────── */
  client_onboard: {
    label: 'Client Onboarding',
    description: 'Create profile, send welcome assessments, schedule first session',
    buildSteps: (params) => [
      {
        tool_name: 'create_client',
        args: {
          client_id: params.client_name,
          display_name: params.client_name,
          case_type: params.case_type || 'individual',
          presenting_concerns: params.concerns || '',
        },
        description: 'Create client profile',
      },
      {
        tool_name: 'send_assessment_sms',
        args: {
          patient_id: '__PREV_RESULT__.patient_id',
          assessment_type: 'phq-9',
        },
        requiresApproval: true,
        description: 'Send PHQ-9 depression screening',
      },
      {
        tool_name: 'send_assessment_sms',
        args: {
          patient_id: '__PREV_RESULT__.patient_id',
          assessment_type: 'gad-7',
        },
        requiresApproval: true,
        description: 'Send GAD-7 anxiety screening',
      },
      {
        tool_name: 'schedule_appointment',
        args: {
          patient_id: '__PREV_RESULT__.patient_id',
          type: 'intake',
          duration: 90,
        },
        requiresApproval: true,
        description: 'Schedule intake session',
      },
      {
        tool_name: 'create_treatment_plan',
        args: {
          patient_id: '__PREV_RESULT__.patient_id',
        },
        description: 'Draft initial treatment plan',
      },
    ],
  },

  /* ── Case Closure ─────────────────────────────────────────────────────── */
  case_closure: {
    label: 'Case Closure',
    description: 'Final assessments, discharge summary, outcome report, archive',
    buildSteps: (params) => [
      {
        tool_name: 'batch_send_assessments',
        args: {
          patient_id: params.patient_id,
          types: ['phq-9', 'gad-7'],
        },
        requiresApproval: true,
        description: 'Send final assessment battery',
      },
      {
        tool_name: 'generate_report',
        args: {
          patient_id: params.patient_id,
          audience: 'clinical',
          purpose: 'discharge_summary',
        },
        description: 'Generate discharge summary',
      },
      {
        tool_name: 'generate_report',
        args: {
          patient_id: params.patient_id,
          audience: 'clinical',
          purpose: 'outcomes_report',
        },
        description: 'Generate treatment outcomes report',
      },
    ],
  },

  /* ── Quarterly Caseload Review ────────────────────────────────────────── */
  quarterly_review: {
    label: 'Quarterly Caseload Review',
    description: 'Review all active clients, identify stalled cases, generate summary',
    buildSteps: (params) => [
      {
        tool_name: 'get_caseload_summary',
        args: { filter: 'all' },
        description: 'Pull full caseload',
      },
      {
        tool_name: 'delegate_analysis',
        args: {
          goal: 'Identify stalled cases with no progress in 4+ sessions and overdue assessments',
          scope: 'caseload',
        },
        description: 'Analyze caseload for stalled cases',
      },
      {
        tool_name: 'generate_report',
        args: {
          audience: 'supervision',
          purpose: 'quarterly_review',
        },
        description: 'Generate quarterly review report',
      },
    ],
  },

  /* ── Court Testimony Prep ─────────────────────────────────────────────── */
  court_prep: {
    label: 'Court Testimony Prep',
    description: 'Pull all records, generate court report, risk timeline',
    buildSteps: (params) => [
      {
        tool_name: 'get_client_sessions',
        args: {
          patient_id: params.patient_id,
          limit: 100,
        },
        description: 'Pull complete session history',
      },
      {
        tool_name: 'get_client_assessments',
        args: {
          patient_id: params.patient_id,
        },
        description: 'Pull all assessment scores',
      },
      {
        tool_name: 'generate_report',
        args: {
          patient_id: params.patient_id,
          audience: 'court',
          purpose: 'court_testimony',
        },
        description: 'Generate court report',
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Core Engine Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new workflow from a predefined template.
 *
 * Inserts the top-level `workflows` row (status = 'running') and one
 * `workflow_steps` row per step.  Returns a summary object the caller can
 * hand back to the therapist.
 *
 * @param {string}  therapistId   - Owning therapist
 * @param {string}  workflowType  - Key into WORKFLOW_TEMPLATES
 * @param {Object}  params        - Template-specific parameters
 * @returns {{ workflowId: number, steps: number, label: string }}
 */
function createWorkflow(therapistId, workflowType, params = {}) {
  const template = WORKFLOW_TEMPLATES[workflowType];
  if (!template) {
    throw new Error(`Unknown workflow type: ${workflowType}`);
  }

  const db = getDb();
  const steps = template.buildSteps(params);

  const { lastInsertRowid: workflowId } = db.insert(
    `INSERT INTO workflows
       (therapist_id, workflow_type, label, status, steps_json, current_step, context_json)
     VALUES (?, ?, ?, 'running', ?, 0, ?)`,
    therapistId,
    workflowType,
    template.label,
    JSON.stringify(steps),
    JSON.stringify(params),
  );

  // Persist individual step records so we can track each one independently.
  steps.forEach((step, i) => {
    db.run(
      `INSERT INTO workflow_steps
         (workflow_id, step_number, tool_name, args_json, status, requires_approval)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      workflowId,
      i,
      step.tool_name,
      JSON.stringify(step.args || {}),
      step.requiresApproval ? 1 : 0,
    );
  });

  return { workflowId, steps: steps.length, label: template.label };
}

/**
 * Fetch full workflow status including enriched step details.
 *
 * @param {number} workflowId
 * @param {string} therapistId
 * @returns {Object|null}  Workflow record augmented with step details, or null
 */
function getWorkflowStatus(workflowId, therapistId) {
  const db = getDb();
  const workflow = db.get(
    'SELECT * FROM workflows WHERE id = ? AND therapist_id = ?',
    workflowId,
    therapistId,
  );
  if (!workflow) return null;

  const steps = db.all(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_number',
    workflowId,
  );

  // Re-derive human descriptions from the template so they stay in sync
  // with any future template changes.
  const template = WORKFLOW_TEMPLATES[workflow.workflow_type];
  const stepDescs = template
    ? template.buildSteps(JSON.parse(workflow.context_json || '{}'))
    : [];

  return {
    ...workflow,
    steps: steps.map((s, i) => ({
      ...s,
      description: stepDescs[i]?.description || s.tool_name,
      args: JSON.parse(s.args_json || '{}'),
      result: s.result_json ? JSON.parse(s.result_json) : null,
    })),
    totalSteps: steps.length,
    completedSteps: steps.filter((s) => s.status === 'completed').length,
    context: JSON.parse(workflow.context_json || '{}'),
  };
}

/**
 * Advance the workflow to its next actionable step.
 *
 * Returns one of three shapes:
 *   { done: true }            - all steps finished
 *   { paused: true, ... }     - waiting for therapist approval
 *   { execute: true, step }   - caller should execute the returned step
 *
 * @param {number} workflowId
 * @returns {Object|null}
 */
function advanceWorkflow(workflowId) {
  const db = getDb();
  const workflow = db.get('SELECT * FROM workflows WHERE id = ?', workflowId);
  if (!workflow || workflow.status !== 'running') return null;

  const steps = db.all(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_number',
    workflowId,
  );
  const currentIdx = workflow.current_step;

  // All steps already completed -- mark workflow done.
  if (currentIdx >= steps.length) {
    db.run(
      "UPDATE workflows SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
      workflowId,
    );
    return { done: true, workflowId };
  }

  const step = steps[currentIdx];

  // Pause when a step needs therapist sign-off and hasn't been approved yet.
  if (step.requires_approval && !step.approved_at && step.status !== 'completed') {
    db.run(
      "UPDATE workflow_steps SET status = 'awaiting_approval' WHERE id = ?",
      step.id,
    );
    db.run(
      "UPDATE workflows SET status = 'paused' WHERE id = ?",
      workflowId,
    );
    return {
      paused: true,
      awaitingApproval: true,
      step: { ...step, description: step.tool_name },
      stepNumber: currentIdx,
      workflowId,
    };
  }

  // Resolve __PREV_RESULT__ placeholders from the previous step's output.
  let args = JSON.parse(step.args_json || '{}');
  if (currentIdx > 0) {
    const prevStep = steps[currentIdx - 1];
    const prevResult = prevStep.result_json ? JSON.parse(prevStep.result_json) : {};
    args = resolveArgs(args, prevResult);
  }

  return {
    execute: true,
    step: { ...step, args },
    stepNumber: currentIdx,
    workflowId,
  };
}

/**
 * Record a successful step completion and bump the workflow pointer.
 *
 * @param {number} workflowId
 * @param {number} stepNumber
 * @param {*}      result - Arbitrary JSON-serialisable result from the tool
 */
function completeStep(workflowId, stepNumber, result) {
  const db = getDb();
  db.run(
    `UPDATE workflow_steps
        SET status = 'completed', result_json = ?, completed_at = datetime('now')
      WHERE workflow_id = ? AND step_number = ?`,
    JSON.stringify(result),
    workflowId,
    stepNumber,
  );
  db.run(
    'UPDATE workflows SET current_step = ? WHERE id = ?',
    stepNumber + 1,
    workflowId,
  );
}

/**
 * Record a step failure and mark the whole workflow as failed.
 *
 * @param {number} workflowId
 * @param {number} stepNumber
 * @param {string} error - Human-readable error message
 */
function failStep(workflowId, stepNumber, error) {
  const db = getDb();
  db.run(
    `UPDATE workflow_steps
        SET status = 'failed', error = ?, completed_at = datetime('now')
      WHERE workflow_id = ? AND step_number = ?`,
    error,
    workflowId,
    stepNumber,
  );
  db.run(
    "UPDATE workflows SET status = 'failed', error = ? WHERE id = ?",
    error,
    workflowId,
  );
}

/**
 * Approve a paused step so the workflow can resume.
 *
 * Sets approved_at, resets step status to 'pending', and flips the
 * workflow back to 'running' so the next advanceWorkflow() call will
 * execute it.
 *
 * @param {number} workflowId
 * @param {number} stepNumber
 * @param {string} therapistId
 * @returns {true|null}
 */
function approveWorkflowStep(workflowId, stepNumber, therapistId) {
  const db = getDb();
  const workflow = db.get(
    'SELECT * FROM workflows WHERE id = ? AND therapist_id = ?',
    workflowId,
    therapistId,
  );
  if (!workflow) return null;

  db.run(
    "UPDATE workflow_steps SET approved_at = datetime('now'), status = 'pending' WHERE workflow_id = ? AND step_number = ?",
    workflowId,
    stepNumber,
  );
  db.run(
    "UPDATE workflows SET status = 'running' WHERE id = ?",
    workflowId,
  );
  return true;
}

/**
 * List workflows for a therapist, optionally filtered by status.
 *
 * @param {string}      therapistId
 * @param {string|null} status - 'planning' | 'running' | 'paused' | 'completed' | 'failed' | null (all)
 * @returns {Object[]}
 */
function listWorkflows(therapistId, status = null) {
  const db = getDb();
  if (status) {
    return db.all(
      'SELECT * FROM workflows WHERE therapist_id = ? AND status = ? ORDER BY created_at DESC LIMIT 20',
      therapistId,
      status,
    );
  }
  return db.all(
    'SELECT * FROM workflows WHERE therapist_id = ? ORDER BY created_at DESC LIMIT 20',
    therapistId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace __PREV_RESULT__.<path> placeholders in an argument map with the
 * corresponding value from the previous step's result.
 *
 * Only top-level string values that start with the sentinel are resolved.
 * If the referenced key does not exist in prevResult the raw placeholder
 * string is preserved so callers can detect the miss.
 *
 * @param {Object} args       - Argument map (potentially containing placeholders)
 * @param {Object} prevResult - Result object from the preceding step
 * @returns {Object}          - New argument map with placeholders resolved
 */
function resolveArgs(args, prevResult) {
  const resolved = {};
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === 'string' && val.startsWith('__PREV_RESULT__.')) {
      const path = val.replace('__PREV_RESULT__.', '');
      resolved[key] = prevResult[path] ?? val;
    } else {
      resolved[key] = val;
    }
  }
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  WORKFLOW_TEMPLATES,
  createWorkflow,
  getWorkflowStatus,
  advanceWorkflow,
  completeStep,
  failStep,
  approveWorkflowStep,
  listWorkflows,
};
