// ── Azure AI Tool Definitions ─────────────────────────────────────────────────
// These are the tools Miwa can call during the agent loop.
// Client codes (not real names) are always used — PHI safe.

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_client_assessments',
      description: 'Fetch recent PHQ-9, GAD-7, or PCL-5 assessment scores and trends for a specific client.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code from caseload (e.g. DEMO-ABC123). May appear as [DEMO-ABC123] — strip brackets.' },
          assessment_type: { type: 'string', description: 'Optional filter: PHQ-9, GAD-7, or PCL-5.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_sessions',
      description: 'Fetch recent session notes and clinical themes for a specific client.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_caseload_summary',
      description: 'Get the full caseload or a filtered subset of clients with latest assessment and risk status.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'risk_flagged', 'overdue_assessment', 'improving', 'deteriorating'],
            description: 'Optional filter.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_appointment',
      description: 'Schedule a therapy appointment for a client. Streams an approval card to the clinician before finalising.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code.' },
          appointment_type: { type: 'string', description: 'Session type (individual, couple, family, group).' },
          scheduled_start: { type: 'string', description: 'ISO datetime string.' },
          duration_minutes: { type: 'number', description: 'Session length in minutes (default 50).' },
          location: { type: 'string', description: 'Location or modality.' },
          notes: { type: 'string', description: 'Notes to attach.' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancel/delete an existing appointment. Use when clinician says "cancel", "delete", "remove" an appointment. Looks up the appointment by client + date, or by appointment ID.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code or name. Used to find the appointment if appointment_id is not provided.' },
          appointment_id: { type: 'integer', description: 'Appointment ID if known (shown in schedule view).' },
          scheduled_date: { type: 'string', description: 'Date of the appointment to cancel (e.g. "2026-04-16", "tomorrow"). Helps disambiguate if client has multiple appointments.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_assessment_sms',
      description: 'Create a PHQ-9, GAD-7, or PCL-5 secure assessment link for a client. SMS delivery is closed beta only, requires recorded consent, and is not HIPAA-covered while the Twilio BAA is pending.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code.' },
          assessment_type: { type: 'string', enum: ['PHQ-9', 'GAD-7', 'PCL-5'], description: 'Assessment to send.' },
          send_at: { type: 'string', description: 'ISO datetime to schedule. Omit for immediate.' },
          custom_message: { type: 'string', description: 'Ignored for SMS closed beta; SMS uses fixed category templates only.' },
        },
        required: ['client_id', 'assessment_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_send_assessments',
      description: 'Send assessments to multiple clients matching filter criteria. Shows a picker for clinician confirmation.',
      parameters: {
        type: 'object',
        properties: {
          assessment_type: { type: 'string', enum: ['PHQ-9', 'GAD-7', 'PCL-5'], description: 'Assessment type.' },
          filter: { type: 'string', enum: ['all', 'anxiety_cases', 'depression_cases', 'trauma_cases'], description: 'Which clients to target.' },
          spread_over_hours: { type: 'number', description: 'If set, spread sends over this many hours.' },
        },
        required: ['assessment_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_client',
      description: 'Create a NEW client profile. ONLY use when the clinician explicitly says "new client", "new patient", "new intake", or mentions someone who does NOT exist in the caseload. NEVER use this if the client already exists — use the existing client_id instead. If unsure, check the caseload first.',
      parameters: {
        type: 'object',
        properties: {
          display_name: { type: 'string', description: 'The name or alias for the client (e.g. "Patricia", "P", "the new couple"). Stored as-is for PHI.' },
          client_type: { type: 'string', enum: ['individual', 'couple', 'family', 'group'], description: 'Session type. Default: individual.' },
          session_modality: { type: 'string', enum: ['in-person', 'telehealth', 'hybrid'], description: 'How sessions are conducted.' },
          session_duration: { type: 'number', description: 'Typical session length in minutes (default 50).' },
          age: { type: 'number', description: 'Client age if mentioned.' },
          gender: { type: 'string', description: 'Client gender if mentioned.' },
          presenting_concerns: { type: 'string', description: 'Brief note on reason for referral/intake if mentioned.' },
          phone: { type: 'string', description: 'Phone number if provided.' },
        },
        required: ['display_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_report',
      description: 'Generate a PDF clinical progress report for a client.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code.' },
          viewer: { type: 'string', description: 'Audience: therapist, court, insurance, supervision, trainee.' },
          purpose: { type: 'string', description: 'Purpose of the report.' },
          focus: { type: 'string', description: 'Specific area to focus on.' },
        },
        required: ['client_id'],
      },
    },
  },
  // ── New tools: resources, billing, outcomes, schedule, help ──────────
  {
    type: 'function',
    function: {
      name: 'get_resources',
      description: 'Search or browse curated clinical resources (assessment guides, treatment protocols, crisis hotlines, victim services, housing, trauma education). Returns matching resources with name, URL, and category.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword (e.g. "CBT", "suicide", "PTSD", "housing", "anxiety"). Searches name, type, and category.' },
          category: { type: 'string', enum: ['assessment-guides', 'clinical-protocols', 'crisis-safety', 'suicide-prevention', 'resource-directories', 'victim-services', 'housing-shelter', 'trauma-education'], description: 'Filter by category ID.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_billing_status',
      description: "Get the therapist's current subscription status, plan tier, trial remaining, and workspace usage.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_outcomes_dashboard',
      description: 'Get practice-level outcomes: total assessments completed, average PHQ-9/GAD-7 scores, severity distribution, improvement count, and active client count.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_schedule',
      description: 'Get upcoming appointments for the therapist. Shows client, time, type, and duration.',
      parameters: {
        type: 'object',
        properties: {
          days_ahead: { type: 'number', description: 'Number of days ahead to look (default 7).' },
          limit: { type: 'number', description: 'Max appointments to return (default 10).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_app_help',
      description: 'Answer questions about how to use the Miwa app. Covers: getting started, voice notes, assessments, scheduling, reports, copilot chat, settings, billing, resources, and FAQ. Use when the therapist asks "how do I...", "what can you do", "help", or seems confused about a feature.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The help topic or question (e.g. "send assessment", "voice notes", "schedule", "billing", "getting started").' },
        },
        required: ['topic'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENTIC PILLAR TOOLS — Hermes-level autonomous capabilities
  // ═══════════════════════════════════════════════════════════════════════════

  // Pillar 1: Pre-Session Briefs
  {
    type: 'function',
    function: {
      name: 'get_session_brief',
      description: 'Get the pre-session clinical brief for an upcoming appointment. Briefs are auto-generated 30 minutes before scheduled sessions and include key themes, assessment trajectory, risk flags, open items from last session, and suggested focus areas. Use when therapist asks about upcoming sessions or wants to prepare.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code or name to get brief for. If omitted, returns all upcoming briefs for today.' },
        },
      },
    },
  },

  // Pillar 2: Workflow Engine
  {
    type: 'function',
    function: {
      name: 'execute_workflow',
      description: 'Start a multi-step clinical workflow. Workflows chain multiple actions together automatically. Available workflows: "client_onboard" (create profile + send assessments + schedule intake), "case_closure" (final assessments + discharge summary + outcomes report), "quarterly_review" (review all cases + identify stalled + generate report), "court_prep" (pull all records + generate court report). Steps requiring action (scheduling, sending assessments) will pause for therapist approval.',
      parameters: {
        type: 'object',
        properties: {
          workflow_type: { type: 'string', enum: ['client_onboard', 'case_closure', 'quarterly_review', 'court_prep'], description: 'Type of workflow to execute.' },
          client_name: { type: 'string', description: 'Client name (for client_onboard).' },
          client_id: { type: 'string', description: 'Existing client code (for case_closure, court_prep).' },
          case_type: { type: 'string', description: 'Case type: individual, couple, family, group (for client_onboard). Default: individual.' },
          concerns: { type: 'string', description: 'Presenting concerns (for client_onboard).' },
        },
        required: ['workflow_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_workflow_status',
      description: 'Check the status of a running workflow. Shows completed steps, current step, and what\'s pending.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'integer', description: 'Workflow ID to check. If omitted, shows all active workflows.' },
        },
      },
    },
  },

  // Pillar 3: Treatment Plan Agent
  {
    type: 'function',
    function: {
      name: 'create_treatment_plan',
      description: 'Create a new treatment plan for a client based on their intake data, presenting concerns, and diagnoses. Generates structured goals with measurable targets (e.g., "PHQ-9 < 10"). Use after intake or when therapist wants to formalize treatment goals.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code or name.' },
          goals: {
            type: 'array',
            description: 'Optional: manually specify goals. Each goal: { goal_text, target_metric, baseline_value }. If omitted, Miwa auto-generates goals from client profile.',
            items: {
              type: 'object',
              properties: {
                goal_text: { type: 'string' },
                target_metric: { type: 'string' },
                baseline_value: { type: 'number' },
              },
            },
          },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_treatment_plan',
      description: 'Get the current treatment plan for a client, including all goals with progress tracking, status (active/met/stalled/revised), and recent progress notes. Use when therapist asks "how is [client] doing on their goals?" or wants treatment plan status.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code or name.' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_treatment_goal',
      description: 'Update a treatment goal — add progress note, change status (met/revised/discontinued), or update current value. Use when therapist discusses goal progress or wants to modify treatment plan.',
      parameters: {
        type: 'object',
        properties: {
          goal_id: { type: 'integer', description: 'Treatment goal ID.' },
          status: { type: 'string', enum: ['active', 'met', 'revised', 'discontinued'], description: 'New status.' },
          current_value: { type: 'number', description: 'Updated metric value (e.g., latest PHQ-9 score).' },
          progress_note: { type: 'string', description: 'Progress note to add.' },
        },
        required: ['goal_id'],
      },
    },
  },

  // Pillar 4: Sub-Agent Delegation
  {
    type: 'function',
    function: {
      name: 'delegate_analysis',
      description: 'Delegate a complex analysis task to run in the background. Spawns a focused sub-analysis using a fast model to process large amounts of data (e.g., reviewing entire caseload, comparing treatment approaches across clients, analyzing intervention effectiveness). Returns a synthesized summary. Use for questions that require looking across multiple clients or large data sets.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'What to analyze (e.g., "Review all anxiety cases for stalled treatment", "Compare CBT vs DBT outcomes across caseload").' },
          scope: { type: 'string', enum: ['caseload', 'single_client', 'assessments', 'sessions'], description: 'Data scope for the analysis.' },
          client_id: { type: 'string', description: 'Client code (required if scope is single_client).' },
        },
        required: ['goal', 'scope'],
      },
    },
  },

  // Pillar 5: Practice Intelligence
  {
    type: 'function',
    function: {
      name: 'search_practice_insights',
      description: 'Search your practice intelligence — patterns Miwa has discovered across your clinical work. Includes: intervention effectiveness (what treatments work for which presentations), cross-client patterns, caseload trends, and session patterns. Use when therapist asks "what\'s working for my anxiety cases?" or "show me my practice trends".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "anxiety treatment effectiveness", "caseload trends", "CBT outcomes").' },
          insight_type: { type: 'string', enum: ['intervention_effectiveness', 'cross_client_pattern', 'session_pattern', 'caseload_trend'], description: 'Filter by insight type.' },
        },
        required: ['query'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1 AGENTIC UPGRADES — Autonomous capabilities
  // ═══════════════════════════════════════════════════════════════════════════

  // Feature 2: Agent-Created Scheduled Tasks
  {
    type: 'function',
    function: {
      name: 'schedule_task',
      description: 'Schedule a future task or reminder. Miwa will execute the task at the scheduled time and notify the therapist. Use for: "remind me to...", "check on client X next week", "follow up on...", "send assessment in 3 days".',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What to do (e.g., "Check if Client A completed their PHQ-9")' },
          scheduled_for: { type: 'string', description: 'When to execute (ISO datetime or relative like "in 3 days", "next Friday 9am", "tomorrow 2pm")' },
          task_type: { type: 'string', enum: ['reminder', 'check_assessment', 'send_assessment', 'follow_up', 'review_case'], description: 'Type of task' },
          client_id: { type: 'string', description: 'Client code if task is client-specific' },
        },
        required: ['description', 'scheduled_for'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_scheduled_tasks',
      description: 'List all upcoming scheduled tasks and reminders. Shows what Miwa has been asked to do in the future.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'completed', 'all'], description: 'Filter by status. Default: pending.' },
        },
      },
    },
  },

  // Feature 4: Background Tasks with Notifications
  {
    type: 'function',
    function: {
      name: 'run_background_task',
      description: 'Start a long-running task in the background. The therapist can continue chatting while it runs. They will be notified when it completes. Use for: generating multiple reports, analyzing entire caseload, batch operations.',
      parameters: {
        type: 'object',
        properties: {
          task_type: { type: 'string', enum: ['generate_reports', 'caseload_analysis', 'batch_assessments', 'quarterly_review'], description: 'Type of background task' },
          description: { type: 'string', description: 'What this task will do' },
          params: { type: 'object', description: 'Task-specific parameters' },
        },
        required: ['task_type', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_background_tasks',
      description: 'Check status of running background tasks.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // Feature 5: Event Trigger Management
  {
    type: 'function',
    function: {
      name: 'manage_event_triggers',
      description: 'View, create, or toggle event-driven triggers. Triggers automatically react to clinical events (assessment submitted, no-show, session signed) by creating alerts or executing actions. Use when therapist says "alert me when...", "notify me if...", "when a client does X, do Y".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'toggle'], description: 'What to do with triggers' },
          trigger_id: { type: 'integer', description: 'Trigger ID (for toggle action)' },
          event_type: { type: 'string', enum: ['assessment_submitted', 'appointment_noshow', 'appointment_checkin', 'session_signed'], description: 'Event to react to (for create action)' },
          action_type: { type: 'string', enum: ['create_alert', 'send_assessment', 'log'], description: 'What to do when event fires (for create action)' },
          config: { type: 'object', description: 'Trigger configuration (alert_type, severity, title, min_score, etc.)' },
        },
        required: ['action'],
      },
    },
  },

  // Client Portal — send magic link
  {
    type: 'function',
    function: {
      name: 'send_portal_link',
      description: 'Send a client portal link to a patient. The portal lets them view appointments, complete assessments, do check-ins, and message their therapist. Link is valid for 7 days.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client code or name.' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_feedback',
      description: 'Submit feedback or a bug report to the Miwa support team. Use when the clinician says something is broken, reports an issue, suggests a feature, or asks to send feedback to support.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The feedback message from the clinician, in their own words.' },
          category: { type: 'string', enum: ['bug', 'feature', 'general'], description: 'bug = something broken, feature = something they want added, general = anything else.' },
        },
        required: ['message', 'category'],
      },
    },
  },
];

// Azure OpenAI-format tool definitions (converted from AGENT_TOOLS above)
const AI_AGENT_TOOLS = AGENT_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

const PORTAL_LINK_TTL_DAYS = 7;

module.exports = { AGENT_TOOLS, AI_AGENT_TOOLS, PORTAL_LINK_TTL_DAYS };
