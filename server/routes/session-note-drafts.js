const express = require('express');
const router = express.Router();
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

const MAX_DRAFT_BYTES = 2 * 1024 * 1024;

function normalizeDraftKey(value) {
  return String(value || '').trim().slice(0, 240);
}

function parsePatientId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function ownPatientOrNull(db, therapistId, patientId) {
  if (!patientId) return null;
  return db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
}

router.get('/:draftKey', async (req, res) => {
  try {
    const draftKey = normalizeDraftKey(req.params.draftKey);
    if (!draftKey) return res.status(400).json({ error: 'draft_key is required' });

    const db = getAsyncDb();
    const row = await db.get(
      `SELECT patient_id, draft_json, saved_at
         FROM session_note_drafts
        WHERE therapist_id = ? AND draft_key = ?`,
      req.therapist.id,
      draftKey,
    );
    if (!row) return res.status(404).json({ error: 'Draft not found' });

    let draft = null;
    try { draft = JSON.parse(row.draft_json || 'null'); } catch {}
    res.json({ patient_id: row.patient_id || null, draft, saved_at: row.saved_at });
  } catch (err) {
    console.error('[session-note-drafts] get failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:draftKey', async (req, res) => {
  try {
    const draftKey = normalizeDraftKey(req.params.draftKey);
    if (!draftKey) return res.status(400).json({ error: 'draft_key is required' });

    const draft = req.body?.draft;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      return res.status(400).json({ error: 'draft object is required' });
    }

    const patientId = parsePatientId(req.body?.patient_id);
    const db = getAsyncDb();
    if (patientId && !(await ownPatientOrNull(db, req.therapist.id, patientId))) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const draftJson = JSON.stringify(draft);
    if (Buffer.byteLength(draftJson, 'utf8') > MAX_DRAFT_BYTES) {
      return res.status(413).json({ error: 'Draft is too large' });
    }

    const savedAt = new Date().toISOString();
    const existing = await db.get(
      'SELECT id FROM session_note_drafts WHERE therapist_id = ? AND draft_key = ?',
      req.therapist.id,
      draftKey,
    );

    if (existing) {
      await db.run(
        `UPDATE session_note_drafts
            SET patient_id = ?, draft_json = ?, saved_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND therapist_id = ?`,
        patientId,
        draftJson,
        savedAt,
        existing.id,
        req.therapist.id,
      );
    } else {
      await db.insert(
        `INSERT INTO session_note_drafts (therapist_id, patient_id, draft_key, draft_json, saved_at)
         VALUES (?, ?, ?, ?, ?)`,
        req.therapist.id,
        patientId,
        draftKey,
        draftJson,
        savedAt,
      );
    }

    try { await persistIfNeeded(); } catch (err) {
      console.warn('[session-note-drafts] persist failed:', err?.message || err);
    }
    res.json({ saved_at: savedAt });
  } catch (err) {
    console.error('[session-note-drafts] save failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:draftKey', async (req, res) => {
  try {
    const draftKey = normalizeDraftKey(req.params.draftKey);
    if (!draftKey) return res.status(400).json({ error: 'draft_key is required' });

    const db = getAsyncDb();
    await db.run(
      'DELETE FROM session_note_drafts WHERE therapist_id = ? AND draft_key = ?',
      req.therapist.id,
      draftKey,
    );
    try { await persistIfNeeded(); } catch (err) {
      console.warn('[session-note-drafts] persist after delete failed:', err?.message || err);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[session-note-drafts] delete failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
