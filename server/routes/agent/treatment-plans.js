const express = require('express');
const { getAsyncDb } = require('../../db/asyncDb');
const { sendRouteError } = require('./lib/helpers');

const router = express.Router();

// ── Treatment plan revision history API ──────────────────────────────────────
// GET /api/agent/treatment-plans/:planId/revisions — list all revisions
// GET /api/agent/treatment-plans/:planId/revisions/:num — get one full snapshot
const { getRevisions, getRevision } = require('../../lib/treatmentPlanRevisions');

router.get('/treatment-plans/:planId/revisions', async (req, res) => {
  try {
    const db = getAsyncDb();
    const plan = await db.get(
      'SELECT id FROM treatment_plans WHERE id = ? AND therapist_id = ?',
      req.params.planId, req.therapist.id
    );
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const revs = await getRevisions(db, req.params.planId);
    res.json({ plan_id: Number(req.params.planId), revisions: revs });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/treatment-plans/:planId/revisions/:num', async (req, res) => {
  try {
    const db = getAsyncDb();
    const plan = await db.get(
      'SELECT id FROM treatment_plans WHERE id = ? AND therapist_id = ?',
      req.params.planId, req.therapist.id
    );
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const rev = await getRevision(db, req.params.planId, parseInt(req.params.num, 10));
    if (!rev) return res.status(404).json({ error: 'Revision not found' });
    res.json(rev);
  } catch (err) {
    sendRouteError(res, err);
  }
});
module.exports = router;
