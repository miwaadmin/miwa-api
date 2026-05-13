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

module.exports = async function getTreatmentPlanHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  
  const plan = await db.get("SELECT * FROM treatment_plans WHERE patient_id = ? AND therapist_id = ? AND status = 'active'", patient.id, therapistId);
  if (!plan) return { message: `No active treatment plan for ${patient.client_id}. Use create_treatment_plan to create one.` };
  
  const goals = await db.all('SELECT * FROM treatment_goals WHERE plan_id = ? ORDER BY id', plan.id);
  return {
    plan_id: plan.id,
    patient: patient.client_id,
    status: plan.status,
    created_at: plan.created_at,
    last_reviewed: plan.last_reviewed_at,
    goals: goals.map(g => ({
      id: g.id,
      goal: g.goal_text,
      target: g.target_metric,
      baseline: g.baseline_value,
      current: g.current_value,
      status: g.status,
      progress_notes: JSON.parse(g.progress_notes_json || '[]').slice(-3),
      interventions: JSON.parse(g.interventions_json || '[]'),
    })),
    summary: `${goals.filter(g => g.status === 'met').length} met, ${goals.filter(g => g.status === 'active').length} active, ${goals.filter(g => g.status === 'revised').length} revised`,
  };
};
