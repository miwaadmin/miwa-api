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

module.exports = async function createClientHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  let displayName = (args.display_name || '').trim();
  // If the AI returned a scrubbed token (e.g. "[NAME]", "[CODE]") instead of a real name,
  // try to recover the actual name from the original (pre-scrub) clinician message.
  if (!displayName || /^\[.*\]$/.test(displayName) || displayName === '[NAME]') {
    if (rawMessage) {
      // Find capitalized words in rawMessage that aren't known client codes and aren't common words
      const knownCodes = new Set((nameMap || []).map(p => p.client_id.toLowerCase()));
      const commonWords = new Set(['i','a','at','in','on','with','the','is','it','am','pm','an','by','or','and','to','for','my','me','he','she','they','we','today','tomorrow','intake','couple','family','group','session','per','new','client','patient','appointment','phone','person','video']);
      const candidates = [...rawMessage.matchAll(/\b([A-Z][a-z]{1,20})\b/g)]
        .map(m => m[1])
        .filter(w => !commonWords.has(w.toLowerCase()) && !knownCodes.has(w.toLowerCase()));
      if (candidates.length > 0) displayName = candidates[0];
    }
  }
  if (!displayName || /^\[.*\]$/.test(displayName)) return { error: 'display_name is required to create a client' };
  
  // Duplicate guard: if a client with this exact name already exists, return the
  // existing record instead of creating a duplicate. Case-insensitive match.
  const existing = await db.get(
    'SELECT id, client_id, display_name FROM patients WHERE therapist_id = ? AND LOWER(display_name) = LOWER(?)',
    therapistId, displayName
  );
  if (existing) {
    return {
      already_exists: true,
      client_id: existing.client_id,
      display_name: existing.display_name,
      message: `${existing.display_name} already exists (${existing.client_id}). Use this client_id for scheduling or other actions.`,
    };
  }
  
  const clientId = await generateClientId(db, therapistId);
  
  await db.insert(
    `INSERT INTO patients (
      client_id, display_name, client_type, session_modality, session_duration,
      age, gender, presenting_concerns, phone, therapist_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    clientId,
    displayName,
    args.client_type || 'individual',
    args.session_modality || null,
    args.session_duration || 50,
    args.age || null,
    args.gender || null,
    args.presenting_concerns || null,
    args.phone || null,
    therapistId
  );
  await persistIfNeeded();
  
  const created = await db.get('SELECT * FROM patients WHERE client_id = ? AND therapist_id = ?', clientId, therapistId);
  
  send({
    type: 'client_created',
    clientId,
    displayName,
    clientType: args.client_type || 'individual',
    sessionModality: args.session_modality || null,
  });
  emitAssistantAction(send, createAssistantAction('show_client', {
    title: 'Client profile created',
    summary: `${displayName} is ready for scheduling, assessments, and intake documentation.`,
    payload: {
      patientId: created?.id,
      clientId,
      displayName,
      clientType: args.client_type || 'individual',
      sessionModality: args.session_modality || null,
    },
  }));
  
  return {
    status: 'created',
    client_id: clientId,
    display_name: displayName,
    patient_id: created?.id,
    message: `Profile created for ${displayName} with code ${clientId}.`,
  };
};
