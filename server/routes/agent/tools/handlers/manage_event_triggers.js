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

module.exports = async function manageEventTriggersHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  switch (args.action) {
    case 'list': {
      const triggers = await db.all(
        'SELECT id, event_type, action_type, config_json, enabled, fire_count, last_fired_at, created_at FROM event_triggers WHERE therapist_id = ? ORDER BY created_at DESC',
        therapistId
      );
      return {
        triggers: triggers.map(t => ({
          ...t,
          config: JSON.parse(t.config_json || '{}'),
        })),
        count: triggers.length,
      };
    }
    case 'create': {
      if (!args.event_type || !args.action_type) {
        return { error: 'event_type and action_type are required to create a trigger' };
      }
      const configJson = JSON.stringify(args.config || {});
      const { lastInsertRowid: triggerId } = await db.insert(
        'INSERT INTO event_triggers (therapist_id, event_type, action_type, config_json) VALUES (?, ?, ?, ?)',
        therapistId, args.event_type, args.action_type, configJson
      );
      return {
        trigger_id: triggerId,
        event_type: args.event_type,
        action_type: args.action_type,
        message: `Trigger created: when "${args.event_type}" occurs, will "${args.action_type}"`,
      };
    }
    case 'toggle': {
      if (!args.trigger_id) return { error: 'trigger_id is required' };
      const trigger = await db.get(
        'SELECT id, enabled FROM event_triggers WHERE id = ? AND therapist_id = ?',
        args.trigger_id, therapistId
      );
      if (!trigger) return { error: 'Trigger not found' };
      const newState = trigger.enabled ? 0 : 1;
      await db.run('UPDATE event_triggers SET enabled = ? WHERE id = ?', newState, trigger.id);
      return { trigger_id: trigger.id, enabled: !!newState, message: `Trigger ${newState ? 'enabled' : 'disabled'}` };
    }
    default:
      return { error: 'Unknown action. Use: list, create, or toggle.' };
  }
};
