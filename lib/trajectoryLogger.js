/**
 * Trajectory Logger — captures every agent conversation in ShareGPT format
 * for eventual fine-tuning of a Miwa-specific clinical model.
 *
 * ShareGPT format (compatible with most fine-tuning pipelines):
 *   [{ from: "system", value: "..." },
 *    { from: "human",  value: "..." },
 *    { from: "gpt",    value: "<think>...</think><tool_call>..." },
 *    { from: "tool",   value: "<tool_response>..." },
 *    { from: "gpt",    value: "..." }]
 *
 * Design:
 *  - Non-blocking: all writes swallow errors (training data is never critical)
 *  - PHI-scrubbed input/output — we're saving what the AI actually saw
 *    post-scrub, which is safe to use for training
 *  - Opt-out via therapists.training_data_opt_out (default OFF = opted in)
 *  - Groups turns by session_token so the full conversation arc is queryable
 */

const { getDb } = require('../db');

function isOptedOut(db, therapistId) {
  try {
    const row = db.get(
      'SELECT training_data_opt_out FROM therapists WHERE id = ?',
      therapistId
    );
    return !!(row && row.training_data_opt_out);
  } catch { return true; }  // Fail safe — don't log if uncertain
}

/**
 * Log a full agent turn in ShareGPT format.
 *
 * @param {object} args
 * @param {number} args.therapistId
 * @param {string} args.sessionToken — UUID or hash to group turns
 * @param {string} args.model — e.g. 'azure-openai-sonnet-4-7'
 * @param {string} args.systemPrompt — the system prompt at this turn
 * @param {string} args.userMessage — therapist's scrubbed message
 * @param {Array}  args.responseContent — Azure OpenAI response content blocks
 * @param {Array}  args.toolResults — results from tools [{name, input, result}]
 * @param {string} args.finalText — final assistant text shown to user
 * @param {boolean} args.completed — turn finished successfully
 */
function logTrajectory({
  therapistId,
  sessionToken,
  model = 'unknown',
  systemPrompt,
  userMessage,
  responseContent,
  toolResults = [],
  finalText,
  completed = true,
}) {
  try {
    if (!therapistId) return;
    const db = getDb();
    if (isOptedOut(db, therapistId)) return;

    const conversation = [];

    if (systemPrompt) {
      conversation.push({ from: 'system', value: String(systemPrompt).slice(0, 20000) });
    }
    if (userMessage) {
      conversation.push({ from: 'human', value: String(userMessage).slice(0, 10000) });
    }

    // Serialize Azure OpenAI response into ShareGPT-style GPT turn with tool calls
    if (responseContent && Array.isArray(responseContent)) {
      const parts = [];
      for (const block of responseContent) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_use') {
          parts.push(
            `<tool_call>\n${JSON.stringify({ name: block.name, arguments: block.input || {} })}\n</tool_call>`
          );
        }
      }
      if (parts.length) {
        conversation.push({ from: 'gpt', value: parts.join('\n').slice(0, 20000) });
      }
    }

    // Tool responses
    for (const tr of (toolResults || [])) {
      try {
        conversation.push({
          from: 'tool',
          value: `<tool_response>\n${JSON.stringify({
            tool_name: tr.name || 'unknown',
            content: typeof tr.result === 'string' ? tr.result.slice(0, 6000) : JSON.stringify(tr.result).slice(0, 6000),
          })}\n</tool_response>`,
        });
      } catch {}
    }

    // If the turn produced a final text-only response distinct from the response blocks,
    // that's the assistant's final user-facing reply
    if (finalText && (!responseContent || !responseContent.some(b => b.type === 'text'))) {
      conversation.push({ from: 'gpt', value: String(finalText).slice(0, 20000) });
    }

    const toolCallsCount = (responseContent || []).filter(b => b.type === 'tool_use').length
                         + (toolResults || []).length;

    db.insert(
      `INSERT INTO training_trajectories
         (therapist_id, session_token, model, conversation_json, tool_calls_count, turn_completed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      therapistId,
      sessionToken || null,
      String(model),
      JSON.stringify(conversation),
      toolCallsCount,
      completed ? 1 : 0
    );
  } catch (err) {
    // Never crash the agent just because training logging failed
    console.warn('[trajectory] Failed to log turn:', err.message);
  }
}

/**
 * Rate a trajectory (good/bad feedback from clinician — future UI feature).
 */
function rateTrajectory(db, { id, therapistId, rating, note }) {
  try {
    if (!['good', 'bad'].includes(rating)) return false;
    db.run(
      `UPDATE training_trajectories SET rating = ?, rating_note = ?
         WHERE id = ? AND therapist_id = ?`,
      rating, note || null, id, therapistId
    );
    return true;
  } catch { return false; }
}

module.exports = { logTrajectory, rateTrajectory, isOptedOut };
