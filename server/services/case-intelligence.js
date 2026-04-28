function toText(value) {
  return String(value || '').trim();
}

function compact(value, max = 220) {
  const text = toText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function daysSince(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((Date.now() - time) / 86400000);
}

function dateOnly(value) {
  if (!value) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  return time.toISOString().slice(0, 10);
}

function riskTextFromSession(session) {
  if (!session) return '';
  return [
    session.subjective,
    session.objective,
    session.assessment,
    session.plan,
    session.ai_feedback,
    session.notes_json,
  ].map(toText).join(' ');
}

function getLatestAssessmentByType(assessments) {
  const latest = {};
  for (const item of assessments) {
    latest[item.template_type] = item;
  }
  return latest;
}

function classifyRisk({ patient, sessions, assessments, alerts }) {
  const riskKeywords = /\b(suicid|homicid|self[-\s]?harm|kill myself|kill themselves|harm others|abuse|strangulation|weapon|danger|safety plan|mandated report)\b/i;
  const acuteKeywords = /\b(active suicid|active homicid|intent|plan to kill|imminent|weapon|strangulation|cannot contract|mandated report)\b/i;

  const flags = [];
  const latestSession = sessions[0];
  const latestSessionText = riskTextFromSession(latestSession);
  const patientRiskText = toText(patient.risk_screening);

  if (acuteKeywords.test(latestSessionText)) {
    flags.push({
      source: 'session',
      severity: 'acute',
      title: 'Acute risk language in recent note',
      detail: compact(latestSession.assessment || latestSession.plan || latestSessionText, 180),
    });
  } else if (riskKeywords.test(latestSessionText)) {
    flags.push({
      source: 'session',
      severity: 'elevated',
      title: 'Risk language in recent note',
      detail: compact(latestSession.assessment || latestSession.plan || latestSessionText, 180),
    });
  }

  if (riskKeywords.test(patientRiskText)) {
    flags.push({
      source: 'profile',
      severity: 'watch',
      title: 'Risk noted in intake profile',
      detail: compact(patientRiskText, 180),
    });
  }

  for (const assessment of assessments.slice(-6)) {
    const riskFlags = parseJson(assessment.risk_flags, assessment.risk_flags || null);
    const totalScore = Number(assessment.total_score);
    if (riskFlags && String(JSON.stringify(riskFlags)).length > 2) {
      flags.push({
        source: 'assessment',
        severity: 'elevated',
        title: `${assessment.template_type} risk flag`,
        detail: compact(typeof riskFlags === 'string' ? riskFlags : JSON.stringify(riskFlags), 180),
        date: dateOnly(assessment.administered_at || assessment.created_at),
      });
    }
    if (/phq/i.test(assessment.template_type || '') && totalScore >= 20) {
      flags.push({
        source: 'assessment',
        severity: 'elevated',
        title: 'Severe PHQ score',
        detail: `Latest ${assessment.template_type} score is ${totalScore}.`,
        date: dateOnly(assessment.administered_at || assessment.created_at),
      });
    }
    if (Number(assessment.is_deterioration) === 1 && Math.abs(Number(assessment.score_change || 0)) >= 5) {
      flags.push({
        source: 'assessment',
        severity: 'watch',
        title: `${assessment.template_type} deterioration`,
        detail: `Score changed by ${assessment.score_change}.`,
        date: dateOnly(assessment.administered_at || assessment.created_at),
      });
    }
  }

  for (const alert of alerts) {
    if (['CRITICAL', 'HIGH'].includes(String(alert.severity || '').toUpperCase())) {
      flags.push({
        source: 'alert',
        severity: String(alert.severity).toLowerCase() === 'critical' ? 'acute' : 'elevated',
        title: alert.title,
        detail: compact(alert.description, 180),
        date: dateOnly(alert.created_at),
      });
    }
  }

  const hasAcute = flags.some(flag => flag.severity === 'acute');
  const hasElevated = flags.some(flag => flag.severity === 'elevated');
  const hasWatch = flags.length > 0;
  return {
    level: hasAcute ? 'acute' : hasElevated ? 'elevated' : hasWatch ? 'watch' : 'none',
    flags,
  };
}

function summarizeTreatmentPlan(plan, goals) {
  if (!plan) {
    return {
      status: 'missing',
      active: false,
      stale: false,
      plan_id: null,
      goals: [],
      summary: '',
      last_reviewed_at: null,
    };
  }

  const reviewedAt = plan.last_reviewed_at || plan.created_at;
  const stale = daysSince(reviewedAt) !== null && daysSince(reviewedAt) > 90;
  return {
    status: stale ? 'stale' : 'active',
    active: true,
    stale,
    plan_id: plan.id,
    goals: goals.map(goal => ({
      id: goal.id,
      text: goal.goal_text,
      status: goal.status || 'active',
      target_metric: goal.target_metric || null,
      current_value: goal.current_value ?? null,
      baseline_value: goal.baseline_value ?? null,
    })),
    summary: compact(plan.summary, 300),
    last_reviewed_at: reviewedAt || null,
  };
}

function buildGaps({ patient, sessions, assessments, treatmentPlan, risk }) {
  const gaps = [];
  const latestSession = sessions[0];
  const lastAssessment = assessments[assessments.length - 1];

  if (!toText(patient.diagnoses) && sessions.length > 0) {
    gaps.push({
      id: 'diagnosis_missing',
      severity: 'medium',
      title: 'Diagnosis is not documented',
      detail: 'This chart has session activity but no diagnosis/provisional diagnosis recorded.',
      action: 'Add a provisional diagnosis or document why diagnosis is deferred.',
    });
  }

  if (!treatmentPlan.active) {
    gaps.push({
      id: 'treatment_plan_missing',
      severity: sessions.length > 0 ? 'high' : 'medium',
      title: 'Treatment plan is missing',
      detail: 'Miwa cannot connect sessions, goals, and progress until an active treatment plan exists.',
      action: 'Create a treatment plan with measurable goals.',
    });
  } else if (treatmentPlan.stale) {
    gaps.push({
      id: 'treatment_plan_stale',
      severity: 'medium',
      title: 'Treatment plan needs review',
      detail: 'The active plan has not been reviewed in over 90 days.',
      action: 'Review goals and update progress before the next session.',
    });
  }

  if (!lastAssessment) {
    gaps.push({
      id: 'baseline_assessment_missing',
      severity: 'medium',
      title: 'No baseline assessment',
      detail: 'No completed PHQ, GAD, or custom assessment is attached to this chart.',
      action: 'Send a baseline screener or document why measurement is not indicated.',
    });
  } else if (daysSince(lastAssessment.administered_at || lastAssessment.created_at) > 30) {
    gaps.push({
      id: 'assessment_stale',
      severity: 'low',
      title: 'Assessment is stale',
      detail: `Last assessment was ${daysSince(lastAssessment.administered_at || lastAssessment.created_at)} days ago.`,
      action: 'Send an updated screener before or after the next session.',
    });
  }

  const unsignedCount = sessions.filter(session => !session.signed_at).length;
  if (unsignedCount > 0) {
    gaps.push({
      id: 'unsigned_notes',
      severity: unsignedCount > 2 ? 'high' : 'medium',
      title: `${unsignedCount} unsigned note${unsignedCount === 1 ? '' : 's'}`,
      detail: 'Unsigned notes increase documentation and compliance risk.',
      action: 'Review and sign outstanding notes.',
    });
  }

  if (['elevated', 'acute'].includes(risk.level)) {
    const latestPlanText = toText(latestSession?.plan);
    if (!/\b(safety|crisis|means|hotline|emergency|protective|coping)\b/i.test(latestPlanText)) {
      gaps.push({
        id: 'risk_followup_missing',
        severity: risk.level === 'acute' ? 'high' : 'medium',
        title: 'Risk follow-up needs clearer documentation',
        detail: 'Recent chart data contains risk signals, but the latest plan does not clearly document safety follow-up.',
        action: 'Document safety assessment, protective factors, and follow-up plan.',
      });
    }
  }

  return gaps;
}

function buildEvidence({ sessions, assessments, alerts, treatmentPlan, risk }) {
  const evidence = [];
  const latestSession = sessions[0];
  if (latestSession) {
    evidence.push({
      type: 'session',
      label: `Latest session ${dateOnly(latestSession.session_date || latestSession.created_at) || ''}`.trim(),
      detail: compact(latestSession.assessment || latestSession.subjective || latestSession.plan || 'Session note exists.', 220),
      severity: 'info',
    });
  }

  const latestByType = getLatestAssessmentByType(assessments);
  for (const assessment of Object.values(latestByType).slice(0, 4)) {
    evidence.push({
      type: 'assessment',
      label: assessment.template_type,
      detail: [
        assessment.total_score !== null && assessment.total_score !== undefined ? `Score ${assessment.total_score}` : null,
        assessment.severity_level || null,
        Number(assessment.is_deterioration) === 1 ? 'deteriorating' : null,
      ].filter(Boolean).join(' - ') || 'Completed assessment',
      date: dateOnly(assessment.administered_at || assessment.created_at),
      severity: Number(assessment.is_deterioration) === 1 ? 'warning' : 'info',
    });
  }

  if (treatmentPlan.active) {
    evidence.push({
      type: 'treatment_plan',
      label: `${treatmentPlan.goals.length} active treatment goal${treatmentPlan.goals.length === 1 ? '' : 's'}`,
      detail: treatmentPlan.summary || compact(treatmentPlan.goals.map(goal => goal.text).join('; '), 220),
      severity: treatmentPlan.stale ? 'warning' : 'info',
    });
  }

  for (const flag of risk.flags.slice(0, 3)) {
    evidence.push({
      type: flag.source,
      label: flag.title,
      detail: flag.detail,
      date: flag.date || null,
      severity: flag.severity,
    });
  }

  for (const alert of alerts.slice(0, 2)) {
    evidence.push({
      type: 'alert',
      label: alert.title,
      detail: compact(alert.description, 220),
      date: dateOnly(alert.created_at),
      severity: String(alert.severity || 'info').toLowerCase(),
    });
  }

  return evidence.slice(0, 8);
}

function buildNextSessionFocus({ patient, latestSession, treatmentPlan, risk, latestAssessments }) {
  const focus = [];
  if (['elevated', 'acute'].includes(risk.level)) {
    focus.push('Begin with risk check-in, protective factors, and safety follow-up.');
  }

  const worsening = latestAssessments.find(item => Number(item.is_deterioration) === 1);
  if (worsening) {
    focus.push(`Review ${worsening.template_type} change and ask what shifted since the last measure.`);
  }

  const activeGoal = treatmentPlan.goals.find(goal => goal.status === 'active');
  if (activeGoal) {
    focus.push(`Connect interventions to active goal: ${compact(activeGoal.text, 110)}`);
  } else if (toText(patient.treatment_goals)) {
    focus.push(`Clarify initial goal: ${compact(patient.treatment_goals, 120)}`);
  }

  if (latestSession?.plan) {
    focus.push(`Follow up on prior plan: ${compact(latestSession.plan, 130)}`);
  }

  if (!focus.length && patient.presenting_concerns) {
    focus.push(`Revisit presenting concern: ${compact(patient.presenting_concerns, 130)}`);
  }

  if (!focus.length) {
    focus.push('Complete intake picture and define the first measurable treatment target.');
  }

  return focus.slice(0, 4);
}

function buildNextActions(gaps, risk) {
  const actions = gaps.slice(0, 5).map(gap => ({
    id: gap.id,
    label: gap.action,
    priority: gap.severity,
  }));

  if (risk.level === 'none' && !actions.length) {
    actions.push({
      id: 'continue_measurement',
      label: 'Continue measurement-based care and update the plan as sessions progress.',
      priority: 'low',
    });
  }

  return actions;
}

async function buildCaseIntelligence(db, therapistId, patientId) {
  const patient = await db.get(
    'SELECT * FROM patients WHERE id = ? AND therapist_id = ?',
    patientId,
    therapistId
  );
  if (!patient) return null;

  const sessions = await db.all(
    `SELECT id, patient_id, therapist_id, session_date, note_format, subjective, objective,
            assessment, plan, icd10_codes, ai_feedback, notes_json, treatment_plan,
            signed_at, created_at
       FROM sessions
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY session_date DESC, created_at DESC, id DESC
       LIMIT 12`,
    patientId,
    therapistId
  );

  const assessments = await db.all(
    `SELECT id, template_type, administered_at, total_score, severity_level,
            score_change, is_improvement, is_deterioration, risk_flags, created_at
       FROM assessments
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY COALESCE(administered_at, created_at) ASC, id ASC`,
    patientId,
    therapistId
  );

  const plan = await db.get(
    `SELECT id, patient_id, therapist_id, status, summary, created_at, last_reviewed_at
       FROM treatment_plans
       WHERE patient_id = ? AND therapist_id = ? AND status = 'active'
       ORDER BY COALESCE(last_reviewed_at, created_at) DESC, id DESC
       LIMIT 1`,
    patientId,
    therapistId
  );

  const goals = plan
    ? await db.all(
        `SELECT id, plan_id, goal_text, target_metric, baseline_value, current_value,
                status, created_at, met_at, revised_at
           FROM treatment_goals
           WHERE plan_id = ?
           ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id ASC`,
        plan.id
      )
    : [];

  const alerts = await db.all(
    `SELECT id, type, severity, title, description, is_read, dismissed_at, created_at
       FROM progress_alerts
       WHERE patient_id = ? AND therapist_id = ? AND dismissed_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 10`,
    patientId,
    therapistId
  );

  const nextAppointment = await db.get(
    `SELECT id, appointment_type, scheduled_start, scheduled_end, location, status
       FROM appointments
       WHERE patient_id = ? AND therapist_id = ? AND COALESCE(status, 'scheduled') != 'cancelled'
       ORDER BY scheduled_start ASC, id ASC
       LIMIT 1`,
    patientId,
    therapistId
  );

  const treatmentPlan = summarizeTreatmentPlan(plan, goals);
  const risk = classifyRisk({ patient, sessions, assessments, alerts });
  const gaps = buildGaps({ patient, sessions, assessments, treatmentPlan, risk });
  const evidence = buildEvidence({ sessions, assessments, alerts, treatmentPlan, risk });
  const latestAssessments = Object.values(getLatestAssessmentByType(assessments));
  const nextSessionFocus = buildNextSessionFocus({
    patient,
    latestSession: sessions[0],
    treatmentPlan,
    risk,
    latestAssessments,
  });

  const highGap = gaps.some(gap => gap.severity === 'high');
  const treatmentPlanStatus = treatmentPlan.status;

  return {
    patient: {
      id: patient.id,
      client_id: patient.client_id,
      first_name: patient.first_name || null,
      last_name: patient.last_name || null,
      display_name: patient.display_name || patient.client_id,
      client_type: patient.client_type || 'individual',
      status: patient.status || 'active',
    },
    status: {
      risk_level: risk.level,
      documentation_readiness: highGap ? 'needs_review' : 'ready',
      treatment_plan_status: treatmentPlanStatus,
      next_session_focus: nextSessionFocus,
    },
    risk,
    treatment_plan: treatmentPlan,
    sessions: {
      count: sessions.length,
      unsigned_count: sessions.filter(session => !session.signed_at).length,
      latest: sessions[0] ? {
        id: sessions[0].id,
        session_date: sessions[0].session_date,
        note_format: sessions[0].note_format,
        assessment: compact(sessions[0].assessment, 220),
        plan: compact(sessions[0].plan, 220),
      } : null,
    },
    assessments: {
      count: assessments.length,
      latest: latestAssessments.map(item => ({
        id: item.id,
        template_type: item.template_type,
        total_score: item.total_score,
        severity_level: item.severity_level,
        score_change: item.score_change,
        is_deterioration: Number(item.is_deterioration) === 1,
        administered_at: item.administered_at || item.created_at,
      })),
    },
    next_appointment: nextAppointment || null,
    gaps,
    evidence,
    next_actions: buildNextActions(gaps, risk),
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildCaseIntelligence,
};
