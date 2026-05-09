const { findPatientByCode, findPatientByDisplayName } = require('./patient-context');

/**
 * Find patients matching batch assessment criteria.
 * Filter: "anxiety_cases", "all", or null defaults to "all"
 */
async function findPatientsForBatchAssessment(db, therapistId, filter = null) {
  let patients = await db.all(
    'SELECT id, display_name, client_id, diagnoses, presenting_concerns, phone, sms_consent FROM patients WHERE therapist_id = ?',
    therapistId
  );

  if (!patients) return [];

  if (filter === 'anxiety_cases') {
    patients = patients.filter(p => {
      const diag = (p.diagnoses || '').toLowerCase();
      const concern = (p.presenting_concerns || '').toLowerCase();
      return diag.includes('anxiety') || concern.includes('anxiety');
    });
  } else if (filter === 'depression_cases') {
    patients = patients.filter(p => {
      const diag = (p.diagnoses || '').toLowerCase();
      const concern = (p.presenting_concerns || '').toLowerCase();
      return diag.includes('depression') || diag.includes('depressive') || concern.includes('depression');
    });
  } else if (filter === 'trauma_cases') {
    patients = patients.filter(p => {
      const diag = (p.diagnoses || '').toLowerCase();
      return diag.includes('ptsd') || diag.includes('trauma');
    });
  }
  // filter === 'all' or unknown: return all

  return patients;
}

/**
 * Fetch assessment history for a specific client.
 * Returns latest N assessments with scores, dates, and trends.
 */
async function getClientAssessments(db, therapistId, patientIdOrName, limit = 5) {
  let patient = null;

  // Try to find patient by ID first
  if (typeof patientIdOrName === 'number') {
    patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientIdOrName, therapistId);
  } else {
    // Try by display_name or client_id
    patient = await findPatientByDisplayName(db, therapistId, patientIdOrName)
      || await findPatientByCode(db, therapistId, patientIdOrName);
  }

  if (!patient) return null;

  const assessments = await db.all(
    `SELECT id, template_type, total_score, severity_level, administered_at, is_improvement, is_deterioration
     FROM assessments WHERE patient_id = ? AND therapist_id = ?
     ORDER BY administered_at DESC LIMIT ?`,
    patient.id, therapistId, limit
  );

  return {
    clientName: patient.display_name || patient.client_id,
    clientId: patient.client_id,
    assessments: assessments.reverse().map(a => ({
      date: (a.administered_at || '').slice(0, 10),
      type: a.template_type,
      score: a.total_score,
      severity: a.severity_level,
      improved: a.is_improvement === 1,
      deteriorated: a.is_deterioration === 1,
    })),
  };
}

/**
 * Fetch session history for a specific client.
 * Returns latest N sessions with key notes and themes.
 */
async function getClientSessions(db, therapistId, patientIdOrName, limit = 5) {
  let patient = null;

  if (typeof patientIdOrName === 'number') {
    patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientIdOrName, therapistId);
  } else {
    patient = await findPatientByDisplayName(db, therapistId, patientIdOrName)
      || await findPatientByCode(db, therapistId, patientIdOrName);
  }

  if (!patient) return null;

  const sessions = await db.all(
    `SELECT id, session_date, note_format, subjective, objective, assessment, plan, created_at
     FROM sessions WHERE patient_id = ? AND therapist_id = ?
     ORDER BY COALESCE(session_date, created_at) DESC LIMIT ?`,
    patient.id, therapistId, limit
  );

  return {
    clientName: patient.display_name || patient.client_id,
    clientId: patient.client_id,
    sessions: sessions.reverse().map(s => ({
      date: (s.session_date || s.created_at || '').slice(0, 10),
      format: s.note_format,
      subjective: (s.subjective || '').slice(0, 100),
      assessment: (s.assessment || '').slice(0, 100),
      plan: (s.plan || '').slice(0, 100),
    })),
  };
}

/**
 * Get caseload summary with filtering options.
 */
async function getCaseloadSummaryFiltered(db, therapistId, filter = null) {
  const patients = await db.all(
    `SELECT id, display_name, client_id, presenting_concerns, risk_screening FROM patients
     WHERE therapist_id = ? ORDER BY display_name ASC`,
    therapistId
  );

  if (!patients || patients.length === 0) {
    return { count: 0, clients: [] };
  }

  let filtered = patients;

  if (filter === 'risk_flagged') {
    filtered = patients.filter(p => p.risk_screening && p.risk_screening.toLowerCase().includes('passive'));
  } else if (filter === 'overdue_assessment') {
    filtered = [];
    for (const p of patients) {
      const latest = await db.get(
        'SELECT administered_at FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 1',
        p.id
      );
      if (!latest) {
        filtered.push(p);
        continue;
      }
      const daysAgo = Math.floor((new Date() - new Date(latest.administered_at)) / (1000 * 60 * 60 * 24));
      if (daysAgo > 30) filtered.push(p);
    }
  } else if (filter === 'improving') {
    filtered = [];
    for (const p of patients) {
      const latest = await db.get(
        'SELECT is_improvement FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 1',
        p.id
      );
      if (latest?.is_improvement === 1) filtered.push(p);
    }
  } else if (filter === 'deteriorating') {
    filtered = [];
    for (const p of patients) {
      const latest = await db.get(
        'SELECT is_deterioration FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 1',
        p.id
      );
      if (latest?.is_deterioration === 1) filtered.push(p);
    }
  }

  const clients = [];
  for (const p of filtered) {
    const latest = await db.get(
      'SELECT template_type, total_score, severity_level FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 1',
      p.id
    );
    const riskFlag = p.risk_screening && p.risk_screening.toLowerCase().includes('passive');
    clients.push({
      name: p.display_name || p.client_id,
      clientId: p.client_id,
      presenting: (p.presenting_concerns || 'N/A').slice(0, 60),
      latestAssessment: latest ? `${latest.template_type}: ${latest.total_score} (${latest.severity_level})` : 'none',
      atRisk: riskFlag,
    });
  }

  return {
    count: filtered.length,
    clients,
  };
}

module.exports = {
  findPatientsForBatchAssessment,
  getClientAssessments,
  getClientSessions,
  getCaseloadSummaryFiltered,
};
