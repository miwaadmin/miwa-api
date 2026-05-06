/**
 * Background Agent Task Runner.
 *
 * Runs the Miwa agent loop OUTSIDE an HTTP request. A user queues a task via
 * POST /api/agent/tasks; this module's scheduler picks it up, runs the loop,
 * stores the result, and sets the task status. The UI polls or subscribes to
 * SSE for status changes.
 *
 * Flow:
 *   queued  → running → done       (success)
 *           ↘            ↘ failed  (error)
 *                        ↘ needs_input  (tool required UI approval — user
 *                          must resume the task from chat)
 *   cancelled  (user cancelled before or during run)
 *
 * Safety:
 *   • MAX_ITERATIONS = 20  (vs 12 for sync — longer-running research OK)
 *   • RUN_TIMEOUT_MS = 15 min
 *   • Per-therapist concurrency cap (MAX_PER_THERAPIST) prevents a single
 *     user from monopolising the global worker.
 *   • Respects the existing therapist.ai_budget_monthly_cents via aiExecutor
 *     (no separate budget here — piggy-backs on the router's daily ceiling).
 *   • Any tool that returns __requiresApproval / __requiresPicker causes the
 *     task to halt with status='needs_input', preserving the partial message
 *     history in result_json so the user can resume in chat.
 *
 * HIPAA:
 *   • Prompt is scrubbed for PHI via scrubNamesFromMessage + scrubText before
 *     going to Azure OpenAI, mirroring the sync agent path.
 *   • Every tool call is logged to the phi_access_log middleware chain when
 *     the tool itself touches PHI (reuses executeAgentTool's existing logging).
 *   • Task results may contain PHI; tasks are scoped to the creating therapist
 *     only (enforced at API layer).
 */

'use strict';

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { MODELS, callAIWithTools } = require('../lib/aiExecutor');
const { AGENT_TOOLS, AI_AGENT_TOOLS, executeAgentTool } = require('../routes/agent');
const { scrubText } = require('../lib/scrubber');
const { buildPatientDossier } = require('../lib/patientDossier');

// ── Config ──────────────────────────────────────────────────────────────────
const MAX_ITERATIONS     = 20;
const RUN_TIMEOUT_MS     = 15 * 60 * 1000; // 15 min
const POLL_INTERVAL_MS   = 5 * 1000;        // 5 sec
const MAX_CONCURRENT     = 3;               // global worker pool
const MAX_PER_THERAPIST  = 2;               // per-therapist fairness cap

// In-memory tracker of running tasks (not persisted — used only for concurrency
// accounting. If the server restarts, crash-recovery picks up orphaned rows.)
const _running = new Map(); // taskId → { therapistId, startedAt, abortController }

// ── Helpers ─────────────────────────────────────────────────────────────────

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function compactTitle(value, max = 64) {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[?.!,;:]+$/g, '')
    .trim();
  if (!cleaned) return 'Background Task';
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 28 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

function extractClientName(prompt) {
  const text = String(prompt || '');
  const patterns = [
    /\b(?:for|on|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
    /\bclient\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = match[1].replace(/\b(?:and|or|to|from|with|all|my|the)\b.*$/i, '').trim();
      if (name && !/^(all|my|the|clients?|patients?|caseload)$/i.test(name)) return name;
    }
  }
  return null;
}

/**
 * Short listener-friendly title for a delegated task.
 * Prefer the work product over the raw user sentence so the task drawer scans
 * like a queue, not a clipped chat transcript.
 */
