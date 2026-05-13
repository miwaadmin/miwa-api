'use strict';

const express = require('express');
const router = express.Router();
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

function parseLimit(value, fallback = 50) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(n, 100));
}

function cleanMessage(value) {
  return String(value || '').replace(/\s+\n/g, '\n').trim();
}

async function loadMessage(db, therapistId, messageId) {
  return db.get(
    `SELECT cm.id, cm.patient_id, cm.therapist_id, cm.sender, cm.sender_type, cm.message, cm.content,
            cm.risk_flag, cm.read_at, cm.created_at,
            p.client_id, p.display_name, p.client_type
       FROM client_messages cm
       JOIN patients p ON p.id = cm.patient_id
      WHERE cm.id = ? AND cm.therapist_id = ?`,
    messageId,
    therapistId,
  );
}

router.get('/summary', async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get(
      `SELECT
         SUM(CASE WHEN COALESCE(sender_type, sender) = 'client' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread,
         SUM(CASE WHEN risk_flag = 1 AND read_at IS NULL THEN 1 ELSE 0 END) AS risk_unread,
         COUNT(*) AS total
       FROM client_messages
      WHERE therapist_id = ?`,
      req.therapist.id,
    );
    const apptRequests = await db.get(
      `SELECT COUNT(*) AS c
       FROM client_appointment_requests
       WHERE therapist_id = ? AND status = 'pending'`,
      req.therapist.id,
    );
    res.json({
      unread: row?.unread || 0,
      risk_unread: row?.risk_unread || 0,
      appointment_requests: apptRequests?.c || 0,
      total: row?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/appointment-requests', async (req, res) => {
  try {
    const db = getAsyncDb();
    const status = req.query.status || null;
    const where = ['car.therapist_id = ?'];
    const params = [req.therapist.id];
    if (status) {
      where.push('car.status = ?');
      params.push(status);
    }
    const rows = await db.all(
      `SELECT car.id, car.patient_id, car.appointment_id, car.request_type, car.message, car.status,
              car.therapist_response, car.created_at, car.reviewed_at, car.updated_at,
              p.client_id, p.display_name,
              a.scheduled_start, a.scheduled_end, a.appointment_type
       FROM client_appointment_requests car
       JOIN patients p ON p.id = car.patient_id
       LEFT JOIN appointments a ON a.id = car.appointment_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE car.status WHEN 'pending' THEN 0 ELSE 1 END, car.created_at DESC
       LIMIT 100`,
      ...params,
    );
    res.json({ requests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/appointment-requests/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const status = ['approved', 'declined', 'countered', 'pending'].includes(req.body?.status)
      ? req.body.status
      : null;
    if (!status) return res.status(400).json({ error: 'Valid status is required.' });
    const request = await db.get(
      `SELECT * FROM client_appointment_requests WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    if (!request) return res.status(404).json({ error: 'Appointment request not found.' });
    const response = cleanMessage(req.body?.therapist_response).slice(0, 1000) || null;
    await db.run(
      `UPDATE client_appointment_requests
       SET status = ?, therapist_response = ?, reviewed_at = CASE WHEN ? = 'pending' THEN reviewed_at ELSE CURRENT_TIMESTAMP END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      status,
      response,
      status,
      req.params.id,
      req.therapist.id,
    );
    await db.insert(
      `INSERT INTO client_messages
         (patient_id, therapist_id, client_account_id, sender, sender_type, message, content, delivered_at)
       VALUES (?, ?, ?, 'system', 'system', ?, ?, CURRENT_TIMESTAMP)`,
      request.patient_id,
      req.therapist.id,
      request.client_account_id || null,
      `Appointment request ${status}.${response ? ` ${response}` : ''}`,
      `Appointment request ${status}.${response ? ` ${response}` : ''}`,
    );
    await db.insert(
      `INSERT INTO client_portal_audit_log
         (patient_id, therapist_id, client_account_id, action, metadata_json)
       VALUES (?, ?, ?, 'therapist_appointment_request_updated', ?)`,
      request.patient_id,
      req.therapist.id,
      request.client_account_id || null,
      JSON.stringify({ appointment_request_id: request.id, status }),
    );
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/messages', async (req, res) => {
  try {
    const db = getAsyncDb();
    const limit = parseLimit(req.query.limit);
    const patientId = req.query.patient_id ? Number.parseInt(req.query.patient_id, 10) : null;
    const unreadOnly = String(req.query.unread || '').toLowerCase() === 'true';

    const where = ['cm.therapist_id = ?'];
    const params = [req.therapist.id];
    if (Number.isFinite(patientId)) {
      where.push('cm.patient_id = ?');
      params.push(patientId);
    }
    if (unreadOnly) {
      where.push("COALESCE(cm.sender_type, cm.sender) = 'client'");
      where.push('cm.read_at IS NULL');
    }

    const rows = await db.all(
      `SELECT cm.id, cm.patient_id, cm.sender, cm.sender_type, cm.message, cm.content, cm.risk_flag, cm.read_at, cm.created_at,
              p.client_id, p.display_name, p.client_type
         FROM client_messages cm
         JOIN patients p ON p.id = cm.patient_id
        WHERE ${where.join(' AND ')}
        ORDER BY cm.risk_flag DESC, cm.created_at DESC, cm.id DESC
        LIMIT ?`,
      ...params,
      limit,
    );

    res.json({
      messages: rows.map(row => ({
        id: row.id,
        patient_id: row.patient_id,
        sender: row.sender_type || row.sender,
        message: row.content || row.message,
        risk_flag: !!row.risk_flag,
        read_at: row.read_at || null,
        created_at: row.created_at,
        patient: {
          id: row.patient_id,
          client_id: row.client_id,
          display_name: row.display_name || row.client_id || 'Client',
          client_type: row.client_type || 'individual',
        },
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/messages', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patientId = Number.parseInt(req.body?.patient_id, 10);
    const message = cleanMessage(req.body?.message);
    if (!Number.isFinite(patientId)) return res.status(400).json({ error: 'patient_id is required' });
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (message.length > 2000) return res.status(400).json({ error: 'message is too long' });

    const patient = await db.get(
      'SELECT id, client_id, display_name, client_type FROM patients WHERE id = ? AND therapist_id = ?',
      patientId,
      req.therapist.id,
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const insert = await db.insert(
      `INSERT INTO client_messages (patient_id, therapist_id, sender, sender_type, message, content)
       VALUES (?, ?, 'therapist', 'therapist', ?, ?)`,
      patient.id,
      req.therapist.id,
      message,
      message,
    );
    await persistIfNeeded();

    const row = await loadMessage(db, req.therapist.id, insert.lastInsertRowid);
    res.status(201).json({ ok: true, message: row });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/messages/:id/read', async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await loadMessage(db, req.therapist.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Message not found' });
    await db.run(
      `UPDATE client_messages
          SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/read-all', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      `UPDATE client_messages
          SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE therapist_id = ?
          AND COALESCE(sender_type, sender) = 'client'
          AND read_at IS NULL`,
      req.therapist.id,
    );
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
