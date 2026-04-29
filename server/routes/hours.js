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
  computeHourGrid,
  isManualEntryBucket,
  listManualEntryBuckets,
  listLeafBuckets,
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

    // Diagnostic: count past appointments that aren't counted because they
    // haven't been marked completed yet. This is the #1 reason a trainee's
    // hours stay at 0 despite having sessions on the calendar — surface it
    // so they can fix it instead of wondering.
    const nowIso = new Date().toISOString();
    const stuckRow = await db.get(
      `SELECT COUNT(*) AS n
       FROM appointments
       WHERE therapist_id = ?
         AND status = 'scheduled'
         AND scheduled_start IS NOT NULL
         AND scheduled_start < ?
         AND duration_minutes IS NOT NULL`,
      req.therapist.id, nowIso,
    );
    const uncountedScheduled = Number(stuckRow?.n) || 0;

    return res.json({ ...state, uncountedScheduled });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to compute hours' });
  }
});

// ─── GET /api/hours/grid ─────────────────────────────────────────────────────
// Per-bucket per-day hours for a date range — powers the Tevera-style
// Track grid view. Pass ?from=YYYY-MM-DD&to=YYYY-MM-DD (max 90 days).
router.get('/grid', async (req, res) => {
  try {
    const db = getAsyncDb();
    const programId = (req.query.program || 'csun_mft').toString();
    const tz = req.therapist?.preferred_timezone || 'America/Los_Angeles';
    const from = req.query.from;
    const to   = req.query.to;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
    const grid = await computeHourGrid(db, req.therapist.id, from, to, programId, tz);
    return res.json(grid);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to compute grid' });
  }
});

// ─── GET /api/hours/buckets ──────────────────────────────────────────────────
router.get('/buckets', async (req, res) => {
  const programId = (req.query.program || 'csun_mft').toString();
  return res.json({ program: programId, buckets: listManualEntryBuckets(programId) });
});

// ─── GET /api/hours/buckets/all ──────────────────────────────────────────────
// Every leaf bucket. Used by the per-appointment override picker so the
// therapist can re-categorize a session into any bucket (auto OR manual).
router.get('/buckets/all', async (req, res) => {
  const programId = (req.query.program || 'csun_mft').toString();
  return res.json({ program: programId, buckets: listLeafBuckets(programId) });
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

// ─── GET /api/hours/export.csv ───────────────────────────────────────────────
// CSV with two sections: bucket totals (one row per bucket) and the full
// list of manual entries. Suitable for handing to a supervisor or pasting
// into a BBS form. Uses CRLF line endings + RFC 4180 quoting so Excel,
// Numbers, and Sheets all open it cleanly.
router.get('/export.csv', async (req, res) => {
  try {
    const db = getAsyncDb();
    const programId = (req.query.program || 'csun_mft').toString();
    const state = await computeHourTotals(db, req.therapist.id, programId);
    const entries = await db.all(
      'SELECT date, bucket_id, hours, supervisor, site, notes FROM practice_hours WHERE therapist_id = ? ORDER BY date ASC, id ASC',
      req.therapist.id,
    );

    const lines = [];
    const esc = v => {
      if (v == null) return '';
      const s = String(v);
      // Quote if it contains a comma, quote, or newline; double internal quotes.
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const row = arr => lines.push(arr.map(esc).join(','));

    // Header banner
    row([`Miwa unofficial hour tracking · ${state.programLabel}`]);
    row([`Generated ${new Date().toISOString()} · ${state.totalSessions} completed sessions counted`]);
    row(['NOT a substitute for the official BBS 32A. For your reference only.']);
    row([]);

    // Section A: bucket totals (matches Progress view)
    row(['Section', 'Category', 'Hours', 'Min', 'Max', 'Percent of min', 'From appointments', 'From manual entries']);
    for (const b of state.buckets) {
      row([
        b.kind === 'rollup' ? 'rollup' : 'leaf',
        b.label,
        b.hours,
        b.minHours || '',
        b.maxHours || '',
        b.percentOfMin == null ? '' : `${b.percentOfMin}%`,
        b.fromAppointments,
        b.fromManual,
      ]);
    }
    row([]);

    // Section B: manual log entries
    row(['Manual log entries']);
    row(['Date', 'Category', 'Hours', 'Supervisor', 'Site', 'Notes']);
    for (const e of entries) {
      row([e.date, e.bucket_id, e.hours, e.supervisor || '', e.site || '', e.notes || '']);
    }

    const csv = lines.join('\r\n') + '\r\n';
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="miwa-hours-${programId}-${stamp}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to export hours' });
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
