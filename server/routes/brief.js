const express = require('express');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

const router = express.Router();

function toBool(value) {
  return value === true || value === 1 || value === '1';
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function localDateFor(date, timezone) {
  return date.toLocaleString('sv-SE', {
    timeZone: timezone || 'America/Los_Angeles',
  }).slice(0, 10);
}

function startOfCurrentWeek(timezone) {
  const today = localDateFor(new Date(), timezone);
  const [year, month, day] = today.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceMonday);
  return utcDate.toISOString().slice(0, 10);
}

function serializeBrief(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    type: row.brief_type,
    brief_type: row.brief_type,
    local_date: row.local_date,
    timezone: row.timezone,
    created_at: row.created_at,
    saved: toBool(row.saved),
    saved_at: row.saved_at || null,
    opened_at: row.opened_at || null,
    articles: parseJson(row.articles_json, []),
    topics: parseJson(row.topics_json, []),
  };
}

async function getTherapistTimezone(db, therapistId) {
  const row = await db.get('SELECT preferred_timezone FROM therapists WHERE id = ?', therapistId);
  return row?.preferred_timezone || 'America/Los_Angeles';
}

async function deleteOldUnsavedBriefs(db, therapistId) {
  const result = await db.run(
    `DELETE FROM research_briefs
     WHERE therapist_id = ?
       AND COALESCE(saved, 0) = 0
       AND created_at < datetime('now', '-7 days')`,
    therapistId,
  );
  if ((result?.changes || 0) > 0) await persistIfNeeded();
}

router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const timezone = await getTherapistTimezone(db, therapistId);
    const today = localDateFor(new Date(), timezone);
    const weekStart = startOfCurrentWeek(timezone);

    await deleteOldUnsavedBriefs(db, therapistId);

    const thisWeekRows = await db.all(
      `SELECT id, therapist_id, brief_type, title, content, articles_json, topics_json,
              local_date, timezone, saved, saved_at, opened_at, created_at
       FROM research_briefs
       WHERE therapist_id = ?
         AND brief_type != 'crisis'
         AND (
           (local_date IS NOT NULL AND local_date BETWEEN ? AND ?)
           OR (local_date IS NULL AND created_at >= ?)
         )
       ORDER BY
         CASE WHEN local_date IS NULL THEN 1 ELSE 0 END ASC,
         local_date ASC,
         created_at ASC`,
      therapistId,
      weekStart,
      today,
      weekStart,
    );

    const savedRows = await db.all(
      `SELECT id, therapist_id, brief_type, title, content, articles_json, topics_json,
              local_date, timezone, saved, saved_at, opened_at, created_at
       FROM research_briefs
       WHERE therapist_id = ?
         AND COALESCE(saved, 0) = 1
         AND brief_type != 'crisis'
       ORDER BY COALESCE(saved_at, created_at) DESC, created_at DESC`,
      therapistId,
    );

    res.json({
      this_week: thisWeekRows.map(serializeBrief),
      saved: savedRows.map(serializeBrief),
      retention: {
        current_week_starts_on: weekStart,
        unsaved_delete_after_days: 7,
      },
    });
  } catch (err) {
    console.error('[brief] list error:', err);
    res.status(500).json({ error: 'Failed to load briefs' });
  }
});

router.post('/:id/save', async (req, res) => {
  try {
    const db = getAsyncDb();
    const brief = await db.get(
      `SELECT id, therapist_id, brief_type, title, content, articles_json, topics_json,
              local_date, timezone, saved, saved_at, opened_at, created_at
       FROM research_briefs
       WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    await db.run(
      `UPDATE research_briefs
       SET saved = 1, saved_at = COALESCE(saved_at, datetime('now'))
       WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    await persistIfNeeded();

    const updated = await db.get(
      `SELECT id, therapist_id, brief_type, title, content, articles_json, topics_json,
              local_date, timezone, saved, saved_at, opened_at, created_at
       FROM research_briefs
       WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    res.json({ brief: serializeBrief(updated) });
  } catch (err) {
    console.error('[brief] save error:', err);
    res.status(500).json({ error: 'Failed to save brief' });
  }
});

router.post('/:id/unsave', async (req, res) => {
  try {
    const db = getAsyncDb();
    const brief = await db.get(
      `SELECT id FROM research_briefs WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    await db.run(
      `UPDATE research_briefs
       SET saved = 0, saved_at = NULL
       WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    await persistIfNeeded();

    const updated = await db.get(
      `SELECT id, therapist_id, brief_type, title, content, articles_json, topics_json,
              local_date, timezone, saved, saved_at, opened_at, created_at
       FROM research_briefs
       WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id,
    );
    res.json({ brief: serializeBrief(updated) });
  } catch (err) {
    console.error('[brief] unsave error:', err);
    res.status(500).json({ error: 'Failed to unsave brief' });
  }
});

module.exports = router;
