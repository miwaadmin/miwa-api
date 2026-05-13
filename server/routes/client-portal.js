const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const requireClientAuth = require('../middleware/clientAuth');
const { TEMPLATES, scoreAssessment, generateAlerts } = require('./assessments');
const { makeStorageKey, uploadLocalFile } = require('../services/fileStorage');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
router.use(requireClientAuth);

async function audit(db, req, action, metadata = null) {
  try {
    await db.insert(
      `INSERT INTO client_portal_audit_log
         (patient_id, therapist_id, client_account_id, action, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
      req.client.patient_id,
      req.client.therapist_id,
      req.client.id,
      action,
      metadata ? JSON.stringify(metadata) : null,
    );
  } catch {}
}

async function getOwnedPatient(db, req) {
  return db.get(
    `SELECT id, client_id, display_name, treatment_goals
     FROM patients
     WHERE id = ? AND therapist_id = ?`,
    req.client.patient_id,
    req.client.therapist_id,
  );
}

function normalizeMessage(row) {
  return {
    id: row.id,
    sender_type: row.sender_type || row.sender || 'client',
    content: row.content || row.message || '',
    read_at: row.read_at || null,
    delivered_at: row.delivered_at || null,
    client_viewed_at: row.client_viewed_at || null,
    therapist_viewed_at: row.therapist_viewed_at || null,
    risk_flag: !!row.risk_flag,
    created_at: row.created_at,
  };
}

function hasCrisisLanguage(text) {
  return /\b(kill myself|suicide|suicidal|end my life|want to die|hurt myself|self harm|overdose|can't go on|no reason to live)\b/i.test(String(text || ''));
}

function trendDirection(first, last, higherIsBetter = false) {
  if (first === null || first === undefined || last === null || last === undefined || first === last) return 'stable';
  const improved = higherIsBetter ? last > first : last < first;
  return improved ? 'improving' : 'increasing';
}

async function portalPayload(db, req) {
  const patient = await getOwnedPatient(db, req);
  if (!patient) return null;

  const therapist = await db.get(
    'SELECT id, first_name, last_name, full_name, telehealth_url FROM therapists WHERE id = ?',
    req.client.therapist_id,
  );
  const appointments = await db.all(
    `SELECT id, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, meet_url, status
     FROM appointments
     WHERE patient_id = ? AND therapist_id = ? AND status != 'cancelled'
     ORDER BY scheduled_start ASC LIMIT 25`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  const assessments = await db.all(
    `SELECT id, token, template_type, member_label, expires_at, completed_at, created_at
     FROM assessment_links
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  const homework = await db.all(
    `SELECT id, title, description, resource_url, due_at, completed_at, client_reflection, therapist_reviewed_at, created_at
     FROM client_homework_assignments
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)
     ORDER BY COALESCE(due_at, created_at) ASC LIMIT 50`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  const messages = await db.all(
    `SELECT id, sender_type, content, sender, message, read_at, client_viewed_at, therapist_viewed_at, created_at
     FROM client_messages
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)
     ORDER BY created_at ASC LIMIT 100`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  const unreadRow = await db.get(
    `SELECT COUNT(*) AS c
     FROM client_messages
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)
       AND sender_type = 'therapist' AND client_viewed_at IS NULL`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  const appointmentRequests = await db.all(
    `SELECT car.id, car.appointment_id, car.request_type, car.message, car.status, car.therapist_response,
            car.created_at, car.reviewed_at, car.updated_at,
            a.scheduled_start, a.scheduled_end, a.appointment_type
     FROM client_appointment_requests car
     LEFT JOIN appointments a ON a.id = car.appointment_id
     WHERE car.patient_id = ? AND car.therapist_id = ? AND (car.client_account_id IS NULL OR car.client_account_id = ?)
     ORDER BY car.created_at DESC LIMIT 10`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  const assessmentRows = await db.all(
    `SELECT id, template_type, total_score, severity_level, severity_color, administered_at, member_label
     FROM assessments
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY administered_at ASC, id ASC`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  const homeworkStats = await db.get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
     FROM client_homework_assignments
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  let goals = [];
  try {
    goals = await db.all(
      `SELECT tg.id, COALESCE(tg.client_visible_label, tg.goal_text) AS title, tg.status
       FROM treatment_goals tg
       JOIN treatment_plans tp ON tp.id = tg.plan_id
       WHERE tp.patient_id = ? AND tp.therapist_id = ? AND tp.status = 'active' AND COALESCE(tg.shared_with_client, 0) = 1
       ORDER BY tg.id ASC LIMIT 5`,
      req.client.patient_id,
      req.client.therapist_id,
    );
  } catch {}

  return {
    client: {
      display_name: req.client.display_name || patient.display_name || patient.client_id,
      email: req.client.email,
    },
    therapist: {
      name: therapist?.full_name || [therapist?.first_name, therapist?.last_name].filter(Boolean).join(' ') || 'Your clinician',
      telehealth_url: therapist?.telehealth_url || null,
    },
    appointments: req.client.appointment_visibility_enabled === 0 ? [] : appointments,
    appointment_requests: appointmentRequests,
    unread_counts: {
      messages: unreadRow?.c || 0,
    },
    assessments: assessments.map((a) => ({
      ...a,
      name: TEMPLATES[a.template_type]?.name || a.template_type,
      url: `/client/assessments?token=${encodeURIComponent(a.token)}`,
      expired: new Date(a.expires_at) < new Date(),
    })),
    homework: req.client.homework_enabled === 0 ? [] : homework,
    messages: messages.map(normalizeMessage),
    outcomes: buildOutcomeSeries(assessmentRows, homeworkStats),
    care_goals: goals,
    safety_resources: {
      emergency: 'If you may hurt yourself or someone else, call 911 or go to the nearest emergency room.',
      crisis: 'Call or text 988 for the Suicide & Crisis Lifeline in the United States.',
      note: req.client.emergency_boundary_message || 'Miwa is not crisis support and messages may not be read immediately.',
    },
    response_expectations: {
      response_window: req.client.response_window || 'Your therapist will respond when they are able.',
      office_hours: req.client.office_hours || null,
      emergency_boundary_message: req.client.emergency_boundary_message || 'For urgent or emergency needs, call 988, 911, or local emergency services.',
    },
    announcement: req.client.portal_announcement || null,
    checklist: (() => {
      try { return req.client.checklist_json ? JSON.parse(req.client.checklist_json) : null } catch { return null }
    })(),
  };
}

function buildOutcomeSeries(rows = [], homeworkStats = {}) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.template_type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      id: row.id,
      score: row.total_score,
      severity: row.severity_level,
      color: row.severity_color,
      date: row.administered_at,
      member_label: row.member_label || null,
    });
  }
  const assessments = [...grouped.entries()].map(([template_type, points]) => {
    const template = TEMPLATES[template_type] || {};
    const first = points[0]?.score;
    const latest = points[points.length - 1]?.score;
    return {
      template_type,
      name: template.name || template_type,
      higher_is_better: !!template.higherIsBetter,
      points,
      latest,
      first,
      trend: trendDirection(first, latest, !!template.higherIsBetter),
      latest_severity: points[points.length - 1]?.severity || null,
    };
  });
  const totalHomework = homeworkStats?.total || 0;
  const completedHomework = homeworkStats?.completed || 0;
  return {
    assessments,
    practice: {
      total: totalHomework,
      completed: completedHomework,
      completion_rate: totalHomework ? Math.round((completedHomework / totalHomework) * 100) : 0,
    },
  };
}

router.get('/home', async (req, res) => {
  const db = getAsyncDb();
  const payload = await portalPayload(db, req);
  if (!payload) return res.status(404).json({ error: 'Client record not found.' });
  await audit(db, req, 'view_portal_home');
  await persistIfNeeded();
  return res.json(payload);
});

router.get('/messages', async (req, res) => {
  const db = getAsyncDb();
  const messages = await db.all(
    `SELECT id, sender_type, content, sender, message, read_at, client_viewed_at, therapist_viewed_at, created_at
     FROM client_messages
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)
     ORDER BY created_at ASC LIMIT 100`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  await db.run(
    `UPDATE client_messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP), client_viewed_at = COALESCE(client_viewed_at, CURRENT_TIMESTAMP)
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?) AND sender_type = 'therapist'`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  await audit(db, req, 'read_messages');
  await persistIfNeeded();
  return res.json({ messages: messages.map(normalizeMessage) });
});

router.post('/messages', async (req, res) => {
  const db = getAsyncDb();
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Message is required.' });
  const patient = await getOwnedPatient(db, req);
  if (!patient) return res.status(404).json({ error: 'Client record not found.' });
  const riskFlag = hasCrisisLanguage(content) ? 1 : 0;
  const result = await db.insert(
    `INSERT INTO client_messages
       (patient_id, therapist_id, client_account_id, sender_type, content, risk_flag, sender, message, delivered_at)
     VALUES (?, ?, ?, 'client', ?, ?, 'client', ?, CURRENT_TIMESTAMP)`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
    content,
    riskFlag,
    content,
  );
  if (riskFlag) {
    await db.insert(
      `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
       VALUES (?, ?, 'CLIENT_MESSAGE_RISK', 'HIGH', ?, ?)`,
      req.client.therapist_id,
      req.client.patient_id,
      'Risk language in client portal message',
      `${patient.display_name || patient.client_id} sent a portal message that may need prompt clinical review.`,
    );
    await audit(db, req, 'client_message_risk_flagged', { message_id: result.lastInsertRowid });
  }
  await audit(db, req, 'send_message', { message_id: result.lastInsertRowid, risk_flag: !!riskFlag });
  await persistIfNeeded();
  return res.json({
    ok: true,
    safety_guidance: riskFlag
      ? 'If this is urgent or you may hurt yourself or someone else, call 911 or go to the nearest emergency room. In the U.S., call or text 988. Miwa messages are not monitored for immediate crisis support.'
      : null,
    message: { id: result.lastInsertRowid, sender_type: 'client', content, risk_flag: riskFlag, created_at: new Date().toISOString() },
  });
});

router.get('/assessments', async (req, res) => {
  const db = getAsyncDb();
  const rows = await db.all(
    `SELECT id, token, template_type, member_label, expires_at, completed_at, created_at
     FROM assessment_links
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  return res.json({
    assessments: rows.map((a) => ({
      ...a,
      name: TEMPLATES[a.template_type]?.name || a.template_type,
      expired: new Date(a.expires_at) < new Date(),
    })),
  });
});

router.get('/outcomes', async (req, res) => {
  const db = getAsyncDb();
  const rows = await db.all(
    `SELECT id, template_type, total_score, severity_level, severity_color, administered_at, member_label
     FROM assessments
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY administered_at ASC, id ASC`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  const homeworkStats = await db.get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
     FROM client_homework_assignments
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  await audit(db, req, 'view_outcomes');
  await persistIfNeeded();
  return res.json({ outcomes: buildOutcomeSeries(rows, homeworkStats) });
});

router.get('/assessments/:token', async (req, res) => {
  const db = getAsyncDb();
  const link = await db.get(
    `SELECT * FROM assessment_links
     WHERE token = ? AND patient_id = ? AND therapist_id = ?`,
    req.params.token,
    req.client.patient_id,
    req.client.therapist_id,
  );
  if (!link) return res.status(404).json({ error: 'Assessment not found.' });
  if (link.completed_at) return res.status(410).json({ error: 'This assessment has already been completed.' });
  if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This assessment has expired.' });
  const template = TEMPLATES[link.template_type];
  if (!template) return res.status(404).json({ error: 'Assessment type not found.' });
  await audit(db, req, 'open_assessment', { template_type: link.template_type });
  await persistIfNeeded();
  return res.json({
    token: link.token,
    template_type: link.template_type,
    name: template.name,
    instructions: template.instructions,
    questions: template.questions,
    options: template.options,
    member_label: link.member_label || null,
  });
});

router.post('/assessments/:token', async (req, res) => {
  const db = getAsyncDb();
  const link = await db.get(
    `SELECT * FROM assessment_links
     WHERE token = ? AND patient_id = ? AND therapist_id = ?`,
    req.params.token,
    req.client.patient_id,
    req.client.therapist_id,
  );
  if (!link) return res.status(404).json({ error: 'Assessment not found.' });
  if (link.completed_at) return res.status(410).json({ error: 'This assessment has already been completed.' });
  if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This assessment has expired.' });

  const { responses, worst_event } = req.body || {};
  const template = TEMPLATES[link.template_type];
  if (!template) return res.status(404).json({ error: 'Assessment type not found.' });
  if (!Array.isArray(responses) || responses.length !== template.questions.length) {
    return res.status(400).json({ error: 'All questions must be answered.' });
  }

  const { total, severityLevel, severityColor } = scoreAssessment(link.template_type, responses);
  const previous = await db.get(
    `SELECT * FROM assessments WHERE patient_id = ? AND template_type = ? AND therapist_id = ? ORDER BY administered_at DESC LIMIT 1`,
    link.patient_id,
    link.template_type,
    link.therapist_id,
  );
  const baseline = await db.get(
    `SELECT total_score FROM assessments WHERE patient_id = ? AND template_type = ? AND therapist_id = ? ORDER BY administered_at ASC LIMIT 1`,
    link.patient_id,
    link.template_type,
    link.therapist_id,
  );
  const scoreChange = previous ? total - previous.total_score : null;
  const cst = template.scoring.clinicalSignificanceThreshold;
  const isImprovement = scoreChange !== null && scoreChange <= -cst ? 1 : 0;
  const isDeterioration = scoreChange !== null && scoreChange >= cst ? 1 : 0;
  const riskFlagsList = [];
  if (link.template_type === 'phq-9' && responses[8]?.value >= 1) riskFlagsList.push({ type: 'suicide_risk', question: 9, value: responses[8].value });
  if (link.template_type === 'cssrs' && responses.some((r) => r?.value === 1)) riskFlagsList.push({ type: 'suicide_risk', source: 'cssrs', active: true });
  if (link.template_type === 'pcl-5' && total >= 33) riskFlagsList.push({ type: 'provisional_ptsd', score: total });
  const notes = (link.template_type === 'pcl-5' && worst_event?.trim()) ? `Worst event (client-reported): ${worst_event.trim()}` : null;
  const result = await db.insert(
    `INSERT INTO assessments
      (patient_id, therapist_id, template_type, responses, total_score, severity_level, severity_color,
       baseline_score, previous_score, score_change, is_improvement, is_deterioration, clinically_significant,
       risk_flags, notes, member_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    link.patient_id,
    link.therapist_id,
    link.template_type,
    JSON.stringify(responses),
    total,
    severityLevel,
    severityColor,
    baseline?.total_score ?? total,
    previous?.total_score ?? null,
    scoreChange,
    isImprovement,
    isDeterioration,
    (isImprovement || isDeterioration) ? 1 : 0,
    JSON.stringify(riskFlagsList),
    notes,
    link.member_label || null,
  );
  const assessmentId = result.lastInsertRowid;
  const patient = await getOwnedPatient(db, req);
  for (const alert of generateAlerts({ template_type: link.template_type, total_score: total, responses: JSON.stringify(responses) }, previous, patient, template)) {
    await db.insert(
      `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description, assessment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      link.patient_id,
      link.therapist_id,
      alert.type,
      alert.severity,
      `[Client Self-Report] ${alert.title}`,
      alert.description,
      assessmentId,
    );
  }
  await db.run('UPDATE assessment_links SET completed_at = CURRENT_TIMESTAMP, assessment_id = ? WHERE token = ?', assessmentId, link.token);
  await audit(db, req, 'complete_assessment', { template_type: link.template_type, assessment_id: assessmentId });
  await persistIfNeeded();
  return res.json({ ok: true, total_score: total, severity_level: severityLevel, show_crisis_resources: riskFlagsList.some((f) => f.type === 'suicide_risk') });
});

router.get('/homework', async (req, res) => {
  const db = getAsyncDb();
  const homework = await db.all(
    `SELECT id, title, description, resource_url, due_at, completed_at, client_reflection, therapist_reviewed_at, created_at
     FROM client_homework_assignments
     WHERE patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)
     ORDER BY COALESCE(due_at, created_at) ASC`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  await audit(db, req, 'open_homework');
  await persistIfNeeded();
  return res.json({ homework });
});

router.post('/homework/:id/complete', async (req, res) => {
  const db = getAsyncDb();
  const row = await db.get(
    `SELECT id FROM client_homework_assignments
     WHERE id = ? AND patient_id = ? AND therapist_id = ? AND (client_account_id IS NULL OR client_account_id = ?)`,
    req.params.id,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  if (!row) return res.status(404).json({ error: 'Homework not found.' });
  await db.run(
    'UPDATE client_homework_assignments SET completed_at = CURRENT_TIMESTAMP, client_reflection = COALESCE(?, client_reflection) WHERE id = ?',
    req.body?.client_reflection || null,
    row.id,
  );
  await audit(db, req, 'complete_homework', { homework_id: row.id });
  await db.insert(
    `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
     VALUES (?, ?, 'CLIENT_HOMEWORK_COMPLETE', 'LOW', 'Client completed practice item', 'A client completed a portal practice item.')`,
    req.client.therapist_id,
    req.client.patient_id,
  );
  await persistIfNeeded();
  return res.json({ ok: true });
});

router.post('/checklist', async (req, res) => {
  const db = getAsyncDb();
  const checklist = {
    consent: true,
    contact_preferences: !!req.body?.contact_preferences,
    viewed_next_appointment: !!req.body?.viewed_next_appointment,
    first_message: !!req.body?.first_message,
    pending_items: !!req.body?.pending_items,
  };
  await db.run('UPDATE client_portal_accounts SET checklist_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', JSON.stringify(checklist), req.client.id);
  await audit(db, req, 'client_checklist_updated', checklist);
  await persistIfNeeded();
  return res.json({ ok: true, checklist });
});

router.get('/appointments', async (req, res) => {
  const db = getAsyncDb();
  if (req.client.appointment_visibility_enabled === 0) return res.json({ appointments: [] });
  const appointments = await db.all(
    `SELECT id, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, meet_url, status
     FROM appointments
     WHERE patient_id = ? AND therapist_id = ? AND status != 'cancelled'
     ORDER BY scheduled_start ASC LIMIT 25`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  const requests = await db.all(
    `SELECT car.id, car.appointment_id, car.request_type, car.message, car.status, car.therapist_response,
            car.created_at, car.reviewed_at, car.updated_at
     FROM client_appointment_requests car
     WHERE car.patient_id = ? AND car.therapist_id = ? AND (car.client_account_id IS NULL OR car.client_account_id = ?)
     ORDER BY car.created_at DESC LIMIT 25`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
  );
  await audit(db, req, 'view_appointments');
  await persistIfNeeded();
  return res.json({ appointments, requests });
});

router.post('/appointments/:id/request', async (req, res) => {
  const db = getAsyncDb();
  const appt = await db.get(
    'SELECT id FROM appointments WHERE id = ? AND patient_id = ? AND therapist_id = ?',
    req.params.id,
    req.client.patient_id,
    req.client.therapist_id,
  );
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  const requestType = ['cancel', 'reschedule'].includes(req.body?.request_type) ? req.body.request_type : 'reschedule';
  const existing = await db.get(
    `SELECT id FROM client_appointment_requests
     WHERE patient_id = ? AND therapist_id = ? AND appointment_id = ?
       AND (client_account_id IS NULL OR client_account_id = ?) AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    req.client.patient_id,
    req.client.therapist_id,
    appt.id,
    req.client.id,
  );
  if (existing) return res.json({ ok: true, request_id: existing.id, status: 'pending' });
  const result = await db.insert(
    `INSERT INTO client_appointment_requests
       (patient_id, therapist_id, client_account_id, appointment_id, request_type, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    req.client.patient_id,
    req.client.therapist_id,
    req.client.id,
    appt.id,
    requestType,
    req.body?.message || null,
  );
  await db.insert(
    `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
     VALUES (?, ?, 'CLIENT_APPOINTMENT_REQUEST', 'MEDIUM', 'Client requested appointment change', 'A client requested a cancel or reschedule from the portal.')`,
    req.client.therapist_id,
    req.client.patient_id,
  );
  await audit(db, req, 'appointment_request_created', { appointment_id: appt.id, request_type: requestType });
  await persistIfNeeded();
  return res.json({ ok: true, request_id: result.lastInsertRowid, status: 'pending' });
});

router.get('/resources', async (_req, res) => {
  return res.json({
    resources: [
      { title: '988 Suicide & Crisis Lifeline', description: 'Call or text 988 in the United States.', url: 'https://988lifeline.org/' },
      { title: 'Emergency help', description: 'Call 911 or go to the nearest emergency room if there is immediate danger.', url: null },
    ],
  });
});

router.get('/documents', async (req, res) => {
  const db = getAsyncDb();
  const rows = await db.all(
    `SELECT id, original_name, file_type, document_label, created_at, client_uploaded
     FROM documents
     WHERE patient_id = ? AND therapist_id = ? AND (client_visible = 1 OR client_uploaded = 1)
     ORDER BY created_at DESC LIMIT 50`,
    req.client.patient_id,
    req.client.therapist_id,
  );
  await audit(db, req, 'document_viewed', { list: true });
  await persistIfNeeded();
  return res.json({ documents: rows });
});

router.post('/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  let storedPath = null;
  try {
    const db = getAsyncDb();
    const patient = await getOwnedPatient(db, req);
    if (!patient) return res.status(404).json({ error: 'Client record not found.' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const allowed = new Set(['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.webp']);
    if (!allowed.has(ext)) return res.status(400).json({ error: 'File type not supported.' });
    storedPath = await uploadLocalFile({
      localPath: req.file.path,
      key: makeStorageKey({
        therapistId: req.client.therapist_id,
        patientId: req.client.patient_id,
        originalName: req.file.originalname,
      }),
      contentType: req.file.mimetype,
    });
    if (storedPath !== req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    const result = await db.insert(
      `INSERT INTO documents
         (patient_id, therapist_id, original_name, file_type, document_label, document_kind, file_path, client_visible, client_uploaded)
       VALUES (?, ?, ?, ?, ?, 'record', ?, 1, 1)`,
      req.client.patient_id,
      req.client.therapist_id,
      path.basename(req.file.originalname).replace(/[^\w.\- ]+/g, '').slice(0, 160) || 'client-upload',
      ext.replace('.', '').toUpperCase(),
      req.body?.document_label || 'Client upload',
      storedPath,
    );
    await audit(db, req, 'document_uploaded', { document_id: result.lastInsertRowid });
    await persistIfNeeded();
    return res.status(201).json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    try {
      if (storedPath && fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
      else if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch {}
    return res.status(500).json({ error: 'Upload failed.' });
  }
});

router.get('/settings', (req, res) => {
  return res.json({
    client: {
      email: req.client.email,
      display_name: req.client.display_name,
      notification_email_enabled: !!req.client.notification_email_enabled,
      notification_sms_enabled: !!req.client.notification_sms_enabled,
      appointment_reminders_enabled: !!req.client.appointment_reminders_enabled,
      assessment_reminders_enabled: !!req.client.assessment_reminders_enabled,
      homework_reminders_enabled: !!req.client.homework_reminders_enabled,
    },
  });
});

router.put('/settings', async (req, res) => {
  const db = getAsyncDb();
  const bool = (value) => value ? 1 : 0;
  const smsAllowed = !!req.client.phone && !!req.client.portal_consent_at;
  await db.run(
    `UPDATE client_portal_accounts
     SET notification_email_enabled = ?,
         notification_sms_enabled = ?,
         appointment_reminders_enabled = ?,
         assessment_reminders_enabled = ?,
         homework_reminders_enabled = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    bool(req.body?.notification_email_enabled),
    smsAllowed ? bool(req.body?.notification_sms_enabled) : 0,
    bool(req.body?.appointment_reminders_enabled),
    bool(req.body?.assessment_reminders_enabled),
    bool(req.body?.homework_reminders_enabled),
    req.client.id,
  );
  await audit(db, req, 'portal_settings_changed');
  await persistIfNeeded();
  return res.json({ ok: true });
});

module.exports = router;
