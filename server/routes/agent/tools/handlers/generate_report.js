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

module.exports = async function generateReportHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  
  const context = await buildPatientContext(db, therapistId, patient.id);
  const reportSpec = {
    viewer: args.viewer || 'therapist',
    purpose: args.purpose || 'progress review',
    focus: args.focus || 'balanced progress summary',
    timeframe: 'all available sessions',
    includeCharts: true,
    title: `${patient.client_id} Progress Review`,
  };
  
  const report = await buildReviewPayload({
    patient, sessions: context.sessions, assessments: context.assessments, reportSpec, therapistId,
  });
  const chartData = getChartData(context.assessments);
  const stored = await createAndStoreReport({
    therapistId, patient,
    report: { ...report, chartData },
    chartData,
    audience: reportSpec.viewer,
    purpose: reportSpec.purpose,
  });
  
  send({
    type: 'report_ready',
    reportId: stored.reportId,
    title: report.title,
    downloadUrl: `/agent/reports/${stored.reportId}/download`,
  });
  
  return {
    status: 'generated',
    title: report.title,
    summary: (report.executiveSummary || '').slice(0, 200),
  };
};