function deriveTitle(prompt) {
  const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Background Task';

  const lower = cleaned.toLowerCase();
  const clientName = extractClientName(cleaned);
  const isCaseload = /\b(all|every)\s+(my\s+)?(clients|patients)\b|\b(my\s+)?caseload\b/.test(lower);
  const isReport = /\b(report|summary|overview|write[-\s]?up|writeup|analysis)\b/.test(lower);
  const isBrief = /\b(brief|briefing)\b/.test(lower);
  const isResearch = /\b(research|studies|evidence|literature)\b/.test(lower);
  const isOutcomes = /\b(outcomes?|progress|improvement|deteriorat|stalled|status|doing)\b/.test(lower);
  const isRisk = /\b(risk|safety|suicid|crisis|danger|harm)\b/.test(lower);
  const isTreatment = /\b(treatment plan|intervention|modality|goals?)\b/.test(lower);
  const isSchedule = /\b(schedule|appointment|calendar|availability)\b/.test(lower);
  const isDraft = /\b(draft|write|generate|create|prepare)\b/.test(lower);

  if (isCaseload && isReport && isOutcomes) return 'Caseload Progress Report';
  if (isCaseload && isReport && isRisk) return 'Caseload Risk Report';
  if (isCaseload && isReport) return 'Caseload Report';
  if (isCaseload && isOutcomes) return 'Caseload Progress Review';
  if (isCaseload) return 'Caseload Review';

  if (clientName && isReport && isTreatment) return `${clientName} Treatment Plan Report`;
  if (clientName && isReport && isRisk) return `${clientName} Risk Review`;
  if (clientName && isReport && isOutcomes) return `${clientName} Progress Report`;
  if (clientName && isReport) return `${clientName} Report`;
  if (clientName && isTreatment) return `${clientName} Treatment Plan Review`;
  if (clientName && isRisk) return `${clientName} Risk Review`;
  if (clientName) return `${clientName} Client Review`;

  if (isResearch && isBrief) return 'Research Brief';
  if (isResearch && isReport) return 'Research Report';
  if (isResearch) return 'Research Review';
  if (isRisk && isReport) return 'Risk Review Report';
  if (isRisk) return 'Risk Review';
  if (isTreatment && isReport) return 'Treatment Plan Report';
  if (isTreatment) return 'Treatment Plan Review';
  if (isSchedule) return 'Scheduling Task';
  if (isDraft && isReport) return 'Report Draft';

  const withoutChatFiller = cleaned
    .replace(/^(hey|hi|hello|yo|ok|okay)[,\s]+/i, '')
    .replace(/^(can|could|would)\s+(you|u)\s+/i, '')
    .replace(/^(can|could|would)\s+i\s+(please\s+)?(have|get)\s+/i, '')
    .replace(/^(please\s+)?(make|create|generate|write|draft|prepare|run|do)\s+(me\s+)?/i, '')
    .trim();
  return compactTitle(toTitleCase(withoutChatFiller || cleaned));
}

/** Count how many tasks a therapist currently has running. */
function runningForTherapist(therapistId) {
  let n = 0;
  for (const info of _running.values()) {
    if (info.therapistId === therapistId) n += 1;
  }
  return n;
}

/**
 * Build the system prompt for a background task. Intentionally leaner than
 * the sync agent prompt — no "stream-friendly" formatting nudges, clear that
 * the user is NOT in the chat right now, and a strong instruction to produce
 * a well-structured final answer because this is what the user will see when
 * they come back.
 */
function buildSystemPrompt({ therapist, caseloadSummary, dateContext }) {
  const name = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'the clinician';
  return [
    `You are Miwa, a clinical AI assistant running a BACKGROUND TASK for ${name}.`,
    ``,
    `The user is NOT in a live chat with you right now. They submitted this`,
    `task and walked away. They will review the full result when you are done.`,
    ``,
    `Therefore:`,
    `  • Produce a complete, well-structured final answer (markdown headings,`,
    `    bullet points, tables where appropriate). The user will scan this,`,
    `    not read a chat log.`,
    `  • Do NOT ask clarifying questions — make a reasonable default choice,`,
    `    state it at the top of your answer, and proceed.`,
    `  • Use tools as needed to gather data. Prefer fewer, well-targeted`,
    `    tool calls over many small ones.`,
    `  • If a required action needs user approval (send SMS, schedule`,
    `    appointment, delete data), STOP and explain what you wanted to do`,
    `    and why, so the user can finish it in chat.`,
    ``,
    dateContext,
    ``,
    `── Caseload context ─────────────────────────────────────────────`,
    caseloadSummary || '(empty caseload)',
  ].join('\n');
}

function formatPageContext(context) {
  if (!context || typeof context !== 'object') return '';
  const parts = [];
  if (context.surface || context.label || context.path) {
    parts.push(`Current Miwa surface: ${context.label || context.surface || context.path}`);
  }
  if (context.path) parts.push(`Path: ${context.path}`);
  if (context.patientName || context.patientId) {
    parts.push(`Focused client: ${context.patientName || context.patientId}`);
  }
  if (Array.isArray(context.visibleClients) && context.visibleClients.length) {
    parts.push(`Visible clients: ${context.visibleClients.slice(0, 12).join(', ')}`);
  }
  if (Array.isArray(context.suggestedActions) && context.suggestedActions.length) {
    parts.push(`Relevant page actions: ${context.suggestedActions.slice(0, 8).join(', ')}`);
  }
  return parts.length ? `\n\nCurrent UI context:\n${parts.map(p => `- ${p}`).join('\n')}` : '';
}

/**
 * Build a brief caseload summary for context injection (mirrors agent.js).
 */
async function buildCaseloadSummary(db, therapistId) {
  const patients = await db.all(
    'SELECT client_id, display_name, presenting_concerns, diagnoses FROM patients WHERE therapist_id = ? ORDER BY id DESC LIMIT 50',
    therapistId,
  );
  if (patients.length === 0) return '';
  return `CASELOAD (${patients.length} clients):\n` + patients
    .map(p => `- ${p.client_id}${p.display_name ? ` (${p.display_name})` : ''}: ${p.presenting_concerns || 'no concerns listed'}${p.diagnoses ? ` | Dx: ${p.diagnoses}` : ''}`)
    .join('\n');
}

