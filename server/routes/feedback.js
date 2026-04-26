const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

// POST /api/feedback — submit feedback (called from chat agent or directly)
router.post('/', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const { message, category = 'general', source = 'chat' } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Feedback message is required.' });
    }
    const validCategories = ['bug', 'feature', 'general'];
    const cat = validCategories.includes(category) ? category : 'general';

    await db.insert(
      `INSERT INTO user_feedback (therapist_id, message, category, source) VALUES (?, ?, ?, ?)`,
      req.therapist.id,
      String(message).trim(),
      cat,
      source === 'chat' ? 'chat' : 'form',
    );
    await persistIfNeeded();

    res.json({ ok: true, message: 'Feedback received — thank you! The Miwa team will review it.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
