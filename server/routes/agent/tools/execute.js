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

    case 'generate_report': {
      const patient = await resolvePatient(args.client_id);
      if (!patient) return { error: 'Client not found' };

      const context = await buildPatientContext(db, therapistId, patient.id);
      const reportSpec = {
        viewer: args.viewer || 'therapist',
        purpose: args.purpose || 'progress review',
        focus: args.focus || 'balanced progress summary',
        timeframe: 'all available sessions',
        includeCharts: true,
        title: `${patient.client_id} Progress Review`,
      };

      const report = await buildReviewPayload({
        patient, sessions: context.sessions, assessments: context.assessments, reportSpec, therapistId,
      });
      const chartData = getChartData(context.assessments);
      const stored = await createAndStoreReport({
        therapistId, patient,
        report: { ...report, chartData },
        chartData,
        audience: reportSpec.viewer,
        purpose: reportSpec.purpose,
      });

      send({
        type: 'report_ready',
        reportId: stored.reportId,
        title: report.title,
        downloadUrl: `/agent/reports/${stored.reportId}/download`,
      });

      return {
        status: 'generated',
        title: report.title,
        summary: (report.executiveSummary || '').slice(0, 200),
      };
    }

    /* ── New tools ──────────────────────────────────────────────────────── */
    case 'get_resources': {
      let results = [];
      const q = (args.query || '').toLowerCase();
      const cat = args.category;
      for (const group of AGENT_RESOURCES) {
        if (cat && group.id !== cat) continue;
        for (const item of group.items) {
          if (q && !item.name.toLowerCase().includes(q) && !item.type.toLowerCase().includes(q) && !group.category.toLowerCase().includes(q)) continue;
          results.push({ name: item.name, type: item.type, url: item.url, source: item.source, category: group.category, urgent: item.urgent || false });
        }
      }
      if (!q && !cat) {
        // Return category summaries instead of all 72 items
        return { categories: AGENT_RESOURCES.map(g => ({ category: g.category, id: g.id, count: g.items.length })), total: AGENT_RESOURCES.reduce((s, g) => s + g.items.length, 0) };
      }
      return { count: results.length, resources: results.slice(0, 10) };
    }

    case 'get_billing_status': {
      const row = await db.get('SELECT subscription_status, subscription_tier, workspace_uses FROM therapists WHERE id = ?', therapistId);
      if (!row) return { error: 'Therapist not found' };
      const trialLimit = 20;
      const isActive = row.subscription_status === 'active' || row.subscription_status === 'trialing';
      return {
        status: row.subscription_status || 'none',
        tier: row.subscription_tier || 'free_trial',
        workspace_uses: row.workspace_uses || 0,
        trial_limit: trialLimit,
        trial_remaining: Math.max(0, trialLimit - (row.workspace_uses || 0)),
        is_active: isActive,
      };
    }

    case 'get_outcomes_dashboard': {
      const totalAssessments = (await db.get('SELECT COUNT(*) as c FROM assessments WHERE therapist_id = ?', therapistId))?.c || 0;
      const activeClients = (await db.get('SELECT COUNT(DISTINCT patient_id) as c FROM assessments WHERE therapist_id = ?', therapistId))?.c || 0;
      const avgPhq9 = (await db.get("SELECT AVG(total_score) as avg FROM assessments WHERE therapist_id = ? AND assessment_type = 'PHQ-9'", therapistId))?.avg;
      const avgGad7 = (await db.get("SELECT AVG(total_score) as avg FROM assessments WHERE therapist_id = ? AND assessment_type = 'GAD-7'", therapistId))?.avg;
      const phq9Dist = await db.all("SELECT severity_level, COUNT(*) as count FROM assessments WHERE therapist_id = ? AND assessment_type = 'PHQ-9' GROUP BY severity_level", therapistId);
      const improvements = (await db.get(`SELECT COUNT(*) as c FROM (
        SELECT patient_id, assessment_type,
          total_score - LAG(total_score) OVER (PARTITION BY patient_id, assessment_type ORDER BY completed_at) as delta
        FROM assessments WHERE therapist_id = ?
      ) WHERE delta < 0`, therapistId))?.c || 0;
      return {
        total_assessments: totalAssessments,
        active_clients_assessed: activeClients,
        avg_phq9: avgPhq9 ? Math.round(avgPhq9 * 10) / 10 : null,
        avg_gad7: avgGad7 ? Math.round(avgGad7 * 10) / 10 : null,
        phq9_severity_distribution: phq9Dist,
        total_improvements: improvements,
      };
    }

    case 'get_schedule': {
      const daysAhead = args.days_ahead || 7;
      const limit = args.limit || 10;
      const rows = await db.all(
        `SELECT a.scheduled_start, a.duration_minutes, a.appointment_type, a.location, a.status, a.notes, p.client_id, p.display_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.therapist_id = ? AND a.status != 'cancelled'
           AND a.scheduled_start >= datetime('now') AND a.scheduled_start <= datetime('now', '+' || ? || ' days')
         ORDER BY a.scheduled_start ASC LIMIT ?`,
        therapistId, daysAhead, limit
      );
      const appointments = rows.map(r => ({
        client: r.client_id || r.display_name,
        type: r.appointment_type,
        start: r.scheduled_start,
        duration: r.duration_minutes,
        location: r.location || 'Not specified',
        status: r.status,
      }));
      emitAssistantAction(send, createAssistantAction('prepare_session', {
        title: rows.length ? 'Upcoming sessions' : 'No upcoming sessions',
        summary: rows.length ? `${rows.length} appointment${rows.length === 1 ? '' : 's'} in the next ${daysAhead} days.` : 'Your schedule is clear for that window.',
        status: rows.length ? 'ready' : 'empty',
        payload: {
          appointments,
          focusAreas: appointments.slice(0, 3).map(a => `${a.client} · ${a.type || 'session'} · ${a.start ? new Date(a.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'unscheduled'}`),
        },
      }));
      return { count: rows.length, days_ahead: daysAhead, appointments };
    }

    case 'get_app_help': {
      const topic = (args.topic || '').toLowerCase();
      const matches = [];
      for (const section of APP_HELP_KB) {
        const titleMatch = section.title.toLowerCase().includes(topic) || section.id.includes(topic);
        for (const entry of section.content) {
          const headingMatch = entry.heading.toLowerCase().includes(topic);
          const bodyMatch = entry.body.toLowerCase().includes(topic);
          if (titleMatch || headingMatch || bodyMatch) {
            matches.push({ section: section.title, heading: entry.heading, body: entry.body });
          }
        }
      }
      if (matches.length === 0) {
        return { message: 'No exact match found. Here are all help topics:', topics: APP_HELP_KB.map(s => s.title) };
      }
      return { matches: matches.slice(0, 3) };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AGENTIC PILLAR TOOL IMPLEMENTATIONS
    // ═══════════════════════════════════════════════════════════════════════

    // Pillar 1: Pre-Session Briefs
    case 'get_session_brief': {
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
    }

    // Pillar 2: Workflow Engine
    case 'execute_workflow': {
      try {
        const { createWorkflow } = require('../services/workflow-engine');
        const params = {};
        if (args.client_name) params.client_name = args.client_name;
        if (args.client_id) {
          const patient = await resolvePatient(args.client_id);
          if (patient) params.patient_id = patient.id;
        }
        if (args.case_type) params.case_type = args.case_type;
        if (args.concerns) params.concerns = args.concerns;

        const result = await createWorkflow(therapistId, args.workflow_type, params);
        return {
          message: `Workflow "${result.label}" started with ${result.steps} steps.`,
          workflow_id: result.workflowId,
          label: result.label,
          total_steps: result.steps,
          note: 'Steps requiring your approval will pause and ask before proceeding.',
        };
      } catch (err) {
        return { error: `Workflow: ${err.message}` };
      }
    }

    case 'get_workflow_status': {
      try {
        const { getWorkflowStatus, listWorkflows } = require('../services/workflow-engine');
        if (args.workflow_id) {
          const status = await getWorkflowStatus(args.workflow_id, therapistId);
          if (!status) return { error: 'Workflow not found' };
          return {
            id: status.id,
            type: status.workflow_type,
            label: status.label,
            status: status.status,
            progress: `${status.completedSteps}/${status.totalSteps} steps completed`,
            current_step: status.current_step,
            steps: status.steps.map(s => ({ step: s.step_number, tool: s.tool_name, description: s.description, status: s.status })),
          };
        }
        const workflows = await listWorkflows(therapistId);
        return { workflows: workflows.map(w => ({ id: w.id, type: w.workflow_type, label: w.label, status: w.status, created_at: w.created_at })) };
      } catch (err) {
        return { error: `Workflow status: ${err.message}` };
      }
    }

    // Pillar 3: Treatment Plan Agent
    case 'create_treatment_plan': {
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
    }

    case 'get_treatment_plan': {
      const patient = await resolvePatient(args.client_id);
      if (!patient) return { error: 'Client not found' };

      const plan = await db.get("SELECT * FROM treatment_plans WHERE patient_id = ? AND therapist_id = ? AND status = 'active'", patient.id, therapistId);
      if (!plan) return { message: `No active treatment plan for ${patient.client_id}. Use create_treatment_plan to create one.` };

      const goals = await db.all('SELECT * FROM treatment_goals WHERE plan_id = ? ORDER BY id', plan.id);
      return {
        plan_id: plan.id,
        patient: patient.client_id,
        status: plan.status,
        created_at: plan.created_at,
        last_reviewed: plan.last_reviewed_at,
        goals: goals.map(g => ({
          id: g.id,
          goal: g.goal_text,
          target: g.target_metric,
          baseline: g.baseline_value,
          current: g.current_value,
          status: g.status,
          progress_notes: JSON.parse(g.progress_notes_json || '[]').slice(-3),
          interventions: JSON.parse(g.interventions_json || '[]'),
        })),
        summary: `${goals.filter(g => g.status === 'met').length} met, ${goals.filter(g => g.status === 'active').length} active, ${goals.filter(g => g.status === 'revised').length} revised`,
      };
    }

    case 'update_treatment_goal': {
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
    }

    // Pillar 4: Sub-Agent Delegation (UPGRADED — parallel multi-agent with synthesis)
    case 'delegate_analysis': {
      try {
        // Gather data based on scope (same data sources, unchanged)
        let contextData = '';
        if (args.scope === 'caseload' || args.scope === 'assessments') {
          const patients = await db.all('SELECT id, client_id, presenting_concerns, diagnoses FROM patients WHERE therapist_id = ?', therapistId);
          const assessments = await db.all(
            `SELECT a.patient_id, a.template_type, a.total_score, a.severity_level, a.is_improvement, a.is_deterioration, a.administered_at, p.client_id
             FROM assessments a JOIN patients p ON p.id = a.patient_id
             WHERE a.therapist_id = ? ORDER BY a.administered_at DESC LIMIT 200`,
            therapistId
          );
          contextData = `PATIENTS (${patients.length}):\n${patients.map(p => `- ${p.client_id}: ${p.presenting_concerns || 'no concerns listed'} | Dx: ${p.diagnoses || 'none'}`).join('\n')}\n\nASSESSMENTS (last 200):\n${assessments.map(a => `- ${a.client_id} ${a.template_type}: ${a.total_score} (${a.severity_level}) ${a.is_improvement ? '↑improving' : ''} ${a.is_deterioration ? '↓deteriorating' : ''} [${a.administered_at}]`).join('\n')}`;
        }
        if (args.scope === 'sessions') {
          const sessions = await db.all(
            `SELECT s.patient_id, s.session_date, s.assessment, s.plan, p.client_id
             FROM sessions s JOIN patients p ON p.id = s.patient_id
             WHERE s.therapist_id = ? AND s.signed_at IS NOT NULL ORDER BY s.session_date DESC LIMIT 100`,
            therapistId
          );
          contextData = `RECENT SESSIONS (last 100):\n${sessions.map(s => `- ${s.client_id} [${s.session_date}]: Assessment: ${(s.assessment || '').slice(0, 150)} | Plan: ${(s.plan || '').slice(0, 150)}`).join('\n')}`;
        }
        if (args.scope === 'single_client' && args.client_id) {
          const patient = await resolvePatient(args.client_id);
          if (!patient) return { error: 'Client not found' };
          const sessions = await db.all('SELECT session_date, assessment, plan FROM sessions WHERE patient_id = ? AND therapist_id = ? ORDER BY session_date DESC LIMIT 20', patient.id, therapistId);
          const assessments = await db.all('SELECT template_type, total_score, severity_level, administered_at FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 20', patient.id);
          contextData = `CLIENT: ${patient.client_id}\nConcerns: ${patient.presenting_concerns}\nDiagnoses: ${patient.diagnoses}\n\nSESSIONS:\n${sessions.map(s => `[${s.session_date}] ${(s.assessment || '').slice(0, 200)}`).join('\n')}\n\nASSESSMENTS:\n${assessments.map(a => `${a.template_type}: ${a.total_score} (${a.severity_level}) [${a.administered_at}]`).join('\n')}`;
        }

        // Split into chunks for parallel processing
        const CHUNK_SIZE = 5000;
        const chunks = [];
        for (let i = 0; i < contextData.length; i += CHUNK_SIZE) {
          chunks.push(contextData.slice(i, i + CHUNK_SIZE));
        }

        // Log the delegated task
        const { lastInsertRowid: taskId } = await db.insert(
          `INSERT INTO delegated_tasks (therapist_id, goal, scope, status, model_used)
           VALUES (?, ?, ?, 'running', 'haiku+sonnet')`,
          therapistId, args.goal, args.scope
        );

        if (chunks.length <= 1) {
          // Small data — single Haiku call (fast path)
          const result = await callAI(
            MODELS.AZURE_MAIN,
            'You are a clinical data analyst for a therapist. Analyze the provided data and give a concise, actionable summary. CRITICAL RULES: (1) Only state facts directly supported by the data. (2) Use client codes, not names. (3) Cite specific scores and dates for every claim. (4) If data is insufficient for a conclusion, say so explicitly. (5) Never infer diagnoses or treatment outcomes not supported by assessment scores. Format as clear bullet points.',
            `ANALYSIS GOAL: ${args.goal}\n\nDATA:\n${contextData}`,
            2000,
            { therapistId, kind: 'delegate_single' }
          );

          await db.run("UPDATE delegated_tasks SET status = 'completed', result_json = ?, tokens_used = ?, completed_at = datetime('now') WHERE id = ?",
            JSON.stringify({ summary: result }), Math.round(result.length / 4), taskId
          );

          return { analysis: result, task_id: taskId, scope: args.scope, parallel_chunks: 1 };
        }

        // Run parallel analysis on each chunk (max 5 parallel)
        const subResults = await Promise.all(
          chunks.slice(0, 5).map((chunk, i) =>
            callAI(
              MODELS.AZURE_MAIN,
              'You are a clinical data analyst. Analyze this subset of data and provide findings. Use client codes only. Cite specific scores and dates.',
              `ANALYSIS GOAL: ${args.goal}\n\nDATA CHUNK ${i + 1}/${Math.min(chunks.length, 5)}:\n${chunk}`,
              800,
              { therapistId, kind: 'delegate_chunk' }
            ).catch(() => `[Chunk ${i + 1} failed]`)
          )
        );

        // Synthesize with Azure OpenAI for coherent final output
        const synthesis = await callAI(
          MODELS.AZURE_MAIN,
          'You are synthesizing findings from multiple parallel analyses for a therapist. Combine the findings into a single coherent summary. Remove duplicates. Rank by clinical urgency. Be concise and actionable. CRITICAL: use client codes, cite specific scores and dates.',
          `ORIGINAL GOAL: ${args.goal}\n\nFINDINGS FROM ${subResults.length} PARALLEL ANALYSES:\n\n${subResults.map((r, i) => `--- Analysis ${i + 1} ---\n${r}`).join('\n\n')}`,
          1500,
          { therapistId, kind: 'delegate_synthesis' }
        );

        const totalTokens = subResults.reduce((sum, r) => sum + (r?.length || 0) / 4, 0) + (synthesis?.length || 0) / 4;

        await db.run("UPDATE delegated_tasks SET status = 'completed', result_json = ?, tokens_used = ?, completed_at = datetime('now') WHERE id = ?",
          JSON.stringify({ synthesis, subResults: subResults.length }), Math.round(totalTokens), taskId
        );

        return { analysis: synthesis, task_id: taskId, scope: args.scope, parallel_chunks: subResults.length };
      } catch (err) {
        console.error('[agent/delegate] failed:', err.message);
        return { error: 'Delegation failed.' };
      }
    }

    // Pillar 5: Practice Intelligence
    case 'search_practice_insights': {
      try {
        const { searchInsights, getInsightsSummary } = require('../services/practice-intelligence');
        if (args.insight_type) {
          const insights = await db.all(
            'SELECT * FROM practice_insights WHERE therapist_id = ? AND insight_type = ? AND is_active = 1 ORDER BY confidence_score DESC LIMIT 10',
            therapistId, args.insight_type
          );
          return { insights: insights.map(i => ({ type: i.insight_type, insight: i.insight_text, confidence: i.confidence_score, generated: i.created_at })) };
        }
        const results = await searchInsights(therapistId, args.query);
        if (!results.length) return { message: 'No practice insights found yet. Insights are generated weekly from your session notes and assessment data. Keep documenting — patterns will emerge!' };
        return { insights: results.map(i => ({ type: i.insight_type, insight: i.insight_text, confidence: i.confidence_score, generated: i.created_at })) };
      } catch (err) {
        return { message: 'Practice intelligence is building — insights generate weekly from your documentation patterns. No insights available yet.' };
      }
    }

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
