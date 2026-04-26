/**
 * Public assessment routes — no authentication required.
 * These endpoints are accessed by clients via a one-time link.
 *
 * GET  /api/public/assess/:token  → returns template questions
 * POST /api/public/assess/:token  → submits completed responses
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb, persist } = require('../db');
const { TEMPLATES, scoreAssessment, generateAlerts } = require('./assessments');

// ── GET /api/public/assess/:token ─────────────────────────────────────────────
router.get('/assess/:token', (req, res) => {
  try {
    const db   = getDb();
    const link = db.get(
      'SELECT * FROM assessment_links WHERE token = ?',
      req.params.token,
    );

    if (!link) return res.status(404).json({ error: 'Link not found or has expired.' });
    if (link.completed_at) return res.status(410).json({ error: 'This assessment has already been completed. Thank you!' });
    if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired. Please contact your clinician for a new one.' });

    const template = TEMPLATES[link.template_type];
    if (!template) return res.status(500).json({ error: 'Assessment type not found.' });

    // Return only what the client needs — no patient record, no therapist info
    res.json({
      token:         link.token,
      template_type: link.template_type,
      name:          template.name,
      instructions:  template.instructions,
      questions:     template.questions,
      options:       template.options,
      expires_at:    link.expires_at,
      member_label:  link.member_label || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/public/assess/:token ────────────────────────────────────────────
router.post('/assess/:token', (req, res) => {
  try {
    const db   = getDb();
    const link = db.get(
      'SELECT * FROM assessment_links WHERE token = ?',
      req.params.token,
    );

    if (!link) return res.status(404).json({ error: 'Link not found.' });
    if (link.completed_at) return res.status(410).json({ error: 'This assessment has already been completed.' });
    if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired.' });

    const { responses, worst_event } = req.body;
    if (!responses || !Array.isArray(responses)) {
      return res.status(400).json({ error: 'responses array is required.' });
    }

    const template = TEMPLATES[link.template_type];
    if (!template) return res.status(500).json({ error: 'Assessment type not found.' });

    if (responses.length !== template.questions.length) {
      return res.status(400).json({ error: `Expected ${template.questions.length} responses, got ${responses.length}.` });
    }

    // Score it using the same engine as therapist-administered assessments
    const { total, severityLevel, severityColor } = scoreAssessment(link.template_type, responses);

    const patient = db.get('SELECT id, client_id FROM patients WHERE id = ?', link.patient_id);
    if (!patient) return res.status(404).json({ error: 'Patient record not found.' });

    // Baseline comparison
    const memberFilter = link.member_label
      ? ' AND member_label = ?'
      : ' AND (member_label IS NULL OR member_label = \'\')';
    const memberParams = link.member_label
      ? [link.patient_id, link.template_type, link.therapist_id, link.member_label]
      : [link.patient_id, link.template_type, link.therapist_id];

    const previous = db.get(
      `SELECT * FROM assessments WHERE patient_id = ? AND template_type = ? AND therapist_id = ?${memberFilter} ORDER BY administered_at DESC LIMIT 1`,
      ...memberParams,
    );
    const baseline = db.get(
      `SELECT total_score FROM assessments WHERE patient_id = ? AND template_type = ? AND therapist_id = ?${memberFilter} ORDER BY administered_at ASC LIMIT 1`,
      ...memberParams,
    );

    const scoreChange       = previous ? total - previous.total_score : null;
    const cst               = template.scoring.clinicalSignificanceThreshold;
    const isImprovement     = scoreChange !== null && scoreChange <= -cst ? 1 : 0;
    const isDeterioration   = scoreChange !== null && scoreChange >= cst  ? 1 : 0;
    const clinicallySignificant = (isImprovement || isDeterioration) ? 1 : 0;

    // Risk flags
    const riskFlagsList = [];
    if (link.template_type === 'phq-9' && responses[8]?.value >= 1) {
      riskFlagsList.push({ type: 'suicide_risk', question: 9, value: responses[8].value });
    }
    if (link.template_type === 'cssrs') {
      const activeIdeation = responses.slice(1).some(r => r && r.value === 1);
      if (activeIdeation) riskFlagsList.push({ type: 'suicide_risk', source: 'cssrs', active: true });
      else if (responses[0]?.value === 1) riskFlagsList.push({ type: 'suicide_risk', source: 'cssrs', passive: true });
    }
    if (link.template_type === 'pcl-5' && total >= 33) {
      riskFlagsList.push({ type: 'provisional_ptsd', score: total });
    }

    // Build notes — include worst_event for PCL-5 if provided
    const notes = (link.template_type === 'pcl-5' && worst_event?.trim())
      ? `Worst event (client-reported): ${worst_event.trim()}`
      : null;

    // Insert assessment
    const result = db.insert(
      `INSERT INTO assessments
        (patient_id, therapist_id, template_type, responses, total_score, severity_level, severity_color,
         baseline_score, previous_score, score_change, is_improvement, is_deterioration, clinically_significant,
         risk_flags, notes, member_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      link.patient_id, link.therapist_id, link.template_type,
      JSON.stringify(responses), total, severityLevel, severityColor,
      baseline?.total_score ?? total,
      previous?.total_score ?? null,
      scoreChange, isImprovement, isDeterioration, clinicallySignificant,
      JSON.stringify(riskFlagsList),
      notes,
      link.member_label || null,
    );

    const assessmentId = result.lastInsertRowid;

    // Generate alerts (same logic as therapist-submitted)
    const mockAssessment = { template_type: link.template_type, total_score: total, responses: JSON.stringify(responses) };
    const alerts = generateAlerts(mockAssessment, previous, patient, template);

    // Tag client-submitted alerts so therapist knows the source
    for (const alert of alerts) {
      db.insert(
        `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description, assessment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        link.patient_id, link.therapist_id,
        alert.type,
        alert.severity,
        `[Client Self-Report] ${alert.title}`,
        alert.description,
        assessmentId,
      );
    }

    // Mark link as completed
    db.run(
      'UPDATE assessment_links SET completed_at = CURRENT_TIMESTAMP, assessment_id = ? WHERE token = ?',
      assessmentId, link.token,
    );

    persist();

    // Determine if crisis resources should be shown
    const showCrisisResources =
      riskFlagsList.some(f => f.type === 'suicide_risk' && (f.active || (f.value && f.value >= 2)));

    res.json({
      ok: true,
      total_score: total,
      severity_level: severityLevel,
      show_crisis_resources: showCrisisResources,
    });
  } catch (err) {
    console.error('[public] assessment submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Between-Session Check-in (public, no auth) ────────────────────────────────

// GET /api/public/checkin/:token — return check-in form data
router.get('/checkin/:token', (req, res) => {
  try {
    const db = getDb();
    const link = db.get('SELECT * FROM checkin_links WHERE token = ?', req.params.token);
    if (!link) return res.status(404).json({ error: 'Check-in link not found or expired.' });
    if (link.completed_at) return res.json({ already_completed: true });
    if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This check-in link has expired.' });
    res.json({
      token: link.token,
      message: link.message,
      expires_at: link.expires_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/checkin/:token — client submits mood rating + optional note
router.post('/checkin/:token', (req, res) => {
  try {
    const db = getDb();
    const link = db.get('SELECT * FROM checkin_links WHERE token = ?', req.params.token);
    if (!link) return res.status(404).json({ error: 'Check-in link not found.' });
    if (link.completed_at) return res.status(409).json({ error: 'Already submitted.' });
    if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired.' });

    const { mood_score, mood_notes } = req.body;
    const score = parseInt(mood_score);
    if (!score || score < 1 || score > 10) return res.status(400).json({ error: 'mood_score must be 1–10.' });

    db.run(
      `UPDATE checkin_links SET completed_at = CURRENT_TIMESTAMP, mood_score = ?, mood_notes = ? WHERE token = ?`,
      score, (mood_notes || '').trim() || null, req.params.token
    );

    // Create proactive alert if mood is low (≤ 4)
    if (score <= 4) {
      try {
        const severity = score <= 2 ? 'HIGH' : 'MEDIUM';
        db.insert(
          `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
           VALUES (?, ?, 'LOW_MOOD_CHECKIN', ?, ?, ?)`,
          link.therapist_id,
          link.patient_id,
          severity,
          `Low mood check-in: ${score}/10`,
          `Client self-reported mood score of ${score}/10 in a between-session check-in.${mood_notes ? ` Note: "${mood_notes.slice(0, 200)}"` : ''}`
        );
      } catch {}
    }

    persist();
    res.json({ ok: true, mood_score: score });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL — magic-link access for therapy clients (no auth required)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a portal token and return the linked patient + therapist.
 * Returns { portalToken, patient, therapist } or null.
 */
