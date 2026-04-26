/**
 * Practice Intelligence Service
 *
 * Analyzes a therapist's entire clinical history to discover patterns,
 * track intervention effectiveness, and generate cross-client insights.
 *
 * Insight types:
 *   - intervention_effectiveness  — which modalities work for which presentations
 *   - cross_client_pattern        — shared patterns across similar clients
 *   - session_pattern             — session duration, frequency, note-length trends
 *   - caseload_trend              — diagnosis distribution, new-client growth
 *
 * PHI safety: Only client_id codes are sent to the LLM -- never real names,
 * phone numbers, emails, or other PII.
 *
 * Table: practice_insights (see db.js schema)
 */

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { callAI, MODELS } = require('../lib/aiExecutor');

// ── Constants ────────────────────────────────────────────────────────────────

const LOG_PREFIX = '[practice-intelligence]';

/** How far back to look when gathering data for insight generation. */
const LOOKBACK_DAYS = 90;

/** Maximum sessions to include in a single Azure OpenAI prompt. */
const MAX_SESSIONS_PER_PROMPT = 120;

/** Maximum assessments to include in a single Azure OpenAI prompt. */
const MAX_ASSESSMENTS_PER_PROMPT = 200;

/**
 * Intervention keywords scanned in session notes.
 * Kept as a map so we can normalize shorthand into canonical labels.
 */
const INTERVENTION_KEYWORDS = {
  'cbt':                      'CBT',
  'cognitive behavioral':     'CBT',
  'cognitive restructuring':  'CBT - Cognitive Restructuring',
  'behavioral activation':    'CBT - Behavioral Activation',
  'dbt':                      'DBT',
  'dialectical':              'DBT',
  'distress tolerance':       'DBT - Distress Tolerance',
  'emotion regulation':       'DBT - Emotion Regulation',
  'erp':                      'ERP',
  'exposure response':        'ERP',
  'exposure therapy':         'Exposure Therapy',
  'motivational interviewing':'MI',
  'mi ':                      'MI',
  'grounding':                'Grounding',
  'mindfulness':              'Mindfulness',
  'emdr':                     'EMDR',
  'act ':                     'ACT',
  'acceptance and commitment':'ACT',
  'psychoeducation':          'Psychoeducation',
  'solution focused':         'SFBT',
  'sfbt':                     'SFBT',
  'somatic':                  'Somatic',
  'narrative therapy':        'Narrative Therapy',
  'play therapy':             'Play Therapy',
  'family systems':           'Family Systems',
  'gottman':                  'Gottman Method',
  'eft':                      'EFT',
  'emotionally focused':      'EFT',
  'ifs':                      'IFS',
  'internal family systems':  'IFS',
};

// ── Data Collection Helpers ──────────────────────────────────────────────────

/**
 * Pull all signed sessions for a therapist from the last N days.
 * Returns a compact representation -- full_note is truncated to save tokens.
 */
async function fetchRecentSessions(db, therapistId) {
  const rows = await db.all(
    `SELECT s.id, s.patient_id, s.session_date, s.note_format,
            s.subjective, s.objective, s.assessment, s.plan,
            s.duration_minutes, s.cpt_code, s.signed_at,
            p.client_id, p.presenting_concerns, p.diagnoses, p.case_type
     FROM sessions s
     JOIN patients p ON p.id = s.patient_id
     WHERE s.therapist_id = ?
       AND s.signed_at IS NOT NULL
       AND s.session_date >= date('now', ?)
     ORDER BY s.session_date DESC
     LIMIT ?`,
    therapistId,
    `-${LOOKBACK_DAYS} days`,
    MAX_SESSIONS_PER_PROMPT
  );

  return rows;
}

/**
 * Pull all assessments for a therapist from the last N days.
 */
async function fetchRecentAssessments(db, therapistId) {
  const rows = await db.all(
    `SELECT a.id, a.patient_id, a.template_type, a.total_score,
            a.severity_level, a.score_change, a.is_improvement,
            a.is_deterioration, a.clinically_significant,
            a.administered_at,
            p.client_id, p.presenting_concerns, p.diagnoses
     FROM assessments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.therapist_id = ?
       AND a.status = 'completed'
       AND a.administered_at >= date('now', ?)
     ORDER BY a.administered_at DESC
     LIMIT ?`,
    therapistId,
    `-${LOOKBACK_DAYS} days`,
    MAX_ASSESSMENTS_PER_PROMPT
  );

  return rows;
}

/**
 * Pull all active patient profiles for a therapist.
 * Only returns PHI-safe fields (client_id, concerns, diagnoses, case_type).
 */
