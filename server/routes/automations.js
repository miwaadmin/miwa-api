const express = require('express');
const router = express.Router();
const { getDb, persist } = require('../db');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /api/automations — list all rules for this therapist
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rules = db.all(
      `SELECT * FROM automation_rules WHERE therapist_id = ? ORDER BY created_at DESC`,
      req.therapist.id
    );
    res.json(rules.map(r => ({
      ...r,
      trigger_config: JSON.parse(r.trigger_config || '{}'),
      action_config: JSON.parse(r.action_config || '{}'),
    })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/automations — create a new rule
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, trigger_type, trigger_config, action_type, action_config } = req.body;

    if (!name || !trigger_type || !action_type) {
      return res.status(400).json({ error: 'name, trigger_type, and action_type are required' });
    }

    const result = db.insert(
      `INSERT INTO automation_rules (therapist_id, name, trigger_type, trigger_config, action_type, action_config)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.therapist.id, name, trigger_type,
      JSON.stringify(trigger_config || {}),
      action_type,
      JSON.stringify(action_config || {})
    );
    persist();

    res.json({ id: result, ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/automations/:id — update a rule (toggle enabled, change config)
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { enabled, name, trigger_config, action_config } = req.body;

    if (enabled !== undefined) {
      db.run('UPDATE automation_rules SET enabled = ? WHERE id = ? AND therapist_id = ?',
        enabled ? 1 : 0, req.params.id, req.therapist.id);
    }
    if (name) {
      db.run('UPDATE automation_rules SET name = ? WHERE id = ? AND therapist_id = ?',
        name, req.params.id, req.therapist.id);
    }
    if (trigger_config) {
      db.run('UPDATE automation_rules SET trigger_config = ? WHERE id = ? AND therapist_id = ?',
        JSON.stringify(trigger_config), req.params.id, req.therapist.id);
    }
    if (action_config) {
      db.run('UPDATE automation_rules SET action_config = ? WHERE id = ? AND therapist_id = ?',
        JSON.stringify(action_config), req.params.id, req.therapist.id);
    }
    persist();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/automations/:id — delete a rule
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.run('DELETE FROM automation_rules WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id);
    persist();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
