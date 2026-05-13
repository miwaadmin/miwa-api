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

module.exports = async function getBillingStatusHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const row = await db.get('SELECT subscription_status, subscription_tier, workspace_uses FROM therapists WHERE id = ?', therapistId);
  if (!row) return { error: 'Therapist not found' };
  const trialLimit = 20;
  const isActive = row.subscription_status === 'active' || row.subscription_status === 'trialing';
  return {
    status: row.subscription_status || 'none',
    tier: row.subscription_tier || 'free_trial',
    workspace_uses: row.workspace_uses || 0,
    trial_limit: trialLimit,
    trial_remaining: Math.max(0, trialLimit - (row.workspace_uses || 0)),
    is_active: isActive,
  };
};
