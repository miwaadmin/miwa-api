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

module.exports = async function executeWorkflowHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  try {
    const { createWorkflow } = require('../services/workflow-engine');
    const params = {};
    if (args.client_name) params.client_name = args.client_name;
    if (args.client_id) {
      const patient = await resolvePatient(args.client_id);
      if (patient) params.patient_id = patient.id;
    }
    if (args.case_type) params.case_type = args.case_type;
    if (args.concerns) params.concerns = args.concerns;
  
    const result = await createWorkflow(therapistId, args.workflow_type, params);
    return {
      message: `Workflow "${result.label}" started with ${result.steps} steps.`,
      workflow_id: result.workflowId,
      label: result.label,
      total_steps: result.steps,
      note: 'Steps requiring your approval will pause and ask before proceeding.',
    };
  } catch (err) {
    return { error: `Workflow: ${err.message}` };
  }
};
