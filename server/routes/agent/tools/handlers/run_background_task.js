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

module.exports = async function runBackgroundTaskHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const { lastInsertRowid: bgTaskId } = await db.insert(
    'INSERT INTO background_tasks (therapist_id, task_type, description) VALUES (?, ?, ?)',
    therapistId, args.task_type, args.description
  );
  
  // Fire and forget — run in background
  runBackgroundTask(db, bgTaskId, therapistId, args.task_type).catch(async err => {
    await db.run("UPDATE background_tasks SET status = 'failed', error = ? WHERE id = ?", err.message, bgTaskId);
  });
  
  return {
    task_id: bgTaskId,
    status: 'running',
    message: `Background task started: "${args.description}". I'll notify you when it's done. You can keep chatting.`,
  };
};
