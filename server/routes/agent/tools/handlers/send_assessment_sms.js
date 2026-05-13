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

module.exports = async function sendAssessmentSmsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  
  const phone = normalisePhone(patient.phone);
  if (!phone) return { error: `${patient.client_id} has no mobile number on file` };
  if (!patient.sms_consent) return { error: `${patient.client_id} does not have recorded SMS consent` };
  
  const ASSESSMENT_TEMPLATES = { 'PHQ-9': 'phq9', 'GAD-7': 'gad7', 'PCL-5': 'pcl5' };
  const asmtType = args.assessment_type || 'PHQ-9';
  const templateKey = ASSESSMENT_TEMPLATES[asmtType] || asmtType.toLowerCase().replace(/[^a-z0-9]/g, '');
  const token = crypto.randomBytes(24).toString('base64url');
  const sendAt = args.send_at ? new Date(args.send_at).toISOString() : new Date().toISOString();
  
  await db.run(
    `INSERT INTO assessment_links (token, patient_id, therapist_id, template_type, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+30 days'))`,
    token, patient.id, therapistId, templateKey
  );
  await db.insert(
    `INSERT INTO scheduled_sends (therapist_id, patient_id, assessment_type, token, phone, send_at, custom_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    therapistId, patient.id, asmtType, token, phone, sendAt, null
  );
  await persistIfNeeded();
  
  const isNow = new Date(sendAt) <= new Date(Date.now() + 60_000);
  return {
    status: 'queued',
    assessment_type: asmtType,
    client_id: patient.client_id,
    send_timing: isNow ? 'immediately' : `scheduled for ${new Date(sendAt).toLocaleString()}`,
    phone_masked: phone.replace(/\d(?=\d{4})/g, '•'),
  };
};
