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

module.exports = async function checkBackgroundTasksHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const tasks = await db.all(
    "SELECT id, task_type, description, status, progress, created_at, completed_at FROM background_tasks WHERE therapist_id = ? ORDER BY created_at DESC LIMIT 10",
    therapistId
  );
  const running = tasks.filter(t => t.status === 'running').length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  // Include result for recently completed tasks
  const withResults = [];
  for (const t of tasks) {
    if (t.status === 'completed') {
      const full = await db.get('SELECT result_json FROM background_tasks WHERE id = ?', t.id);
      if (full?.result_json) {
        try { t.result_preview = JSON.parse(full.result_json); } catch {}
      }
    }
    withResults.push(t);
  }
  return { tasks: withResults, running, completed };
};
