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

async function safeAll(db, sql, ...params) {
  try { return await db.all(sql, ...params); } catch { return []; }
}

async function safeGet(db, sql, ...params) {
  try { return await db.get(sql, ...params); } catch { return null; }
}

const EHR_COMPANION_PROFILES = {
  Exym: {
    noteFormats: ['SOAP', 'DAP', 'BIRP', 'GIRP', 'concise_agency_style'],
    copyStyle: 'Concise, audit-ready sections with clear risk, intervention, response, plan, and medical necessity language.',
    checklist: ['Confirm required service code/modality in Exym', 'Copy only the clean note, not private reflection', 'Mark copied in Miwa after saving in Exym'],
  },
  Welligent: {
    noteFormats: ['SOAP', 'DAP', 'BIRP', 'narrative', 'concise_agency_style'],
    copyStyle: 'Structured agency note with concise clinical language, goal linkage, risk/safety statement, and next-step plan.',
    checklist: ['Match the Welligent template section order', 'Use minimum necessary identifiers', 'Confirm supervisor/co-sign expectations'],
  },
  Credible: {
    noteFormats: ['SOAP', 'DAP', 'BIRP', 'narrative'],
    copyStyle: 'Behavioral health documentation style with problem, intervention, client response, progress, and follow-up.',
    checklist: ['Verify required fields in Credible', 'Keep risk and mandated-reporting language explicit', 'Mark copied once saved'],
  },
  SimplePractice: {
    noteFormats: ['SOAP', 'DAP', 'BIRP', 'GIRP', 'narrative'],
    copyStyle: 'Clean private-practice-style note adapted for a supervised/agency companion workflow.',
    checklist: ['Confirm whether SimplePractice is official record at this site', 'Copy the clinical note only', 'Track supervision needs separately'],
  },
  TherapyNotes: {
    noteFormats: ['SOAP', 'DAP', 'BIRP', 'GIRP'],
    copyStyle: 'Tight clinical sections that map cleanly into TherapyNotes progress-note fields.',
    checklist: ['Align with treatment plan objective', 'Check risk/safety language', 'Copy clean note and mark complete'],
  },
  Other: {
    noteFormats: ['SOAP', 'DAP', 'BIRP', 'GIRP', 'narrative', 'concise_agency_style', 'custom'],
    copyStyle: 'Custom agency-required format. Keep official-record language outside Miwa unless authorized by site policy.',
    checklist: ['Confirm site policy', 'Use the agency-required template', 'Do not copy private reflection'],
  },
};

const ETHICAL_ESCALATION_RULES = [
  { key: 'si_hi', label: 'SI/HI or self/other harm', priority: 'urgent', pattern: /\b(SI|HI|suicid|self[-\s]?harm|kill myself|kill (him|her|them)|homicid|harm others?)\b/i },
  { key: 'mandated_reporting', label: 'Abuse or mandated reporting', priority: 'urgent', pattern: /\b(abuse|neglect|mandated report|CPS|APS|elder abuse|dependent adult|child abuse)\b/i },
  { key: 'tarasoff', label: 'Duty to protect / Tarasoff', priority: 'urgent', pattern: /\b(Tarasoff|duty to protect|identifiable victim|threat(en)?ed)\b/i },
  { key: 'minors_custody', label: 'Minors, custody, or consent complexity', priority: 'high', pattern: /\b(minor|custody|parental consent|guardian|custodial|divorce decree)\b/i },
  { key: 'roi_consent', label: 'Consent, ROI, or confidentiality', priority: 'high', pattern: /\b(ROI|release of information|consent|confidentiality|privacy|authorization)\b/i },
  { key: 'scope_competence', label: 'Scope of competence', priority: 'high', pattern: /\b(scope of competence|outside my scope|not trained|competence|consult supervisor)\b/i },
  { key: 'documentation_uncertainty', label: 'Documentation uncertainty', priority: 'normal', pattern: /\b(not sure how to document|documentation uncertainty|charting question|what should I write|copy to EHR)\b/i },
  { key: 'crisis_response', label: 'Crisis response', priority: 'urgent', pattern: /\b(crisis|safety plan|hospitalize|5150|involuntary|danger to self|danger to others|grave disability)\b/i },
];

function getEhrCompanionProfile(name, savedFormat, customFormat) {
  const profile = EHR_COMPANION_PROFILES[name] || EHR_COMPANION_PROFILES.Other;
  return {
    ehr_name: name || 'Other',
    preferred_note_format: savedFormat || profile.noteFormats[0],
    custom_format: customFormat || null,
    ...profile,
  };
}

