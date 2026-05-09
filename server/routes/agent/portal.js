const express = require('express');
const { getAsyncDb, persistIfNeeded } = require('../../db/asyncDb');
const { sendRouteError } = require('./lib/helpers');
const { PORTAL_LINK_TTL_DAYS } = require('./tools/definitions');

const router = express.Router();

// ── POST /api/agent/portal-link — Generate a client portal magic link ────────
router.post('/portal-link', async (req, res) => {
  try {
    const db = getAsyncDb();
    const crypto = require('crypto');
    const { patient_id } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });

    const patient = await db.get(
      'SELECT * FROM patients WHERE id = ? AND therapist_id = ?',
      patient_id, req.therapist.id,
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const token = crypto.randomBytes(24).toString('base64url');
    await db.insert(
      `INSERT INTO client_portal_tokens (token, patient_id, therapist_id, expires_at)
       VALUES (?, ?, ?, datetime('now', '+7 days'))`,
      token, patient.id, req.therapist.id,
    );
    await persistIfNeeded();

    const baseUrl = process.env.APP_URL || 'https://miwa.care';
    const portalUrl = `${baseUrl}/portal/${token}`;

    res.json({
      ok: true,
      portal_url: portalUrl,
      token,
      expires_in: `${PORTAL_LINK_TTL_DAYS} days`,
      patient_id: patient.id,
      client_id: patient.client_id,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ── POST /api/agent/portal-message — Therapist sends message to client via portal ─
router.post('/portal-message', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { patient_id, message } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });

    const patient = await db.get(
      'SELECT * FROM patients WHERE id = ? AND therapist_id = ?',
      patient_id, req.therapist.id,
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const result = await db.insert(
      `INSERT INTO client_messages (patient_id, therapist_id, sender, message)
       VALUES (?, ?, 'therapist', ?)`,
      patient.id, req.therapist.id, message.trim().slice(0, 2000),
    );
    await persistIfNeeded();

    res.json({ ok: true, message_id: result.lastInsertRowid });
  } catch (err) {
    sendRouteError(res, err);
  }
});
module.exports = router;
