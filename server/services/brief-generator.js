/**
 * Pre-Session Brief Generator
 *
 * Autonomously generates clinical preparation briefs before scheduled
 * appointments. Compiles structured data (fast, synchronous) then layers
 * a Azure OpenAI-written narrative on top (best-effort, async).
 *
 * The scheduler calls `checkAndGenerateBriefs()` every minute. When an
 * appointment is 25-35 minutes away and no brief exists yet, one is
 * compiled from the patient's profile, recent sessions, between-session
 * check-ins, assessments, and treatment plan, then stored in the
 * `session_briefs` table.
 *
 * Therapists can retrieve briefs via `getBrief()` (single) or
 * `getUpcomingBriefs()` (all of today's upcoming), and regenerate one
 * on demand via `regenerateBrief()`.
 */

'use strict';

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { clinicalReasoning } = require('../lib/aiExecutor');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning fallback on failure.
 */
function safeJsonParse(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Extract a compact list of items from a Plan section string.
 * Splits on newlines and list markers, trims empty entries.
 */
function extractPlanItems(planText) {
  if (!planText) return [];
  return planText
    .split(/[\n\r]+/)
    .map(line => line.replace(/^[\s\-*•\d.]+/, '').trim())
    .filter(item => item.length > 2);
}

/**
 * Determine the trend label from two numeric scores for a clinical measure.
 * Convention: for most symptom scales, lower is better (PHQ-9, GAD-7, PCL-5).
 * For functional scales (WHODAS, ORS), higher is better. We default to
 * lower-is-better since most templates in the codebase follow that pattern.
 */
function trendLabel(latest, previous) {
  if (latest == null || previous == null) return 'insufficient_data';
  if (latest < previous) return 'improving';
  if (latest > previous) return 'worsening';
  return 'stable';
}

/**
 * Start-of-day ISO string for a given Date in local time.
 */
function startOfDayISO(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Days between two ISO dates (latest first). Returns null if either is falsy.
 */
function daysBetween(laterIso, earlierIso) {
  if (!laterIso || !earlierIso) return null;
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Produce a short, readable summary of a session's Subjective section for
 * the narrative prompt. Truncates to ~180 chars, strips list markers.
 */
function summarizeSubjective(text) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 180 ? cleaned.slice(0, 177) + '…' : cleaned;
}

/**
 * End-of-day ISO string for a given Date in local time.
 */
function endOfDayISO(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// ─── Core: Generate a Single Brief ───────────────────────────────────────────

/**
 * Build and store a pre-session brief for one appointment.
 *
 * Steps:
 *   1. Load the appointment + patient profile
 *   2. Pull the last 3 session notes (Plan items are key)
 *   3. Pull the latest 3 assessments with trajectory
 *   4. Pull active treatment goals and progress
 *   5. Compile into a structured JSON brief
 *   6. Store in `session_briefs`
 *
 * @param {number} therapistId
 * @param {number} appointmentId
 * @param {object} options
 * @param {boolean} options.skipNarrative  — skip Azure OpenAI narrative (test mode / fast path)
 * @returns {Promise<{ briefId: number, brief: object }>} Stored brief ID + content
 */
async function generateBrief(therapistId, appointmentId, options = {}) {
  const db = getAsyncDb();

  // ── 1. Appointment + Patient Profile ────────────────────────────────────────

  const appointment = await db.get(
    `SELECT id, therapist_id, patient_id, client_code, appointment_type,
            scheduled_start, status
     FROM appointments
     WHERE id = ? AND therapist_id = ?`,
    appointmentId, therapistId
  );

  if (!appointment) {
    throw new Error(`Appointment ${appointmentId} not found for therapist ${therapistId}`);
  }

  const patient = await db.get(
    `SELECT id, client_id, display_name, presenting_concerns, diagnoses,
            risk_screening, treatment_goals
     FROM patients
     WHERE id = ? AND therapist_id = ?`,
    appointment.patient_id, therapistId
  );

  if (!patient) {
    throw new Error(`Patient ${appointment.patient_id} not found for therapist ${therapistId}`);
  }

  // ── 2. Last 3 Session Notes ─────────────────────────────────────────────────

  const recentSessions = await db.all(
    `SELECT id, session_date, note_format, subjective, objective,
            assessment, plan, signed_at
     FROM sessions
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY COALESCE(session_date, created_at) DESC
     LIMIT 3`,
    appointment.patient_id, therapistId
  );

  const lastSessionDate = recentSessions.length > 0
    ? recentSessions[0].session_date || null
    : null;

  // Extract key themes from Subjective and Assessment sections across sessions.
  // These are the presenting topics the client has been discussing.
  const keyThemes = [];
  const seenThemes = new Set();
  for (const session of recentSessions) {
    // Pull themes from the Subjective section (client's words / presenting issues)
    const subjectiveItems = extractPlanItems(session.subjective);
    for (const item of subjectiveItems.slice(0, 2)) {
      const normalized = item.toLowerCase().slice(0, 80);
      if (!seenThemes.has(normalized)) {
        seenThemes.add(normalized);
        keyThemes.push(item);
      }
    }
  }

  // Collect open / unresolved items from the Plan section of the most recent session.
  // These represent carry-forward action items the therapist intended to address.
  const openItems = recentSessions.length > 0
    ? extractPlanItems(recentSessions[0].plan)
    : [];

  // ── 2b. Between-Session Check-Ins ───────────────────────────────────────────
  // Pulls up to 5 completed check-ins, newest first. When a last session exists,
  // we only include check-ins completed AFTER it — those represent the signal
  // the therapist actually wants for this upcoming session (mid-week mood, what
  // the client said between visits). When no prior session exists, we include
  // the most recent 5 check-ins on record so the brief still has something useful.

  const lastSessionIso = lastSessionDate;
  let checkinRows;
  try {
    if (lastSessionIso) {
      checkinRows = await db.all(
        `SELECT mood_score, mood_notes, completed_at
         FROM checkin_links
         WHERE patient_id = ? AND therapist_id = ?
           AND completed_at IS NOT NULL
           AND completed_at > ?
         ORDER BY completed_at DESC
         LIMIT 5`,
        appointment.patient_id, therapistId, lastSessionIso
      );
    } else {
      checkinRows = await db.all(
        `SELECT mood_score, mood_notes, completed_at
         FROM checkin_links
         WHERE patient_id = ? AND therapist_id = ?
           AND completed_at IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT 5`,
        appointment.patient_id, therapistId
      );
    }
  } catch {
    checkinRows = [];
  }

  const checkins = checkinRows.map(r => ({
    mood_score: r.mood_score != null ? Number(r.mood_score) : null,
    mood_notes: (r.mood_notes || '').trim() || null,
    completed_at: r.completed_at,
  }));

  // Compute the average mood across returned check-ins (useful for narrative + trend).
  const moodValues = checkins.map(c => c.mood_score).filter(v => v != null);
  const avgMood = moodValues.length > 0
    ? Math.round((moodValues.reduce((a, b) => a + b, 0) / moodValues.length) * 10) / 10
    : null;

  // A "low mood signal" is any check-in at or below 2/5 — worth surfacing to the clinician.
  const lowMoodCheckins = checkins.filter(c => c.mood_score != null && c.mood_score <= 2);

  // ── 3. Latest 3 Assessments + Trajectory ────────────────────────────────────

  const recentAssessments = await db.all(
    `SELECT id, template_type, total_score, severity_level,
            is_improvement, is_deterioration, administered_at
     FROM assessments
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY administered_at DESC
     LIMIT 3`,
    appointment.patient_id, therapistId
  );

  // Build assessment trajectory grouped by template type (e.g. PHQ-9, GAD-7).
  // For each type we report the latest score, the previous score, and the trend.
  const assessmentTrajectory = {};
  const assessmentsByType = {};

  for (const a of recentAssessments) {
    const type = (a.template_type || 'unknown').toLowerCase();
    if (!assessmentsByType[type]) assessmentsByType[type] = [];
    assessmentsByType[type].push(a);
  }

  for (const [type, assessments] of Object.entries(assessmentsByType)) {
    const latest = assessments[0];
    const previous = assessments.length > 1 ? assessments[1] : null;

    assessmentTrajectory[type] = {
      latest: latest.total_score,
      severity: latest.severity_level || null,
      previous: previous ? previous.total_score : null,
      trend: previous
        ? trendLabel(latest.total_score, previous.total_score)
        : 'baseline',
      last_administered: latest.administered_at,
    };
  }

  // ── 4. Active Treatment Goals + Progress ────────────────────────────────────

  const treatmentGoals = [];

  // Find the active treatment plan for this patient
  const activePlan = await db.get(
    `SELECT id FROM treatment_plans
     WHERE patient_id = ? AND therapist_id = ? AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    appointment.patient_id, therapistId
  );

  if (activePlan) {
    const goals = await db.all(
      `SELECT goal_text, target_metric, baseline_value, current_value, status
       FROM treatment_goals
       WHERE plan_id = ? AND status IN ('active', 'in_progress')
       ORDER BY created_at ASC`,
      activePlan.id
    );

    for (const goal of goals) {
      // Build a human-readable progress string
      let progress = 'no data';
      if (goal.baseline_value != null && goal.current_value != null) {
        const pct = goal.baseline_value !== 0
          ? Math.round(((goal.baseline_value - goal.current_value) / goal.baseline_value) * 100)
          : 0;
        progress = `baseline ${goal.baseline_value} -> current ${goal.current_value}`;
        if (goal.target_metric) {
          progress += ` (${goal.target_metric})`;
        }
        if (pct > 0) {
          progress += ` — ${pct}% improvement`;
        } else if (pct < 0) {
          progress += ` — ${Math.abs(pct)}% worsening`;
        }
      } else if (goal.current_value != null) {
        progress = `current ${goal.current_value}`;
        if (goal.target_metric) progress += ` (${goal.target_metric})`;
      }

      treatmentGoals.push({
        goal: goal.goal_text,
        status: goal.status,
        progress,
      });
    }
  }

  // Also include treatment_goals from the patient profile if no plan exists
  // and the field is populated (legacy / intake-entered goals).
  if (treatmentGoals.length === 0 && patient.treatment_goals) {
    const legacyGoals = extractPlanItems(patient.treatment_goals);
    for (const g of legacyGoals) {
      treatmentGoals.push({ goal: g, status: 'active', progress: 'from intake' });
    }
  }

  // ── 5. Risk Flags ───────────────────────────────────────────────────────────

  const riskFlags = [];

  // From patient profile risk_screening field
  if (patient.risk_screening) {
    const screening = patient.risk_screening.trim();
    if (screening.length > 0 && screening.toLowerCase() !== 'none') {
      riskFlags.push(screening);
    }
  }

  // Check for elevated suicide-item scores on recent PHQ-9 assessments
  for (const a of recentAssessments) {
    if ((a.template_type || '').toLowerCase() === 'phq-9' && a.total_score >= 15) {
      riskFlags.push(`PHQ-9 score ${a.total_score} (${a.severity_level || 'elevated'}) on ${a.administered_at}`);
      break; // only flag once
    }
  }

  // Flag any worsening trajectory
  for (const [type, trajectory] of Object.entries(assessmentTrajectory)) {
    if (trajectory.trend === 'worsening') {
      riskFlags.push(`${type.toUpperCase()} worsening: ${trajectory.previous} -> ${trajectory.latest}`);
    }
  }

  // Flag any low mood signals from between-session check-ins
  if (lowMoodCheckins.length > 0) {
    const worst = lowMoodCheckins.reduce(
      (acc, c) => (acc == null || c.mood_score < acc.mood_score ? c : acc),
      null
    );
    if (worst) {
      riskFlags.push(
        `Low mood check-in: ${worst.mood_score}/5 on ${worst.completed_at?.slice(0, 10) || 'recent'}` +
        (worst.mood_notes ? ` — "${worst.mood_notes.slice(0, 60)}${worst.mood_notes.length > 60 ? '…' : ''}"` : '')
      );
    }
  }

  // ── 6. Suggested Focus Areas ────────────────────────────────────────────────
  // Heuristic suggestions based on available data. No AI involved.

  // Suggested focus items, ranked by clinical priority:
  // 1. Risk (most urgent), 2. Worsening scores, 3. Open items, 4. Improving scores, 5. First session
  // Treatment goals are NOT listed here — they're already in treatment_goals array.
  const suggestedFocus = [];

  // Priority 1: Risk flags
  if (riskFlags.length > 0) {
    suggestedFocus.push('Review safety plan and risk factors');
  }

  // Priority 2: Worsening assessment scores
  for (const [type, trajectory] of Object.entries(assessmentTrajectory)) {
    if (trajectory.trend === 'worsening') {
      suggestedFocus.push(`Address ${type.toUpperCase()} score increase (${trajectory.previous} -> ${trajectory.latest})`);
    }
  }

  // Priority 3: Low mood between sessions
  if (lowMoodCheckins.length > 0) {
    suggestedFocus.push(
      `Check on low mood signal${lowMoodCheckins.length === 1 ? '' : 's'} reported between sessions`
    );
  }

  // Priority 4: Open items from last session
  if (openItems.length > 0) {
    suggestedFocus.push(`Follow up on plan items from last session (${openItems.length} open)`);
  }

  // Priority 4: Improving scores (reinforce)
  for (const [type, trajectory] of Object.entries(assessmentTrajectory)) {
    if (trajectory.trend === 'improving') {
      suggestedFocus.push(`Reinforce progress on ${type.toUpperCase()} (${trajectory.previous} -> ${trajectory.latest})`);
    }
  }

  // Priority 5: First/early session
  if (recentSessions.length === 0) {
    suggestedFocus.push('First or early session — establish rapport and gather history');
  }

  // ── 7. Compile and Store ────────────────────────────────────────────────────

  const brief = {
    patient_name: patient.display_name || patient.client_id,
    patient_id: patient.id,
    appointment_type: appointment.appointment_type,
    scheduled_start: appointment.scheduled_start,
    last_session_date: lastSessionDate,
    days_since_last_session: daysBetween(new Date().toISOString(), lastSessionDate),
    key_themes: keyThemes.slice(0, 6),
    assessment_trajectory: assessmentTrajectory,
    risk_flags: riskFlags,
    open_items: openItems.slice(0, 8),
    treatment_goals: treatmentGoals.slice(0, 6),
    suggested_focus: suggestedFocus.slice(0, 4),
    checkins: checkins,
    avg_checkin_mood: avgMood,
    low_mood_checkin_count: lowMoodCheckins.length,
    sessions_reviewed: recentSessions.length,
    assessments_reviewed: recentAssessments.length,
    checkins_reviewed: checkins.length,
    narrative: null,           // filled below, best-effort
    narrative_status: 'pending',
    generated_at: new Date().toISOString(),
  };

  // ── 8. Azure OpenAI Narrative ─────────────────────────────────────────────────────
  // Synthesizes the structured data into a forward-looking 60-second spoken
  // brief. Runs best-effort — if the AI call fails or is disabled, the brief
  // is still stored with all the structured data.

  if (!options.skipNarrative) {
    try {
      const lastSubjective = recentSessions.length > 0
        ? summarizeSubjective(recentSessions[0].subjective)
        : '';
      const lastPlan = recentSessions.length > 0
        ? summarizeSubjective(recentSessions[0].plan)
        : '';
      const narrative = await generateNarrative({
        brief,
        lastSubjective,
        lastPlan,
        therapistId,
      });
      brief.narrative = narrative;
      brief.narrative_status = narrative ? 'ok' : 'empty';
    } catch (err) {
      console.warn(
        `[brief-generator] narrative generation failed for appt ${appointmentId}:`,
        err.message
      );
      brief.narrative = null;
      brief.narrative_status = 'error';
    }
  } else {
    brief.narrative_status = 'skipped';
  }

  const { lastInsertRowid } = await db.insert(
    `INSERT INTO session_briefs (therapist_id, patient_id, appointment_id, brief_json, status)
     VALUES (?, ?, ?, ?, 'generated')`,
    therapistId, appointment.patient_id, appointmentId, JSON.stringify(brief)
  );

  console.log(
    `[brief-generator] Brief created id=${lastInsertRowid} ` +
    `appointment=${appointmentId} patient=${patient.client_id} ` +
    `narrative=${brief.narrative_status}`
  );

  await persistIfNeeded();

  return { briefId: lastInsertRowid, brief };
}

// ─── Narrative Synthesis ─────────────────────────────────────────────────────

/**
 * Produce a 2-3 paragraph forward-looking narrative for a brief using Azure OpenAI.
 *
 * The tone is a trusted colleague murmuring in the therapist's ear on the walk
 * to the session: what you left off with, what changed between sessions, two
 * threads worth picking up today.
 *
 * Returns the narrative string, or empty string if generation produced nothing.
 */
async function generateNarrative({ brief, lastSubjective, lastPlan, therapistId }) {
  // Compose a compact, structured data packet for the model. Avoid dumping raw
  // fields blindly — each line is labeled so the model can reason about it.

  const lines = [];
  lines.push(`Client: ${brief.patient_name}`);
  lines.push(`Session type: ${brief.appointment_type || 'individual'}`);

  if (brief.last_session_date) {
    const days = brief.days_since_last_session;
    lines.push(
      `Last session: ${brief.last_session_date.slice(0, 10)}` +
      (days != null ? ` (${days} day${days === 1 ? '' : 's'} ago)` : '')
    );
  } else {
    lines.push('Last session: none on record (first session or early episode)');
  }

  if (lastSubjective) lines.push(`Last subjective: ${lastSubjective}`);
  if (lastPlan)       lines.push(`Last plan: ${lastPlan}`);

  if (brief.key_themes.length > 0) {
    lines.push(`Recent themes: ${brief.key_themes.slice(0, 4).join(' | ')}`);
  }

  if (brief.open_items.length > 0) {
    lines.push(`Open items from last plan: ${brief.open_items.slice(0, 4).join(' | ')}`);
  }

  if (brief.checkins.length > 0) {
    const cs = brief.checkins.slice(0, 4).map(c => {
      const date = c.completed_at?.slice(0, 10) || 'recent';
      const mood = c.mood_score != null ? `${c.mood_score}/5` : 'no score';
      const note = c.mood_notes ? ` — "${c.mood_notes.slice(0, 80)}"` : '';
      return `[${date}] mood ${mood}${note}`;
    });
    lines.push(`Between-session check-ins (newest first): ${cs.join(' || ')}`);
    if (brief.avg_checkin_mood != null) {
      lines.push(`Avg check-in mood: ${brief.avg_checkin_mood}/5`);
    }
  } else {
    lines.push('Between-session check-ins: none on record');
  }

  if (Object.keys(brief.assessment_trajectory).length > 0) {
    const at = Object.entries(brief.assessment_trajectory).map(([type, t]) => {
      const prev = t.previous != null ? t.previous : '—';
      return `${type.toUpperCase()} ${prev}→${t.latest} (${t.trend})`;
    });
    lines.push(`Assessment trajectory: ${at.join(' | ')}`);
  }

  if (brief.risk_flags.length > 0) {
    lines.push(`Risk flags: ${brief.risk_flags.slice(0, 3).join(' | ')}`);
  }

  if (brief.treatment_goals.length > 0) {
    lines.push(
      `Active goals: ${brief.treatment_goals.slice(0, 3).map(g => g.goal).join(' | ')}`
    );
  }

  const dataPacket = lines.join('\n');

  const systemPrompt = `You are Miwa, a clinical documentation co-pilot for a licensed mental health therapist.

You are writing a forward-looking 60-second pre-session brief. The therapist is about to walk into a session in roughly 30 minutes and will read this in the hallway.

Tone: a trusted clinical colleague murmuring in the therapist's ear. Conversational, confident, clinically precise. No headers, no bullet points, no markdown — flowing prose.

Structure (flexible — drop paragraphs if data is thin):
  1. Recap the last session and what was carried forward.
  2. What changed between sessions — check-ins, assessment shifts, risk signals.
  3. Two specific threads worth picking up today, OR a single clinically grounded suggestion if the data only supports one.

Rules:
  • NEVER invent details that aren't in the provided data. If data is thin, say so briefly ("First session with this client — no prior context").
  • Refer to the client by first name or "them" — never "the patient" or "the client" in prose.
  • Speak in the therapist's voice ("you left off with…", "her mid-week check-in…"). Don't narrate yourself.
  • Hard cap: under 170 words. The therapist is walking — they can't read a paragraph.
  • If assessment scores shifted, name the instrument and both scores ("PHQ-9 went from 12 to 16").
  • If there's a risk signal, surface it early and explicitly — don't bury it.
  • Do not sign off, do not add caveats, do not use emoji.`;

  const userPrompt =
    `Structured pre-session data:\n\n${dataPacket}\n\n` +
    `Write the 60-second pre-session brief now.`;

  const text = await clinicalReasoning(
    systemPrompt,
    userPrompt,
    650,   // max tokens — ~170 words leaves comfortable headroom
    false, // no Opus escalation for briefs; speed matters
    { therapistId, kind: 'pre_session_brief', skipBudgetCheck: false }
  );

  return (text || '').trim();
}

// ─── Scheduler Hook: Check and Generate Briefs ──────────────────────────────

/**
 * Runs on each scheduler tick (typically every minute).
 *
 * Finds appointments starting in the 25-35 minute window from now that
 * do not already have a brief, and generates one for each.
 *
 * The window is intentionally narrow (10 minutes wide) so:
 *   - Brief is ready well before the session starts
 *   - We don't generate too early (data might still change)
 *   - On a 1-minute tick cycle, each appointment falls in the window
 *     ~10 times, but the duplicate check prevents re-generation
 *
 * @returns {Promise<number>} Count of briefs generated this tick
 */
async function checkAndGenerateBriefs() {
  let db;
  try {
    db = getAsyncDb();
  } catch {
    return 0; // DB not initialized yet
  }

  const now = new Date();

  // Window: 25 to 35 minutes from now
  const windowStart = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 35 * 60 * 1000).toISOString();

  // Find appointments in the window that don't already have a brief
  let upcoming;
  try {
    upcoming = await db.all(
      `SELECT a.id AS appointment_id, a.therapist_id
       FROM appointments a
       WHERE a.scheduled_start >= ?
         AND a.scheduled_start <= ?
         AND a.status IN ('scheduled', 'confirmed')
         AND NOT EXISTS (
           SELECT 1 FROM session_briefs sb
           WHERE sb.appointment_id = a.id
         )
       ORDER BY a.scheduled_start ASC`,
      windowStart, windowEnd
    );
  } catch (err) {
    console.error('[brief-generator] Query error:', err.message);
    return 0;
  }

  if (!upcoming.length) return 0;

  let generated = 0;

  for (const appt of upcoming) {
    try {
      await generateBrief(appt.therapist_id, appt.appointment_id);
      generated++;
    } catch (err) {
      console.error(
        `[brief-generator] Failed for appointment ${appt.appointment_id}:`,
        err.message
      );
    }
  }

  if (generated > 0) {
    console.log(`[brief-generator] Generated ${generated} brief(s) this tick`);
    await persistIfNeeded();
  }

  return generated;
}

// ─── Retrieval: Single Brief ─────────────────────────────────────────────────

/**
 * Fetch a brief by ID and mark it as viewed.
 *
 * @param {number} briefId
 * @param {number} therapistId  — ownership check
 * @returns {object|null} The brief record with parsed brief_json, or null
 */
async function getBrief(briefId, therapistId) {
  const db = getAsyncDb();

  const row = await db.get(
    `SELECT id, therapist_id, patient_id, appointment_id,
            brief_json, status, viewed_at, created_at
     FROM session_briefs
     WHERE id = ? AND therapist_id = ?`,
    briefId, therapistId
  );

  if (!row) return null;

  // Mark as viewed on first access
  if (!row.viewed_at) {
    await db.run(
      `UPDATE session_briefs
       SET viewed_at = ?, status = 'viewed'
       WHERE id = ?`,
      new Date().toISOString(), briefId
    );
  }

  return {
    id: row.id,
    therapist_id: row.therapist_id,
    patient_id: row.patient_id,
    appointment_id: row.appointment_id,
    brief: safeJsonParse(row.brief_json, {}),
    status: row.viewed_at ? 'viewed' : row.status,
    viewed_at: row.viewed_at || new Date().toISOString(),
    created_at: row.created_at,
  };
}

// ─── Retrieval: Today's Upcoming Briefs ──────────────────────────────────────

/**
 * Get all briefs for a therapist's upcoming appointments today.
 * Returns briefs ordered by appointment start time, enriched with
 * appointment details for display.
 *
 * @param {number} therapistId
 * @returns {object[]} Array of brief summaries
 */
async function getUpcomingBriefs(therapistId) {
  const db = getAsyncDb();

  const now = new Date();
  const todayStart = startOfDayISO(now);
  const todayEnd = endOfDayISO(now);

  const rows = await db.all(
    `SELECT sb.id, sb.patient_id, sb.appointment_id,
            sb.brief_json, sb.status, sb.viewed_at, sb.created_at,
            a.scheduled_start, a.scheduled_end, a.appointment_type, a.status AS appt_status,
            p.display_name, p.client_id
     FROM session_briefs sb
     JOIN appointments a ON a.id = sb.appointment_id
     JOIN patients p ON p.id = sb.patient_id
     WHERE sb.therapist_id = ?
       AND a.scheduled_start >= ?
       AND a.scheduled_start <= ?
       AND a.status IN ('scheduled', 'confirmed')
     ORDER BY a.scheduled_start ASC`,
    therapistId, todayStart, todayEnd
  );

  return rows.map(row => {
    const brief = safeJsonParse(row.brief_json, {});
    return {
      id: row.id,
      patient_id: row.patient_id,
      patient_name: brief.patient_name || row.display_name || row.client_id,
      appointment_id: row.appointment_id,
      appointment_type: row.appointment_type,
      scheduled_start: row.scheduled_start,
      scheduled_end: row.scheduled_end,
      status: row.status,
      viewed_at: row.viewed_at,
      created_at: row.created_at,
      // Full brief body — small list (at most today's sessions), fine to include
      // inline so the narrative is available immediately without a second fetch.
      brief,
      // Convenience summary fields for collapsed cards
      risk_flag_count: (brief.risk_flags || []).length,
      open_item_count: (brief.open_items || []).length,
      active_goal_count: (brief.treatment_goals || []).length,
      checkin_count: (brief.checkins || []).length,
      has_worsening: Object.values(brief.assessment_trajectory || {})
        .some(t => t.trend === 'worsening'),
      suggested_focus: (brief.suggested_focus || []).slice(0, 2),
    };
  });
}

// ─── Regenerate ──────────────────────────────────────────────────────────────

/**
 * Delete any existing brief for this appointment and build a fresh one.
 * Used for the "Refresh brief" action in the UI after a therapist has
 * added a check-in, scored an assessment, or edited the last note.
 *
 * @param {number} therapistId
 * @param {number} appointmentId
 * @returns {Promise<{ briefId: number, brief: object }>}
 */
async function regenerateBrief(therapistId, appointmentId) {
  const db = getAsyncDb();

  // Ownership check first — don't delete another therapist's briefs
  const appt = await db.get(
    'SELECT id FROM appointments WHERE id = ? AND therapist_id = ?',
    appointmentId, therapistId
  );
  if (!appt) throw new Error('Appointment not found');

  await db.run(
    'DELETE FROM session_briefs WHERE appointment_id = ? AND therapist_id = ?',
    appointmentId, therapistId
  );

  const result = await generateBrief(therapistId, appointmentId);
  await persistIfNeeded();
  return result;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  generateBrief,
  regenerateBrief,
  checkAndGenerateBriefs,
  getBrief,
  getUpcomingBriefs,
};