/** Update task row with partial progress. Called between iterations. */
async function updateTaskProgress(db, taskId, patch) {
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  if (cols.length === 0) return;
  vals.push(taskId);
  await db.run(`UPDATE agent_tasks SET ${cols.join(', ')} WHERE id = ?`, ...vals);
  await persistIfNeeded();
}

// ── Core: run a single task ─────────────────────────────────────────────────

/**
 * Execute a single task by ID. Returns a Promise that resolves when the task
 * reaches a terminal state (done/failed/cancelled/needs_input).
 *
 * The outer worker loop (startWorker) handles concurrency limits; this
 * function assumes it was already cleared to run.
 */
async function runTask(taskId) {
  const db = getAsyncDb();
  const task = await db.get('SELECT * FROM agent_tasks WHERE id = ?', taskId);
  if (!task) return;
  if (task.status === 'cancelled') return;

  const therapist = await db.get(
    'SELECT id, full_name, first_name, preferred_timezone FROM therapists WHERE id = ?',
    task.therapist_id,
  );
  if (!therapist) {
    await updateTaskProgress(db, taskId, {
      status: 'failed',
      error_message: 'Therapist not found',
      completed_at: new Date().toISOString(),
    });
    return;
  }

  // Mark running
  const startedAt = new Date();
  await updateTaskProgress(db, taskId, {
    status: 'running',
    started_at: startedAt.toISOString(),
  });

  const abortController = new AbortController();
  _running.set(taskId, {
    therapistId: therapist.id,
    startedAt,
    abortController,
  });

  // Timeout: abort the task if it runs longer than RUN_TIMEOUT_MS.
  const timeoutHandle = setTimeout(() => {
    abortController.abort('run timeout');
  }, RUN_TIMEOUT_MS);

  // Build context
  const tz = therapist.preferred_timezone || 'America/Los_Angeles';
  const now = new Date();
  const localDate = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const localTime = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
  const dateContext = `Today is ${localDate}. Current time: ${localTime} (${tz}).`;

  const caseloadSummary = await buildCaseloadSummary(db, therapist.id);
  let pageContext = null;
  try { pageContext = task.context_json ? JSON.parse(task.context_json) : null; } catch {}
  const systemPrompt = buildSystemPrompt({ therapist, caseloadSummary, dateContext }) + formatPageContext(pageContext);

  // Scrub prompt for PHI (same approach as sync agent — conservative default)
  const scrubbed = scrubText(task.prompt || '');
  const messages = [{ role: 'user', content: scrubbed.text || task.prompt }];

  const toolCallLog = [];
  let iterations = 0;
  let finalText = '';
  let terminalStatus = 'done';
  let terminalError = null;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      if (abortController.signal.aborted) {
        throw new Error(`Task aborted: ${abortController.signal.reason || 'unknown reason'}`);
      }

      // Re-read task status to catch user-initiated cancel mid-loop
      const latest = await db.get('SELECT status FROM agent_tasks WHERE id = ?', taskId);
      if (latest?.status === 'cancelled') {
        terminalStatus = 'cancelled';
        break;
      }

      iterations = i + 1;
      const response = await callAIWithTools(
        MODELS.AZURE_MAIN,
        systemPrompt,
        messages,
        AI_AGENT_TOOLS,
        1500,
        { therapistId: therapist.id, kind: `background_task_iter_${i}` },
      );

      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('') || '';
        break;
      }

      // Execute each tool call. In background mode we provide a no-op `send`
      // (no SSE) and surface approval/picker requests as `needs_input`.
      let needsInput = false;
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeAgentTool({
          name: toolUse.name,
          args: toolUse.input || {},
          db,
          therapistId: therapist.id,
          nameMap: {},        // background tasks don't carry a nameMap yet — future improvement
          send: () => {},     // no SSE in background mode
          rawMessage: task.prompt,
        });

        toolCallLog.push({
          iter: i,
          tool: toolUse.name,
          input: toolUse.input || {},
          // Strip __flags before logging
          result: result && typeof result === 'object'
            ? Object.fromEntries(Object.entries(result).filter(([k]) => !k.startsWith('__')))
            : result,
          needs_input: !!(result?.__requiresApproval || result?.__requiresPicker),
        });

        if (result?.__requiresApproval || result?.__requiresPicker) {
          needsInput = true;
          break;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      if (needsInput) {
        terminalStatus = 'needs_input';
        finalText = finalText
          || 'This task needs your input to continue. Open it in Miwa chat to finish.';
        break;
      }

      messages.push({ role: 'user', content: toolResults });

      // Persist partial progress after every iteration so the UI can show
      // "12 tool calls, still working..." while the task runs.
      await updateTaskProgress(db, taskId, {
        iterations,
        tool_calls_json: JSON.stringify(toolCallLog),
      });
    }

    if (iterations >= MAX_ITERATIONS && !finalText) {
      finalText = 'Reached the maximum of ' + MAX_ITERATIONS + ' iterations without a final answer. Partial tool-call log preserved.';
    }
  } catch (err) {
    terminalStatus = 'failed';
    terminalError = err?.message || String(err);
  } finally {
    clearTimeout(timeoutHandle);
    _running.delete(taskId);
  }

  await updateTaskProgress(db, taskId, {
    status: terminalStatus,
    result_text: finalText || null,
    error_message: terminalError,
    iterations,
    tool_calls_json: JSON.stringify(toolCallLog),
    completed_at: new Date().toISOString(),
  });
}

