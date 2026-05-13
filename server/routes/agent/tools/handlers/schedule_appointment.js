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

module.exports = async function scheduleAppointmentHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  
  const preview = formatAppointmentPreview(patient, {
    appointmentType: args.appointment_type || inferAppointmentType(patient, ''),
    scheduledStart: args.scheduled_start,
    durationMinutes: args.duration_minutes || 50,
    location: args.location,
    notes: args.notes,
  });
  
  const action = await db.insert(
    `INSERT INTO agent_actions (therapist_id, kind, payload_json, status) VALUES (?, ?, ?, ?)`,
    therapistId, 'schedule_appointment',
    JSON.stringify({
      patientId: patient.id,
      appointmentType: args.appointment_type || inferAppointmentType(patient, ''),
      scheduledStart: args.scheduled_start || null,
      durationMinutes: args.duration_minutes || 50,
      location: args.location || null,
      notes: args.notes || null,
    }),
    'pending'
  );
  
  send({
    type: 'approval_required',
    actionId: action.lastInsertRowid,
    title: 'Schedule appointment',
    preview,
    patientCode: patient.client_id,
    patientId: patient.id,
    appointment: {
      appointmentType: args.appointment_type || inferAppointmentType(patient, ''),
      scheduledStart: args.scheduled_start || null,
      durationMinutes: args.duration_minutes || 50,
      location: args.location || null,
      notes: args.notes || null,
    },
  });
  emitAssistantAction(send, createAssistantAction('schedule_picker', {
    title: 'Schedule appointment',
    summary: preview,
    payload: {
      actionId: action.lastInsertRowid,
      patientId: patient.id,
      clientId: patient.client_id,
      clientName: patient.display_name || patient.client_id,
      appointmentType: args.appointment_type || inferAppointmentType(patient, ''),
      scheduledStart: args.scheduled_start || null,
      durationMinutes: args.duration_minutes || 50,
      location: args.location || null,
      notes: args.notes || null,
    },
    meta: { actionId: action.lastInsertRowid },
  }));
  
  return { __requiresApproval: true };
};
