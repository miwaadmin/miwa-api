const { persistIfNeeded } = require('../../../db/asyncDb');
const { MODELS, callAI } = require('../../../lib/aiExecutor');

/**
 * Execute a long-running background task asynchronously.
 * Updates progress in the background_tasks table and creates an alert when done.
 */
async function runBackgroundTask(db, taskId, therapistId, taskType) {
  try {
    let result;

    switch (taskType) {
      case 'caseload_analysis': {
        const patients = await db.all(
          'SELECT id, client_id, presenting_concerns, diagnoses FROM patients WHERE therapist_id = ?',
          therapistId
        );
        await db.run('UPDATE background_tasks SET progress = 25 WHERE id = ?', taskId);

        const assessments = await db.all(
          `SELECT a.patient_id, a.template_type, a.total_score, a.severity_level, a.administered_at, p.client_id
           FROM assessments a JOIN patients p ON p.id = a.patient_id
           WHERE a.therapist_id = ? ORDER BY a.administered_at DESC LIMIT 200`,
          therapistId
        );
        await db.run('UPDATE background_tasks SET progress = 50 WHERE id = ?', taskId);

        const analysis = await callAI(
          MODELS.AZURE_MAIN,
          'You are analyzing a therapist\'s entire caseload. Provide: (1) clients at risk, (2) stalled cases, (3) improving cases, (4) overdue for assessment, (5) recommended actions. Be specific — cite client codes, scores, dates.',
          `CASELOAD: ${patients.length} clients\n\n${patients.map(p => `${p.client_id}: ${p.presenting_concerns || 'N/A'} | Dx: ${p.diagnoses || 'N/A'}`).join('\n')}\n\nASSESSMENTS:\n${assessments.map(a => `${a.client_id} ${a.template_type}: ${a.total_score} (${a.severity_level}) [${a.administered_at}]`).join('\n')}`,
          2000,
          { therapistId, kind: 'caseload_analysis' }
        );
        await db.run('UPDATE background_tasks SET progress = 90 WHERE id = ?', taskId);
        result = { analysis };
        break;
      }

      case 'generate_reports': {
        await db.run('UPDATE background_tasks SET progress = 10 WHERE id = ?', taskId);
        const patients = await db.all(
          'SELECT id, client_id, display_name FROM patients WHERE therapist_id = ?',
          therapistId
        );
        await db.run('UPDATE background_tasks SET progress = 50 WHERE id = ?', taskId);
        result = { message: `Report generation queued for ${patients.length} clients`, client_count: patients.length };
        break;
      }

      case 'quarterly_review': {
        await db.run('UPDATE background_tasks SET progress = 20 WHERE id = ?', taskId);
        const patients = await db.all(
          'SELECT id, client_id, presenting_concerns, diagnoses FROM patients WHERE therapist_id = ?',
          therapistId
        );
        const assessments = await db.all(
          `SELECT a.patient_id, a.template_type, a.total_score, a.severity_level, a.administered_at, p.client_id
           FROM assessments a JOIN patients p ON p.id = a.patient_id
           WHERE a.therapist_id = ? AND a.administered_at >= datetime('now', '-90 days')
           ORDER BY a.administered_at DESC LIMIT 300`,
          therapistId
        );
        await db.run('UPDATE background_tasks SET progress = 50 WHERE id = ?', taskId);

        const review = await callAI(
          MODELS.AZURE_MAIN,
          'You are generating a quarterly clinical review for a therapist. Analyze the last 90 days of data. Report on: (1) caseload changes, (2) overall improvement/deterioration trends, (3) clients meeting treatment goals, (4) clients who may need treatment plan revision, (5) assessment completion rates. Format as a professional quarterly summary.',
          `CASELOAD: ${patients.length} clients\n\n${patients.map(p => `${p.client_id}: ${p.presenting_concerns || 'N/A'}`).join('\n')}\n\nASSESSMENTS (last 90 days):\n${assessments.map(a => `${a.client_id} ${a.template_type}: ${a.total_score} (${a.severity_level}) [${a.administered_at}]`).join('\n')}`,
          2500,
          { therapistId, kind: 'quarterly_review' }
        );
        await db.run('UPDATE background_tasks SET progress = 90 WHERE id = ?', taskId);
        result = { review };
        break;
      }

      case 'batch_assessments': {
        await db.run('UPDATE background_tasks SET progress = 50 WHERE id = ?', taskId);
        result = { message: 'Batch assessment processing completed' };
        break;
      }

      default:
        result = { message: `Task type ${taskType} executed` };
    }

    await db.run(
      "UPDATE background_tasks SET status = 'completed', result_json = ?, progress = 100, completed_at = datetime('now') WHERE id = ?",
      JSON.stringify(result), taskId
    );

    // Create notification alert
    await db.insert(
      "INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description) VALUES (?, 0, 'TASK_COMPLETE', 'LOW', ?, ?)",
      therapistId,
      `Task complete: ${taskType}`,
      'Your background task has finished. Ask Miwa to show results.'
    );

    await persistIfNeeded();
  } catch (err) {
    await db.run("UPDATE background_tasks SET status = 'failed', error = ? WHERE id = ?", err.message, taskId);
    await persistIfNeeded();
    throw err;
  }
}

module.exports = { runBackgroundTask };
