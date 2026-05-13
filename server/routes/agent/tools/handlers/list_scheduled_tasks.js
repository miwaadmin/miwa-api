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

module.exports = async function listScheduledTasksHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const status = args.status || 'pending';
  const where = status === 'all' ? '' : "AND status = 'pending'";
  const tasks = await db.all(
    `SELECT id, task_type, description, scheduled_for, status, created_at FROM agent_scheduled_tasks WHERE therapist_id = ? ${where} ORDER BY scheduled_for ASC LIMIT 20`,
    therapistId
  );
  return { tasks, count: tasks.length };
};
