const crypto = require('crypto');
const { persistIfNeeded } = require('../../../db/asyncDb');
const { MODELS, callAI } = require('../../../lib/aiExecutor');
const { sendPortalSms, normalisePhone } = require('../../../services/twilio');
const { snapshotPlan } = require('../../../lib/treatmentPlanRevisions');
const { createAssistantAction, emitAssistantAction } = require('../../../lib/assistantActions');

const { inferAppointmentType } = require('../lib/helpers');
const {
  findPatientByCode,
  findPatientByDisplayName,
  buildPatientContext,
} = require('../lib/patient-context');
const {
  getClientAssessments,
  getClientSessions,
  getCaseloadSummaryFiltered,
  findPatientsForBatchAssessment,
} = require('../lib/caseload-readers');
const { formatAppointmentPreview } = require('../lib/appointment-ops');
const { generateClientId } = require('../lib/client-codes');
const {
  buildReviewPayload,
  getChartData,
  createAndStoreReport,
} = require('../lib/reports-pipeline');
const { runBackgroundTask } = require('../lib/background-tasks');

const { AGENT_RESOURCES } = require('./data/resources');
const { APP_HELP_KB } = require('./data/help-kb');
const { PORTAL_LINK_TTL_DAYS } = require('./definitions');
const getClientAssessmentsHandler = require('./handlers/get_client_assessments');
const getClientSessionsHandler = require('./handlers/get_client_sessions');
const getCaseloadSummaryHandler = require('./handlers/get_caseload_summary');
const scheduleAppointmentHandler = require('./handlers/schedule_appointment');
const cancelAppointmentHandler = require('./handlers/cancel_appointment');
const sendAssessmentSmsHandler = require('./handlers/send_assessment_sms');
const batchSendAssessmentsHandler = require('./handlers/batch_send_assessments');
const createClientHandler = require('./handlers/create_client');
const generateReportHandler = require('./handlers/generate_report');
const getResourcesHandler = require('./handlers/get_resources');
const getBillingStatusHandler = require('./handlers/get_billing_status');
const getOutcomesDashboardHandler = require('./handlers/get_outcomes_dashboard');
const getScheduleHandler = require('./handlers/get_schedule');
const getAppHelpHandler = require('./handlers/get_app_help');
const getSessionBriefHandler = require('./handlers/get_session_brief');
const executeWorkflowHandler = require('./handlers/execute_workflow');
const getWorkflowStatusHandler = require('./handlers/get_workflow_status');
const createTreatmentPlanHandler = require('./handlers/create_treatment_plan');
const getTreatmentPlanHandler = require('./handlers/get_treatment_plan');
const updateTreatmentGoalHandler = require('./handlers/update_treatment_goal');
const delegateAnalysisHandler = require('./handlers/delegate_analysis');
const searchPracticeInsightsHandler = require('./handlers/search_practice_insights');

