const express = require('express');
const router = express.Router();
const { getAsyncDb } = require('../db/asyncDb');

// POST /api/digest/preview — returns digest data (JSON, for UI preview)
router.post('/preview', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    // Get practice stats
    const totalPatients = (await db.get('SELECT COUNT(*) as count FROM patients WHERE therapist_id = ?', tid)).count;
    const totalSessions7Days = (await db.get(
      "SELECT COUNT(*) as count FROM sessions WHERE therapist_id = ? AND created_at >= datetime('now', '-7 days')", tid
    )).count;
    const totalAssessments = (await db.get('SELECT COUNT(*) as count FROM assessments WHERE therapist_id = ?', tid)).count;
    const criticalAlerts = (await db.get(
      "SELECT COUNT(*) as count FROM progress_alerts WHERE therapist_id = ? AND severity = 'CRITICAL' AND dismissed_at IS NULL", tid
    )).count;
    const improvements = (await db.get(
      "SELECT COUNT(*) as count FROM assessments WHERE therapist_id = ? AND is_improvement = 1 AND created_at >= datetime('now', '-30 days')", tid
    )).count;

    // Clients with critical alerts
    const riskClients = await db.all(
      `SELECT p.client_id, p.id as patient_id, COUNT(al.id) as alert_count
       FROM progress_alerts al
       JOIN patients p ON al.patient_id = p.id
       WHERE al.therapist_id = ? AND al.severity = 'CRITICAL' AND al.dismissed_at IS NULL
       GROUP BY al.patient_id`, tid
    );

    // Overdue assessments (patients not assessed in 30+ days)
    const allPatients = await db.all(
      `SELECT p.id, p.client_id, MAX(a.administered_at) as last_assessment
       FROM patients p
       LEFT JOIN assessments a ON a.patient_id = p.id AND a.therapist_id = p.therapist_id
       WHERE p.therapist_id = ?
       GROUP BY p.id`, tid
    );
    const overdue = allPatients.filter(p => {
      if (!p.last_assessment) return true;
      const days = (Date.now() - new Date(p.last_assessment).getTime()) / (1000 * 60 * 60 * 24);
      return days > 30;
    });

    res.json({
      period: 'Last 30 days',
      generatedAt: new Date().toISOString(),
      stats: {
        totalPatients,
        totalSessions7Days,
        totalAssessments,
        criticalAlerts,
        improvements,
        overdueCount: overdue.length,
      },
      riskClients,
      overdueClients: overdue.slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
