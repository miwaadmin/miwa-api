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

module.exports = async function getAppHelpHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const topic = (args.topic || '').toLowerCase();
  const matches = [];
  for (const section of APP_HELP_KB) {
    const titleMatch = section.title.toLowerCase().includes(topic) || section.id.includes(topic);
    for (const entry of section.content) {
      const headingMatch = entry.heading.toLowerCase().includes(topic);
      const bodyMatch = entry.body.toLowerCase().includes(topic);
      if (titleMatch || headingMatch || bodyMatch) {
        matches.push({ section: section.title, heading: entry.heading, body: entry.body });
      }
    }
  }
  if (matches.length === 0) {
    return { message: 'No exact match found. Here are all help topics:', topics: APP_HELP_KB.map(s => s.title) };
  }
  return { matches: matches.slice(0, 3) };
};
