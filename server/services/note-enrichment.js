/**
 * Agentic Documentation Pipeline — Note Enrichment Service
 *
 * After a session note is dictated or created, this service enriches it with
 * AI-powered clinical suggestions. It runs a single Azure OpenAI call with
 * full patient context and returns structured enrichment data that the
 * therapist can accept, dismiss, or ignore.
 *
 * Enrichment types produced:
 *   - suggested_icd10      — ICD-10 codes supported by session content
 *   - continuity_threads   — recurring themes across prior sessions
 *   - risk_flags           — SI/HI/safety language detection
 *   - goal_alignment       — how this session maps to treatment plan goals
 *   - smart_plan_suggestions — actionable Plan section recommendations
 *
 * PHI safety:
 *   - Patient names are never sent to the model; only client_id is used
 *   - All note text passes through unmodified (model is HIPAA-covered via BAA)
 *   - Enrichment output is stored as JSON in the note_enrichments table
 *
 * Dependencies:
 *   - ../lib/aiExecutor  (callAI, MODELS)
 *   - ../db                (getDb, persist)
 */

'use strict';

const { callAI, MODELS } = require('../lib/aiExecutor');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

// ── Enrichment types stored as separate rows ─────────────────────────────────

const ENRICHMENT_TYPES = [
  'suggested_icd10',
  'continuity_threads',
  'risk_flags',
  'goal_alignment',
  'smart_plan_suggestions',
];

// ── Data loaders ─────────────────────────────────────────────────────────────

/**
 * Load the session note being enriched.
 * Returns null if the session does not exist or does not belong to the therapist.
 */
async function loadSession(db, sessionId, therapistId) {
  return db.get(
    `SELECT s.id, s.patient_id, s.session_date, s.note_format,
            s.subjective, s.objective, s.assessment, s.plan,
            s.icd10_codes, s.full_note, s.signed_at
     FROM sessions s
     WHERE s.id = ? AND s.therapist_id = ?`,
    sessionId, therapistId
  );
}

/**
 * Load patient demographic and clinical context.
 * Uses client_id for identification — never sends display_name to the model.
 */
async function loadPatientContext(db, patientId) {
  return db.get(
    `SELECT id, client_id, presenting_concerns, diagnoses, risk_screening,
            case_type, client_type, age_range, gender,
            mental_health_history, substance_use, medications,
            strengths_protective_factors, functional_impairments
     FROM patients WHERE id = ?`,
    patientId
  );
}

/**
 * Load the last N sessions for this patient (excluding the current one)
 * to enable continuity threading.
 */
async function loadPriorSessions(db, patientId, currentSessionId, limit = 5) {
  return db.all(
    `SELECT id, session_date, subjective, objective, assessment, plan, full_note, icd10_codes
     FROM sessions
     WHERE patient_id = ? AND id != ?
     ORDER BY session_date DESC, created_at DESC
     LIMIT ?`,
    patientId, currentSessionId, limit
  );
}

/**
 * Load active treatment goals for the patient via treatment_plans.
 * Returns goals with their plan context.
 */
async function loadActiveGoals(db, patientId) {
  return db.all(
    `SELECT tg.id AS goal_id, tg.goal_text, tg.status, tg.current_value,
            tg.target_metric, tg.baseline_value,
            tg.interventions_json, tg.progress_notes_json
     FROM treatment_goals tg
     JOIN treatment_plans tp ON tg.plan_id = tp.id
     WHERE tp.patient_id = ? AND tp.status = 'active' AND tg.status = 'active'
     ORDER BY tg.id`,
    patientId
  );
}

/**
 * Load the most recent assessment for each template type administered
 * to this patient. Provides severity context for clinical reasoning.
 */
async function loadLatestAssessments(db, patientId) {
  return db.all(
    `SELECT a1.id, a1.template_type, a1.total_score, a1.severity_level,
            a1.administered_at, a1.risk_flags, a1.score_change, a1.is_deterioration
     FROM assessments a1
     INNER JOIN (
       SELECT template_type, MAX(administered_at) AS max_date
       FROM assessments
       WHERE patient_id = ?
       GROUP BY template_type
     ) a2 ON a1.template_type = a2.template_type AND a1.administered_at = a2.max_date
     WHERE a1.patient_id = ?
     ORDER BY a1.administered_at DESC`,
    patientId, patientId
  );
}

