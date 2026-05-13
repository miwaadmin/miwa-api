const {
  crypto,
  persistIfNeeded,
  MODELS,
  callAI,
  sendPortalSms,
  normalisePhone,
  snapshotPlan,
  createAssistantAction,
  emitAssistantAction,
  inferAppointmentType,
  buildPatientContext,
  getClientSessions,
  getCaseloadSummaryFiltered,
  findPatientsForBatchAssessment,
  formatAppointmentPreview,
  generateClientId,
  buildReviewPayload,
  getChartData,
  createAndStoreReport,
  runBackgroundTask,
  AGENT_RESOURCES,
  APP_HELP_KB,
  PORTAL_LINK_TTL_DAYS,
} = require('./deps');

module.exports = async function submitFeedbackHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const feedbackMsg = String(args.message || '').trim();
  if (!feedbackMsg) return { error: 'No feedback message provided.' };
  const validCats = ['bug', 'feature', 'general'];
  const cat = validCats.includes(args.category) ? args.category : 'general';
  try {
    await db.insert(
      `INSERT INTO user_feedback (therapist_id, message, category, source) VALUES (?, ?, ?, 'chat')`,
      therapistId, feedbackMsg, cat,
    );
    await persistIfNeeded();
    return { ok: true, category: cat };
  } catch (err) {
    return { error: `Failed to save feedback: ${err.message}` };
  }
};
