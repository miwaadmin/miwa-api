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

module.exports = async function batchSendAssessmentsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const candidates = await findPatientsForBatchAssessment(db, therapistId, args.filter || null);
  const withPhone = candidates.filter(p => p.phone && p.sms_consent && normalisePhone(p.phone));
  
  if (withPhone.length === 0) return { error: 'No clients with mobile numbers and recorded SMS consent match that filter' };
  
  send({
    type: 'batch_assessment_picker',
    assessmentType: args.assessment_type || 'PHQ-9',
    filter: args.filter || 'all',
    spreadOption: args.spread_over_hours ? 'spread' : 'now',
    patients: withPhone.map(p => ({
      id: p.id,
      name: p.display_name || p.client_id,
      clientId: p.client_id,
      phone: p.phone,
    })),
  });
  emitAssistantAction(send, createAssistantAction('assessment_batch_preview', {
    title: `Batch ${args.assessment_type || 'PHQ-9'}`,
    summary: `${withPhone.length} eligible clients matched ${args.filter || 'all clients'}.`,
    payload: {
      assessmentType: args.assessment_type || 'PHQ-9',
      filter: args.filter || 'all',
      spreadOption: args.spread_over_hours ? 'spread' : 'now',
      patients: withPhone.map(p => ({
        id: p.id,
        name: p.display_name || p.client_id,
        clientId: p.client_id,
      })),
    },
  }));
  
  return { __requiresPicker: true };
};
