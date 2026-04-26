/**
 * Clinical Document Generator
 *
 * Drafts letters and forms that therapists otherwise write by hand —
 * ESA letters, school accommodation requests, attorney summaries,
 * insurance pre-authorization narratives, return-to-work letters, and
 * treatment summaries. Each template pulls the relevant chart data,
 * renders it through Azure OpenAI in the therapist's voice, and stores the
 * draft for review + sign-off.
 *
 * Templates are structured objects with:
 *   - id, name, description — for the picker
 *   - requires — chart data we need to generate (dx, last session, etc.)
 *   - options — user-supplied fields (recipient name, hours requested, etc.)
 *   - compile — fn that builds the chart-data packet for the prompt
 *   - systemPrompt — role + voice + rules
 *   - userPromptTemplate — fn that builds the prompt from packet + options
 */

'use strict';

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { clinicalReasoning } = require('../lib/aiExecutor');

// ─── Chart Data Helpers ──────────────────────────────────────────────────────

/**
 * Pull the subset of a patient's chart needed for letter generation.
 * Returns a structured packet — templates pick what they need from it.
 */
async function buildChartPacket(db, therapistId, patientId) {
  const patient = await db.get(
    `SELECT id, client_id, display_name, date_of_birth, diagnoses,
            presenting_concerns, risk_screening, treatment_goals,
            created_at
     FROM patients
     WHERE id = ? AND therapist_id = ?`,
    patientId, therapistId
  );
  if (!patient) throw new Error('Patient not found');

  const therapist = await db.get(
    `SELECT id, name, credentials, license_number, license_state,
            practice_name, practice_address, practice_phone,
            email, title
     FROM therapists
     WHERE id = ?`,
    therapistId
  );

  // Episode start — treat the patient record's created_at as the episode open.
  // Sessions give us total visit count + most recent date.
  const sessionAgg = await db.get(
    `SELECT COUNT(*) AS total_sessions,
            MAX(session_date) AS last_session_date,
            MIN(session_date) AS first_session_date
     FROM sessions
     WHERE patient_id = ? AND therapist_id = ? AND signed_at IS NOT NULL`,
    patientId, therapistId
  ) || { total_sessions: 0 };

  const recentSessions = await db.all(
    `SELECT session_date, subjective, assessment, plan, icd10_codes
     FROM sessions
     WHERE patient_id = ? AND therapist_id = ? AND signed_at IS NOT NULL
     ORDER BY session_date DESC
     LIMIT 3`,
    patientId, therapistId
  );

  // Latest assessment per instrument — we want scores for clinical narrative.
  let latestAssessments = [];
  try {
    latestAssessments = await db.all(
      `SELECT a.template_type, a.total_score, a.severity_level, a.administered_at
       FROM assessments a
       WHERE a.patient_id = ? AND a.therapist_id = ?
       AND a.id IN (
         SELECT MAX(id) FROM assessments
         WHERE patient_id = ? AND therapist_id = ?
         GROUP BY template_type
       )
       ORDER BY a.administered_at DESC`,
      patientId, therapistId, patientId, therapistId
    );
  } catch {
    latestAssessments = [];
  }

  let activePlan = null;
  try {
    const plan = await db.get(
      `SELECT id, summary FROM treatment_plans
       WHERE patient_id = ? AND therapist_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      patientId, therapistId
    );
    if (plan) {
      const goals = await db.all(
        `SELECT goal_text, target_metric, status FROM treatment_goals
         WHERE plan_id = ? AND status IN ('active', 'in_progress', 'met')
         ORDER BY created_at ASC`,
        plan.id
      );
      activePlan = { summary: plan.summary, goals };
    }
  } catch {}

  return { patient, therapist, sessionAgg, recentSessions, latestAssessments, activePlan };
}

/**
 * Format a concise, labeled text block for the LLM prompt. Avoids raw JSON
 * dumps — the model reasons better against labeled prose.
 */
function formatChartPacket(p, options = {}) {
  const lines = [];

  lines.push('=== PATIENT ===');
  lines.push(`Name: ${p.patient.display_name || p.patient.client_id}`);
  if (p.patient.date_of_birth && !options.hideDOB) {
    lines.push(`DOB: ${p.patient.date_of_birth}`);
  }
  if (p.patient.diagnoses) lines.push(`Diagnoses: ${p.patient.diagnoses}`);
  if (p.patient.presenting_concerns) lines.push(`Presenting concerns: ${p.patient.presenting_concerns}`);
  if (p.patient.risk_screening) lines.push(`Risk screening: ${p.patient.risk_screening}`);

  lines.push('');
  lines.push('=== TREATMENT COURSE ===');
  if (p.sessionAgg.first_session_date) {
    lines.push(`First session: ${p.sessionAgg.first_session_date.slice(0, 10)}`);
  }
  if (p.sessionAgg.last_session_date) {
    lines.push(`Most recent session: ${p.sessionAgg.last_session_date.slice(0, 10)}`);
  }
  lines.push(`Total sessions: ${p.sessionAgg.total_sessions || 0}`);

  if (p.activePlan) {
    lines.push('');
    lines.push('=== ACTIVE TREATMENT PLAN ===');
    if (p.activePlan.summary) lines.push(p.activePlan.summary);
    if (p.activePlan.goals?.length) {
      lines.push('Goals:');
      p.activePlan.goals.slice(0, 5).forEach(g => {
        lines.push(`  - [${g.status}] ${g.goal_text}`);
      });
    }
  }

  if (p.latestAssessments?.length) {
    lines.push('');
    lines.push('=== LATEST ASSESSMENTS ===');
    p.latestAssessments.slice(0, 5).forEach(a => {
      lines.push(`${a.template_type}: ${a.total_score} (${a.severity_level || 'n/a'}) — ${a.administered_at?.slice(0, 10) || ''}`);
    });
  }

  if (p.recentSessions?.length) {
    lines.push('');
    lines.push('=== RECENT CLINICAL OBSERVATIONS ===');
    p.recentSessions.slice(0, 3).forEach(s => {
      const date = s.session_date?.slice(0, 10) || '?';
      const notes = [s.subjective, s.assessment, s.plan]
        .filter(Boolean)
        .map(t => t.replace(/\s+/g, ' ').trim().slice(0, 280))
        .join(' | ');
      if (notes) lines.push(`[${date}] ${notes}`);
    });
  }

  lines.push('');
  lines.push('=== CLINICIAN ===');
  const t = p.therapist;
  lines.push(`Name: ${t.name || 'Therapist'}${t.credentials ? ', ' + t.credentials : ''}`);
  if (t.title) lines.push(`Title: ${t.title}`);
  if (t.license_number) lines.push(`License: ${t.license_number}${t.license_state ? ' (' + t.license_state + ')' : ''}`);
  if (t.practice_name) lines.push(`Practice: ${t.practice_name}`);
  if (t.practice_address) lines.push(`Address: ${t.practice_address}`);
  if (t.practice_phone) lines.push(`Phone: ${t.practice_phone}`);
  if (t.email) lines.push(`Email: ${t.email}`);

  return lines.join('\n');
}

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * Common voice + formatting rules shared across every letter.
 */
const BASE_VOICE_RULES = `
CLINICIAN VOICE:
  • Write as the clinician in first person ("I have been treating...", "In my clinical opinion...").
  • Professional, warm, precise. No marketing speak. No em-dashes for emphasis.
  • Use plain English where possible; clinical terms when they carry specific meaning.
  • Never invent facts not in the chart data. If a requested detail isn't in the data, omit it or
    write a bracketed placeholder like [CLINICIAN: confirm specific activity].
  • Maintain client privacy — share only clinically relevant information needed for the letter's purpose.

FORMATTING:
  • Use a standard letterhead block at the top (clinician name, credentials, practice, contact).
  • Date line, recipient block, salutation.
  • 2-5 short paragraphs of body. No headers inside the letter unless the template says otherwise.
  • Closing: "Sincerely," + clinician name + credentials + license line.
  • Do NOT use markdown. Output as plain prose ready to paste into a document.
`;

const TEMPLATES = {

  esa_letter: {
    id: 'esa_letter',
    name: 'Emotional Support Animal Letter',
    description: 'Housing or travel ESA recommendation letter supporting a client\'s existing animal under the Fair Housing Act.',
    options: [
      { key: 'recipient', label: 'Addressed to', placeholder: 'Housing provider, landlord, or "To Whom It May Concern"', required: false },
      { key: 'animal_type', label: 'Animal type', placeholder: 'e.g. dog, cat', required: true },
      { key: 'animal_name', label: "Animal's name (optional)", placeholder: 'e.g. Luna', required: false },
      { key: 'purpose', label: 'Purpose', type: 'select', options: ['housing', 'travel', 'both'], required: true },
    ],
    systemPrompt: `You are a licensed mental health therapist drafting an Emotional Support Animal (ESA) letter
for a current client under the Fair Housing Act. Your letter will be read by a landlord, property manager,
or airline — not a clinical audience.

CORE REQUIREMENTS (must be present, explicitly):
  1. You are a licensed mental health professional, with license details.
  2. The client has a DSM-5 / ICD-10 mental or emotional disability (name it from the chart).
  3. The animal is necessary to afford the person equal opportunity to use and enjoy a dwelling,
     OR (for travel) the animal is necessary for emotional support during travel.
  4. The therapist-client relationship (length, modality).

DO NOT:
  • Certify the animal or its training. ESAs don't require training.
  • Disclose the specific diagnosis unless the chart data confirms the client consents.
    Use language like "a mental health condition that substantially limits one or more major life activities"
    instead of spelling out a specific dx code.
  • Promise outcomes or guarantee the animal resolves symptoms.
` + BASE_VOICE_RULES,
    buildUserPrompt(packet, opts, chartText) {
      return `Draft an ESA letter for the following client and clinician. Use the options below.\n\n` +
        `${chartText}\n\n` +
        `=== LETTER OPTIONS ===\n` +
        `Recipient: ${opts.recipient || 'To Whom It May Concern'}\n` +
        `Animal type: ${opts.animal_type || '[animal type]'}\n` +
        `Animal name: ${opts.animal_name || '(unnamed)'}\n` +
        `Purpose: ${opts.purpose || 'housing'}\n\n` +
        `Write the full letter now, ready to sign.`;
    },
  },

  school_accommodation: {
    id: 'school_accommodation',
    name: 'School Accommodation Request',
    description: 'Supporting letter for 504 plan or IEP consideration at the client\'s school, detailing functional impact and recommended accommodations.',
    options: [
      { key: 'recipient', label: 'Addressed to', placeholder: 'School counselor, principal, or 504/IEP team', required: false },
      { key: 'student_grade', label: "Student's grade level", placeholder: 'e.g. 7th grade', required: false },
      { key: 'requested_accommodations', label: 'Requested accommodations (one per line)', type: 'textarea', placeholder: 'e.g. Extended time on tests\nPreferential seating near teacher\nPermission to take breaks during class', required: true },
      { key: 'school_name', label: 'School name (optional)', placeholder: 'e.g. Lincoln Middle School', required: false },
    ],
    systemPrompt: `You are a licensed mental health therapist writing a supporting letter for a school
accommodation request (Section 504 plan or IEP consideration) on behalf of a current client who is a student.

STRUCTURE:
  1. Opening: identify yourself, the therapist-client relationship, and the purpose of the letter.
  2. Clinical picture: the client's diagnosis/diagnoses and specifically HOW they affect school functioning
     (attention, concentration, emotional regulation, attendance, peer interaction, test-taking, etc.).
     Ground each functional impact in clinical observations from the chart.
  3. Recommended accommodations: list each requested accommodation and briefly tie it to a specific
     functional impairment. Be concrete ("extended time" → "to mitigate test anxiety that affects
     processing speed under pressure").
  4. Closing: offer to collaborate with the school team, provide contact info.

VOICE:
  • Write to a mixed audience — school staff who may not be clinicians.
  • Avoid jargon; if you use a term like "executive functioning," briefly explain what it means for this student.
  • Do NOT diagnose siblings, family members, or recommend medication changes.
` + BASE_VOICE_RULES,
    buildUserPrompt(packet, opts, chartText) {
      return `Draft a school accommodation support letter. Use the chart below and the requested
accommodations. Tie each accommodation to a specific functional impact seen in session.\n\n` +
        `${chartText}\n\n` +
        `=== LETTER OPTIONS ===\n` +
        `Recipient: ${opts.recipient || 'Section 504 / IEP Team'}\n` +
        `School: ${opts.school_name || '[school name]'}\n` +
        `Grade: ${opts.student_grade || '[grade]'}\n` +
        `Requested accommodations:\n${opts.requested_accommodations || '[list accommodations]'}\n\n` +
        `Write the full letter now.`;
    },
  },

  attorney_summary: {
    id: 'attorney_summary',
    name: 'Attorney / Legal Summary',
    description: 'Clinical summary for attorney use in legal proceedings (custody, disability, criminal defense mitigation, etc.). Strictly fact-based.',
    options: [
      { key: 'recipient', label: 'Attorney name + firm', placeholder: 'e.g. Jane Doe, Esq., Doe & Associates', required: true },
      { key: 'matter', label: 'Legal matter', type: 'select', options: ['custody', 'disability', 'criminal mitigation', 'victim impact', 'immigration', 'other'], required: true },
      { key: 'scope_requested', label: 'Specific questions from attorney', type: 'textarea', placeholder: 'e.g. Current diagnosis; functional capacity; treatment response to date; prognosis with continued treatment', required: true },
      { key: 'release_on_file', label: 'Signed release on file', type: 'checkbox', required: true },
    ],
    systemPrompt: `You are a licensed mental health therapist writing a clinical summary for attorney use in
a legal proceeding. Your audience is the attorney — not a judge, jury, or opposing counsel directly.

BOUNDARIES (non-negotiable):
  • You are a TREATING clinician, not a forensic evaluator. State this explicitly in the letter.
  • You may not opine on legal questions (custody fitness, competency, criminal responsibility) unless
    you conducted a formal forensic evaluation for that purpose — which treating letters never do.
  • You may only share information covered by a signed release of information. If the user indicated no
    release is on file, draft a brief note stating you cannot respond without a signed release and stop.
  • Stick to facts: dates of treatment, presenting issues, diagnosis, functional impact observed in session,
    treatment response, current status.

STRUCTURE:
  1. Opening block: therapist identifying info, acknowledgement of treating (not forensic) role.
  2. Treatment dates, session frequency, modality.
  3. Diagnostic impressions (current).
  4. Observed functional status relevant to the attorney's questions — answer only what can be answered
     from a treating clinician's scope.
  5. Closing: offer to clarify, note limitations of treating-clinician role.

VOICE:
  • Formal, factual, concise. No advocacy language ("my client deserves...").
  • Quantify where you can (session count, assessment scores).
` + BASE_VOICE_RULES,
    buildUserPrompt(packet, opts, chartText) {
      if (!opts.release_on_file) {
        return `The user indicated that NO signed release of information is on file. Draft only a brief
two-paragraph note to ${opts.recipient || '[attorney]'} stating that you cannot respond to the request
without a signed release, and listing the types of releases you would need. Do not include any clinical content.

${chartText}`;
      }
      return `Draft an attorney letter summarizing this client's treatment. Stay strictly within the treating-clinician role.\n\n` +
        `${chartText}\n\n` +
        `=== LETTER OPTIONS ===\n` +
        `Attorney: ${opts.recipient}\n` +
        `Matter type: ${opts.matter || 'other'}\n` +
        `Specific questions from attorney:\n${opts.scope_requested || '[attorney questions]'}\n\n` +
        `Write the full letter now.`;
    },
  },

  insurance_preauth: {
    id: 'insurance_preauth',
    name: 'Insurance Pre-Authorization / Medical Necessity',
    description: 'Medical-necessity narrative for insurance pre-authorization or continued authorization of outpatient psychotherapy.',
    options: [
      { key: 'insurance_name', label: 'Insurance company', placeholder: 'e.g. Blue Shield of California', required: true },
      { key: 'service_requested', label: 'Service', type: 'select', options: ['continued outpatient psychotherapy', 'higher frequency (2x/wk)', 'family therapy adjunct', 'initial authorization'], required: true },
      { key: 'sessions_requested', label: 'Sessions requested (number)', placeholder: 'e.g. 12', required: true },
      { key: 'cpt_code', label: 'CPT code', placeholder: 'e.g. 90834', required: false },
      { key: 'member_id', label: 'Member ID', placeholder: 'Optional', required: false },
    ],
    systemPrompt: `You are a licensed mental health therapist writing a medical necessity / pre-authorization
letter to an insurance company for continued or initial outpatient psychotherapy.

GOAL: establish medical necessity using the insurer's standard criteria:
  1. A DSM-5 / ICD-10 diagnosis supported by clinical findings.
  2. Functional impairment in at least one major life domain (work, school, relationships, self-care).
  3. Evidence of symptom severity (use assessment scores where available: PHQ-9, GAD-7, PCL-5, etc.).
  4. A treatment plan with concrete goals.
  5. Evidence of treatment response (or lack thereof) to justify continued care.
  6. Why outpatient level of care is the appropriate setting (not higher or lower).

STRUCTURE:
  1. Header: clinician letterhead + insurance-facing fields (member ID, CPT code, date of service range).
  2. Diagnosis section — name the primary dx and any comorbid.
  3. Clinical presentation + functional impairment — specific, observable.
  4. Symptom severity — cite assessment scores.
  5. Treatment plan and goals.
  6. Progress or lack thereof + rationale for requested sessions.
  7. Closing — willingness to provide further documentation.

VOICE:
  • Clinical, precise, assessment-score-anchored. No emotional appeals.
  • Quantify everything possible.
  • Frame in the insurer's language of medical necessity.
` + BASE_VOICE_RULES,
    buildUserPrompt(packet, opts, chartText) {
      return `Draft an insurance pre-authorization / medical necessity letter.\n\n` +
        `${chartText}\n\n` +
        `=== LETTER OPTIONS ===\n` +
        `Insurance: ${opts.insurance_name}\n` +
        `Service requested: ${opts.service_requested}\n` +
        `Sessions requested: ${opts.sessions_requested}\n` +
        `CPT code: ${opts.cpt_code || '[CPT]'}\n` +
        `Member ID: ${opts.member_id || '[on file]'}\n\n` +
        `Write the full letter now.`;
    },
  },

  return_to_work: {
    id: 'return_to_work',
    name: 'Return-to-Work / Fitness-for-Duty Letter',
    description: 'Return-to-work or fitness-for-duty letter with specific recommended restrictions.',
    options: [
      { key: 'recipient', label: 'Addressed to', placeholder: 'Employer, HR, or "To Whom It May Concern"', required: false },
      { key: 'employer_name', label: 'Employer name', placeholder: 'e.g. Acme Corp', required: false },
      { key: 'return_date', label: 'Target return date', placeholder: 'e.g. May 1, 2026', required: true },
      { key: 'restrictions', label: 'Recommended restrictions (one per line)', type: 'textarea', placeholder: 'e.g. Part-time hours for first 2 weeks\nNo mandatory overtime for 30 days\nFlexibility for weekly therapy appointments', required: false },
      { key: 'leave_reason', label: 'Reason for leave', type: 'select', options: ['mental health leave', 'burnout recovery', 'stress-related medical leave', 'depressive episode', 'anxiety episode', 'other'], required: true },
    ],
    systemPrompt: `You are a licensed mental health therapist writing a return-to-work or fitness-for-duty
letter for a client who has been out on mental-health-related leave and is returning to work.

STRUCTURE:
  1. Opening: identify yourself, confirm treating relationship, reason for leave.
  2. Clinical readiness statement: based on treatment progress, the client is clinically ready to return
     to work on [date], with [specific restrictions if any].
  3. Restrictions / accommodations: list each recommended restriction with a brief clinical rationale.
  4. Continued treatment: note ongoing treatment plan and how the employer can support continuity.
  5. Closing: invite dialogue with HR, offer contact info.

DO NOT:
  • Disclose more diagnostic detail than necessary. Prefer "a mental health condition that has been
    responding to treatment" unless the client has explicitly authorized dx disclosure.
  • Over-promise or guarantee the client's performance. Focus on clinical readiness.
  • Recommend anything outside the scope of mental health functioning.
` + BASE_VOICE_RULES,
    buildUserPrompt(packet, opts, chartText) {
      return `Draft a return-to-work letter.\n\n` +
        `${chartText}\n\n` +
        `=== LETTER OPTIONS ===\n` +
        `Recipient: ${opts.recipient || 'To Whom It May Concern'}\n` +
        `Employer: ${opts.employer_name || '[employer]'}\n` +
        `Return date: ${opts.return_date}\n` +
        `Leave reason (clinical framing): ${opts.leave_reason}\n` +
        `Recommended restrictions:\n${opts.restrictions || '(none — full duty)'}\n\n` +
        `Write the full letter now.`;
    },
  },
};

/**
 * List available templates (for the picker UI).
 */
function listTemplates() {
  return Object.values(TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    options: t.options,
  }));
}

