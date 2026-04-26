const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const requireAuth = require('../middleware/auth');
const { generateBriefForTherapist } = require('../services/researcher');
const { getLatestNews, fetchAndStoreNews } = require('../services/newsService');
const { generateDailyBriefing } = require('../services/dailyBriefing');

router.use(requireAuth);

// GET /api/research/daily-briefing — today's "Your Day" summary
// Auto-generates if one doesn't exist yet for today.
// Pass ?regenerate=1 to force a rebuild (deletes existing and recomputes).
router.get('/daily-briefing', async (req, res) => {
  try {
    const db = getDb();
    const therapist = db.get('SELECT preferred_timezone FROM therapists WHERE id = ?', req.therapist.id);
    const tz = therapist?.preferred_timezone || 'America/Los_Angeles';
    const todayLocal = new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);

    // Force-regenerate if requested
    if (req.query.regenerate === '1') {
      try {
        db.run(
          `DELETE FROM daily_briefings WHERE therapist_id = ? AND local_date = ?`,
          req.therapist.id, todayLocal
        );
      } catch (err) {
        console.error('[daily-briefing] regenerate delete failed:', err.message);
      }
    }

    let briefing = db.get(
      `SELECT id, local_date, markdown, stats_json, narrative, caseload_json,
              emailed_at, opened_at, created_at
         FROM daily_briefings
        WHERE therapist_id = ? AND local_date = ?`,
      req.therapist.id, todayLocal
    );

    // Self-healing check: briefings cached from an older template version
    // still have the deprecated "## Needs Attention", "## Good News", or
    // "---\n*Generated at" footer baked into their markdown. When we see
    // those markers in an existing row, delete and regenerate so the user
    // gets the current template without having to click ↻ manually.
    if (briefing && briefing.markdown && (
      /^##\s+Today['\u2019]s Schedule/mi.test(briefing.markdown) ||
      /^##\s+Needs Attention/mi.test(briefing.markdown) ||
      /^##\s+Good News/mi.test(briefing.markdown) ||
      /\*Generated at\s+\d/i.test(briefing.markdown)
    )) {
      try {
        db.run('DELETE FROM daily_briefings WHERE id = ?', briefing.id);
      } catch {}
      briefing = null;
    }

    // If no briefing yet, generate on demand (also happens in morning cron)
    if (!briefing) {
      const result = await generateDailyBriefing(req.therapist.id);
      if (result && result.id) {
        briefing = db.get(
          `SELECT id, local_date, markdown, stats_json, narrative, caseload_json,
                  emailed_at, opened_at, created_at
             FROM daily_briefings WHERE id = ?`,
          result.id
        );
      } else {
        console.error('[daily-briefing] generateDailyBriefing returned no id for therapist', req.therapist.id);
      }
    }

    if (!briefing) {
      console.error('[daily-briefing] No briefing available for therapist', req.therapist.id, 'date', todayLocal);
      return res.json(null);
    }

    res.json({
      ...briefing,
      stats: briefing.stats_json ? JSON.parse(briefing.stats_json) : null,
      caseload: briefing.caseload_json ? JSON.parse(briefing.caseload_json) : null,
    });
  } catch (err) {
    console.error('[daily-briefing] route error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/research/daily-briefing/:id/open — mark as opened
router.post('/daily-briefing/:id/open', (req, res) => {
  try {
    const db = getDb();
    db.run(
      `UPDATE daily_briefings SET opened_at = COALESCE(opened_at, datetime('now'))
         WHERE id = ? AND therapist_id = ?`,
      req.params.id, req.therapist.id
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/research/briefs — latest briefs for this therapist
// Auto-triggers generation on first visit if 0 briefs exist.
// Excludes expired briefs: unopened >3 days or unsaved >7 days old.
router.get('/briefs', (req, res) => {
  try {
    const db = getDb();
    const briefs = db.all(
      `SELECT id, brief_type, title, content, articles_json, topics_json, sent_email, saved, opened_at, created_at
       FROM research_briefs
       WHERE therapist_id = ?
         AND (
           saved = 1
           OR (opened_at IS NOT NULL AND created_at > datetime('now', '-7 days'))
           OR (opened_at IS NULL AND created_at > datetime('now', '-3 days'))
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      req.therapist.id
    );

    // Auto-trigger first brief if none exist and therapist has patients
    // Guard: skip if one was already kicked off today (prevents double-fire on rapid page loads)
    if (briefs.length === 0) {
      const hasPatients = db.get('SELECT COUNT(*) as c FROM patients WHERE therapist_id = ?', req.therapist.id);
      const alreadyToday = db.get(
        `SELECT id FROM research_briefs WHERE therapist_id = ? AND date(created_at) = date('now')`,
        req.therapist.id
      );
      if (hasPatients?.c > 0 && !alreadyToday) {
        generateBriefForTherapist(req.therapist.id, 'daily').catch(e =>
          console.error('[research] Auto-generate first brief error:', e.message)
        );
      }
    }

    res.json(briefs.map(b => ({
      ...b,
      saved: !!b.saved,
      articles: b.articles_json ? JSON.parse(b.articles_json) : [],
      topics: b.topics_json ? JSON.parse(b.topics_json) : [],
    })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/research/latest — just the most recent brief
router.get('/latest', (req, res) => {
  try {
    const db = getDb();
    const brief = db.get(
      `SELECT id, brief_type, title, content, articles_json, topics_json, created_at
       FROM research_briefs
       WHERE therapist_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      req.therapist.id
    );
    if (!brief) return res.json(null);
    res.json({
      ...brief,
      articles: brief.articles_json ? JSON.parse(brief.articles_json) : [],
      topics: brief.topics_json ? JSON.parse(brief.topics_json) : [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/research/generate — manually trigger a brief
router.post('/generate', async (req, res) => {
  try {
    const { type = 'daily' } = req.body;
    const db = getDb();

    // Block any non-crisis brief within the last 24 hours (type-agnostic so 'weekly' old records also count)
    const briefCheckSql = type === 'crisis'
      ? `SELECT id FROM research_briefs WHERE therapist_id = ? AND brief_type = 'crisis' AND created_at > datetime('now', '-24 hours')`
      : `SELECT id FROM research_briefs WHERE therapist_id = ? AND brief_type != 'crisis' AND created_at > datetime('now', '-24 hours')`;
    const alreadyToday = db.get(briefCheckSql, req.therapist.id);
    if (alreadyToday) {
      return res.status(429).json({
        error: `A ${type === 'crisis' ? 'crisis' : 'daily'} brief was already generated today. Come back tomorrow or delete today's brief first.`,
      });
    }

    console.log(`[research] Manual generate started for therapist_id=${req.therapist.id} type=${type}`);

    // Await the generation so we can report errors to the frontend
    await generateBriefForTherapist(req.therapist.id, type);

    console.log(`[research] Manual generate completed for therapist_id=${req.therapist.id}`);
    res.json({ ok: true, message: 'Research brief generated successfully.' });
  } catch (err) {
    console.error('[research] Manual generate FAILED:', err.message);
    res.status(500).json({ error: 'Brief generation failed. Please try again later.' });
  }
});

// POST /api/research/briefs/:id/save — toggle save on a brief (saved briefs never auto-decay)
router.post('/briefs/:id/save', (req, res) => {
  try {
    const db = getDb();
    const brief = db.get(
      'SELECT id, saved FROM research_briefs WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id
    );
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    const newSaved = brief.saved ? 0 : 1;
    db.run('UPDATE research_briefs SET saved = ? WHERE id = ?', newSaved, brief.id);
    const { persist } = require('../db');
    try { persist(); } catch {}
    res.json({ ok: true, saved: !!newSaved });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/research/briefs/:id/open — mark a brief as opened (resets the 3-day decay clock)
router.post('/briefs/:id/open', (req, res) => {
  try {
    const db = getDb();
    db.run(
      `UPDATE research_briefs SET opened_at = COALESCE(opened_at, datetime('now'))
       WHERE id = ? AND therapist_id = ?`,
      req.params.id, req.therapist.id
    );
    const { persist } = require('../db');
    try { persist(); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/research/briefs/:id — delete a specific brief
router.delete('/briefs/:id', (req, res) => {
  try {
    const db = getDb();
    db.run(
      'DELETE FROM research_briefs WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id
    );
    const { persist } = require('../db');
    try { persist(); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/research/news — latest mental health news (last 72 hours)
router.get('/news', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    const articles = await getLatestNews(limit);
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/research/news/refresh — manually trigger a news fetch
router.post('/news/refresh', async (req, res) => {
  try {
    fetchAndStoreNews().catch(e =>
      console.error('[research] News refresh error:', e.message)
    );
    res.json({ ok: true, message: 'News refresh started. Check back in ~15 seconds.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/research/overnight-updates
 *
 * Structured data for the Dashboard's "Overnight Updates" card.
 * Returns the assessments submitted by patients in the last 14 hours,
 * grouped by patient, with the PREVIOUS score of the same type for each
 * so the UI can show a trend (15 → 20 ↑ worsening).
 *
 * Response shape:
 *   {
 *     updates: [
 *       {
 *         patient_id, client_id, display_name,
 *         worst_severity: 'Severe' | 'Moderate' | ...,
 *         status: 'worsening' | 'improving' | 'mixed' | 'stable',
 *         scores: [
 *           {
 *             type: 'PHQ-9',
 *             current: 20, previous: 15,
 *             severity: 'Severe',
 *             trend: 'up' | 'down' | 'same' | 'new',
 *             delta: +5,
 *             is_improvement, is_deterioration,
 *             administered_at,
 *             assessment_id,
 *           },
 *           ...
 *         ],
 *       },
 *       ...
 *     ]
 *   }
 */
router.get('/overnight-updates', (req, res) => {
  try {
    const db = getDb();
    const therapistId = req.therapist.id;

    // Fetch the assessments submitted in the last 14 hours.
    const recent = db.all(
      `SELECT a.id AS assessment_id,
              a.patient_id,
              a.template_type,
              a.total_score,
              a.severity_level,
              a.is_improvement,
              a.is_deterioration,
              a.administered_at,
              p.client_id,
              p.display_name
         FROM assessments a
         JOIN patients p ON p.id = a.patient_id
        WHERE a.therapist_id = ?
          AND a.administered_at > datetime('now', '-14 hours')
        ORDER BY a.administered_at DESC`,
      therapistId,
    );

    // Severity rank used for sorting + picking "worst severity" per patient.
    const SEVERITY_RANK = {
      'severe':              5,
      'moderately severe':   4,
      'moderate':            3,
      'mild':                2,
      'minimal':             1,
      'within normal limits': 1,
    };
    const severityRank = (s) => SEVERITY_RANK[(s || '').toLowerCase()] || 0;

    // Group by patient.
    const byPatient = new Map();
    for (const row of recent) {
      // Look up the previous score of the SAME template type for this patient
      // (the one immediately before this new submission).
      const previous = db.get(
        `SELECT total_score, severity_level, administered_at
           FROM assessments
          WHERE patient_id = ? AND template_type = ? AND id != ?
            AND administered_at <= ?
          ORDER BY administered_at DESC
          LIMIT 1`,
        row.patient_id, row.template_type, row.assessment_id, row.administered_at,
      );

      const prevScore = previous ? previous.total_score : null;
      const curScore = row.total_score;
      let trend = 'new';
      let delta = null;
      if (previous) {
        delta = curScore - prevScore;
        trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
      }

      const score = {
        type:             row.template_type,
        current:          curScore,
        previous:         prevScore,
        severity:         row.severity_level || null,
        trend,
        delta,
        is_improvement:   !!row.is_improvement,
        is_deterioration: !!row.is_deterioration,
        administered_at:  row.administered_at,
        assessment_id:    row.assessment_id,
      };

      if (!byPatient.has(row.patient_id)) {
        byPatient.set(row.patient_id, {
          patient_id:   row.patient_id,
          client_id:    row.client_id,
          display_name: row.display_name,
          scores: [],
        });
      }
      byPatient.get(row.patient_id).scores.push(score);
    }

    // Derive per-patient summary fields.
    const updates = Array.from(byPatient.values()).map(p => {
      const worstRank = p.scores.reduce((m, s) => Math.max(m, severityRank(s.severity)), 0);
      const worstSeverity = p.scores.find(s => severityRank(s.severity) === worstRank)?.severity || null;

      const anyWorse = p.scores.some(s => s.is_deterioration || (s.trend === 'up' && s.delta >= 2));
      const anyBetter = p.scores.some(s => s.is_improvement || (s.trend === 'down' && s.delta <= -2));
      let status;
      if (anyWorse && anyBetter) status = 'mixed';
      else if (anyWorse)         status = 'worsening';
      else if (anyBetter)        status = 'improving';
      else                       status = 'stable';

      return {
        ...p,
        worst_severity: worstSeverity,
        status,
        worst_severity_rank: worstRank, // only used for sort; stripped below
      };
    });

    // Sort: worsening + severe first, then mixed, then stable/improving.
    // Within each band, higher severity rank first.
    const STATUS_WEIGHT = { worsening: 0, mixed: 1, stable: 2, improving: 3 };
    updates.sort((a, b) => {
      const sw = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
      if (sw !== 0) return sw;
      return b.worst_severity_rank - a.worst_severity_rank;
    });

    // Strip the internal-only rank field before returning.
    for (const u of updates) delete u.worst_severity_rank;

    res.json({ updates, count: updates.length });
  } catch (err) {
    console.error('[overnight-updates] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/research/todays-schedule
 *
 * Structured data for the Dashboard's "Today's Schedule" card. Returns
 * today's non-cancelled appointments (in the therapist's local timezone),
 * annotated with whether a pre-session brief is ready.
 *
 * Response:
 *   {
 *     date: '2026-04-17',
 *     appointments: [
 *       {
 *         appointment_id, patient_id, client_id, display_name,
 *         scheduled_start, scheduled_end,
 *         appointment_type, duration_minutes,
 *         status,
 *         has_brief: true|false,
 *         brief_id: number|null,
 *       }, ...
 *     ],
 *     brief_count: N,
 *   }
 */
router.get('/todays-schedule', (req, res) => {
  try {
    const db = getDb();
    const therapist = db.get('SELECT preferred_timezone FROM therapists WHERE id = ?', req.therapist.id);
    const tz = therapist?.preferred_timezone || 'America/Los_Angeles';
    const todayLocal = new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);

    const appts = db.all(
      `SELECT a.id AS appointment_id,
              a.scheduled_start,
              a.scheduled_end,
              a.appointment_type,
              a.duration_minutes,
              a.status,
              p.id AS patient_id,
              p.client_id,
              p.display_name
         FROM appointments a
         LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.therapist_id = ?
          AND DATE(a.scheduled_start) = ?
          AND a.status != 'cancelled'
        ORDER BY a.scheduled_start ASC`,
      req.therapist.id, todayLocal,
    );

    // Check which appointments have a ready pre-session brief.
    const withBriefs = appts.map(a => {
      let brief = null;
      try {
        brief = db.get(
          'SELECT id FROM session_briefs WHERE appointment_id = ? LIMIT 1',
          a.appointment_id,
        );
      } catch {}
      return {
        ...a,
        has_brief: !!brief,
        brief_id:  brief?.id || null,
        duration_minutes: a.duration_minutes || 50,
      };
    });

    const brief_count = withBriefs.filter(a => a.has_brief).length;

    res.json({ date: todayLocal, appointments: withBriefs, brief_count });
  } catch (err) {
    console.error('[todays-schedule] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
