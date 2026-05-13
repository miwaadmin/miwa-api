const crypto = require('crypto');
const { persistIfNeeded } = require('../../../../db/asyncDb');
const { MODELS, callAI } = require('../../../../lib/aiExecutor');
const { sendPortalSms, normalisePhone } = require('../../../../services/twilio');
const { snapshotPlan } = require('../../../../lib/treatmentPlanRevisions');
const { createAssistantAction, emitAssistantAction } = require('../../../../lib/assistantActions');

const { inferAppointmentType } = require('../../lib/helpers');
const {
  findPatientByCode,
  findPatientByDisplayName,
  buildPatientContext,
} = require('../../lib/patient-context');
const {
  getClientAssessments,
  getClientSessions,
  getCaseloadSummaryFiltered,
  findPatientsForBatchAssessment,
} = require('../../lib/caseload-readers');
const { formatAppointmentPreview } = require('../../lib/appointment-ops');
const { generateClientId } = require('../../lib/client-codes');
const {
  buildReviewPayload,
  getChartData,
  createAndStoreReport,
} = require('../../lib/reports-pipeline');
const { runBackgroundTask } = require('../../lib/background-tasks');

const { AGENT_RESOURCES } = require('../data/resources');
const { APP_HELP_KB } = require('../data/help-kb');
const { PORTAL_LINK_TTL_DAYS } = require('../definitions');

module.exports = {
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
  findPatientByCode,
  findPatientByDisplayName,
  buildPatientContext,
  getClientAssessments,
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
};