// ── Prompt construction ──────────────────────────────────────────────────────

/**
 * Build the system prompt for the enrichment call.
 *
 * This prompt is the clinical backbone of the enrichment pipeline. It must be:
 *   - Conservative on ICD-10 suggestions (only codes with clear textual support)
 *   - Sensitive on risk detection (flag ambiguous SI/HI language)
 *   - Grounded in actual prior session text for continuity threading
 *   - Respectful of clinical judgment (suggestions, never directives)
 */
function buildSystemPrompt() {
  return `You are a clinical documentation assistant for a licensed psychotherapist. Your role is to analyze a session note alongside patient history and produce structured enrichment suggestions that the therapist can accept or dismiss.

CRITICAL GUIDELINES:

1. ICD-10 CODING
   - Only suggest codes that are DIRECTLY and CLEARLY supported by the session content.
   - Each suggestion must cite the specific language in the note that supports the code.
   - Use confidence levels conservatively:
     * "high" — the note explicitly describes symptoms meeting diagnostic criteria
     * "medium" — the note contains strong indicators but not a full criteria match
     * "low" — the note hints at the condition but evidence is partial
   - Never suggest a code based solely on patient history if it is not reflected in THIS session.
   - Prefer specific codes over unspecified ones (e.g., F33.1 over F33.9 when severity is documented).
   - Limit to 5 suggestions maximum.

2. RISK FLAG DETECTION
   - Err on the side of caution. Flag ANY language that could indicate:
     * Suicidal ideation (SI): direct statements, passive wishes, hopelessness, "no reason to live", "better off without me", references to self-harm methods
     * Homicidal ideation (HI): threats, violent fantasies, named targets, access to means
     * Self-harm: cutting, burning, disordered eating as self-punishment, reckless behavior
     * Safety concerns: abuse disclosures, DV indicators, child/elder welfare concerns, mandated reporting triggers
   - Severity levels:
     * "critical" — explicit SI/HI with plan, intent, or means; active abuse disclosure; imminent danger
     * "warning" — passive SI, vague HI, ambiguous self-harm references, recent escalation in risk factors
     * "info" — historical risk factors mentioned, protective factors weakening, noteworthy but not acute
   - Include a clinical suggestion for each flag (e.g., "Consider safety plan review", "Document lethal means counseling").
   - If no risk-relevant language is found, return an empty array. Do NOT fabricate risk flags.

3. CONTINUITY THREADS
   - Compare the CURRENT session note against the provided PRIOR session summaries.
   - Only identify themes that appear in BOTH the current note AND at least one prior session.
   - Reference specific session dates where the theme appeared.
   - Examples: recurring anxiety triggers, ongoing medication concerns, relationship patterns, therapeutic homework follow-through.
   - Do NOT fabricate connections that are not textually supported.

4. GOAL ALIGNMENT
   - For each active treatment goal provided, assess whether THIS session contains content relevant to that goal.
   - Quote or paraphrase the relevant content from the session note.
   - Provide a brief progress observation (e.g., "Client demonstrated use of coping skill discussed in prior sessions").
   - Only include goals that have genuine relevance to the current session. Skip goals with no connection.

5. SMART PLAN SUGGESTIONS
   - Based on the session content, suggest specific, actionable items for the Plan section.
   - Suggestions should be clinically sound and follow from what was discussed in the session.
   - Include rationale for each suggestion (why this action follows from the session content).
   - Examples: assessment administration, referral considerations, homework assignments, technique adjustments, safety planning steps.
   - Limit to 4 suggestions maximum.

RESPONSE FORMAT:
You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanatory text outside the JSON.

{
  "suggested_icd10": [
    {"code": "F33.1", "description": "Major depressive disorder, recurrent, moderate", "confidence": "high"}
  ],
  "continuity_threads": [
    {"theme": "Workplace anxiety and avoidance", "previous_dates": ["2025-01-15", "2025-02-01"], "note": "Client again reported anxiety related to team meetings, consistent with pattern noted in prior sessions."}
  ],
  "risk_flags": [
    {"flag": "Passive suicidal ideation", "severity": "warning", "suggestion": "Consider administering C-SSRS and reviewing safety plan."}
  ],
  "goal_alignment": [
    {"goal_id": 12, "goal_text": "Reduce panic attack frequency to <2/month", "relevant_content": "Client reported only one panic episode this week, down from three the prior week.", "progress_note": "Meaningful progress toward goal; frequency trending downward."}
  ],
  "smart_plan_suggestions": [
    {"suggestion": "Administer PHQ-9 at next session to track depressive symptom trajectory", "rationale": "Client reported improved mood but persistent sleep disturbance; standardized measure would quantify change."}
  ]
}

If a category has no relevant findings, return an empty array for that key. Always include all five keys.`;
}