async function executeAgentTool({ name, args, db, therapistId, nameMap, send, rawMessage }) {
  // Strip brackets from client codes: [DEMO-ABC123] → DEMO-ABC123
  async function resolvePatient(rawId) {
    const clean = (rawId || '').replace(/[\[\]]/g, '').trim();
    if (!clean) return null;
    return await findPatientByCode(db, therapistId, clean)
      || await findPatientByDisplayName(db, therapistId, clean);
  }

  switch (name) {
    case 'get_client_assessments':
      return await getClientAssessmentsHandler({ args, db, therapistId, send, resolvePatient });

    case 'get_client_sessions':
      return await getClientSessionsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_caseload_summary':
      return await getCaseloadSummaryHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'schedule_appointment':
      return await scheduleAppointmentHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'cancel_appointment':
      return await cancelAppointmentHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'send_assessment_sms':
      return await sendAssessmentSmsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'batch_send_assessments':
      return await batchSendAssessmentsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'create_client':
      return await createClientHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'generate_report':
      return await generateReportHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    /* ── New tools ──────────────────────────────────────────────────────── */
    case 'get_resources':
      return await getResourcesHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_billing_status':
      return await getBillingStatusHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_outcomes_dashboard':
      return await getOutcomesDashboardHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_schedule':
      return await getScheduleHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_app_help':
      return await getAppHelpHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // ═══════════════════════════════════════════════════════════════════════
    // AGENTIC PILLAR TOOL IMPLEMENTATIONS
    // ═══════════════════════════════════════════════════════════════════════

    // Pillar 1: Pre-Session Briefs
    case 'get_session_brief':
      return await getSessionBriefHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 2: Workflow Engine
    case 'execute_workflow':
      return await executeWorkflowHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_workflow_status':
      return await getWorkflowStatusHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 3: Treatment Plan Agent
    case 'create_treatment_plan':
      return await createTreatmentPlanHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'get_treatment_plan':
      return await getTreatmentPlanHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    case 'update_treatment_goal':
      return await updateTreatmentGoalHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 4: Sub-Agent Delegation (UPGRADED — parallel multi-agent with synthesis)
    case 'delegate_analysis':
      return await delegateAnalysisHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // Pillar 5: Practice Intelligence
    case 'search_practice_insights':
      return await searchPracticeInsightsHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient });

    // ═══════════════════════════════════════════════════════════════════════
    // TIER 1 AGENTIC UPGRADES — Tool Implementations
    // ═══════════════════════════════════════════════════════════════════════

    // Feature 2: Agent-Created Scheduled Tasks
    case 'schedule_task': {
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
    }

    case 'list_scheduled_tasks': {
      const status = args.status || 'pending';
      const where = status === 'all' ? '' : "AND status = 'pending'";
      const tasks = await db.all(
        `SELECT id, task_type, description, scheduled_for, status, created_at FROM agent_scheduled_tasks WHERE therapist_id = ? ${where} ORDER BY scheduled_for ASC LIMIT 20`,
        therapistId
      );
      return { tasks, count: tasks.length };
    }

    // Feature 4: Background Tasks with Notifications
    case 'run_background_task': {
      const { lastInsertRowid: bgTaskId } = await db.insert(
        'INSERT INTO background_tasks (therapist_id, task_type, description) VALUES (?, ?, ?)',
        therapistId, args.task_type, args.description
      );

      // Fire and forget — run in background
      runBackgroundTask(db, bgTaskId, therapistId, args.task_type).catch(async err => {
        await db.run("UPDATE background_tasks SET status = 'failed', error = ? WHERE id = ?", err.message, bgTaskId);
      });

      return {
        task_id: bgTaskId,
        status: 'running',
        message: `Background task started: "${args.description}". I'll notify you when it's done. You can keep chatting.`,
      };
    }

    case 'check_background_tasks': {
      const tasks = await db.all(
        "SELECT id, task_type, description, status, progress, created_at, completed_at FROM background_tasks WHERE therapist_id = ? ORDER BY created_at DESC LIMIT 10",
        therapistId
      );
      const running = tasks.filter(t => t.status === 'running').length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      // Include result for recently completed tasks
      const withResults = [];
      for (const t of tasks) {
        if (t.status === 'completed') {
          const full = await db.get('SELECT result_json FROM background_tasks WHERE id = ?', t.id);
          if (full?.result_json) {
            try { t.result_preview = JSON.parse(full.result_json); } catch {}
          }
        }
        withResults.push(t);
      }
      return { tasks: withResults, running, completed };
    }

    // Feature 5: Event Trigger Management
    case 'manage_event_triggers': {
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
    }

    case 'send_portal_link': {
      const patient = await resolvePatient(args.client_id);
      if (!patient) return { error: 'Client not found' };

      const crypto = require('crypto');
      const token = crypto.randomBytes(24).toString('base64url');

      await db.insert(
        `INSERT INTO client_portal_tokens (token, patient_id, therapist_id, expires_at)
         VALUES (?, ?, ?, datetime('now', '+7 days'))`,
        token, patient.id, therapistId,
      );
      await persistIfNeeded();

      const baseUrl = process.env.APP_URL || 'https://miwa.care';
      const portalUrl = `${baseUrl}/portal/${token}`;

      // Try text delivery only when SMS is explicitly enabled and configured
      const phone = patient.phone ? normalisePhone(patient.phone) : null;
      let deliveryMethod = 'link_only';
      if (phone && patient.sms_consent) {
        try {
          const result = await sendPortalSms(phone, portalUrl);
          if (result.status !== 'skipped') deliveryMethod = 'sms';
        } catch {}
      }

      return {
        portal_url: portalUrl,
        client_id: patient.client_id,
        display_name: patient.display_name || patient.client_id,
        delivery: deliveryMethod,
        expires_in: `${PORTAL_LINK_TTL_DAYS} days`,
        phone_masked: phone ? phone.replace(/\d(?=\d{4})/g, '\u2022') : null,
      };
    }

    case 'submit_feedback': {
      const feedbackMsg = String(args.message || '').trim();
      if (!feedbackMsg) return { error: 'No feedback message provided.' };
      const validCats = ['bug', 'feature', 'general'];
      const cat = validCats.includes(args.category) ? args.category : 'general';
      try {
        await db.insert(
          `INSERT INTO user_feedback (therapist_id, message, category, source) VALUES (?, ?, ?, 'chat')`,
          therapistId, feedbackMsg, cat,
        );
        await persistIfNeeded();
        return { ok: true, category: cat };
      } catch (err) {
        return { error: `Failed to save feedback: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
module.exports = { executeAgentTool };
