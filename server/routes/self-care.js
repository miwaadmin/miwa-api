const express = require('express');
const router = express.Router();
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { TEMPLATES, scoreAssessment } = require('./assessments');

const TEMPLATE_TYPE = 'self-care';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function parseResponses(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map((response) => ({
    id: String(response?.id || ''),
    value: Number.isFinite(response?.value) || response?.value === '?' ? response.value : null,
    label: response?.label ? String(response.label) : undefined,
  }));
}

function rowToSelfCare(row) {
  if (!row) return null;
  return {
    id: row.id,
    total_score: Number(row.total_score) || 0,
    severity_level: row.severity_level,
    severity_color: row.severity_color,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    responses: row.responses ? JSON.parse(row.responses) : [],
  };
}

function weeklyStatus(latest) {
  if (!latest?.created_at) {
    return {
      due: true,
      next_due_at: null,
      days_until_due: 0,
    };
  }

  const lastDate = new Date(latest.created_at);
  if (Number.isNaN(lastDate.getTime())) {
    return { due: true, next_due_at: null, days_until_due: 0 };
  }

  const nextDue = new Date(lastDate.getTime() + WEEK_MS);
  const msUntilDue = nextDue.getTime() - Date.now();
  return {
    due: msUntilDue <= 0,
    next_due_at: nextDue.toISOString(),
    days_until_due: msUntilDue <= 0 ? 0 : Math.ceil(msUntilDue / (24 * 60 * 60 * 1000)),
  };
}

router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const rows = await db.all(
      `SELECT id, therapist_id, responses, total_score, severity_level, severity_color, created_at
         FROM therapist_self_care_assessments
        WHERE therapist_id = ?
        ORDER BY created_at DESC
        LIMIT 12`,
      tid,
    );
    const history = rows.map(rowToSelfCare);
    const latest = history[0] || null;
    res.json({
      template: TEMPLATES[TEMPLATE_TYPE],
      latest,
      history,
      weekly: weeklyStatus(latest),
    });
  } catch (err) {
    console.error('[self-care] GET failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const template = TEMPLATES[TEMPLATE_TYPE];
    const responses = parseResponses(req.body?.responses);
    if (!responses) {
      return res.status(400).json({ error: 'responses must be an array' });
    }

    const validQuestionIds = new Set(template.questions.map(q => q.id));
    const validResponses = responses.filter(response => (
      validQuestionIds.has(response.id) &&
      (
        response.value === '?' ||
        (
          Number.isFinite(response.value) &&
          response.value >= 0 &&
          response.value <= 3
        )
      )
    ));
    const numericResponses = validResponses.filter(response => (
      Number.isFinite(response.value)
    ));

    if (numericResponses.length === 0) {
      return res.status(400).json({ error: 'At least one rated self-care item is required' });
    }

    const { total, severityLevel, severityColor } = scoreAssessment(TEMPLATE_TYPE, validResponses);
    const result = await db.insert(
      `INSERT INTO therapist_self_care_assessments
         (therapist_id, responses, total_score, severity_level, severity_color)
       VALUES (?, ?, ?, ?, ?)`,
      tid,
      JSON.stringify(validResponses),
      total,
      severityLevel,
      severityColor,
    );
    await persistIfNeeded();

    const row = await db.get(
      `SELECT id, therapist_id, responses, total_score, severity_level, severity_color, created_at
         FROM therapist_self_care_assessments
        WHERE id = ? AND therapist_id = ?`,
      result.lastInsertRowid,
      tid,
    );
    const latest = rowToSelfCare(row);
    res.status(201).json({
      latest,
      weekly: weeklyStatus(latest),
    });
  } catch (err) {
    console.error('[self-care] POST failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