async function fetchPatientProfiles(db, therapistId) {
  const rows = await db.all(
    `SELECT id, client_id, presenting_concerns, diagnoses,
            case_type, client_type, session_modality, session_duration
     FROM patients
     WHERE therapist_id = ?`,
    therapistId
  );

  return rows;
}

// ── Session Summarization (token reduction) ──────────────────────────────────

/**
 * Build a compact text summary of a session for the LLM prompt.
 * Uses client_id (never display_name) for PHI safety.
 * Truncates each SOAP section to keep token count low.
 */
function summarizeSession(session) {
  const MAX_SECTION = 150; // characters per SOAP section
  const trunc = (text) => {
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > MAX_SECTION ? clean.slice(0, MAX_SECTION) + '...' : clean;
  };

  const parts = [
    `[${session.client_id}] ${session.session_date}`,
    `Dx: ${session.diagnoses || 'N/A'}`,
    `Concerns: ${session.presenting_concerns || 'N/A'}`,
    `Format: ${session.note_format || 'SOAP'}`,
  ];

  if (session.duration_minutes) parts.push(`Duration: ${session.duration_minutes}min`);
  if (session.cpt_code) parts.push(`CPT: ${session.cpt_code}`);

  // Include truncated SOAP sections
  if (session.subjective) parts.push(`S: ${trunc(session.subjective)}`);
  if (session.objective)  parts.push(`O: ${trunc(session.objective)}`);
  if (session.assessment) parts.push(`A: ${trunc(session.assessment)}`);
  if (session.plan)       parts.push(`P: ${trunc(session.plan)}`);

  return parts.join(' | ');
}

/**
 * Build a compact text summary of an assessment.
 */
function summarizeAssessment(assessment) {
  const parts = [
    `[${assessment.client_id}] ${assessment.template_type}`,
    `Score: ${assessment.total_score}`,
    `Severity: ${assessment.severity_level || 'N/A'}`,
  ];

  if (assessment.score_change != null) {
    const dir = assessment.is_improvement ? 'improved' : assessment.is_deterioration ? 'worsened' : 'stable';
    parts.push(`Change: ${assessment.score_change} (${dir})`);
  }
  if (assessment.clinically_significant) parts.push('CLINICALLY SIGNIFICANT');
  parts.push(`Date: ${assessment.administered_at}`);

  return parts.join(' | ');
}

// ── Intervention Detection ───────────────────────────────────────────────────

/**
 * Scan a session's note text for intervention keywords.
 * Returns an array of canonical intervention labels found.
 */
function detectInterventions(session) {
  const text = [
    session.subjective,
    session.objective,
    session.assessment,
    session.plan,
  ].filter(Boolean).join(' ').toLowerCase();

  const found = new Set();
  for (const [keyword, label] of Object.entries(INTERVENTION_KEYWORDS)) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(text)) {
      found.add(label);
    }
  }

  return [...found];
}

// ── Azure OpenAI Prompt Construction ───────────────────────────────────────────────

/**
 * Build the system prompt for practice intelligence analysis.
 */
function buildSystemPrompt() {
  return [
    'You are a clinical practice intelligence analyst for a licensed therapist.',
    'You analyze de-identified clinical data to find actionable patterns.',
    '',
    'IMPORTANT RULES:',
    '- All clients are identified ONLY by code (e.g. "CLT-001"). Never infer or generate real names.',
    '- Base every insight on the data provided. Do not fabricate statistics.',
    '- Be specific: cite client codes, assessment types, score changes, and session counts.',
    '- Focus on clinically actionable insights the therapist can use immediately.',
    '',
    'You MUST respond with a JSON array of insight objects. Each object has:',
    '  {',
    '    "type": "intervention_effectiveness" | "cross_client_pattern" | "session_pattern" | "caseload_trend",',
    '    "text": "Human-readable insight text (1-3 sentences, specific and actionable)",',
    '    "evidence": ["Array of specific data points supporting this insight"],',
    '    "confidence": 0.0-1.0 (how strongly the data supports this),',
    '    "patient_codes": ["CLT-001", "CLT-002"] // client codes referenced',
    '  }',
    '',
    'Generate 3-8 insights total, covering at least 2 different types.',
    'Prioritize intervention_effectiveness and cross_client_pattern insights.',
    'Only output the JSON array -- no markdown, no commentary.',
  ].join('\n');
}

/**
 * Build the user prompt with aggregated clinical data.
 * Keeps token usage low by summarizing rather than sending full notes.
 */
