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

module.exports = async function cancelAppointmentHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  // Find the appointment by ID or by client + date
  let appt = null;
  if (args.appointment_id) {
    appt = await db.get(
      `SELECT a.*, p.client_id, p.display_name FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.id = ? AND a.therapist_id = ? AND a.status != 'cancelled'`,
      args.appointment_id, therapistId
    );
  } else if (args.client_id) {
    const patient = await resolvePatient(args.client_id);
    if (!patient) return { error: 'Client not found' };
    // Find upcoming non-cancelled appointment, optionally filtered by date
    let dateFilter = '';
    const params = [patient.id, therapistId];
    if (args.scheduled_date) {
      dateFilter = ' AND DATE(a.scheduled_start) = DATE(?)';
      params.push(args.scheduled_date);
    }
    appt = await db.get(
      `SELECT a.*, p.client_id, p.display_name FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.patient_id = ? AND a.therapist_id = ? AND a.status != 'cancelled'${dateFilter}
       ORDER BY a.scheduled_start ASC LIMIT 1`,
      ...params
    );
  }
  if (!appt) return { error: 'No matching appointment found. Check the client name and date.' };
  
  // Cancel it (soft delete — same logic as REST endpoint)
  await db.run(
    `UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    appt.id
  );
  await persistIfNeeded();
  
  const name = appt.display_name || appt.client_id;
  const when = appt.scheduled_start
    ? new Date(appt.scheduled_start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unscheduled';
  
  send({
    type: 'appointment_cancelled',
    appointmentId: appt.id,
    clientName: name,
    scheduledStart: appt.scheduled_start,
  });
  
  return {
    cancelled: true,
    appointment_id: appt.id,
    client: name,
    was_scheduled_for: when,
    message: `Cancelled ${appt.appointment_type || 'session'} for ${name} (was ${when}).`,
  };
};
