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

module.exports = async function searchPracticeInsightsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  try {
    const { searchInsights, getInsightsSummary } = require('../services/practice-intelligence');
    if (args.insight_type) {
      const insights = await db.all(
        'SELECT * FROM practice_insights WHERE therapist_id = ? AND insight_type = ? AND is_active = 1 ORDER BY confidence_score DESC LIMIT 10',
        therapistId, args.insight_type
      );
      return { insights: insights.map(i => ({ type: i.insight_type, insight: i.insight_text, confidence: i.confidence_score, generated: i.created_at })) };
    }
    const results = await searchInsights(therapistId, args.query);
    if (!results.length) return { message: 'No practice insights found yet. Insights are generated weekly from your session notes and assessment data. Keep documenting — patterns will emerge!' };
    return { insights: results.map(i => ({ type: i.insight_type, insight: i.insight_text, confidence: i.confidence_score, generated: i.created_at })) };
  } catch (err) {
    return { message: 'Practice intelligence is building — insights generate weekly from your documentation patterns. No insights available yet.' };
  }
};
