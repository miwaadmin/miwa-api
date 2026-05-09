const { MODELS, callAI } = require('../../../lib/aiExecutor');

/**
 * Compress older conversation history into a summary using Haiku.
 * Keeps last 10 messages, summarises everything older.
 * Runs in background — non-blocking.
 */
async function compressConversationHistory(db, therapistId) {
  // Get all messages
  const allMessages = await db.all(
    'SELECT role, content, created_at FROM chat_messages WHERE therapist_id = ? ORDER BY created_at ASC',
    therapistId
  );

  if (allMessages.length <= 20) return; // Not enough to compress

  const toCompress = allMessages.slice(0, -10);
  const conversationText = toCompress
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join('\n');

  const summaryText = await callAI(
    MODELS.AZURE_MAIN,
    'You are summarizing a conversation between a therapist and their AI copilot Miwa. Preserve: (1) clinical decisions made, (2) client-specific context discussed, (3) action items agreed upon, (4) any corrections the therapist made to Miwa. Be concise but preserve critical clinical context. Use 200 words max.',
    `Summarize this conversation:\n\n${conversationText.slice(0, 10000)}`,
    500,
    { therapistId, kind: 'conversation_summary', skipBudgetCheck: true }
  );

  // Store summary
  await db.insert(
    'INSERT INTO conversation_summaries (therapist_id, summary, messages_compressed, token_estimate) VALUES (?, ?, ?, ?)',
    therapistId, summaryText, toCompress.length, Math.round(summaryText.length / 4)
  );

  // Delete compressed messages (keep last 10)
  const keepFrom = allMessages[allMessages.length - 10]?.created_at;
  if (keepFrom) {
    await db.run(
      'DELETE FROM chat_messages WHERE therapist_id = ? AND created_at < ?',
      therapistId, keepFrom
    );
  }

  console.log(`[memory] Compressed ${toCompress.length} messages for therapist ${therapistId}`);
}

module.exports = { compressConversationHistory };