function getTemplate(templateId) {
  return TEMPLATES[templateId];
}

// ─── Core Generator ──────────────────────────────────────────────────────────

/**
 * Produce a draft document for (therapist, patient, template). Stores the
 * draft in `generated_documents` and returns it for immediate display.
 *
 * @returns {Promise<{ id, template_id, template_name, title, content, status, created_at }>}
 */
async function generateDocument({ therapistId, patientId, templateId, options = {} }) {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);

  // Validate required options
  for (const opt of (template.options || [])) {
    if (opt.required && (options[opt.key] == null || options[opt.key] === '')) {
      // Booleans are explicit: undefined !== false. Validate as "present."
      if (opt.type !== 'checkbox' && !options[opt.key]) {
        throw new Error(`Missing required option: ${opt.key}`);
      }
    }
  }

  const db = getAsyncDb();
  const packet = await buildChartPacket(db, therapistId, patientId);
  const chartText = formatChartPacket(packet);
  const userPrompt = template.buildUserPrompt(packet, options, chartText);

  const content = await clinicalReasoning(
    template.systemPrompt,
    userPrompt,
    2200,                                  // enough for a ~500-700 word letter
    false,                                 // no Opus escalation
    { therapistId, kind: `letter_${templateId}` }
  );

  const title = `${template.name} — ${packet.patient.display_name || packet.patient.client_id}`;

  const { lastInsertRowid } = await db.insert(
    `INSERT INTO generated_documents
      (therapist_id, patient_id, template_id, template_name, title, content, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    therapistId, patientId, templateId, template.name, title, content,
    JSON.stringify({ options, template_version: 1 })
  );

  await persistIfNeeded();

  return {
    id: lastInsertRowid,
    template_id: templateId,
    template_name: template.name,
    title,
    content,
    status: 'draft',
    created_at: new Date().toISOString(),
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

async function listDocumentsForTherapist(therapistId, { patientId, limit = 50 } = {}) {
  const db = getAsyncDb();
  const rows = patientId
    ? await db.all(
        `SELECT id, template_id, template_name, title, status, finalized_at, created_at, updated_at
         FROM generated_documents
         WHERE therapist_id = ? AND patient_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        therapistId, patientId, limit
      )
    : await db.all(
        `SELECT id, patient_id, template_id, template_name, title, status, finalized_at, created_at, updated_at
         FROM generated_documents
         WHERE therapist_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        therapistId, limit
      );
  return rows;
}

async function getDocument(therapistId, documentId) {
  const db = getAsyncDb();
  return db.get(
    `SELECT * FROM generated_documents WHERE id = ? AND therapist_id = ?`,
    documentId, therapistId
  );
}

async function updateDocument(therapistId, documentId, { content, title, status }) {
  const db = getAsyncDb();
  const existing = await getDocument(therapistId, documentId);
  if (!existing) throw new Error('Document not found');

  const fields = [];
  const args = [];
  if (content != null) { fields.push('content = ?'); args.push(content); }
  if (title   != null) { fields.push('title = ?');   args.push(title); }
  if (status  != null) {
    fields.push('status = ?');
    args.push(status);
    if (status === 'finalized' && !existing.finalized_at) {
      fields.push('finalized_at = ?');
      args.push(new Date().toISOString());
    }
  }
  fields.push('updated_at = ?');
  args.push(new Date().toISOString());
  args.push(documentId, therapistId);

  await db.run(
    `UPDATE generated_documents SET ${fields.join(', ')} WHERE id = ? AND therapist_id = ?`,
    ...args
  );
  await persistIfNeeded();
  return getDocument(therapistId, documentId);
}

async function deleteDocument(therapistId, documentId) {
  const db = getAsyncDb();
  const existing = await getDocument(therapistId, documentId);
  if (!existing) return false;
  await db.run(
    `DELETE FROM generated_documents WHERE id = ? AND therapist_id = ?`,
    documentId, therapistId
  );
  await persistIfNeeded();
  return true;
}

module.exports = {
  listTemplates,
  getTemplate,
  generateDocument,
  listDocumentsForTherapist,
  getDocument,
  updateDocument,
  deleteDocument,
};
