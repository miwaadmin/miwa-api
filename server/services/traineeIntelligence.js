const { callAI, MODELS } = require('../lib/aiExecutor');
const { canSendPhiToTextAI } = require('../lib/phiPolicy');
const { scrubText } = require('../lib/scrubber');
const { computeHourTotals } = require('./practiceHours');

function protect(value) {
  return canSendPhiToTextAI() ? String(value || '') : scrubText(value || '');
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function daysAgo(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function totalHours(hoursState) {
  const totalBucket = Array.isArray(hoursState?.buckets)
    ? hoursState.buckets.find((bucket) => bucket.id === 'total' || bucket.parent == null)
    : null;
  return Number(totalBucket?.hours || 0);
}

async function collectTraineeWorkspaceState(db, therapistId, { timezone = 'America/Los_Angeles', limit = 10 } = {}) {
  const therapist = await db.get(
    `SELECT credential_type, workspace_mode, agency_name, agency_ehr_name, training_program,
            assistant_orientation, assistant_memory, site_policy_acknowledged_at
       FROM therapists WHERE id = ?`,
    therapistId,
  );
  const ehrName = therapist?.agency_ehr_name || 'agency EHR';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  const cases = await db.all(
    `SELECT id, client_id, display_name, presenting_concerns, diagnoses, risk_screening,
            treatment_goals, supervision_priority, agency_note_status, supervision_questions,
            private_reflection, updated_at, created_at
       FROM patients
      WHERE therapist_id = ?
        AND (archived_at IS NULL)
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?`,
    therapistId, limit,
  ).catch(() => []);

  const noteDrafts = await db.all(
    `SELECT s.id, s.patient_id, s.session_date, s.created_at, s.note_format,
            s.trainee_note_status, s.copied_to_ehr_at, s.needs_supervision,
            s.supervision_question, p.client_id, p.display_name
       FROM sessions s
       JOIN patients p ON p.id = s.patient_id
      WHERE s.therapist_id = ?
        AND (
          s.signed_at IS NULL
          OR s.trainee_note_status IN ('Draft', 'Ready for Review', 'Discuss in Supervision')
          OR (s.copied_to_ehr_at IS NULL AND s.signed_at IS NOT NULL)
        )
      ORDER BY COALESCE(s.session_date, s.created_at) DESC
      LIMIT ?`,
    therapistId, limit,
  ).catch(() => []);

  const appointments = await db.all(
    `SELECT a.id, a.scheduled_start, a.duration_minutes, a.appointment_type, a.status,
            p.id AS patient_id, p.client_id, p.display_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
      WHERE a.therapist_id = ?
        AND a.status != 'cancelled'
        AND substr(a.scheduled_start, 1, 10) = ?
      ORDER BY a.scheduled_start ASC`,
    therapistId, today,
  ).catch(() => []);

  const riskCases = cases.filter((c) => /risk|suicid|self-harm|harm|abuse|danger|safety|mandated/i.test(
    `${c.risk_screening || ''} ${c.presenting_concerns || ''}`,
  ));

  const supervisionCases = cases.filter((c) =>
    String(c.supervision_priority || '').toLowerCase() === 'high'
    || /stuck|supervision|ethic|risk|diagnos|countertransference/i.test(`${c.supervision_questions || ''} ${c.private_reflection || ''}`),
  );

  let hours = null;
  if (['trainee', 'associate'].includes(therapist?.credential_type || '')) {
    try {
      hours = await computeHourTotals(db, therapistId, therapist?.training_program || 'csun_mft');
    } catch {}
  }

  const uncountedScheduled = await db.get(
    `SELECT COUNT(*) AS n
       FROM appointments
      WHERE therapist_id = ?
        AND status = 'scheduled'
        AND scheduled_start IS NOT NULL
        AND scheduled_start < ?
        AND duration_minutes IS NOT NULL`,
    therapistId, new Date().toISOString(),
  ).catch(() => ({ n: 0 }));

  return {
    mode: therapist?.workspace_mode || 'private_practice',
    credential_type: therapist?.credential_type || 'licensed',
    agency_name: therapist?.agency_name || null,
    agency_ehr_name: ehrName,
    training_program: therapist?.training_program || null,
    site_policy_acknowledged: !!therapist?.site_policy_acknowledged_at,
    orientation: therapist?.assistant_orientation || null,
    today,
    cases,
    appointments,
    noteDrafts,
    riskCases,
    supervisionCases,
    hours,
    uncountedScheduled: Number(uncountedScheduled?.n || 0),
  };
}

function formatTraineeWorkspaceState(state) {
  if (!state || state.mode !== 'agency_companion') return '';
  const noteLines = state.noteDrafts.slice(0, 8).map((s) => {
    const age = daysAgo(s.session_date || s.created_at);
    const lag = age == null ? '' : `, ${age} day${age === 1 ? '' : 's'} old`;
    return `- ${protect(s.display_name || s.client_id)}: ${s.trainee_note_status || 'Draft/unsigned'}${s.copied_to_ehr_at ? ', copied' : `, not yet copied to ${state.agency_ehr_name}`}${lag}`;
  });
  const supervisionLines = state.supervisionCases.slice(0, 8).map((c) =>
    `- ${protect(c.display_name || c.client_id)}: ${protect(c.supervision_questions || c.risk_screening || c.presenting_concerns || 'Needs clinical review')}`,
  );
  const apptLines = state.appointments.slice(0, 8).map((a) =>
    `- ${String(a.scheduled_start || '').slice(11, 16)} ${protect(a.display_name || a.client_id)} (${a.appointment_type || 'session'})`,
  );
  return `AGENCY COMPANION TRAINEE INTELLIGENCE:
- Official record stance: ${state.agency_ehr_name} is usually the official record. Miwa is the HIPAA-ready companion workspace.
- Site policy: ${state.site_policy_acknowledged ? 'acknowledged' : 'not acknowledged; remind the trainee to only enter agency PHI if authorized.'}
- Today: ${state.today}. Appointments today: ${state.appointments.length}. Note drafts/copy queue: ${state.noteDrafts.length}. Risk/ethics watch: ${state.riskCases.length}. Uncounted past scheduled sessions: ${state.uncountedScheduled}.
- Hours: ${state.hours ? `${totalHours(state.hours).toFixed(1)} logged in ${state.training_program || 'training program'}` : 'not available'}.

Today's sessions:
${apptLines.length ? apptLines.join('\n') : '- None found.'}

Note drafts and agency EHR copy queue:
${noteLines.length ? noteLines.join('\n') : '- No active note drafts found.'}

Supervision candidates:
${supervisionLines.length ? supervisionLines.join('\n') : '- No high-priority supervision cases found.'}

Use this context proactively for: what needs attention today, notes to draft/copy, supervision prep, risk/ethics follow-up, hours gaps, and learning prompts. Be supportive, Socratic when useful, and concise.`;
}

async function generateTraineeDailyBrief(db, therapistId, options = {}) {
  const state = await collectTraineeWorkspaceState(db, therapistId, options);
  const promptContext = formatTraineeWorkspaceState(state);
  if (state.mode !== 'agency_companion') return { state, markdown: '' };
  const markdown = await callAI(
    MODELS.AZURE_MAIN,
    'You are Miwa in Trainee / Agency Companion Mode. Write a practical daily trainee brief. Do not invent facts. Keep it concise, action-oriented, and supervision-aware.',
    `${promptContext}\n\nWrite the brief with these exact sections:\n- Handle today\n- Note drafts and agency EHR copy queue\n- Supervision prep\n- Risk/ethics watch\n- Hours/logging\n- Learning focus\n\nUse "agency EHR" or the named EHR. Include the site-policy reminder only if relevant.`,
    1600,
    false,
    { therapistId, kind: 'trainee_daily_brief' },
  );
  return { state, markdown };
}

async function generateCaseSnapshot(db, therapistId, patientId) {
  const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
  if (!patient) return null;
  const sessions = await db.all(
    `SELECT * FROM sessions WHERE patient_id = ? AND therapist_id = ?
      ORDER BY COALESCE(session_date, created_at) DESC LIMIT 5`,
    patientId, therapistId,
  );
  const prompt = `CASE:
Name/code: ${protect(patient.display_name || patient.client_id)}
Presenting concerns: ${protect(patient.presenting_concerns || '')}
Diagnosis/hypotheses: ${protect(patient.diagnoses || '')}
Treatment goals: ${protect(patient.treatment_goals || '')}
Risk/safety: ${protect(patient.risk_screening || '')}
Case conceptualization: ${protect(patient.case_conceptualization || '')}
Modality lens: ${protect(patient.modality_lens || '')}
Supervision questions: ${protect(patient.supervision_questions || '')}
Agency note status: ${patient.agency_note_status || 'unknown'}

RECENT SESSIONS:
${sessions.map((s) => `- ${s.session_date || s.created_at}: ${protect(s.assessment || s.full_note || s.subjective || '')}`).join('\n') || '- None'}

Create an agentic trainee case snapshot with: current clinical picture, last session recap, working diagnosis/hypotheses, treatment direction, risk/safety status, supervision questions, note/EHR status, next session focus, learning opportunity.`;
  const markdown = await callAI(
    MODELS.AZURE_MAIN,
    'You are Miwa in Trainee / Agency Companion Mode. Produce a concise case snapshot for supervision prep. Do not invent facts; label uncertainties as hypotheses.',
    prompt,
    1600,
    false,
    { therapistId, kind: 'trainee_case_snapshot' },
  );
  return { patient, sessions, markdown };
}

async function generateSupervisionAgenda(db, therapistId, options = {}) {
  const state = await collectTraineeWorkspaceState(db, therapistId, options);
  const markdown = await callAI(
    MODELS.AZURE_MAIN,
    'You are Miwa as a supervision-prep agent for a therapy trainee. Build a concise weekly agenda from the available workspace data.',
    `${formatTraineeWorkspaceState(state)}\n\nGenerate a supervision agenda with: high-priority cases, risk/ethics items, case conceptualization questions, documentation questions, hours/admin questions, follow-up from last supervision, and action items to track. If data is missing, suggest what the trainee should add.`,
    1800,
    false,
    { therapistId, kind: 'trainee_supervision_agenda' },
  );
  return { state, markdown };
}

module.exports = {
  collectTraineeWorkspaceState,
  formatTraineeWorkspaceState,
  generateTraineeDailyBrief,
  generateCaseSnapshot,
  generateSupervisionAgenda,
};