function scanEthicalEscalations(text) {
  const source = String(text || '');
  return ETHICAL_ESCALATION_RULES
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => ({
      key: rule.key,
      label: rule.label,
      priority: rule.priority,
      cta: 'Bring this to supervision',
      guidance: rule.priority === 'urgent'
        ? 'Pause and follow site crisis/mandated-reporting protocol; consult supervisor immediately.'
        : 'Add to supervision and document the clinical/legal reasoning clearly.',
    }));
}

async function collectTraineeWorkspaceState(db, therapistId, { timezone = 'America/Los_Angeles', limit = 10 } = {}) {
  const therapist = await db.get(
    `SELECT credential_type, workspace_mode, agency_name, agency_ehr_name, training_program,
            assistant_orientation, assistant_memory, site_policy_acknowledged_at,
            site_policy_status, agency_ehr_note_format, agency_ehr_custom_format
       FROM therapists WHERE id = ?`,
    therapistId,
  );
  const ehrName = therapist?.agency_ehr_name || 'agency EHR';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  const cases = await safeAll(db,
    `SELECT id, client_id, display_name, record_mode, presenting_concerns, diagnoses, risk_screening,
            treatment_goals, supervision_priority, agency_note_status, supervision_questions,
            private_reflection, updated_at, created_at
       FROM patients
      WHERE therapist_id = ?
        AND (archived_at IS NULL)
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?`,
    therapistId, limit,
  );

  const noteDrafts = await safeAll(db,
    `SELECT s.id, s.patient_id, s.session_date, s.created_at, s.note_format,
            s.trainee_note_status, s.copied_to_ehr_at, s.needs_supervision,
            s.supervision_question, s.draft_completed_at, s.reviewed_by_trainee_at,
            s.risk_safety_checked_at, s.discussed_in_supervision_at, s.follow_up_completed_at,
            p.client_id, p.display_name
      FROM sessions s
       JOIN patients p ON p.id = s.patient_id
      WHERE s.therapist_id = ?
        AND (s.signed_at IS NULL OR s.copied_to_ehr_at IS NULL OR s.trainee_note_status IN ('Draft', 'Ready for Review', 'Discuss in Supervision'))
      ORDER BY COALESCE(s.session_date, s.created_at) DESC
      LIMIT ?`,
    therapistId, limit,
  );

  const appointments = await safeAll(db,
    `SELECT a.id, a.scheduled_start, a.duration_minutes, a.appointment_type, a.status,
            p.id AS patient_id, p.client_id, p.display_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
      WHERE a.therapist_id = ?
        AND a.status != 'cancelled'
        AND substr(a.scheduled_start, 1, 10) = ?
      ORDER BY a.scheduled_start ASC`,
    therapistId, today,
  );

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

  const uncountedScheduled = await safeGet(db,
    `SELECT COUNT(*) AS n
       FROM appointments
      WHERE therapist_id = ?
        AND status = 'scheduled'
        AND scheduled_start IS NOT NULL
        AND scheduled_start < ?
        AND duration_minutes IS NOT NULL`,
    therapistId, new Date().toISOString(),
  ) || { n: 0 };

  return {
    mode: therapist?.workspace_mode || 'private_practice',
    credential_type: therapist?.credential_type || 'licensed',
    agency_name: therapist?.agency_name || null,
    agency_ehr_name: ehrName,
    site_policy_status: therapist?.site_policy_status || null,
    agency_ehr_profile: getEhrCompanionProfile(ehrName, therapist?.agency_ehr_note_format, therapist?.agency_ehr_custom_format),
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

function documentationLatency(session) {
  const base = session?.session_date || session?.created_at;
  const draftedAt = session?.draft_completed_at || session?.created_at;
  const copiedAt = session?.copied_to_ehr_at;
  return {
    daysSinceSession: daysAgo(base),
    daysToDraft: base && draftedAt ? Math.max(0, daysAgo(base) - daysAgo(draftedAt)) : null,
    daysLateToEhr: copiedAt ? 0 : daysAgo(base),
  };
}

function formatTraineeWorkspaceState(state) {
  if (!state || state.mode !== 'agency_companion') return '';
  const noteLines = state.noteDrafts.slice(0, 8).map((s) => {
    const latency = documentationLatency(s);
    const age = latency.daysSinceSession;
    const lag = age == null ? '' : `, ${age} day${age === 1 ? '' : 's'} since session`;
    return `- ${protect(s.display_name || s.client_id)}: ${s.trainee_note_status || 'Draft/unsigned'}${s.copied_to_ehr_at ? ', copied' : `, not yet copied to ${state.agency_ehr_name}`}${lag}`;
  });
  const supervisionLines = state.supervisionCases.slice(0, 8).map((c) =>
    `- ${protect(c.display_name || c.client_id)}: ${protect(c.supervision_questions || c.risk_screening || c.presenting_concerns || 'Needs clinical review')}`,
  );
  const apptLines = state.appointments.slice(0, 8).map((a) =>
    `- ${String(a.scheduled_start || '').slice(11, 16)} ${protect(a.display_name || a.client_id)} (${a.appointment_type || 'session'})`,
  );
  return `AGENCY COMPANION TRAINEE INTELLIGENCE:
- Official record stance: ${state.agency_ehr_name} is usually the official record. Miwa is the HIPAA-compliant companion workspace.
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
    'You are Miwa as a supervision-prep agent for a therapy trainee. Build a short agenda for a real human supervision meeting.',
    `${formatTraineeWorkspaceState(state)}\n\nGenerate a concise supervision agenda, not a full report. Maximum 5 sections. Maximum 2 bullets per section. Prioritize only what should actually be discussed with a human supervisor this week: urgent cases, risk/ethics, stuck case formulation, documentation blockers, and one follow-up/action item. Do not list every draft, every client, or every missing data point. If there is no real item for a section, omit the section.`,
    900,
    false,
    { therapistId, kind: 'trainee_supervision_agenda' },
  );
  return { state, markdown };
}

async function generateTraineeExport(db, therapistId, type, options = {}) {
  const state = await collectTraineeWorkspaceState(db, therapistId, { ...options, limit: 50 });
  const stamp = new Date().toISOString().slice(0, 10);
  const header = [
    `Miwa Agency Companion Export`,
    `Type: ${type}`,
    `Date: ${stamp}`,
    `Official record: ${state.agency_ehr_name} remains the agency record unless your site says otherwise.`,
    `Policy reminder: Use PHI only if authorized by your site. Private reflections are excluded from note exports.`,
    '',
  ].join('\n');

  if (type === 'hours-summary') {
    const buckets = Array.isArray(state.hours?.buckets) ? state.hours.buckets : [];
    return {
      filename: `miwa-hours-summary-${stamp}.txt`,
      text: `${header}Hours Summary\n\n${buckets.map((b) => `${b.label || b.id}: ${Number(b.hours || 0).toFixed(2)} hours`).join('\n') || 'No hours found.'}`,
    };
  }

  if (type === 'growth-summary') {
    const events = await safeAll(db,
      `SELECT * FROM trainee_growth_events WHERE therapist_id = ? ORDER BY created_at DESC LIMIT 100`,
      therapistId,
    );
    return {
      filename: `miwa-clinical-growth-summary-${stamp}.txt`,
      text: `${header}Clinical Growth Summary\n\n${events.map((e) => `- ${dateOnly(e.created_at)} ${e.competency || e.category}: ${protect(e.title)}${e.details ? `\n  ${protect(e.details)}` : ''}`).join('\n') || 'No growth events logged yet.'}`,
    };
  }

  if (type === 'case-presentation' && options.patientId) {
    const snapshot = await generateCaseSnapshot(db, therapistId, Number(options.patientId));
    return {
      filename: `miwa-case-presentation-${options.patientId}-${stamp}.txt`,
      text: `${header}Case Presentation for Supervision\n\n${snapshot?.markdown || 'Case not found.'}`,
    };
  }

  const agenda = await generateSupervisionAgenda(db, therapistId, options);
  return {
    filename: `miwa-supervision-agenda-${stamp}.txt`,
    text: `${header}Supervision Agenda\n\n${agenda.markdown || 'No agenda content generated.'}`,
  };
}

async function buildLicensedTransitionPlan(db, therapistId) {
  const state = await collectTraineeWorkspaceState(db, therapistId, { limit: 50 });
  const cases = state.cases || [];
  const growthRows = await safeAll(db,
    `SELECT COUNT(*) AS n FROM trainee_growth_events WHERE therapist_id = ?`,
    therapistId,
  );
  return {
    current_mode: state.mode,
    target_mode: 'private_practice',
    preserved: [
      'assistant memory and preferences',
      'writing style samples and note templates',
      'clinical growth timeline',
      'competency map',
      'supervision feedback history',
      'selected case history',
    ],
    unlocks: ['billing', 'client portal', 'private-practice dashboard', 'system-of-record client charts'],
    convertible_cases: cases.map((c) => ({
      id: c.id,
      label: c.display_name || c.client_id,
      current_record_mode: c.record_mode || 'agency_ehr_companion',
      recommendation: 'Convert only if this becomes your private-practice client and you have authorization to maintain Miwa as system of record.',
    })),
    growth_event_count: Number(growthRows[0]?.n || 0),
  };
}

module.exports = {
  collectTraineeWorkspaceState,
  formatTraineeWorkspaceState,
  generateTraineeDailyBrief,
  generateCaseSnapshot,
  generateSupervisionAgenda,
  generateTraineeExport,
  getEhrCompanionProfile,
  scanEthicalEscalations,
  buildLicensedTransitionPlan,
};
