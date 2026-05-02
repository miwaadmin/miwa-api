/**
 * Treatment Plan Revisions — versioned history for HIPAA/liability.
 *
 * Every mutation to a treatment plan or its goals writes a snapshot row.
 * Never overwrites. Lets clinicians answer "what did the plan say on March 5?"
 * for supervision, court, audit, and quality-of-care review.
 *
 * Usage:
 *   const { snapshotPlan } = require('../lib/treatmentPlanRevisions');
 *   // After any write to treatment_plans / treatment_goals:
 *   snapshotPlan(db, { planId, therapistId, changeKind: 'goal_updated',
 *                      changeDetail: 'Updated current_value to 8', authorKind: 'therapist', authorId: therapistId });
 */

async function snapshotPlan(db, { planId, therapistId, changeKind, changeDetail = null, authorKind = 'therapist', authorId = null }) {
  try {
    if (!planId || !therapistId) return null;

    // Load current plan + goals
    const plan = await db.get(
      `SELECT id, patient_id, therapist_id, status, last_reviewed_at, created_at
         FROM treatment_plans WHERE id = ?`,
      planId
    );
    if (!plan) return null;

    const goals = await db.all(
      `SELECT id, goal_text, target_metric, baseline_value, current_value,
              status, progress_notes_json, created_at, met_at, revised_at
         FROM treatment_goals WHERE plan_id = ? ORDER BY id ASC`,
      planId
    );

    // Compute next revision number
    const last = await db.get(
      `SELECT COALESCE(MAX(revision_num), 0) AS max_rev
         FROM treatment_plan_revisions WHERE plan_id = ?`,
      planId
    );
    const revisionNum = (last?.max_rev || 0) + 1;

    // Build snapshot payload
    const snapshot = {
      revision_num: revisionNum,
      plan: {
        id: plan.id,
        status: plan.status,
        last_reviewed_at: plan.last_reviewed_at,
        created_at: plan.created_at,
      },
      goals: goals.map(g => ({
        id: g.id,
        goal_text: g.goal_text,
        target_metric: g.target_metric,
        baseline_value: g.baseline_value,
        current_value: g.current_value,
        status: g.status,
        progress_notes: (() => { try { return JSON.parse(g.progress_notes_json || '[]'); } catch { return []; } })(),
        created_at: g.created_at,
        met_at: g.met_at,
        revised_at: g.revised_at,
      })),
      snapshotted_at: new Date().toISOString(),
    };

    await db.run(
      `INSERT INTO treatment_plan_revisions
         (plan_id, therapist_id, patient_id, revision_num, snapshot_json,
          change_kind, change_detail, author_kind, author_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      planId, therapistId, plan.patient_id, revisionNum,
      JSON.stringify(snapshot), changeKind, changeDetail, authorKind, authorId || therapistId
    );

    return revisionNum;
  } catch (err) {
    console.error('[tp-revisions] Failed to snapshot plan:', err.message);
    return null;
  }
}

/**
 * Get full revision history for a treatment plan.
 */
async function getRevisions(db, planId, { limit = 50 } = {}) {
  try {
    return await db.all(
      `SELECT id, revision_num, change_kind, change_detail, author_kind,
              author_id, created_at
         FROM treatment_plan_revisions
         WHERE plan_id = ?
         ORDER BY revision_num DESC
         LIMIT ?`,
      planId, limit
    );
  } catch { return []; }
}

/**
 * Get a specific revision with full snapshot.
 */
async function getRevision(db, planId, revisionNum) {
  try {
    const row = await db.get(
      `SELECT * FROM treatment_plan_revisions
         WHERE plan_id = ? AND revision_num = ?`,
      planId, revisionNum
    );
    if (!row) return null;
    return {
      ...row,
      snapshot: (() => { try { return JSON.parse(row.snapshot_json); } catch { return null; } })(),
    };
  } catch { return null; }
}

module.exports = { snapshotPlan, getRevisions, getRevision };
