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

module.exports = async function getWorkflowStatusHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  try {
    const { getWorkflowStatus, listWorkflows } = require('../services/workflow-engine');
    if (args.workflow_id) {
      const status = await getWorkflowStatus(args.workflow_id, therapistId);
      if (!status) return { error: 'Workflow not found' };
      return {
        id: status.id,
        type: status.workflow_type,
        label: status.label,
        status: status.status,
        progress: `${status.completedSteps}/${status.totalSteps} steps completed`,
        current_step: status.current_step,
        steps: status.steps.map(s => ({ step: s.step_number, tool: s.tool_name, description: s.description, status: s.status })),
      };
    }
    const workflows = await listWorkflows(therapistId);
    return { workflows: workflows.map(w => ({ id: w.id, type: w.workflow_type, label: w.label, status: w.status, created_at: w.created_at })) };
  } catch (err) {
    return { error: `Workflow status: ${err.message}` };
  }
};
