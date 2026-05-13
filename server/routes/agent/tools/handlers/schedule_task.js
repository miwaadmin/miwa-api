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

module.exports = async function scheduleTaskHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
  let scheduledFor = args.scheduled_for;
  // Parse relative dates
  const now = new Date();
  if (scheduledFor.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Extract time if specified (e.g., "tomorrow 2pm")
    const timeMatch = scheduledFor.match(/(\d{1,2})\s*(am|pm)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      if (timeMatch[2].toLowerCase() === 'pm' && hours < 12) hours += 12;
      if (timeMatch[2].toLowerCase() === 'am' && hours === 12) hours = 0;
      tomorrow.setHours(hours, 0, 0, 0);
    } else {
      tomorrow.setHours(9, 0, 0, 0);
    }
    scheduledFor = tomorrow.toISOString();
  } else if (scheduledFor.match(/in\s+\d+/i)) {
    const match = scheduledFor.match(/in\s+(\d+)\s*(minute|hour|day|week)s?/i);
    if (match) {
      const amount = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[unit] || 86400000;
      scheduledFor = new Date(now.getTime() + amount * ms).toISOString();
    }
  } else if (scheduledFor.toLowerCase().includes('next')) {
    // Handle "next Friday", "next Monday" etc.
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayMatch = scheduledFor.match(/next\s+(\w+)/i);
    if (dayMatch) {
      const targetDay = days.indexOf(dayMatch[1].toLowerCase());
      if (targetDay >= 0) {
        const d = new Date(now);
        d.setDate(d.getDate() + ((targetDay + 7 - d.getDay()) % 7 || 7));
        // Extract time if specified
        const timeMatch = scheduledFor.match(/(\d{1,2})\s*(am|pm)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          if (timeMatch[2].toLowerCase() === 'pm' && hours < 12) hours += 12;
          if (timeMatch[2].toLowerCase() === 'am' && hours === 12) hours = 0;
          d.setHours(hours, 0, 0, 0);
        } else {
          d.setHours(9, 0, 0, 0);
        }
        scheduledFor = d.toISOString();
      }
    }
  }
  // If it's already ISO format, leave as-is
  
  const { lastInsertRowid: taskId } = await db.insert(
    'INSERT INTO agent_scheduled_tasks (therapist_id, task_type, description, prompt, scheduled_for) VALUES (?, ?, ?, ?, ?)',
    therapistId, args.task_type || 'reminder', args.description,
    args.description, scheduledFor
  );
  emitAssistantAction(send, createAssistantAction('create_follow_up_task', {
    title: 'Follow-up scheduled',
    summary: `Scheduled for ${new Date(scheduledFor).toLocaleString()}.`,
    status: 'completed',
    payload: {
      taskId,
      description: args.description,
      scheduledFor,
      taskType: args.task_type || 'reminder',
      clientId: args.client_id || null,
    },
  }));
  
  return {
    task_id: taskId,
    description: args.description,
    scheduled_for: scheduledFor,
    message: `Scheduled: "${args.description}" for ${new Date(scheduledFor).toLocaleString()}`,
  };
};