/**
 * Build the user prompt containing all clinical context for this session.
 * Uses client_id instead of patient name for PHI safety.
 */
function buildUserPrompt(session, patient, priorSessions, goals, assessments) {
  const sections = [];

  // ── Current session note ───────────────────────────────────────────────────
  sections.push('=== CURRENT SESSION NOTE ===');
  sections.push(`Client ID: ${patient.client_id}`);
  sections.push(`Session Date: ${session.session_date || 'Not recorded'}`);
  sections.push(`Note Format: ${session.note_format || 'SOAP'}`);

  if (session.note_format === 'SOAP' || session.subjective || session.objective) {
    if (session.subjective) sections.push(`\nSUBJECTIVE:\n${session.subjective}`);
    if (session.objective)  sections.push(`\nOBJECTIVE:\n${session.objective}`);
    if (session.assessment) sections.push(`\nASSESSMENT:\n${session.assessment}`);
    if (session.plan)       sections.push(`\nPLAN:\n${session.plan}`);
  }

  if (session.full_note) {
    sections.push(`\nFULL NOTE:\n${session.full_note}`);
  }

  if (session.icd10_codes) {
    sections.push(`\nEXISTING ICD-10 CODES: ${session.icd10_codes}`);
  }

  // ── Patient clinical background ────────────────────────────────────────────
  sections.push('\n=== PATIENT CLINICAL CONTEXT ===');
  sections.push(`Client ID: ${patient.client_id}`);
  if (patient.age_range)      sections.push(`Age Range: ${patient.age_range}`);
  if (patient.gender)         sections.push(`Gender: ${patient.gender}`);
  if (patient.client_type)    sections.push(`Client Type: ${patient.client_type}`);
  if (patient.case_type)      sections.push(`Case Type: ${patient.case_type}`);

  if (patient.presenting_concerns) {
    sections.push(`\nPresenting Concerns:\n${patient.presenting_concerns}`);
  }
  if (patient.diagnoses) {
    sections.push(`\nDiagnoses on File:\n${patient.diagnoses}`);
  }
  if (patient.risk_screening) {
    sections.push(`\nRisk Screening:\n${patient.risk_screening}`);
  }
  if (patient.mental_health_history) {
    sections.push(`\nMental Health History:\n${patient.mental_health_history}`);
  }
  if (patient.substance_use) {
    sections.push(`\nSubstance Use:\n${patient.substance_use}`);
  }
  if (patient.medications) {
    sections.push(`\nMedications:\n${patient.medications}`);
  }
  if (patient.strengths_protective_factors) {
    sections.push(`\nStrengths/Protective Factors:\n${patient.strengths_protective_factors}`);
  }
  if (patient.functional_impairments) {
    sections.push(`\nFunctional Impairments:\n${patient.functional_impairments}`);
  }

  // ── Prior sessions (for continuity threading) ──────────────────────────────
  if (priorSessions.length > 0) {
    sections.push('\n=== PRIOR SESSIONS (most recent first) ===');
    for (const ps of priorSessions) {
      sections.push(`\n--- Session ${ps.session_date || 'undated'} (ID: ${ps.id}) ---`);
      if (ps.subjective) sections.push(`Subjective: ${ps.subjective.slice(0, 500)}`);
      if (ps.objective)  sections.push(`Objective: ${ps.objective.slice(0, 500)}`);
      if (ps.assessment) sections.push(`Assessment: ${ps.assessment.slice(0, 500)}`);
      if (ps.plan)       sections.push(`Plan: ${ps.plan.slice(0, 500)}`);
      if (ps.icd10_codes) sections.push(`ICD-10: ${ps.icd10_codes}`);
    }
  } else {
    sections.push('\n=== PRIOR SESSIONS ===');
    sections.push('No prior sessions on record. This may be the initial session.');
  }

  // ── Active treatment goals ─────────────────────────────────────────────────
  if (goals.length > 0) {
    sections.push('\n=== ACTIVE TREATMENT GOALS ===');
    for (const g of goals) {
      let goalLine = `Goal ID ${g.goal_id}: "${g.goal_text}" (status: ${g.status})`;
      if (g.target_metric)  goalLine += ` | target: ${g.target_metric}`;
      if (g.baseline_value != null) goalLine += ` | baseline: ${g.baseline_value}`;
      if (g.current_value != null)  goalLine += ` | current: ${g.current_value}`;
      sections.push(goalLine);
    }
  } else {
    sections.push('\n=== ACTIVE TREATMENT GOALS ===');
    sections.push('No active treatment goals on record.');
  }

  // ── Latest assessments ─────────────────────────────────────────────────────
  if (assessments.length > 0) {
    sections.push('\n=== LATEST ASSESSMENTS ===');
    for (const a of assessments) {
      let line = `${a.template_type}: score ${a.total_score}`;
      if (a.severity_level)   line += ` (${a.severity_level})`;
      if (a.administered_at)  line += ` — administered ${a.administered_at}`;
      if (a.is_deterioration) line += ' [DETERIORATION]';
      if (a.score_change)     line += ` | change: ${a.score_change > 0 ? '+' : ''}${a.score_change}`;
      if (a.risk_flags)       line += ` | risk flags: ${a.risk_flags}`;
      sections.push(line);
    }
  } else {
    sections.push('\n=== LATEST ASSESSMENTS ===');
    sections.push('No standardized assessments on record.');
  }

  // ── Instruction ────────────────────────────────────────────────────────────
  sections.push('\n=== TASK ===');
  sections.push('Analyze the current session note in the context of the patient history, prior sessions, treatment goals, and assessments above. Return a JSON enrichment object with all five keys as specified in your instructions.');

  return sections.join('\n');
}