function buildUserPrompt(sessions, assessments, patients) {
  const sections = [];

  // ── Caseload summary
  const diagCounts = {};
  const caseTypeCounts = {};
  for (const p of patients) {
    const dx = (p.diagnoses || 'Unspecified').split(/[,;]/).map(d => d.trim()).filter(Boolean);
    for (const d of dx) {
      diagCounts[d] = (diagCounts[d] || 0) + 1;
    }
    const ct = p.case_type || p.client_type || 'individual';
    caseTypeCounts[ct] = (caseTypeCounts[ct] || 0) + 1;
  }

  sections.push('=== CASELOAD OVERVIEW ===');
  sections.push(`Total active clients: ${patients.length}`);
  sections.push(`Case types: ${JSON.stringify(caseTypeCounts)}`);
  sections.push(`Diagnosis distribution: ${JSON.stringify(diagCounts)}`);
  sections.push('');

  // ── Intervention usage summary (pre-computed to help the LLM)
  const interventionsByClient = {};
  for (const s of sessions) {
    const interventions = detectInterventions(s);
    if (interventions.length > 0) {
      if (!interventionsByClient[s.client_id]) {
        interventionsByClient[s.client_id] = {
          diagnoses: s.diagnoses || '',
          concerns: s.presenting_concerns || '',
          interventions: new Set(),
          sessionCount: 0,
        };
      }
      for (const iv of interventions) {
        interventionsByClient[s.client_id].interventions.add(iv);
      }
      interventionsByClient[s.client_id].sessionCount++;
    }
  }

  if (Object.keys(interventionsByClient).length > 0) {
    sections.push('=== INTERVENTION USAGE BY CLIENT ===');
    for (const [clientCode, data] of Object.entries(interventionsByClient)) {
      sections.push(
        `[${clientCode}] Dx: ${data.diagnoses} | Concerns: ${data.concerns} | ` +
        `Interventions: ${[...data.interventions].join(', ')} | Sessions: ${data.sessionCount}`
      );
    }
    sections.push('');
  }

  // ── Assessment outcomes by client
  const assessmentsByClient = {};
  for (const a of assessments) {
    if (!assessmentsByClient[a.client_id]) {
      assessmentsByClient[a.client_id] = [];
    }
    assessmentsByClient[a.client_id].push(a);
  }

  if (Object.keys(assessmentsByClient).length > 0) {
    sections.push('=== ASSESSMENT OUTCOMES BY CLIENT ===');
    for (const [clientCode, clientAssessments] of Object.entries(assessmentsByClient)) {
      const summaries = clientAssessments.map(summarizeAssessment);
      sections.push(`Client ${clientCode}:`);
      for (const s of summaries) {
        sections.push(`  ${s}`);
      }
    }
    sections.push('');
  }

  // ── Session metadata (for session_pattern insights)
  const durations = sessions.filter(s => s.duration_minutes).map(s => s.duration_minutes);
  if (durations.length > 0) {
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    sections.push('=== SESSION METADATA ===');
    sections.push(`Sessions in last ${LOOKBACK_DAYS} days: ${sessions.length}`);
    sections.push(`Duration — avg: ${avg}min, min: ${min}min, max: ${max}min`);

    // Break down by CPT code if available
    const byCpt = {};
    for (const s of sessions) {
      const code = s.cpt_code || 'unspecified';
      if (!byCpt[code]) byCpt[code] = [];
      if (s.duration_minutes) byCpt[code].push(s.duration_minutes);
    }
    for (const [cpt, durs] of Object.entries(byCpt)) {
      if (durs.length > 1) {
        const cptAvg = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
        sections.push(`  ${cpt}: ${durs.length} sessions, avg ${cptAvg}min`);
      }
    }
    sections.push('');
  }

  // ── Summarized session notes (truncated for token efficiency)
  if (sessions.length > 0) {
    sections.push('=== RECENT SESSION SUMMARIES ===');
    for (const s of sessions) {
      sections.push(summarizeSession(s));
    }
    sections.push('');
  }

  sections.push(
    'Analyze the above data and produce practice insights as specified. ' +
    'Focus on intervention effectiveness patterns, cross-client similarities, ' +
    'session patterns, and caseload trends.'
  );

  return sections.join('\n');
}

// ── Insight Parsing & Upserting ──────────────────────────────────────────────

/**
 * Parse the Azure OpenAI response into validated insight objects.
 * Handles edge cases like markdown wrappers, single-object responses, etc.
 */
function parseInsightsResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return [];

  // Strip markdown code fences if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error(LOG_PREFIX, 'Failed to parse insights JSON:', err.message);
    return [];
  }

  // Normalize to array
  if (!Array.isArray(parsed)) {
    parsed = [parsed];
  }

  const VALID_TYPES = new Set([
    'intervention_effectiveness',
    'cross_client_pattern',
    'session_pattern',
    'caseload_trend',
  ]);

  return parsed
    .filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (!VALID_TYPES.has(item.type)) return false;
      if (!item.text || typeof item.text !== 'string') return false;
      return true;
    })
    .map(item => ({
      type: item.type,
      text: item.text.trim(),
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
      confidence: typeof item.confidence === 'number'
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.5,
      patientCodes: Array.isArray(item.patient_codes) ? item.patient_codes : [],
    }));
}

/**
 * Resolve client_id codes to patient IDs for storage.
 * Returns an array of numeric patient IDs.
 */
async function resolvePatientIds(db, therapistId, clientCodes) {
  if (!clientCodes.length) return [];

  const ids = [];
  for (const code of clientCodes) {
    const row = await db.get(
      'SELECT id FROM patients WHERE therapist_id = ? AND client_id = ?',
      therapistId, code
    );
    if (row) ids.push(row.id);
  }
  return ids;
}

/**
 * Upsert an insight into the practice_insights table.
 * If a similar active insight of the same type exists (fuzzy match on first
 * 60 chars of text), update it. Otherwise insert a new row.
 */