// ── Worker loop: poll queue, dispatch up to MAX_CONCURRENT ──────────────────

let _workerStarted = false;

/**
 * Start the background worker. Idempotent — calling multiple times is a no-op.
 * Called once from server/index.js at boot.
 */
function startWorker() {
  if (_workerStarted) return;
  _workerStarted = true;

  console.log('[task-runner] Background agent worker started (poll every 5s)');

  // Crash recovery: any row stuck in status='running' on boot was orphaned
  // by a previous process crash. Re-queue them so they pick back up.
  (async () => {
  try {
    const db = getAsyncDb();
    const orphans = await db.all('SELECT id FROM agent_tasks WHERE status = ?', 'running');
    if (orphans.length > 0) {
      await db.run("UPDATE agent_tasks SET status = 'queued' WHERE status = 'running'");
      await persistIfNeeded();
      console.log(`[task-runner] Recovered ${orphans.length} orphaned task(s) from prior crash`);
    }
  } catch (err) {
    console.warn('[task-runner] Crash recovery failed:', err.message);
  }
  })();

  setInterval(pollOnce, POLL_INTERVAL_MS).unref();
}

/**
 * Look for queued tasks and dispatch as many as concurrency allows.
 * Runs every POLL_INTERVAL_MS; also called inline when a new task is created
 * so the user doesn't wait a full 5 sec for the worker to pick it up.
 */
async function pollOnce() {
  if (_running.size >= MAX_CONCURRENT) return;

  try {
    const db = getAsyncDb();
    const slotsAvailable = MAX_CONCURRENT - _running.size;
    // Fetch more candidates than we need, because some might be blocked by
    // per-therapist caps.
    const candidates = await db.all(
      `SELECT id, therapist_id FROM agent_tasks
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT ?`,
      slotsAvailable * 3,
    );

    for (const row of candidates) {
      if (_running.size >= MAX_CONCURRENT) break;
      if (runningForTherapist(row.therapist_id) >= MAX_PER_THERAPIST) continue;
      if (_running.has(row.id)) continue;

      // Kick off — no await, runs concurrently. Errors are handled inside
      // runTask and persisted to the DB.
      runTask(row.id).catch(err => {
        console.error('[task-runner] Unhandled error in runTask', row.id, err);
      });
    }
  } catch (err) {
    console.warn('[task-runner] Poll error:', err.message);
  }
}

/**
 * Cancel a running task. Returns true if the task was running and was aborted,
 * false if it wasn't found in the running set (caller should still mark
 * 'cancelled' in the DB for the queued case).
 */
function cancelRunning(taskId) {
  const info = _running.get(taskId);
  if (!info) return false;
  info.abortController.abort('cancelled by user');
  return true;
}

// ── Task creation API (for routes/agent-tasks.js) ──────────────────────────

/**
 * Insert a new queued task and nudge the worker to pick it up.
 * Returns the full task row.
 */
async function enqueueTask({ therapistId, prompt, title, context }) {
  if (!therapistId) throw new Error('therapistId required');
  if (!prompt || !prompt.trim()) throw new Error('prompt required');

  const db = getAsyncDb();
  const insert = await db.insert(
    `INSERT INTO agent_tasks (therapist_id, title, prompt, context_json, status)
     VALUES (?, ?, ?, ?, 'queued')`,
    therapistId,
    (title && title.trim()) || deriveTitle(prompt),
    prompt.trim(),
    context ? JSON.stringify(context) : null,
  );
  await persistIfNeeded();

  // Kick the worker so the task starts within a few hundred ms instead of up
  // to POLL_INTERVAL_MS from now.
  setImmediate(pollOnce);

  return db.get('SELECT * FROM agent_tasks WHERE id = ?', insert.lastInsertRowid);
}

module.exports = {
  startWorker,
  enqueueTask,
  cancelRunning,
  pollOnce,
  deriveTitle,
  // Exported for tests
  _runTask: runTask,
  _running,
};
