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

module.exports = async function getResourcesHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  let results = [];
  const q = (args.query || '').toLowerCase();
  const cat = args.category;
  for (const group of AGENT_RESOURCES) {
    if (cat && group.id !== cat) continue;
    for (const item of group.items) {
      if (q && !item.name.toLowerCase().includes(q) && !item.type.toLowerCase().includes(q) && !group.category.toLowerCase().includes(q)) continue;
      results.push({ name: item.name, type: item.type, url: item.url, source: item.source, category: group.category, urgent: item.urgent || false });
    }
  }
  if (!q && !cat) {
    // Return category summaries instead of all 72 items
    return { categories: AGENT_RESOURCES.map(g => ({ category: g.category, id: g.id, count: g.items.length })), total: AGENT_RESOURCES.reduce((s, g) => s + g.items.length, 0) };
  }
  return { count: results.length, resources: results.slice(0, 10) };
};
