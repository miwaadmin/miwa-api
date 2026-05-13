const crypto = require('crypto');
const { persistIfNeeded } = require('../../../db/asyncDb');
const { MODELS, callAI } = require('../../../lib/aiExecutor');
const { sendPortalSms, normalisePhone } = require('../../../services/twilio');
const { snapshotPlan } = require('../../../lib/treatmentPlanRevisions');
const { createAssistantAction, emitAssistantAction } = require('../../../lib/assistantActions');

const { inferAppointmentType } = require('../lib/helpers');
const {
  findPatientByCode,
  findPatientByDisplayName,
  buildPatientContext,
} = require('../lib/patient-context');
const {
  getClientAssessments,
  getClientSessions,
  getCaseloadSummaryFiltered,
  findPatientsForBatchAssessment,
} = require('../lib/caseload-readers');
const { formatAppointmentPreview } = require('../lib/appointment-ops');
const { generateClientId } = require('../lib/client-codes');
const {
  buildReviewPayload,
  getChartData,
  createAndStoreReport,
} = require('../lib/reports-pipeline');
const { runBackgroundTask } = require('../lib/background-tasks');

const { AGENT_RESOURCES } = require('./data/resources');
const { APP_HELP_KB } = require('./data/help-kb');
const { PORTAL_LINK_TTL_DAYS } = require('./definitions');
const getClientAssessmentsHandler = require('./handlers/get_client_assessments');
const getClientSessionsHandler = require('./handlers/get_client_sessions');
const getCaseloadSummaryHandler = require('./handlers/get_caseload_summary');
const scheduleAppointmentHandler = require('./handlers/schedule_appointment');
const cancelAppointmentHandler = require('./handlers/cancel_appointment');
const sendAssessmentSmsHandler = require('./handlers/send_assessment_sms');
const batchSendAssessmentsHandler = require('./handlers/batch_send_assessments');
const createClientHandler = require('./handlers/create_client');
const generateReportHandler = require('./handlers/generate_report');
const getResourcesHandler = require('./handlers/get_resources');
const getBillingStatusHandler = require('./handlers/get_billing_status');
const getOutcomesDashboardHandler = require('./handlers/get_outcomes_dashboard');
const getScheduleHandler = require('./handlers/get_schedule');
const getAppHelpHandler = require('./handlers/get_app_help');
const getSessionBriefHandler = require('./handlers/get_session_brief');
const executeWorkflowHandler = require('./handlers/execute_workflow');
const getWorkflowStatusHandler = require('./handlers/get_workflow_status');
const createTreatmentPlanHandler = require('./handlers/create_treatment_plan');
const getTreatmentPlanHandler = require('./handlers/get_treatment_plan');
const updateTreatmentGoalHandler = require('./handlers/update_treatment_goal');
const delegateAnalysisHandler = require('./handlers/delegate_analysis');
const searchPracticeInsightsHandler = require('./handlers/search_practice_insights');
const scheduleTaskHandler = require('./handlers/schedule_task');
const listScheduledTasksHandler = require('./handlers/list_scheduled_tasks');
const runBackgroundTaskHandler = require('./handlers/run_background_task');
const checkBackgroundTasksHandler = require('./handlers/check_background_tasks');
const manageEventTriggersHandler = require('./handlers/manage_event_triggers');
const sendPortalLinkHandler = require('./handlers/send_portal_link');
const submitFeedbackHandler = require('./handlers/submit_feedback');

async function executeAgentTool({ name, args, db, therapistId, nameMap, send, rawMessage }) {
  // Strip brackets from client codes: [DEMO-ABC123] → DEMO-ABC123
  async function resolvePatient(rawId) {
    const clean = (rawId || '').replace(/[\[\]]/g, '').trim();
    if (!clean) return null;
    return await findPatientByCode(db, therapistId, clean)
      || await findPatientByDisplayName(db, therapistId, clean);
  }

  switch (name) {
    case 'get_client_assessments':
      return await getClientAssessmentsHandler({ args, db, therapistId, send, resolvePatient });

    case 'get_client_sessions':
      return await getClientSessionsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_caseload_summary':
      return await getCaseloadSummaryHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'schedule_appointment':
      return await scheduleAppointmentHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'cancel_appointment':
      return await cancelAppointmentHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'send_assessment_sms':
      return await sendAssessmentSmsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'batch_send_assessments':
      return await batchSendAssessmentsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'create_client':
      return await createClientHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'generate_report':
      return await generateReportHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    /* ── New tools ──────────────────────────────────────────────────────── */
    case 'get_resources':
      return await getResourcesHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_billing_status':
      return await getBillingStatusHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_outcomes_dashboard':
      return await getOutcomesDashboardHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_schedule':
      return await getScheduleHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_app_help':
      return await getAppHelpHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // ═══════════════════════════════════════════════════════════════════════
    // AGENTIC PILLAR TOOL IMPLEMENTATIONS
    // ═══════════════════════════════════════════════════════════════════════

    // Pillar 1: Pre-Session Briefs
    case 'get_session_brief':
      return await getSessionBriefHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 2: Workflow Engine
    case 'execute_workflow':
      return await executeWorkflowHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_workflow_status':
      return await getWorkflowStatusHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 3: Treatment Plan Agent
    case 'create_treatment_plan':
      return await createTreatmentPlanHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_treatment_plan':
      return await getTreatmentPlanHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'update_treatment_goal':
      return await updateTreatmentGoalHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 4: Sub-Agent Delegation (UPGRADED — parallel multi-agent with synthesis)
    case 'delegate_analysis':
      return await delegateAnalysisHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 5: Practice Intelligence
    case 'search_practice_insights':
      return await searchPracticeInsightsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // ═══════════════════════════════════════════════════════════════════════
    // TIER 1 AGENTIC UPGRADES — Tool Implementations
    // ═══════════════════════════════════════════════════════════════════════

    // Feature 2: Agent-Created Scheduled Tasks
    case 'schedule_task':
      return await scheduleTaskHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'list_scheduled_tasks':
      return await listScheduledTasksHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Feature 4: Background Tasks with Notifications
    case 'run_background_task':
      return await runBackgroundTaskHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'check_background_tasks':
      return await checkBackgroundTasksHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Feature 5: Event Trigger Management
    case 'manage_event_triggers':
      return await manageEventTriggersHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'send_portal_link':
      return await sendPortalLinkHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'submit_feedback':
      return await submitFeedbackHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
module.exports = { executeAgentTool };
