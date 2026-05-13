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

module.exports = async function getScheduleHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const daysAhead = args.days_ahead || 7;
  const limit = args.limit || 10;
  const rows = await db.all(
    `SELECT a.scheduled_start, a.duration_minutes, a.appointment_type, a.location, a.status, a.notes, p.client_id, p.display_name
     FROM appointments a JOIN patients p ON p.id = a.patient_id
     WHERE a.therapist_id = ? AND a.status != 'cancelled'
       AND a.scheduled_start >= datetime('now') AND a.scheduled_start <= datetime('now', '+' || ? || ' days')
     ORDER BY a.scheduled_start ASC LIMIT ?`,
    therapistId, daysAhead, limit
  );
  const appointments = rows.map(r => ({
    client: r.client_id || r.display_name,
    type: r.appointment_type,
    start: r.scheduled_start,
    duration: r.duration_minutes,
    location: r.location || 'Not specified',
    status: r.status,
  }));
  emitAssistantAction(send, createAssistantAction('prepare_session', {
    title: rows.length ? 'Upcoming sessions' : 'No upcoming sessions',
    summary: rows.length ? `${rows.length} appointment${rows.length === 1 ? '' : 's'} in the next ${daysAhead} days.` : 'Your schedule is clear for that window.',
    status: rows.length ? 'ready' : 'empty',
    payload: {
      appointments,
      focusAreas: appointments.slice(0, 3).map(a => `${a.client} · ${a.type || 'session'} · ${a.start ? new Date(a.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'unscheduled'}`),
    },
  }));
  return { count: rows.length, days_ahead: daysAhead, appointments };
};
