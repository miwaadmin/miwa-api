/**
 * Unified Activity Feed API
 *
 * Single endpoint that UNIONs all the separate audit/activity tables into
 * a normalized timeline. Paperclip-inspired: one call answers "what happened
 * with this patient / for this therapist / in this date range".
 *
 * Sources:
 *   - event_logs             (auth, admin, system events)
 *   - agent_actions          (AI-initiated actions with approval)
 *   - outreach_log           (SMS/message deliveries)
 *   - workflow_steps         (multi-step workflow progress)
 *   - progress_alerts        (risk, improvement, stagnation flags)
 *   - scheduled_sends        (assessment SMS queue)
 *   - phi_access_log         (HIPAA PHI access trail)
 *
 * Normalized shape:
 *   { actor, action, entityType, entityId, patientId, detail, source,
 *     severity, createdAt }
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getDb } = require('../db');

router.use(requireAuth);

/**
 * GET /api/activity
 * Query params:
 *   patient_id    — scope to one patient
 *   from, to      — ISO date range (defaults: last 30 days)
 *   limit         — max rows (default 100, max 500)
 *   sources       — comma-separated subset of: logs,actions,outreach,
 *                   workflows,alerts,sends,phi
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const tid = req.therapist.id;
    const patientId = req.query.patient_id ? parseInt(req.query.patient_id, 10) : null;
    const from = req.query.from || "datetime('now', '-30 days')";
    const to = req.query.to || "datetime('now')";
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const allowed = new Set(['logs', 'actions', 'outreach', 'workflows', 'alerts', 'sends', 'phi']);
    const requested = req.query.sources
      ? new Set(req.query.sources.split(',').map(s => s.trim()).filter(s => allowed.has(s)))
      : allowed;

    // Use bound parameters for from/to when supplied as ISO strings
    const hasRange = !!(req.query.from && req.query.to);
    const range = hasRange
      ? { where: 'BETWEEN ? AND ?', args: [from, to] }
      : { where: `>= datetime('now', '-30 days')`, args: [] };

    const rows = [];

    // 1. event_logs — auth + system events
    if (requested.has('logs')) {
      try {
        const whereExtra = patientId ? '' : '';  // event_logs has no patient_id
        if (!patientId) {
          const evs = db.all(
            `SELECT id, event_type, status, message, meta_json, created_at
               FROM event_logs
              WHERE therapist_id = ? AND created_at ${range.where}
              ORDER BY created_at DESC LIMIT ?`,
            tid, ...range.args, limit
          );
          for (const e of evs) {
            rows.push({
              id: `log-${e.id}`,
              source: 'event_log',
              actor: 'system',
              action: e.event_type,
              entityType: 'event',
              entityId: null,
              patientId: null,
              title: e.event_type,
              detail: e.message,
              severity: e.status === 'failed' ? 'error' : 'info',
              createdAt: e.created_at,
            });
          }
        }
      } catch {}
    }

    // 2. agent_actions — approval-gated AI actions
    if (requested.has('actions')) {
      try {
        const patientFilter = patientId ? `AND json_extract(payload_json, '$.patientId') = ?` : '';
        const args = patientId ? [tid, ...range.args, patientId, limit] : [tid, ...range.args, limit];
        const actions = db.all(
          `SELECT id, kind, payload_json, status, created_at, completed_at
             FROM agent_actions
            WHERE therapist_id = ? AND created_at ${range.where} ${patientFilter}
            ORDER BY created_at DESC LIMIT ?`,
          ...args
        );
        for (const a of actions) {
          let payload = {};
          try { payload = JSON.parse(a.payload_json || '{}'); } catch {}
          rows.push({
            id: `action-${a.id}`,
            source: 'agent_action',
            actor: 'miwa',
            action: a.kind,
            entityType: 'action',
            entityId: a.id,
            patientId: payload.patientId || null,
            title: a.kind.replace(/_/g, ' '),
            detail: payload.notes || payload.scheduledStart || payload.description || null,
            severity: a.status === 'cancelled' ? 'warn' : 'info',
            status: a.status,
            createdAt: a.created_at,
          });
        }
      } catch {}
    }

    // 3. outreach_log — SMS deliveries
    if (requested.has('outreach')) {
      try {
        const patientFilter = patientId ? 'AND patient_id = ?' : '';
        const args = patientId
          ? [tid, ...range.args, patientId, limit]
          : [tid, ...range.args, limit];
        const outs = db.all(
          `SELECT id, patient_id, rule_id, outreach_type, channel, message_preview, status, created_at
             FROM outreach_log
            WHERE therapist_id = ? AND created_at ${range.where} ${patientFilter}
            ORDER BY created_at DESC LIMIT ?`,
          ...args
        );
        for (const o of outs) {
          rows.push({
            id: `outreach-${o.id}`,
            source: 'outreach',
            actor: 'miwa',
            action: o.outreach_type || 'outreach',
            entityType: 'message',
            entityId: o.id,
            patientId: o.patient_id,
            title: `${o.channel?.toUpperCase() || 'SMS'}: ${o.outreach_type || 'outreach'}`,
            detail: o.message_preview,
            severity: o.status === 'failed' ? 'error' : 'info',
            status: o.status,
            createdAt: o.created_at,
          });
        }
      } catch {}
    }

    // 4. workflow_steps — multi-step workflow progress
    if (requested.has('workflows')) {
      try {
        const patientFilter = patientId ? 'AND w.patient_id = ?' : '';
        const args = patientId
          ? [tid, ...range.args, patientId, limit]
          : [tid, ...range.args, limit];
        const steps = db.all(
          `SELECT ws.id, ws.workflow_id, ws.step_name, ws.status, ws.completed_at,
                  ws.started_at, w.workflow_type, w.patient_id
             FROM workflow_steps ws
             JOIN workflows w ON w.id = ws.workflow_id
            WHERE w.therapist_id = ? AND COALESCE(ws.completed_at, ws.started_at) ${range.where}
                  ${patientFilter}
            ORDER BY COALESCE(ws.completed_at, ws.started_at) DESC LIMIT ?`,
          ...args
        );
        for (const s of steps) {
          rows.push({
            id: `step-${s.id}`,
            source: 'workflow',
            actor: 'miwa',
            action: `${s.workflow_type}: ${s.step_name}`,
            entityType: 'workflow_step',
            entityId: s.id,
            patientId: s.patient_id,
            title: s.step_name,
            detail: `Workflow: ${s.workflow_type}`,
            severity: s.status === 'failed' ? 'error' : s.status === 'completed' ? 'success' : 'info',
            status: s.status,
            createdAt: s.completed_at || s.started_at,
          });
        }
      } catch {}
    }

    // 5. progress_alerts
    if (requested.has('alerts')) {
      try {
        const patientFilter = patientId ? 'AND patient_id = ?' : '';
        const args = patientId
          ? [tid, ...range.args, patientId, limit]
          : [tid, ...range.args, limit];
        const alerts = db.all(
          `SELECT id, patient_id, type, severity, title, description, created_at
             FROM progress_alerts
            WHERE therapist_id = ? AND created_at ${range.where} ${patientFilter}
            ORDER BY created_at DESC LIMIT ?`,
          ...args
        );
        for (const a of alerts) {
          rows.push({
            id: `alert-${a.id}`,
            source: 'alert',
            actor: 'miwa',
            action: a.type,
            entityType: 'alert',
            entityId: a.id,
            patientId: a.patient_id,
            title: a.title,
            detail: a.description,
            severity: a.severity === 'CRITICAL' ? 'error'
                    : a.severity === 'WARNING' ? 'warn'
                    : a.severity === 'SUCCESS' ? 'success' : 'info',
            createdAt: a.created_at,
          });
        }
      } catch {}
    }

    // 6. scheduled_sends — assessment SMS queue
    if (requested.has('sends')) {
      try {
        const patientFilter = patientId ? 'AND patient_id = ?' : '';
        const args = patientId
          ? [tid, ...range.args, patientId, limit]
          : [tid, ...range.args, limit];
        const sends = db.all(
          `SELECT id, patient_id, assessment_type, status, send_at, sent_at, error, created_at
             FROM scheduled_sends
            WHERE therapist_id = ? AND created_at ${range.where} ${patientFilter}
            ORDER BY created_at DESC LIMIT ?`,
          ...args
        );
        for (const s of sends) {
          rows.push({
            id: `send-${s.id}`,
            source: 'scheduled_send',
            actor: 'miwa',
            action: 'send_assessment',
            entityType: 'scheduled_send',
            entityId: s.id,
            patientId: s.patient_id,
            title: `Scheduled ${s.assessment_type}`,
            detail: s.error || (s.sent_at ? `Sent ${s.sent_at}` : `Pending ${s.send_at}`),
            severity: s.status === 'failed' ? 'error' : s.status === 'sent' ? 'success' : 'info',
            status: s.status,
            createdAt: s.created_at,
          });
        }
      } catch {}
    }

    // 7. phi_access_log — HIPAA audit trail
    if (requested.has('phi')) {
      try {
        const patientFilter = patientId ? 'AND patient_id = ?' : '';
        const args = patientId
          ? [tid, ...range.args, patientId, limit]
          : [tid, ...range.args, limit];
        const accesses = db.all(
          `SELECT id, action, resource, patient_id, method, status_code, created_at
             FROM phi_access_log
            WHERE therapist_id = ? AND created_at ${range.where} ${patientFilter}
            ORDER BY created_at DESC LIMIT ?`,
          ...args
        );
        for (const p of accesses) {
          rows.push({
            id: `phi-${p.id}`,
            source: 'phi_access',
            actor: 'therapist',
            action: p.action,
            entityType: 'phi_access',
            entityId: p.id,
            patientId: p.patient_id,
            title: `${p.method} ${p.resource}`,
            detail: `HTTP ${p.status_code}`,
            severity: p.status_code >= 400 ? 'warn' : 'info',
            createdAt: p.created_at,
          });
        }
      } catch {}
    }

    // Sort combined rows by createdAt desc, cap to limit
    rows.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });

    res.json({
      activity: rows.slice(0, limit),
      total_returned: Math.min(rows.length, limit),
      sources_included: Array.from(requested),
      filters: { patient_id: patientId, from: req.query.from || null, to: req.query.to || null },
    });
  } catch (err) {
    console.error('[activity] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
