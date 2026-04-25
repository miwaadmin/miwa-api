const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getDb, persist } = require('../db');

// POST /api/feedback — submit feedback (called from chat agent or directly)
router.post('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { message, category = 'general', source = 'chat' } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Feedback message is required.' });
    }
    const validCategories = ['bug', 'feature', 'general'];
    const cat = validCategories.includes(category) ? category : 'general';

    db.insert(
      `INSERT INTO user_feedback (therapist_id, message, category, source) VALUES (?, ?, ?, ?)`,
      req.therapist.id,
      String(message).trim(),
      cat,
      source === 'chat' ? 'chat' : 'form',
    );
    persist();

    res.json({ ok: true, message: 'Feedback received — thank you! The Miwa team will review it.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
