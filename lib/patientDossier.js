/**
 * Patient Dossier — QMD-style markdown context bundle.
 *
 * Returns a compact, everything-you-need-to-know markdown document for a
 * single patient. Injected into Miwa's system prompt whenever a patient
 * is in focus (URL context, chat context, or mentioned by name).
 *
 * This replaces the "5 tool calls to remember who this person is" pattern
 * with a zero-tool-call, pre-loaded dossier.
 *
 * Design goals:
 *  - Everything PHI-scrubbed (uses lib/scrubber)
 *  - Dense but scannable — targets ~600-900 tokens
 *  - Sections the AI can reference by heading
 *  - Includes assessment TRAJECTORIES (not just latest)
 *  - Surfaces treatment plan status + open goals
 *  - Recent 3 sessions (assessment + plan snippets only, NOT full notes)
 *  - Upcoming appointments
 *  - Open alerts (risk, stagnation, etc.)
 *
 * Safe to call with a non-existent patient — returns null.
 */

const { scrubText } = require('./scrubber');

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toISOString().slice(0, 10); } catch { return s; }
}

function buildTrajectory(assessments, type) {
  // Filter to one type, keep chronological, cap to 8 most recent so line stays short
  const pts = assessments
    .filter(a => (a.template_type || '').toLowerCase() === type.toLowerCase())
    .slice(-8);
  if (pts.length === 0) return null;
  const scores = pts.map(a => `${a.total_score}`).join('→');
  const first = pts[0];
  const last = pts[pts.length - 1];
  const delta = last.total_score - first.total_score;
  const direction = delta < 0 ? '↓ improving' : delta > 0 ? '↑ worsening' : '— stable';
  return {
    line: `${type.toUpperCase()}: ${scores}  (baseline ${first.total_score} → latest ${last.total_score}, ${direction} ${Math.abs(delta)} pts, ${pts.length} assessments)`,
    latest: last,
    baseline: first,
    n: pts.length,
  };
}

function sessionSnippet(s) {
  const date = fmtDate(s.session_date || s.created_at);
  const assessment = (s.assessment || '').toString().slice(0, 240).trim();
  const plan = (s.plan || '').toString().slice(0, 160).trim();
  const lines = [`**${date}** (${s.note_format || 'note'})`];
  if (assessment) lines.push(`  - A: ${scrubText(assessment)}`);
  if (plan) lines.push(`  - P: ${scrubText(plan)}`);
  return lines.join('\n');
}

/**
 * Build a rich markdown dossier for a single patient.
 * Returns null if patient not found / not owned by therapist.
 */
