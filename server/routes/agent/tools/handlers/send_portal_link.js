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

module.exports = async function sendPortalLinkHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  
  const crypto = require('crypto');
  const token = crypto.randomBytes(24).toString('base64url');
  
  await db.insert(
    `INSERT INTO client_portal_tokens (token, patient_id, therapist_id, expires_at)
     VALUES (?, ?, ?, datetime('now', '+7 days'))`,
    token, patient.id, therapistId,
  );
  await persistIfNeeded();
  
  const baseUrl = process.env.APP_URL || 'https://miwa.care';
  const portalUrl = `${baseUrl}/portal/${token}`;
  
  // Try text delivery only when SMS is explicitly enabled and configured
  const phone = patient.phone ? normalisePhone(patient.phone) : null;
  let deliveryMethod = 'link_only';
  if (phone && patient.sms_consent) {
    try {
      const result = await sendPortalSms(phone, portalUrl);
      if (result.status !== 'skipped') deliveryMethod = 'sms';
    } catch {}
  }
  
  return {
    portal_url: portalUrl,
    client_id: patient.client_id,
    display_name: patient.display_name || patient.client_id,
    delivery: deliveryMethod,
    expires_in: `${PORTAL_LINK_TTL_DAYS} days`,
    phone_masked: phone ? phone.replace(/\d(?=\d{4})/g, '\u2022') : null,
  };
};
