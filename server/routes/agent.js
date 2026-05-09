const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const multer = require('multer');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { MODELS, callAI, callAIWithTools } = require('../lib/aiExecutor');
const {
  transcribeAudioBuffer,
  generateSpeechBuffer,
  isAIServiceError,
  safeAIErrorResponse,
} = require('../services/aiClient');
const {
  makeStorageKey,
  readStoredFile,
  storedFileExists,
  uploadLocalFile,
} = require('../services/fileStorage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const { scrubText } = require('../lib/scrubber');
const { normalisePhone, sendAppointmentSms, sendPortalSms } = require('../services/twilio');

const router = express.Router();
const REPORTS_DIR = path.join(__dirname, '..', 'generated_reports');
const { buildPatientDossier } = require('../lib/patientDossier');
const { snapshotPlan } = require('../lib/treatmentPlanRevisions');
const { logTrajectory } = require('../lib/trajectoryLogger');
const {
  auditAction,
  formatRuntimeForPrompt,
  getRuntimeSnapshot,
  recordConversationSignal,
} = require('../services/assistantRuntime');
const {
  createRealtimeCallAnswer,
  createRealtimeClientSecret,
  getRealtimeConfig,
  getRealtimeStatus,
  safeOpenAIDetails,
} = require('../services/realtimeVoice');
const {
  collectTraineeWorkspaceState,
  formatTraineeWorkspaceState,
  buildLicensedTransitionPlan,
  generateCaseSnapshot,
  generateSupervisionAgenda,
  generateTraineeDailyBrief,
  generateTraineeExport,
  getEhrCompanionProfile,
  scanEthicalEscalations,
} = require('../services/traineeIntelligence');
const {
  createAssistantAction,
  emitAssistantAction,
} = require('../lib/assistantActions');

const { AGENT_RESOURCES } = require('./agent/tools/data/resources');
const { APP_HELP_KB } = require('./agent/tools/data/help-kb');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const {
  sendRouteError,
  safePdfDownloadName,
  escapeJsonForPrompt,
  safeJsonParse,
  isInternalModelQuestion,
  internalModelDisclosureReply,
  normalizeImageAttachments,
  inferAppointmentType,
} = require('./agent/lib/helpers');

const {
  escapeRegex,
  buildNameMap,
  scrubNamesFromMessage,
  restoreNamesInResponse,
  detectAmbiguousNames,
} = require('./agent/lib/phi-names');

const {
  buildPatientContext,
  findPatientByCode,
  findPatientByDisplayName,
  buildPatientSummary,
  buildCaseloadSummary,
} = require('./agent/lib/patient-context');

const {
  SOUL_CATEGORIES,
  loadTherapistSoul,
  extractAndSavePreferences,
} = require('./agent/lib/soul-profile');

const { compressConversationHistory } = require('./agent/lib/conversation-memory');

const { runBackgroundTask } = require('./agent/lib/background-tasks');

const {
  findPatientsForBatchAssessment,
  getClientAssessments,
  getClientSessions,
  getCaseloadSummaryFiltered,
} = require('./agent/lib/caseload-readers');

const { planRequest } = require('./agent/lib/planner');

const {
  formatAppointmentPreview,
  createAppointmentRecord,
  generateMeetForAppointment,
  maybeSendTelehealthSms,
  getGoogleCalendarSyncConfig,
  buildAppointmentSyncMeta,
  buildAppointmentDateFields,
  getAppointmentById,
  findAppointmentConflicts,
} = require('./agent/lib/appointment-ops');

const { generateClientId, extractClientCodeFromText } = require('./agent/lib/client-codes');

const {
  buildReviewPayload,
  getChartData,
  wrapText,
  createReportPdf,
  createAndStoreReport,
} = require('./agent/lib/reports-pipeline');

const { AGENT_TOOLS, AI_AGENT_TOOLS, PORTAL_LINK_TTL_DAYS } = require('./agent/tools/definitions');

/**
 * Execute a single tool call from the agent loop.
 * Returns a plain object with the result (or special __requiresApproval / __requiresPicker flags).
 */
const { executeAgentTool } = require('./agent/tools/execute');

router.use(require('./agent/portal'));

router.use(require('./agent/appointments'));

router.use(require('./agent/reports'));

router.use(require('./agent/trainee'));

router.use(require('./agent/chat'));


router.use(require('./agent/voice'));

router.use(require('./agent/preferences'));


router.use(require('./agent/treatment-plans'));

module.exports = router;

// ── Expose internals for task-runner.js ──────────────────────────────────────
// These are used by the background task runner (services/task-runner.js) to
// run the same agent loop outside of an HTTP request. Keeping them on the
// router module avoids a risky extraction to a shared lib while still letting
// the runner reuse the battle-tested tool implementations.
module.exports.AGENT_TOOLS        = AGENT_TOOLS;
module.exports.AI_AGENT_TOOLS = AI_AGENT_TOOLS;
module.exports.executeAgentTool   = executeAgentTool;
module.exports.isInternalModelQuestion = isInternalModelQuestion;
module.exports.internalModelDisclosureReply = internalModelDisclosureReply;
