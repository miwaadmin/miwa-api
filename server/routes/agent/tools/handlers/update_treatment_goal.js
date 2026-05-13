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

module.exports = async function updateTreatmentGoalHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  const goal = await db.get('SELECT tg.*, tp.therapist_id FROM treatment_goals tg JOIN treatment_plans tp ON tp.id = tg.plan_id WHERE tg.id = ?', args.goal_id);
  if (!goal || goal.therapist_id !== therapistId) return { error: 'Goal not found' };
  
  if (args.status) {
    await db.run('UPDATE treatment_goals SET status = ? WHERE id = ?', args.status, args.goal_id);
    if (args.status === 'met') await db.run("UPDATE treatment_goals SET met_at = datetime('now') WHERE id = ?", args.goal_id);
    if (args.status === 'revised') await db.run("UPDATE treatment_goals SET revised_at = datetime('now') WHERE id = ?", args.goal_id);
  }
  if (args.current_value !== undefined) {
    await db.run('UPDATE treatment_goals SET current_value = ? WHERE id = ?', args.current_value, args.goal_id);
  }
  if (args.progress_note) {
    const notes = JSON.parse(goal.progress_notes_json || '[]');
    notes.push({ note: args.progress_note, date: new Date().toISOString().split('T')[0] });
    await db.run('UPDATE treatment_goals SET progress_notes_json = ? WHERE id = ?', JSON.stringify(notes), args.goal_id);
  }
  
  // Snapshot the plan after the goal change — revision history for HIPAA/liability
  const changes = [
    args.status && `status → ${args.status}`,
    args.current_value !== undefined && `current_value → ${args.current_value}`,
    args.progress_note && 'added progress note',
  ].filter(Boolean).join(', ');
  await snapshotPlan(db, {
    planId: goal.plan_id, therapistId,
    changeKind: 'goal_updated',
    changeDetail: `Goal ${args.goal_id}: ${changes}`,
    authorKind: 'agent',
  });
  
  return { message: 'Goal updated successfully', goal_id: args.goal_id };
};
