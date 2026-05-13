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

module.exports = async function getOutcomesDashboardHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const totalAssessments = (await db.get('SELECT COUNT(*) as c FROM assessments WHERE therapist_id = ?', therapistId))?.c || 0;
  const activeClients = (await db.get('SELECT COUNT(DISTINCT patient_id) as c FROM assessments WHERE therapist_id = ?', therapistId))?.c || 0;
  const avgPhq9 = (await db.get("SELECT AVG(total_score) as avg FROM assessments WHERE therapist_id = ? AND assessment_type = 'PHQ-9'", therapistId))?.avg;
  const avgGad7 = (await db.get("SELECT AVG(total_score) as avg FROM assessments WHERE therapist_id = ? AND assessment_type = 'GAD-7'", therapistId))?.avg;
  const phq9Dist = await db.all("SELECT severity_level, COUNT(*) as count FROM assessments WHERE therapist_id = ? AND assessment_type = 'PHQ-9' GROUP BY severity_level", therapistId);
  const improvements = (await db.get(`SELECT COUNT(*) as c FROM (
    SELECT patient_id, assessment_type,
      total_score - LAG(total_score) OVER (PARTITION BY patient_id, assessment_type ORDER BY completed_at) as delta
    FROM assessments WHERE therapist_id = ?
  ) WHERE delta < 0`, therapistId))?.c || 0;
  return {
    total_assessments: totalAssessments,
    active_clients_assessed: activeClients,
    avg_phq9: avgPhq9 ? Math.round(avgPhq9 * 10) / 10 : null,
    avg_gad7: avgGad7 ? Math.round(avgGad7 * 10) / 10 : null,
    phq9_severity_distribution: phq9Dist,
    total_improvements: improvements,
  };
};
