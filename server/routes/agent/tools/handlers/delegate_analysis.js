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

module.exports = async function delegateAnalysisHandler({ args, db, therapistId, nameMap, send, rawMessage, resolvePatient }) {
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
};
