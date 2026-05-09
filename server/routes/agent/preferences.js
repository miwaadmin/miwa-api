const express = require('express');
const { getAsyncDb, persistIfNeeded } = require('../../db/asyncDb');
const { sendRouteError } = require('./lib/helpers');
const { SOUL_CATEGORIES } = require('./lib/soul-profile');

const router = express.Router();

// ── Therapist Preferences (Soul Profile) API ──────────────────────────────────

// GET /api/agent/preferences — return all saved preferences for the logged-in therapist

router.get('/preferences', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT id, category, key, value, source, confidence, last_observed_at, created_at
       FROM therapist_preferences WHERE therapist_id = ? ORDER BY category, last_observed_at DESC`,
      req.therapist.id
    );
    res.json({ preferences: rows || [] });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// POST /api/agent/preferences — explicitly set or update a preference
// Body: { category, key, value }
router.post('/preferences', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { category, key, value } = req.body || {};
    if (!category || !key || !value) {
      return res.status(400).json({ error: 'category, key, and value are required' });
    }
    if (!SOUL_CATEGORIES[category]) {
      return res.status(400).json({ error: `category must be one of: ${Object.keys(SOUL_CATEGORIES).join(', ')}` });
    }

    const existing = await db.get(
      'SELECT id FROM therapist_preferences WHERE therapist_id = ? AND category = ? AND key = ?',
      req.therapist.id, category, key
    );
    if (existing) {
      await db.run(
        `UPDATE therapist_preferences SET value = ?, source = 'explicit', last_observed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        value, existing.id
      );
    } else {
      await db.insert(
        `INSERT INTO therapist_preferences (therapist_id, category, key, value, source) VALUES (?, ?, ?, ?, 'explicit')`,
        req.therapist.id, category, key, value
      );
    }
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// DELETE /api/agent/preferences/:id — remove a specific preference
router.delete('/preferences/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const pref = await db.get(
      'SELECT id FROM therapist_preferences WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id
    );
    if (!pref) return res.status(404).json({ error: 'Preference not found' });
    await db.run('DELETE FROM therapist_preferences WHERE id = ?', req.params.id);
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err);
  }
});
module.exports = router;
