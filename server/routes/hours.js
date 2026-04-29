/**
 * /api/hours — practice hour tracking for trainees and associates.
 *
 * GET    /                  — full hour-tracking state (auto-tally + manual)
 * GET    /entries           — list manual entries (optional ?from=&to=&bucket=)
 * POST   /entries           — create a manual entry
 * PUT    /entries/:id       — update a manual entry
 * DELETE /entries/:id       — delete a manual entry
 * GET    /buckets           — list manual-entry-eligible buckets (for the form)
 *
 * Gated to trainee + associate credential types so it doesn't clutter the
 * UI for already-licensed clinicians who don't need hour tracking.
 */
const express = require('express');
const router = express.Router();

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const {
  computeHourTotals,
  isManualEntryBucket,
  listManualEntryBuckets,
} = require('../services/practiceHours');

// Middleware: only trainees + associates have hour-tracking access. Licensed
// clinicians don't need it; the gate keeps the API small and predictable.
function requireTrainingCredential(req, res, next) {
  const cred = req.therapist?.credential_type || 'licensed';
  if (cred !== 'trainee' && cred !== 'associate') {
    return res.status(403).json({ error: 'Hour tracking is available on trainee and associate plans.' });
  }
  next();
}

router.use(requireTrainingCredential);

// ─── GET /api/hours ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const programId = (req.query.program || 'csun_mft').toString();
    const state = await computeHourTotals(db, req.therapist.id, programId);
    return res.json(state);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to compute hours' });
  }
});

// ─── GET /api/hours/buckets ──────────────────────────────────────────────────
router.get('/buckets', async (req, res) => {
  const programId = (req.query.program || 'csun_mft').toString();
  return res.json({ program: programId, buckets: listManualEntryBuckets(programId) });
});

// ─── GET /api/hours/entries ──────────────────────────────────────────────────
router.get('/entries', async (req, res) => {
  try {
    const db = getAsyncDb();
    const params = [req.therapist.id];
    let sql = 'SELECT * FROM practice_hours WHERE therapist_id = ?';
    if (req.query.from) { sql += ' AND date >= ?'; params.push(req.query.from); }
    if (req.query.to)   { sql += ' AND date <= ?'; params.push(req.query.to); }
    if (req.query.bucket) { sql += ' AND bucket_id = ?'; params.push(req.query.bucket); }
    sql += ' ORDER BY date DESC, id DESC';
    const rows = await db.all(sql, ...params);
    return res.json({ entries: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load entries' });
  }
});

// ─── POST /api/hours/entries ─────────────────────────────────────────────────
router.post('/entries', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { bucket_id, date, hours, supervisor, site, notes, program } = req.body || {};
    if (!bucket_id || !date || hours == null) {
      return res.status(400).json({ error: 'bucket_id, date, and hours are required' });
    }
    if (!isManualEntryBucket(bucket_id, program || 'csun_mft')) {
      return res.status(400).json({ error: 'That category isn\'t eligible for manual entry' });
    }
    const hrs = Number(hours);
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) {
      return res.status(400).json({ error: 'hours must be a positive number, max 24 per entry' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const result = await db.insert(
      `INSERT INTO practice_hours (therapist_id, bucket_id, date, hours, supervisor, site, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.therapist.id, bucket_id, date, hrs,
      supervisor || null, site || null, notes || null,
    );
    await persistIfNeeded();
    const entry = await db.get('SELECT * FROM practice_hours WHERE id = ?', result.lastInsertRowid);
    return res.status(201).json({ entry });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save entry' });
  }
});

// ─── PUT /api/hours/entries/:id ──────────────────────────────────────────────
router.put('/entries/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const existing = await db.get(
      'SELECT * FROM practice_hours WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const { bucket_id, date, hours, supervisor, site, notes } = req.body || {};
    const nextBucket = bucket_id || existing.bucket_id;
    const nextDate   = date      || existing.date;
    const nextHours  = hours == null ? existing.hours : Number(hours);
    if (!isManualEntryBucket(nextBucket)) {
      return res.status(400).json({ error: 'That category isn\'t eligible for manual entry' });
    }
    if (!Number.isFinite(nextHours) || nextHours <= 0 || nextHours > 24) {
      return res.status(400).json({ error: 'hours must be a positive number, max 24 per entry' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nextDate))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    await db.run(
      `UPDATE practice_hours SET
         bucket_id = ?, date = ?, hours = ?, supervisor = ?, site = ?, notes = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      nextBucket, nextDate, nextHours,
      supervisor !== undefined ? (supervisor || null) : existing.supervisor,
      site       !== undefined ? (site       || null) : existing.site,
      notes      !== undefined ? (notes      || null) : existing.notes,
      req.params.id, req.therapist.id,
    );
    await persistIfNeeded();
    const updated = await db.get('SELECT * FROM practice_hours WHERE id = ?', req.params.id);
    return res.json({ entry: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update entry' });
  }
});

// ─── DELETE /api/hours/entries/:id ───────────────────────────────────────────
router.delete('/entries/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const existing = await db.get(
      'SELECT id FROM practice_hours WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    await db.run('DELETE FROM practice_hours WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    await persistIfNeeded();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to delete entry' });
  }
});

module.exports = router;
