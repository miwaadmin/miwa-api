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

module.exports = async function createTreatmentPlanHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  
  // Check if plan already exists
  const existing = await db.get("SELECT id FROM treatment_plans WHERE patient_id = ? AND therapist_id = ? AND status = 'active'", patient.id, therapistId);
  if (existing) return { error: `Client already has an active treatment plan (ID: ${existing.id}). Use get_treatment_plan to view it or update goals individually.` };
  
  let goals = args.goals || [];
  if (!goals.length) {
    // Auto-generate goals from patient profile
    const concerns = (patient.presenting_concerns || '').toLowerCase();
    const diagnoses = (patient.diagnoses || '').toLowerCase();
    if (/\bdepress/i.test(concerns) || /\bf32\b/i.test(diagnoses) || /\bf33\b/i.test(diagnoses)) {
      goals.push({ goal_text: 'Reduce depressive symptoms to mild range', target_metric: 'PHQ-9 < 10', baseline_value: null });
    }
    if (/\banxi/i.test(concerns) || /\bf41\b/i.test(diagnoses)) {
      goals.push({ goal_text: 'Reduce anxiety symptoms to mild range', target_metric: 'GAD-7 < 8', baseline_value: null });
    }
    if (/\btrauma\b/i.test(concerns) || /\bptsd\b/i.test(concerns) || /\bf43\b/i.test(diagnoses)) {
      goals.push({ goal_text: 'Reduce PTSD symptoms below clinical threshold', target_metric: 'PCL-5 < 33', baseline_value: null });
    }
    if (!goals.length) {
      goals.push({ goal_text: 'Improve overall functioning and reduce distress', target_metric: 'Clinician assessment', baseline_value: null });
    }
  }
  
  const { lastInsertRowid: planId } = await db.insert(
    `INSERT INTO treatment_plans (patient_id, therapist_id, status, summary, last_reviewed_at)
     VALUES (?, ?, 'active', ?, datetime('now'))`,
    patient.id, therapistId, `Treatment plan for ${patient.client_id} — ${goals.length} goals`
  );
  
  for (const g of goals) {
    // Try to get baseline from latest assessment
    let baseline = g.baseline_value;
    if (!baseline && g.target_metric) {
      const metricMatch = g.target_metric.match(/(PHQ-9|GAD-7|PCL-5)/i);
      if (metricMatch) {
        const templateType = metricMatch[1].toLowerCase().replace('-', '');
        const latest = await db.get(
          'SELECT total_score FROM assessments WHERE patient_id = ? AND template_type = ? ORDER BY administered_at DESC LIMIT 1',
          patient.id, templateType
        );
        if (latest) baseline = latest.total_score;
      }
    }
    await db.run(
      `INSERT INTO treatment_goals (plan_id, goal_text, target_metric, baseline_value, current_value, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      planId, g.goal_text, g.target_metric || null, baseline, baseline
    );
  }
  
  // Snapshot the newly created plan (revision 1)
  await snapshotPlan(db, {
    planId, therapistId,
    changeKind: 'plan_created',
    changeDetail: `Created with ${goals.length} initial goals`,
    authorKind: 'agent',
  });
  
  return {
    plan_id: planId,
    patient: patient.client_id,
    goals_created: goals.length,
    goals: goals.map(g => ({ goal: g.goal_text, target: g.target_metric, baseline: g.baseline_value })),
    message: `Treatment plan created with ${goals.length} goals. Progress will auto-update as assessments come in and sessions are documented.`,
  };
};