function buildPatientDossier(db, therapistId, patientId) {
  const patient = db.get(
    `SELECT id, client_id, display_name, age, age_range, gender, client_type,
            presenting_concerns, diagnoses, risk_screening, treatment_goals,
            medications, medical_history, session_modality, session_duration,
            created_at, phone
       FROM patients WHERE id = ? AND therapist_id = ?`,
    patientId, therapistId
  );
  if (!patient) return null;

  // Sessions — all of them, but only recent 3 get detail
  const sessions = db.all(
    `SELECT id, session_date, note_format, assessment, plan, icd10_codes, signed_at, created_at
       FROM sessions WHERE patient_id = ? AND therapist_id = ?
       ORDER BY COALESCE(session_date, created_at) ASC`,
    patientId, therapistId
  );

  // Assessments — all, for trajectory calc
  const assessments = db.all(
    `SELECT id, template_type, total_score, severity_level, administered_at,
            is_improvement, is_deterioration, baseline_score
       FROM assessments WHERE patient_id = ? AND therapist_id = ?
       ORDER BY administered_at ASC`,
    patientId, therapistId
  );

  // Treatment plan + goals
  const plan = db.get(
    `SELECT id, status, last_reviewed_at, created_at FROM treatment_plans
       WHERE patient_id = ? AND therapist_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
    patientId, therapistId
  );
  const goals = plan ? db.all(
    `SELECT goal_text, target_metric, status, current_value, baseline_value
       FROM treatment_goals WHERE plan_id = ?
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'revised' THEN 1 WHEN 'met' THEN 2 ELSE 3 END, id ASC`,
    plan.id
  ) : [];

  // Upcoming appointments (next 2)
  const upcoming = db.all(
    `SELECT scheduled_start, appointment_type, duration_minutes, status FROM appointments
       WHERE patient_id = ? AND therapist_id = ? AND scheduled_start IS NOT NULL
         AND status != 'cancelled' AND scheduled_start > datetime('now')
       ORDER BY scheduled_start ASC LIMIT 2`,
    patientId, therapistId
  );

  // Open (undismissed) alerts
  const alerts = db.all(
    `SELECT type, severity, title, description, created_at FROM progress_alerts
       WHERE patient_id = ? AND therapist_id = ? AND dismissed_at IS NULL
       ORDER BY created_at DESC LIMIT 5`,
    patientId, therapistId
  );

  // ── Assemble markdown ──────────────────────────────────────────────────
  const md = [];

  md.push(`# Patient Dossier — ${patient.client_id}`);

  // Profile
  md.push('## Profile');
  const profileBits = [
    patient.age ? `${patient.age} y/o` : patient.age_range,
    patient.gender,
    patient.client_type || 'individual',
    patient.session_modality,
  ].filter(Boolean).join(' · ');
  if (profileBits) md.push(`- ${profileBits}`);
  if (patient.presenting_concerns) {
    md.push(`- **Presenting concerns:** ${scrubText(patient.presenting_concerns).slice(0, 400)}`);
  }
  if (patient.diagnoses) {
    md.push(`- **Current diagnoses:** ${scrubText(patient.diagnoses).slice(0, 300)}`);
  }
  if (patient.medications) {
    md.push(`- **Medications:** ${scrubText(patient.medications).slice(0, 200)}`);
  }
  if (patient.risk_screening) {
    md.push(`- **Risk screening:** ${scrubText(patient.risk_screening).slice(0, 200)}`);
  }

  // Assessment trajectories
  const phq = buildTrajectory(assessments, 'phq-9') || buildTrajectory(assessments, 'phq9');
  const gad = buildTrajectory(assessments, 'gad-7') || buildTrajectory(assessments, 'gad7');
  const pcl = buildTrajectory(assessments, 'pcl-5') || buildTrajectory(assessments, 'pcl5');
  if (phq || gad || pcl) {
    md.push('## Assessment Trajectories');
    if (phq) md.push(`- ${phq.line}`);
    if (gad) md.push(`- ${gad.line}`);
    if (pcl) md.push(`- ${pcl.line}`);
  } else {
    md.push('## Assessment Trajectories');
    md.push('- *No assessments completed yet.*');
  }

  // Treatment plan
  if (plan && goals.length > 0) {
    md.push('## Treatment Plan');
    md.push(`- Active plan created ${fmtDate(plan.created_at)}${plan.last_reviewed_at ? `, last reviewed ${fmtDate(plan.last_reviewed_at)}` : ''}`);
    for (const g of goals.slice(0, 6)) {
      const status = g.status || 'active';
      const progress = g.target_metric ? ` (target: ${g.target_metric}${g.current_value !== null && g.current_value !== undefined ? `, current: ${g.current_value}` : ''})` : '';
      md.push(`- [${status}] ${scrubText(g.goal_text || '').slice(0, 160)}${progress}`);
    }
  }

  // Recent sessions (last 3)
  if (sessions.length > 0) {
    md.push('## Recent Sessions');
    md.push(`*${sessions.length} total sessions on record*`);
    for (const s of sessions.slice(-3).reverse()) {
      md.push(sessionSnippet(s));
    }
  }

  // Upcoming
  if (upcoming.length > 0) {
    md.push('## Upcoming Appointments');
    for (const a of upcoming) {
      md.push(`- ${fmtDate(a.scheduled_start)} · ${a.appointment_type || 'session'} · ${a.duration_minutes || 50} min`);
    }
  }

  // Open alerts
  if (alerts.length > 0) {
    md.push('## Open Alerts');
    for (const a of alerts) {
      const icon = a.severity === 'CRITICAL' ? '🚨' : a.severity === 'WARNING' ? '⚠️' : a.severity === 'SUCCESS' ? '✅' : '·';
      md.push(`- ${icon} **${a.title}** — ${(a.description || '').slice(0, 160)}`);
    }
  }

  return md.join('\n');
}

module.exports = { buildPatientDossier };
