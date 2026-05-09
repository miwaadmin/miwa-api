const { scrubText } = require('../../../lib/scrubber');
const { inferAppointmentType } = require('./helpers');

async function buildPatientContext(db, therapistId, patientId) {
  const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
  if (!patient) return null;

  const sessions = await db.all(
    `SELECT id, session_date, note_format, subjective, objective, assessment, plan, icd10_codes, ai_feedback, treatment_plan, created_at
     FROM sessions WHERE patient_id = ? AND therapist_id = ? ORDER BY COALESCE(session_date, created_at) ASC`,
    patientId,
    therapistId,
  );

  const assessments = await db.all(
    `SELECT id, template_type, total_score, severity_level, administered_at, is_improvement, is_deterioration
     FROM assessments WHERE patient_id = ? AND therapist_id = ? ORDER BY administered_at ASC`,
    patientId,
    therapistId,
  );

  // Last appointment gives us inferred defaults for duration + location/modality
  const lastAppointment = await db.get(
    `SELECT appointment_type, duration_minutes, location FROM appointments
     WHERE patient_id = ? AND therapist_id = ? ORDER BY created_at DESC LIMIT 1`,
    patientId, therapistId
  ) || null;

  return { patient, sessions, assessments, lastAppointment };
}

async function findPatientByCode(db, therapistId, code) {
  if (!code) return null;
  return await db.get('SELECT * FROM patients WHERE therapist_id = ? AND client_id = ?', therapistId, code.trim());
}

async function findPatientByDisplayName(db, therapistId, name) {
  if (!name) return null;
  // Exact match first, then case-insensitive
  const exact = await db.get(
    'SELECT * FROM patients WHERE therapist_id = ? AND LOWER(display_name) = LOWER(?)',
    therapistId, name.trim()
  );
  if (exact) return exact;
  // Fuzzy: display_name starts with the given name
  return await db.get(
    "SELECT * FROM patients WHERE therapist_id = ? AND LOWER(display_name) LIKE LOWER(?) || '%'",
    therapistId, name.trim()
  ) || null;
}

function buildPatientSummary(context) {
  if (!context) return '';
  const { patient, sessions, assessments, lastAppointment } = context;
  const latestSession = sessions[sessions.length - 1] || null;
  const latestAssessment = assessments[assessments.length - 1] || null;

  // Infer scheduling defaults — patient profile takes priority over last appointment
  const defaultDuration = patient.session_duration || lastAppointment?.duration_minutes || 50;
  const defaultLocation = patient.session_modality || lastAppointment?.location || null;
  const defaultType = inferAppointmentType(patient, lastAppointment?.appointment_type || '');

  const displayName = patient.display_name || patient.client_id || 'Client';

  return [
    `Client: ${displayName}`,
    `Age range: ${patient.age_range || 'N/A'}`,
    `Client type: ${patient.client_type || patient.case_type || 'individual'}`,
    `Presenting concerns: ${scrubText(patient.presenting_concerns || '') || 'N/A'}`,
    `Current diagnoses: ${scrubText(patient.diagnoses || '') || 'N/A'}`,
    latestSession ? `Most recent session: ${latestSession.session_date || latestSession.created_at || 'N/A'} — ${scrubText(latestSession.assessment || latestSession.plan || '')}` : '',
    latestAssessment ? `Most recent assessment: ${latestAssessment.template_type} score ${latestAssessment.total_score}${latestAssessment.severity_level ? ` (${latestAssessment.severity_level})` : ''}` : '',
    `Session count: ${sessions.length}`,
    `Assessment count: ${assessments.length}`,
    `SCHEDULING DEFAULTS (use these — do NOT ask the clinician for them):`,
    `  appointment_type: ${defaultType}`,
    `  duration_minutes: ${defaultDuration}`,
    defaultLocation ? `  location: ${defaultLocation}` : `  location: not yet set (omit from confirmation, do not ask)`,
  ].filter(Boolean).join('\n');
}

/**
 * Build a concise caseload summary for the agent's system context.
 * Shows all patients with their latest assessment, risk status, and presenting concerns.
 * Includes enough detail to be useful without overwhelming the agent.
 */
async function buildCaseloadSummary(db, therapistId) {
  const patients = await db.all(
    `SELECT id, display_name, client_id, presenting_concerns, risk_screening FROM patients
     WHERE therapist_id = ? ORDER BY display_name ASC`,
    therapistId
  );

  if (!patients || patients.length === 0) {
    return 'You have no active clients currently.';
  }

  const summaries = [];
  for (const p of patients) {
    const latest = await db.get(
      `SELECT template_type, total_score, severity_level FROM assessments
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY administered_at DESC LIMIT 1`,
      p.id, therapistId
    );

    const riskFlag = p.risk_screening && p.risk_screening.toLowerCase().includes('passive') ? ' ⚠️ risk-flagged' : '';
    const assessmentStr = latest
      ? `${latest.template_type}: ${latest.total_score}${latest.severity_level ? ` (${latest.severity_level})` : ''}`
      : 'no assessments';

    const label = p.display_name || p.client_id || 'Client';
    summaries.push(`• ${label} — ${scrubText(p.presenting_concerns || 'intake pending')} — ${assessmentStr}${riskFlag}`);
  }

  return `Your caseload (${patients.length} client${patients.length !== 1 ? 's' : ''}):\n${summaries.join('\n')}`;
}

module.exports = {
  buildPatientContext,
  findPatientByCode,
  findPatientByDisplayName,
  buildPatientSummary,
  buildCaseloadSummary,
};