function resolvePortalToken(db, token) {
  const row = db.get(
    'SELECT * FROM client_portal_tokens WHERE token = ?',
    token,
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  const patient = db.get('SELECT * FROM patients WHERE id = ?', row.patient_id);
  const therapist = db.get('SELECT id, first_name, last_name, full_name, telehealth_url FROM therapists WHERE id = ?', row.therapist_id);
  if (!patient || !therapist) return null;

  // Update last_accessed_at
  db.run('UPDATE client_portal_tokens SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?', row.id);

  return { portalToken: row, patient, therapist };
}

// ── GET /api/public/portal/:token — Validate token + return portal data ──────
router.get('/portal/:token', (req, res) => {
  try {
    const db = getDb();
    const ctx = resolvePortalToken(db, req.params.token);
    if (!ctx) return res.status(404).json({ error: 'Portal link not found or has expired. Please contact your therapist for a new link.' });

    const { patient, therapist, portalToken } = ctx;

    // Upcoming appointments
    const appointments = db.all(
      `SELECT id, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, status
       FROM appointments
       WHERE patient_id = ? AND therapist_id = ? AND status = 'scheduled'
         AND scheduled_start >= datetime('now')
       ORDER BY scheduled_start ASC LIMIT 10`,
      patient.id, therapist.id,
    );

    // Past appointments (last 5)
    const pastAppointments = db.all(
      `SELECT id, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, status
       FROM appointments
       WHERE patient_id = ? AND therapist_id = ? AND scheduled_start < datetime('now')
       ORDER BY scheduled_start DESC LIMIT 5`,
      patient.id, therapist.id,
    );

    // Pending assessments
    const pendingAssessments = db.all(
      `SELECT id, token, template_type, expires_at, created_at
       FROM assessment_links
       WHERE patient_id = ? AND therapist_id = ? AND completed_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
      patient.id, therapist.id,
    );

    // Completed assessments (last 10)
    const completedAssessments = db.all(
      `SELECT al.id, al.template_type, al.completed_at, a.total_score, a.severity_level
       FROM assessment_links al
       LEFT JOIN assessments a ON a.id = al.assessment_id
       WHERE al.patient_id = ? AND al.therapist_id = ? AND al.completed_at IS NOT NULL
       ORDER BY al.completed_at DESC LIMIT 10`,
      patient.id, therapist.id,
    );

    // Recent check-ins
    const recentCheckins = db.all(
      `SELECT id, mood_score, mood_notes, completed_at, created_at
       FROM checkin_links
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY created_at DESC LIMIT 5`,
      patient.id, therapist.id,
    );

    // Messages
    const messages = db.all(
      `SELECT id, sender, message, read_at, created_at
       FROM client_messages
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY created_at DESC LIMIT 50`,
      patient.id, therapist.id,
    );

    const therapistName = therapist.full_name
      || [therapist.first_name, therapist.last_name].filter(Boolean).join(' ')
      || 'Your therapist';

    res.json({
      client: {
        display_name: patient.display_name || patient.client_id,
        client_type: patient.client_type || 'individual',
      },
      therapist: {
        name: therapistName,
      },
      appointments,
      pastAppointments,
      pendingAssessments,
      completedAssessments,
      recentCheckins,
      messages,
      token_expires_at: portalToken.expires_at,
    });
  } catch (err) {
    console.error('[portal] load error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/public/portal/:token/message — Client sends a message ─────────
router.post('/portal/:token/message', (req, res) => {
  try {
    const db = getDb();
    const ctx = resolvePortalToken(db, req.params.token);
    if (!ctx) return res.status(404).json({ error: 'Portal link not found or has expired.' });

    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required.' });
    }

    const trimmed = message.trim().slice(0, 2000); // Cap at 2000 chars

    const result = db.insert(
      `INSERT INTO client_messages (patient_id, therapist_id, sender, message)
       VALUES (?, ?, 'client', ?)`,
      ctx.patient.id, ctx.therapist.id, trimmed,
    );

    // Create proactive alert for the therapist
    const clientName = ctx.patient.display_name || ctx.patient.client_id;
    try {
      db.insert(
        `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
         VALUES (?, ?, 'CLIENT_MESSAGE', 'LOW', ?, ?)`,
        ctx.therapist.id,
        ctx.patient.id,
        `New message from ${clientName}`,
        `${clientName} sent a message via the client portal: "${trimmed.slice(0, 100)}${trimmed.length > 100 ? '...' : ''}"`,
      );
    } catch {}

    persist();
    res.json({ ok: true, message_id: result.lastInsertRowid });
  } catch (err) {
    console.error('[portal] message error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/portal/:token/assessments — Pending assessments ─────────
router.get('/portal/:token/assessments', (req, res) => {
  try {
    const db = getDb();
    const ctx = resolvePortalToken(db, req.params.token);
    if (!ctx) return res.status(404).json({ error: 'Portal link not found or has expired.' });

    const pending = db.all(
      `SELECT id, token, template_type, expires_at, created_at
       FROM assessment_links
       WHERE patient_id = ? AND therapist_id = ? AND completed_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
      ctx.patient.id, ctx.therapist.id,
    );

    const completed = db.all(
      `SELECT al.id, al.template_type, al.completed_at, a.total_score, a.severity_level
       FROM assessment_links al
       LEFT JOIN assessments a ON a.id = al.assessment_id
       WHERE al.patient_id = ? AND al.therapist_id = ? AND al.completed_at IS NOT NULL
       ORDER BY al.completed_at DESC LIMIT 20`,
      ctx.patient.id, ctx.therapist.id,
    );

    res.json({ pending, completed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/portal/:token/appointments — Appointments ───────────────
router.get('/portal/:token/appointments', (req, res) => {
  try {
    const db = getDb();
    const ctx = resolvePortalToken(db, req.params.token);
    if (!ctx) return res.status(404).json({ error: 'Portal link not found or has expired.' });

    const upcoming = db.all(
      `SELECT id, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, status
       FROM appointments
       WHERE patient_id = ? AND therapist_id = ? AND status = 'scheduled'
         AND scheduled_start >= datetime('now')
       ORDER BY scheduled_start ASC LIMIT 20`,
      ctx.patient.id, ctx.therapist.id,
    );

    const past = db.all(
      `SELECT id, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, status
       FROM appointments
       WHERE patient_id = ? AND therapist_id = ? AND scheduled_start < datetime('now')
       ORDER BY scheduled_start DESC LIMIT 10`,
      ctx.patient.id, ctx.therapist.id,
    );

    res.json({ upcoming, past });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/portal/:token/messages — Message history ────────────────
router.get('/portal/:token/messages', (req, res) => {
  try {
    const db = getDb();
    const ctx = resolvePortalToken(db, req.params.token);
    if (!ctx) return res.status(404).json({ error: 'Portal link not found or has expired.' });

    const messages = db.all(
      `SELECT id, sender, message, read_at, created_at
       FROM client_messages
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY created_at ASC LIMIT 100`,
      ctx.patient.id, ctx.therapist.id,
    );

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