async function upsertInsight(db, therapistId, insight, patientIds) {
  const evidenceJson = JSON.stringify(insight.evidence);
  const patientIdsJson = JSON.stringify(patientIds);

  // Check for an existing similar insight (same type, similar text prefix)
  const textPrefix = insight.text.slice(0, 60);
  const existing = await db.get(
    `SELECT id FROM practice_insights
     WHERE therapist_id = ?
       AND insight_type = ?
       AND is_active = 1
       AND insight_text LIKE ?`,
    therapistId,
    insight.type,
    textPrefix + '%'
  );

  if (existing) {
    // Update the existing insight with fresh data
    await db.run(
      `UPDATE practice_insights
       SET insight_text = ?,
           evidence_json = ?,
           confidence_score = ?,
           patient_ids_json = ?,
           last_validated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      insight.text,
      evidenceJson,
      insight.confidence,
      patientIdsJson,
      existing.id
    );
    return { action: 'updated', id: existing.id };
  }

  // Insert new insight
  const result = await db.insert(
    `INSERT INTO practice_insights
       (therapist_id, insight_type, insight_text, evidence_json,
        confidence_score, patient_ids_json, is_active, last_validated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
    therapistId,
    insight.type,
    insight.text,
    evidenceJson,
    insight.confidence,
    patientIdsJson
  );
  return { action: 'inserted', id: result.lastInsertRowid };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate practice insights for one or all therapists.
 *
 * @param {number|null} therapistId  If null, runs for every therapist with patients.
 * @returns {Promise<{total: number, byTherapist: Object}>}
 */
async function generatePracticeInsights(therapistId = null) {
  const db = getAsyncDb();

  // Determine which therapists to process
  let therapistIds;
  if (therapistId) {
    therapistIds = [therapistId];
  } else {
    const rows = await db.all('SELECT DISTINCT therapist_id FROM patients WHERE therapist_id IS NOT NULL');
    therapistIds = rows.map(r => r.therapist_id);
  }

  console.log(LOG_PREFIX, `Starting insight generation for ${therapistIds.length} therapist(s)`);

  const results = { total: 0, byTherapist: {} };

  for (const tId of therapistIds) {
    try {
      const count = await generateInsightsForTherapist(db, tId);
      results.byTherapist[tId] = { insights: count, error: null };
      results.total += count;
      console.log(LOG_PREFIX, `Therapist ${tId}: generated ${count} insights`);
    } catch (err) {
      console.error(LOG_PREFIX, `Therapist ${tId} failed:`, err.message);
      results.byTherapist[tId] = { insights: 0, error: err.message };
    }
  }

  console.log(LOG_PREFIX, `Complete. Total insights: ${results.total}`);
  return results;
}

/**
 * Generate insights for a single therapist.
 * @returns {Promise<number>} Number of insights generated.
 */
async function generateInsightsForTherapist(db, therapistId) {
  // ── Step 1: Gather data ────────────────────────────────────────────────────
  const sessions = await fetchRecentSessions(db, therapistId);
  const assessments = await fetchRecentAssessments(db, therapistId);
  const patients = await fetchPatientProfiles(db, therapistId);

  if (!sessions.length && !assessments.length) {
    console.log(LOG_PREFIX, `Therapist ${therapistId}: no signed sessions or assessments in last ${LOOKBACK_DAYS} days, skipping`);
    return 0;
  }

  console.log(LOG_PREFIX, `Therapist ${therapistId}: ${sessions.length} sessions, ${assessments.length} assessments, ${patients.length} patients`);

  // ── Step 2: Build prompt ───────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(sessions, assessments, patients);

  // ── Step 3: Call Azure OpenAI Haiku for cost efficiency ──────────────────────────
  const responseText = await callAI(
    MODELS.AZURE_MAIN,
    systemPrompt,
    userPrompt,
    2000 // max tokens -- enough for 3-8 insight objects
  );

  // ── Step 4: Parse response ─────────────────────────────────────────────────
  let insights = parseInsightsResponse(responseText);

  // Reject insights with confidence below 0.3
  insights = insights.filter(i => (i.confidence || 0) >= 0.3);

  if (!insights.length) {
    console.warn(LOG_PREFIX, `Therapist ${therapistId}: Azure OpenAI returned no parseable insights`);
    return 0;
  }

  // ── Step 5: Upsert into database ───────────────────────────────────────────
  let count = 0;
  for (const insight of insights) {
    const patientIds = await resolvePatientIds(db, therapistId, insight.patientCodes);
    const result = await upsertInsight(db, therapistId, insight, patientIds);
    console.log(LOG_PREFIX, `  ${result.action} [${insight.type}] id=${result.id} confidence=${insight.confidence}`);
    count++;
  }

  await persistIfNeeded();
  return count;
}

/**
 * Search insights by type or keyword.
 *
 * @param {number} therapistId
 * @param {string} query  Free-text search term or insight type name.
 * @returns {Array} Matching insight rows.
 */
async function searchInsights(therapistId, query) {
  const db = getAsyncDb();

  if (!query || typeof query !== 'string') {
    return db.all(
      `SELECT * FROM practice_insights
       WHERE therapist_id = ? AND is_active = 1
       ORDER BY created_at DESC
       LIMIT 20`,
      therapistId
    );
  }

  const term = query.trim();

  // Check if the query matches an insight type exactly
  const VALID_TYPES = [
    'intervention_effectiveness',
    'cross_client_pattern',
    'session_pattern',
    'caseload_trend',
  ];
  if (VALID_TYPES.includes(term)) {
    return db.all(
      `SELECT * FROM practice_insights
       WHERE therapist_id = ? AND insight_type = ? AND is_active = 1
       ORDER BY confidence_score DESC, created_at DESC
       LIMIT 20`,
      therapistId, term
    );
  }

  // Otherwise do a LIKE search across type and text
  const likeTerm = `%${term}%`;
  return db.all(
    `SELECT * FROM practice_insights
     WHERE therapist_id = ? AND is_active = 1
       AND (insight_type LIKE ? OR insight_text LIKE ? OR evidence_json LIKE ?)
     ORDER BY confidence_score DESC, created_at DESC
     LIMIT 20`,
    therapistId, likeTerm, likeTerm, likeTerm
  );
}

/**
 * Get the top 5 most recent/relevant active insights for dashboard display.
 *
 * @param {number} therapistId
 * @returns {Array} Up to 5 insight rows, ordered by recency and confidence.
 */
async function getInsightsSummary(therapistId) {
  const db = getAsyncDb();

  // Prioritize: high confidence first, then most recently validated
  return db.all(
    `SELECT * FROM practice_insights
     WHERE therapist_id = ? AND is_active = 1
     ORDER BY confidence_score DESC, last_validated_at DESC, created_at DESC
     LIMIT 5`,
    therapistId
  );
}

/**
 * Get insights that reference a specific patient.
 *
 * @param {number} therapistId
 * @param {number} patientId
 * @returns {Array} Insight rows where this patient appears in patient_ids_json.
 */
async function getInsightsForPatient(therapistId, patientId) {
  const db = getAsyncDb();

  // patient_ids_json stores a JSON array like [3, 7, 12].
  // We use a LIKE match on the patient ID to find references.
  // This handles both "[3," and ",3," and ",3]" and "[3]" patterns.
  const rows = await db.all(
    `SELECT * FROM practice_insights
     WHERE therapist_id = ? AND is_active = 1
       AND patient_ids_json LIKE ?
     ORDER BY confidence_score DESC, created_at DESC`,
    therapistId,
    `%${patientId}%`
  );

  // Post-filter for exact ID match (avoid false positives like 3 matching 13, 30, etc.)
  return rows.filter(row => {
    try {
      const ids = JSON.parse(row.patient_ids_json || '[]');
      return ids.includes(patientId);
    } catch {
      return false;
    }
  });
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generatePracticeInsights,
  searchInsights,
  getInsightsSummary,
  getInsightsForPatient,
};
