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

module.exports = async function getSessionBriefHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  try {
    const { getBrief, getUpcomingBriefs } = require('../services/brief-generator');
    if (args.client_id) {
      const patient = await resolvePatient(args.client_id);
      if (!patient) return { error: 'Client not found' };
      const briefs = await db.all(
        `SELECT sb.* FROM session_briefs sb WHERE sb.therapist_id = ? AND sb.patient_id = ? ORDER BY sb.created_at DESC LIMIT 1`,
        therapistId, patient.id
      );
      if (!briefs.length) return { message: `No pre-session brief found for ${patient.client_id}. Briefs are auto-generated 30 minutes before scheduled appointments.` };
      const brief = briefs[0];
      if (!brief.viewed_at) await db.run("UPDATE session_briefs SET viewed_at = datetime('now') WHERE id = ?", brief.id);
      const parsed = JSON.parse(brief.brief_json);
      emitAssistantAction(send, createAssistantAction('prepare_session', {
        title: `Prepare for ${patient.display_name || patient.client_id}`,
        summary: 'Pre-session brief is ready.',
        payload: {
          patientId: patient.id,
          clientId: patient.client_id,
          clientName: patient.display_name || patient.client_id,
          focusAreas: [
            ...(parsed.keyThemes || parsed.themes || []).slice(0, 2),
            ...(parsed.suggestedFocus || parsed.focusAreas || []).slice(0, 2),
          ].filter(Boolean),
        },
      }));
      return { brief: parsed, generated_at: brief.created_at };
    }
    const upcoming = await getUpcomingBriefs(therapistId);
    if (!upcoming.length) return { message: 'No upcoming briefs for today. Briefs are auto-generated 30 minutes before scheduled appointments.' };
    emitAssistantAction(send, createAssistantAction('prepare_session', {
      title: 'Today\'s pre-session briefs',
      summary: `${upcoming.length} brief${upcoming.length === 1 ? '' : 's'} ready.`,
      payload: {
        focusAreas: upcoming.slice(0, 4).map(b => b.brief?.clientName || b.brief?.client_id || 'Upcoming session'),
      },
    }));
    return { briefs: upcoming.map(b => ({ ...b.brief, generated_at: b.created_at })) };
  } catch (err) {
    return { error: `Brief system: ${err.message}` };
  }
};