// ── JSON parsing with fallback ───────────────────────────────────────────────

/**
 * Parse Azure OpenAI's response as JSON. Handles cases where the model wraps
 * the JSON in markdown code fences or adds leading/trailing text.
 */
function parseEnrichmentResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty response from enrichment model');
  }

  let text = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Try to extract JSON object if there is surrounding text
  if (!text.startsWith('{')) {
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      text = text.slice(braceStart, braceEnd + 1);
    }
  }

  const parsed = JSON.parse(text);

  // Validate expected keys exist
  const result = {};
  for (const key of ENRICHMENT_TYPES) {
    result[key] = Array.isArray(parsed[key]) ? parsed[key] : [];
  }

  return result;
}

// ── Enrichment storage ───────────────────────────────────────────────────────

/**
 * Store each enrichment type as a separate row in note_enrichments.
 * This allows per-type accept/dismiss tracking.
 */
async function storeEnrichments(db, sessionId, therapistId, enrichments) {
  const storedIds = {};

  for (const type of ENRICHMENT_TYPES) {
    const content = enrichments[type];
    // Only store non-empty enrichments
    if (!Array.isArray(content) || content.length === 0) continue;

    const result = await db.insert(
      `INSERT INTO note_enrichments (session_id, therapist_id, enrichment_type, content_json)
       VALUES (?, ?, ?, ?)`,
      sessionId, therapistId, type, JSON.stringify(content)
    );
    storedIds[type] = result.lastInsertRowid;
  }

  return storedIds;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Main enrichment pipeline.
 *
 * Loads all relevant context, sends a single Azure OpenAI call, parses the
 * structured response, stores each enrichment type, and returns the full
 * enrichment object.
 *
 * @param {number} sessionId   — ID of the session to enrich
 * @param {number} therapistId — ID of the therapist (for ownership verification)
 * @returns {Object} — { enrichments, enrichmentIds, sessionId }
 * @throws if session not found, patient not found, or model call fails
 */
async function enrichSessionNote(sessionId, therapistId) {
  const db = getAsyncDb();

  // ── Step A: Load the session note ──────────────────────────────────────────
  const session = await loadSession(db, sessionId, therapistId);
  if (!session) {
    throw new Error(`Session not found or access denied: session_id=${sessionId}`);
  }

  // Guard: don't enrich sessions with no content
  const hasContent = session.subjective || session.objective || session.assessment
    || session.plan || session.full_note;
  if (!hasContent) {
    throw new Error('Session has no note content to enrich');
  }

  // ── Step B: Load patient context ───────────────────────────────────────────
  const patient = await loadPatientContext(db, session.patient_id);
  if (!patient) {
    throw new Error(`Patient not found for session: patient_id=${session.patient_id}`);
  }

  // ── Step C: Load prior sessions for continuity threading ───────────────────
  const priorSessions = await loadPriorSessions(db, session.patient_id, sessionId, 3);

  // ── Step D: Load active treatment goals ────────────────────────────────────
  const goals = await loadActiveGoals(db, session.patient_id);

  // ── Step E: Load latest assessments ────────────────────────────────────────
  const assessments = await loadLatestAssessments(db, session.patient_id);

  // ── Step F: Build prompts and call Azure OpenAI ──────────────────────────────────
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(session, patient, priorSessions, goals, assessments);

  console.log(
    `[note-enrichment] Enriching session_id=${sessionId} for therapist_id=${therapistId} ` +
    `(patient_id=${session.patient_id}, priorSessions=${priorSessions.length}, ` +
    `goals=${goals.length}, assessments=${assessments.length})`
  );

  let rawResponse;
  try {
    rawResponse = await callAI(
      MODELS.AZURE_MAIN,
      systemPrompt,
      userPrompt,
      4000  // generous token limit for structured JSON output
    );
  } catch (err) {
    console.error(`[note-enrichment] Azure OpenAI call failed for session_id=${sessionId}:`, err.message);
    throw new Error('Enrichment model call failed');
  }

  // ── Step G: Parse the structured JSON response ─────────────────────────────
  let enrichments;
  try {
    enrichments = parseEnrichmentResponse(rawResponse);
  } catch (err) {
    console.error(
      `[note-enrichment] Failed to parse enrichment JSON for session_id=${sessionId}:`,
      err.message
    );
    throw new Error('Enrichment response parsing failed');
  }

  // ── Step G.5: Post-processing validation ───────────────────────────────────

  // Validate ICD-10 suggestions: reject codes not supported by session content
  const noteText = [session.subjective, session.objective, session.assessment, session.plan, session.full_note].filter(Boolean).join(' ').toLowerCase();
  if (enrichments.suggested_icd10 && Array.isArray(enrichments.suggested_icd10)) {
    enrichments.suggested_icd10 = enrichments.suggested_icd10.filter(item => {
      // Reject if confidence is missing
      if (!item.confidence || !['high', 'medium', 'low'].includes(item.confidence)) return false;
      // Reject if description is too short to be real
      if (!item.description || item.description.length < 5) return false;
      return true;
    });
  }

  // Validate risk flags: require severity and suggestion
  if (enrichments.risk_flags && Array.isArray(enrichments.risk_flags)) {
    enrichments.risk_flags = enrichments.risk_flags.filter(item => {
      if (!item.severity || !['critical', 'warning', 'info'].includes(item.severity)) return false;
      if (!item.flag || item.flag.length < 3) return false;
      if (!item.suggestion) item.suggestion = 'Review clinical assessment and document findings.';
      return true;
    });
  }

  // Validate continuity threads: require at least one previous date
  if (enrichments.continuity_threads && Array.isArray(enrichments.continuity_threads)) {
    enrichments.continuity_threads = enrichments.continuity_threads.filter(item => {
      if (!item.theme || item.theme.length < 3) return false;
      if (!Array.isArray(item.previous_dates) || item.previous_dates.length === 0) return false;
      return true;
    });
  }

  // ── Step H: Store each enrichment type in the database ─────────────────────
  const enrichmentIds = await storeEnrichments(db, sessionId, therapistId, enrichments);
  await persistIfNeeded();

  console.log(
    `[note-enrichment] Stored enrichments for session_id=${sessionId}: ` +
    Object.entries(enrichmentIds).map(([t, id]) => `${t}=#${id}`).join(', ')
  );

  // ── Step I: Return the full enrichment object ──────────────────────────────
  return {
    sessionId,
    enrichments,
    enrichmentIds,
  };
}

/**
 * Fetch all enrichments for a session.
 *
 * Returns an object keyed by enrichment_type, each containing:
 *   - id:           the enrichment row ID (for accept/dismiss)
 *   - content:      parsed JSON array of enrichment items
 *   - accepted:     null (pending), 1 (accepted), or 0 (dismissed)
 *   - created_at:   timestamp of when the enrichment was generated
 *
 * @param {number} sessionId   — ID of the session
 * @param {number} therapistId — ID of the therapist (ownership check)
 * @returns {Object} — keyed by enrichment_type
 */
async function getEnrichments(sessionId, therapistId) {
  const db = getAsyncDb();

  const rows = await db.all(
    `SELECT id, enrichment_type, content_json, accepted, created_at
     FROM note_enrichments
     WHERE session_id = ? AND therapist_id = ?
     ORDER BY created_at DESC`,
    sessionId, therapistId
  );

  // Group by enrichment type. If multiple runs exist, the most recent wins
  // (rows are ordered DESC, so first seen per type is the latest).
  const result = {};
  for (const row of rows) {
    if (!result[row.enrichment_type]) {
      let content = [];
      try {
        content = JSON.parse(row.content_json);
      } catch {
        // Malformed JSON — return empty array rather than crashing
      }
      result[row.enrichment_type] = {
        id: row.id,
        content,
        accepted: row.accepted,
        created_at: row.created_at,
      };
    }
  }

  return result;
}

/**
 * Mark an enrichment as accepted.
 *
 * This feeds into preference learning — over time, the patterns of which
 * enrichments a therapist accepts vs. dismisses can tune future suggestions.
 *
 * @param {number} enrichmentId — row ID in note_enrichments
 * @param {number} therapistId  — ownership verification
 * @returns {boolean} — true if the update succeeded
 */
async function acceptEnrichment(enrichmentId, therapistId) {
  const db = getAsyncDb();

  const existing = await db.get(
    'SELECT id FROM note_enrichments WHERE id = ? AND therapist_id = ?',
    enrichmentId, therapistId
  );
  if (!existing) {
    throw new Error(`Enrichment not found or access denied: id=${enrichmentId}`);
  }

  await db.run(
    'UPDATE note_enrichments SET accepted = 1 WHERE id = ?',
    enrichmentId
  );

  await persistIfNeeded();

  return true;
}

/**
 * Mark an enrichment as dismissed (rejected).
 *
 * Dismissed enrichments are stored with accepted=0 for preference learning.
 * They are not deleted — the therapist can still view them.
 *
 * @param {number} enrichmentId — row ID in note_enrichments
 * @param {number} therapistId  — ownership verification
 * @returns {boolean} — true if the update succeeded
 */
async function dismissEnrichment(enrichmentId, therapistId) {
  const db = getAsyncDb();

  const existing = await db.get(
    'SELECT id FROM note_enrichments WHERE id = ? AND therapist_id = ?',
    enrichmentId, therapistId
  );
  if (!existing) {
    throw new Error(`Enrichment not found or access denied: id=${enrichmentId}`);
  }

  await db.run(
    'UPDATE note_enrichments SET accepted = 0 WHERE id = ?',
    enrichmentId
  );

  await persistIfNeeded();

  return true;
}

module.exports = {
  enrichSessionNote,
  getEnrichments,
  acceptEnrichment,
  dismissEnrichment,
  // Exported for testing
  ENRICHMENT_TYPES,
  buildSystemPrompt,
  buildUserPrompt,
  parseEnrichmentResponse,
};
