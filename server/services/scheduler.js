/**
 * Background scheduler for Miwa.
 * Runs every minute. Finds pending scheduled SMS sends and delivers them.
 *
 * Table: scheduled_sends
 *   id, therapist_id, patient_id, assessment_type, token, phone,
 *   send_at (ISO), status (pending|sent|failed|cancelled),
 *   sent_at, error, created_at
 */
const crypto = require('crypto')
const cron = require('node-cron')
const { getDb, persist } = require('../db')
const { sendAssessmentSms, normalisePhone } = require('./twilio')
const { runDailyBriefs, generateBriefForTherapist, triggerCrisisBrief } = require('./researcher')
const { runMorningBriefings } = require('./dailyBriefing')
const { fetchAndStoreNews } = require('./newsService')

let started = false

function startScheduler() {
  if (started) return
  started = true

  // Run every minute
  cron.schedule('* * * * *', async () => {
    let db
    try {
      db = getDb()
    } catch {
      return // DB not ready yet
    }

    const now = new Date().toISOString()

    let pending
    try {
      pending = db.all(
        `SELECT * FROM scheduled_sends
         WHERE status = 'pending' AND send_at <= ?
         ORDER BY send_at ASC
         LIMIT 20`,
        now
      )
    } catch {
      return
    }

    if (!pending.length) return

    for (const row of pending) {
      try {
        const result = await sendAssessmentSms(row.phone, row.token, row.assessment_type)

        db.run(
          `UPDATE scheduled_sends
           SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL
           WHERE id = ?`,
          row.id
        )

        console.log(`[scheduler] SMS sent — id=${row.id} type=${row.assessment_type} sid=${result.sid}`)
      } catch (err) {
        const errMsg = err.message || String(err)
        db.run(
          `UPDATE scheduled_sends
           SET status = 'failed', error = ?
           WHERE id = ?`,
          errMsg.slice(0, 500),
          row.id
        )
        console.error(`[scheduler] SMS failed — id=${row.id} error=${errMsg}`)
      }
    }

    try { persist() } catch {}
  })

  console.log('[scheduler] Started — SMS delivery runs every minute')

  // ── Feature 2: Agent Scheduled Tasks — check every 5 minutes ──────────
  cron.schedule('*/5 * * * *', async () => {
    let db
    try { db = getDb() } catch { return }

    try {
      const now = new Date().toISOString()
      const dueTasks = db.all(
        "SELECT * FROM agent_scheduled_tasks WHERE status = 'pending' AND scheduled_for <= ? LIMIT 10",
        now
      )

      for (const task of dueTasks) {
        try {
          // Create a proactive alert for the therapist
          db.insert(
            `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
             VALUES (?, 0, 'SCHEDULED_TASK', 'LOW', ?, ?)`,
            task.therapist_id,
            `Reminder: ${task.description}`,
            `Scheduled task due: ${task.description}`
          )

          db.run(
            "UPDATE agent_scheduled_tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
            task.id
          )

          console.log(`[scheduler] Executed agent task: ${task.description}`)
        } catch (taskErr) {
          console.error(`[scheduler] Agent task ${task.id} failed:`, taskErr.message)
        }
      }

      if (dueTasks.length > 0) persist()
    } catch (err) {
      if (!err.message?.includes('no such table')) {
        console.error('[scheduler] Agent tasks error:', err.message)
      }
    }
  })

  console.log('[scheduler] Started — Agent scheduled tasks check runs every 5 minutes')

  // Run alerts job every hour
  startAlertsScheduler()
}

/**
 * Detect proactive alerts for a patient:
 * - IMPROVEMENT: latest assessment >= 5 points better than previous
 * - DETERIORATION: latest assessment >= 5 points worse than previous
 * - OVERDUE_ASSESSMENT: last assessment > 30 days old
 * - RISK_REVIEW_DUE: risk_screening is flagged and safety plan not reviewed in 7 days
 */
function detectAlertsForPatient(db, therapistId, patientId) {
  const alerts = []

  // Get latest 2 assessments
  const assessments = db.all(
    `SELECT template_type, total_score, administered_at FROM assessments
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY administered_at DESC LIMIT 2`,
    patientId, therapistId
  )

  // Check for improvement/deterioration
  if (assessments.length >= 2) {
    const latest = assessments[0]
    const previous = assessments[1]
    const change = latest.total_score - previous.total_score

    if (Math.abs(change) >= 5) {
      const isImprovement = change < 0
      const direction = isImprovement ? 'improved' : 'increased'
      const severity = isImprovement ? 'LOW' : 'HIGH'

      const patientName = db.get(
        'SELECT display_name, client_id FROM patients WHERE id = ?',
        patientId
      )?.display_name

      alerts.push({
        alert_type: isImprovement ? 'IMPROVEMENT' : 'DETERIORATION',
        severity,
        title: `${patientName || 'Client'}'s ${latest.template_type} ${direction} by ${Math.abs(change)} points`,
        description: `Score changed from ${previous.total_score} to ${latest.total_score} (${latest.template_type})`,
        metric_value: change
      })
    }
  }

  // Check if overdue for assessment (> 30 days)
  if (assessments.length > 0) {
    const lastAssessmentDate = new Date(assessments[0].administered_at)
    const now = new Date()
    const daysAgo = Math.floor((now - lastAssessmentDate) / (1000 * 60 * 60 * 24))

    if (daysAgo > 30) {
      const patientName = db.get(
        'SELECT display_name, client_id FROM patients WHERE id = ?',
        patientId
      )?.display_name

      alerts.push({
        alert_type: 'OVERDUE_ASSESSMENT',
        severity: 'MEDIUM',
        title: `${patientName || 'Client'} is overdue for assessment`,
        description: `Last assessment was ${daysAgo} days ago (${assessments[0]?.template_type || 'unknown'})`,
        metric_value: daysAgo
      })
    }
  } else {
    // No assessments at all
    const patient = db.get(
      'SELECT display_name, client_id, created_at FROM patients WHERE id = ?',
      patientId
    )
    if (patient) {
      const intakeDaysAgo = Math.floor((new Date() - new Date(patient.created_at)) / (1000 * 60 * 60 * 24))
      if (intakeDaysAgo >= 7) {
        alerts.push({
          alert_type: 'OVERDUE_ASSESSMENT',
          severity: 'MEDIUM',
          title: `${patient.display_name || patient.client_id} has no baseline assessment`,
          description: `Intake was ${intakeDaysAgo} days ago`,
          metric_value: intakeDaysAgo
        })
      }
    }
  }

  // Check risk review (risk flag + no review in 7 days)
  const patient = db.get(
    'SELECT risk_screening FROM patients WHERE id = ?',
    patientId
  )
  if (patient?.risk_screening && patient.risk_screening.toLowerCase().includes('passive')) {
    // Check if safety plan was reviewed recently
    const lastSession = db.get(
      `SELECT session_date, created_at FROM sessions
       WHERE patient_id = ? AND (plan LIKE '%safety%' OR assessment LIKE '%safety%')
       ORDER BY COALESCE(session_date, created_at) DESC LIMIT 1`,
      patientId
    )

    if (!lastSession) {
      const patientName = db.get(
        'SELECT display_name, client_id FROM patients WHERE id = ?',
        patientId
      )?.display_name

      alerts.push({
        alert_type: 'RISK_REVIEW_DUE',
        severity: 'CRITICAL',
        title: `${patientName || 'Client'} has passive SI — no recent safety plan review`,
        description: 'Risk flag present but safety plan not documented in recent sessions',
        metric_value: null
      })
    }
  }

  return alerts
}

/**
 * Auto-send assessment to an overdue patient.
 * Creates an assessment link, schedules immediate SMS send, and logs a proactive_alert
 * so the therapist sees what happened.
 */
function autoSendOverdueAssessment(db, therapistId, patientId) {
  try {
    const patient = db.get(
      'SELECT id, client_id, display_name, phone FROM patients WHERE id = ? AND therapist_id = ?',
      patientId, therapistId
    )
    if (!patient?.phone) return null

    const phone = normalisePhone(patient.phone)
    if (!phone) return null

    // Check if we already auto-sent in the last 7 days
    const recentAutoSend = db.get(
      `SELECT id FROM scheduled_sends
       WHERE patient_id = ? AND therapist_id = ?
       AND created_at > datetime('now', '-7 days')
       AND assessment_type = 'PHQ-9'`,
      patientId, therapistId
    )
    if (recentAutoSend) return null

    // Determine which assessment to send (default PHQ-9, use last type if available)
    const lastAssessment = db.get(
      `SELECT template_type FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 1`,
      patientId
    )
    const assessmentType = lastAssessment?.template_type || 'PHQ-9'
    const templateKey = assessmentType.toLowerCase().replace('-', '')

    // Create assessment link
    const token = crypto.randomBytes(16).toString('hex')
    db.run(
      `INSERT INTO assessment_links (token, patient_id, therapist_id, template_type, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+30 days'))`,
      token, patientId, therapistId, templateKey
    )

    // Schedule immediate send
    db.insert(
      `INSERT INTO scheduled_sends (therapist_id, patient_id, assessment_type, token, phone, send_at, custom_message)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
      therapistId, patientId, assessmentType, token, phone,
      `Miwa auto-sent: ${assessmentType} was overdue for ${patient.display_name || patient.client_id}`
    )

    console.log(`[auto-send] Queued ${assessmentType} for ${patient.client_id} (overdue)`)
    return { assessmentType, clientId: patient.client_id }
  } catch (err) {
    console.error(`[auto-send] Failed for patient_id=${patientId}:`, err.message)
    return null
  }
}

function startAlertsScheduler() {
  // Run every hour (at minute 0 of each hour)
  cron.schedule('0 * * * *', async () => {
    let db
    try {
      db = getDb()
    } catch {
      return // DB not ready yet
    }

    try {
      // Get all therapists
      const therapists = db.all('SELECT DISTINCT therapist_id FROM patients')

      for (const { therapist_id } of therapists) {
        const patients = db.all(
          'SELECT id FROM patients WHERE therapist_id = ?',
          therapist_id
        )

        let alertsCreated = 0
        for (const { id: patientId } of patients) {
          const alerts = detectAlertsForPatient(db, therapist_id, patientId)

          for (const alert of alerts) {
            // Check if this alert already exists and hasn't been dismissed
            const existing = db.get(
              `SELECT id FROM proactive_alerts
               WHERE therapist_id = ? AND patient_id = ? AND alert_type = ?
               AND dismissed_at IS NULL
               AND created_at > datetime('now', '-1 hour')`,
              therapist_id, patientId, alert.alert_type
            )

            if (!existing) {
              db.insert(
                `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description, metric_value)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                therapist_id, patientId, alert.alert_type, alert.severity,
                alert.title, alert.description, alert.metric_value
              )
              alertsCreated++

              // Trigger crisis research brief when a critical alert fires
              if (alert.alert_type === 'DETERIORATION' || alert.alert_type === 'RISK_REVIEW_DUE') {
                triggerCrisisBrief(therapist_id).catch(e =>
                  console.error('[researcher] Crisis brief trigger failed:', e.message)
                )
              }

              // Auto-send assessment if overdue and therapist has opted in
              if (alert.alert_type === 'OVERDUE_ASSESSMENT') {
                try {
                  const therapistPerms = db.get(
                    'SELECT assistant_permissions_json FROM therapists WHERE id = ?',
                    therapist_id
                  )
                  const perms = therapistPerms?.assistant_permissions_json
                    ? JSON.parse(therapistPerms.assistant_permissions_json)
                    : {}
                  if (perms.auto_send_overdue) {
                    const result = autoSendOverdueAssessment(db, therapist_id, patientId)
                    if (result) {
                      // Update alert description to note auto-send
                      db.run(
                        `UPDATE proactive_alerts SET description = description || ' — Auto-sent ' || ? WHERE therapist_id = ? AND patient_id = ? AND alert_type = 'OVERDUE_ASSESSMENT' AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
                        result.assessmentType, therapist_id, patientId
                      )
                    }
                  }
                } catch {}
              }
            }
          }
        }

        if (alertsCreated > 0) {
          console.log(`[alerts] Created ${alertsCreated} alerts for therapist_id=${therapist_id}`)
        }
      }

      try { persist() } catch {}
    } catch (err) {
      console.error(`[alerts] Error in alerts scheduler: ${err.message}`)
    }
  })

  console.log('[scheduler] Started — Proactive alerts check runs every hour')

  // Evaluate automation rules every hour (at minute 5)
  cron.schedule('5 * * * *', async () => {
    let db
    try { db = getDb() } catch { return }

    try {
      let rules
      try {
        rules = db.all('SELECT * FROM automation_rules WHERE enabled = 1')
      } catch { return } // table may not exist yet

      for (const rule of rules) {
        try {
          const triggerConfig = JSON.parse(rule.trigger_config || '{}')
          const actionConfig = JSON.parse(rule.action_config || '{}')

          // Check if rule already fired recently (debounce: once per 24h per rule)
          if (rule.last_fired_at) {
            const hoursSinceFired = (Date.now() - new Date(rule.last_fired_at).getTime()) / 3600000
            if (hoursSinceFired < 24) continue
          }

          let shouldFire = false
          let matchedPatients = []

          // Evaluate trigger conditions
          if (rule.trigger_type === 'score_below') {
            const patients = db.all(
              `SELECT DISTINCT a.patient_id, a.total_score, p.display_name, p.client_id, p.phone
               FROM assessments a
               JOIN patients p ON p.id = a.patient_id
               WHERE a.therapist_id = ? AND a.template_type = ?
               AND a.id IN (SELECT MAX(id) FROM assessments WHERE therapist_id = ? GROUP BY patient_id)
               AND a.total_score < ?`,
              rule.therapist_id, triggerConfig.assessment_type || 'PHQ-9',
              rule.therapist_id, triggerConfig.threshold || 10
            )
            if (patients.length > 0) { shouldFire = true; matchedPatients = patients }
          }

          if (rule.trigger_type === 'score_above') {
            const patients = db.all(
              `SELECT DISTINCT a.patient_id, a.total_score, p.display_name, p.client_id, p.phone
               FROM assessments a
               JOIN patients p ON p.id = a.patient_id
               WHERE a.therapist_id = ? AND a.template_type = ?
               AND a.id IN (SELECT MAX(id) FROM assessments WHERE therapist_id = ? GROUP BY patient_id)
               AND a.total_score > ?`,
              rule.therapist_id, triggerConfig.assessment_type || 'PHQ-9',
              rule.therapist_id, triggerConfig.threshold || 15
            )
            if (patients.length > 0) { shouldFire = true; matchedPatients = patients }
          }

          if (rule.trigger_type === 'assessment_overdue') {
            const days = triggerConfig.days || 30
            const patients = db.all(
              `SELECT p.id as patient_id, p.display_name, p.client_id, p.phone,
                      MAX(a.administered_at) as last_assessment
               FROM patients p
               LEFT JOIN assessments a ON a.patient_id = p.id
               WHERE p.therapist_id = ?
               GROUP BY p.id
               HAVING last_assessment IS NULL OR last_assessment < datetime('now', '-' || ? || ' days')`,
              rule.therapist_id, days
            )
            if (patients.length > 0) { shouldFire = true; matchedPatients = patients }
          }

          if (!shouldFire || matchedPatients.length === 0) continue

          // Execute action
          if (rule.action_type === 'send_checkin' || rule.action_type === 'send_assessment') {
            for (const patient of matchedPatients) {
              if (!patient.phone) continue
              const phone = normalisePhone(patient.phone)
              if (!phone) continue
              autoSendOverdueAssessment(db, rule.therapist_id, patient.patient_id)
            }
          }

          if (rule.action_type === 'create_alert') {
            for (const patient of matchedPatients) {
              db.insert(
                `INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description)
                 VALUES (?, ?, 'AUTOMATION', 'LOW', ?, ?)`,
                rule.therapist_id, patient.patient_id,
                `Rule "${rule.name}" triggered for ${patient.display_name || patient.client_id}`,
                actionConfig.message || `Automation rule matched: ${rule.name}`
              )
            }
          }

          // Mark rule as fired
          db.run(
            'UPDATE automation_rules SET last_fired_at = CURRENT_TIMESTAMP, fire_count = fire_count + 1 WHERE id = ?',
            rule.id
          )

          console.log(`[automations] Rule "${rule.name}" fired for ${matchedPatients.length} patient(s)`)
        } catch (ruleErr) {
          console.error(`[automations] Rule ${rule.id} error:`, ruleErr.message)
        }
      }

      try { persist() } catch {}
    } catch (err) {
      console.error('[automations] Scheduler error:', err.message)
    }
  })

  console.log('[scheduler] Started — Automation rules check runs every hour')

  // ── Pillar 1: Pre-Session Briefs — every 5 minutes ─────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { checkAndGenerateBriefs } = require('./brief-generator')
      const count = await checkAndGenerateBriefs()
      if (count > 0) console.log(`[briefs] Generated ${count} pre-session brief(s)`)
    } catch (err) {
      if (!err.message?.includes('not initialised')) {
        console.error('[briefs] Error:', err.message)
      }
    }
  })
  console.log('[scheduler] Started — Pre-session briefs check runs every 5 minutes')

  // ── MBC Auto-Send — PHQ-9 + GAD-7 before every session ───────────────────
  // Inspired by the Two Chairs study (96% MBC completion via automated delivery).
  // Checks every 5 min for appointments ~24 hours out and queues assessment SMS.
  cron.schedule('*/5 * * * *', async () => {
    let db
    try { db = getDb() } catch { return }

    const now = new Date()
    // Window: 23h50m to 24h10m from now — 20-minute window checked every 5 min
    const windowStart = new Date(now.getTime() + (23 * 60 + 50) * 60 * 1000).toISOString()
    const windowEnd   = new Date(now.getTime() + (24 * 60 + 10) * 60 * 1000).toISOString()

    let upcoming
    try {
      upcoming = db.all(
        `SELECT a.id AS appointment_id, a.therapist_id, a.patient_id
         FROM appointments a
         WHERE a.scheduled_start >= ?
           AND a.scheduled_start <= ?
           AND a.status IN ('scheduled', 'confirmed')
           AND a.mbc_auto_sent = 0
         ORDER BY a.scheduled_start ASC`,
        windowStart, windowEnd
      )
    } catch { return }

    if (!upcoming.length) return

    let queued = 0
    for (const appt of upcoming) {
      try {
        // Check therapist opt-in (default: enabled)
        const therapist = db.get(
          'SELECT assistant_permissions_json FROM therapists WHERE id = ?',
          appt.therapist_id
        )
        try {
          const perms = therapist?.assistant_permissions_json
            ? JSON.parse(therapist.assistant_permissions_json) : {}
          if (perms.auto_mbc_enabled === false) continue
        } catch {}

        // Check patient has valid phone
        const patient = db.get(
          'SELECT id, client_id, phone FROM patients WHERE id = ?',
          appt.patient_id
        )
        if (!patient?.phone) continue
        const phone = normalisePhone(patient.phone)
        if (!phone) continue

        // Create PHQ-9 assessment link + scheduled send
        const phqToken = crypto.randomBytes(16).toString('hex')
        db.run(
          `INSERT INTO assessment_links (token, patient_id, therapist_id, template_type, expires_at)
           VALUES (?, ?, ?, 'phq9', datetime('now', '+7 days'))`,
          phqToken, appt.patient_id, appt.therapist_id
        )
        db.run(
          `INSERT INTO scheduled_sends (therapist_id, patient_id, assessment_type, token, phone, send_at)
           VALUES (?, ?, 'PHQ-9', ?, ?, datetime('now'))`,
          appt.therapist_id, appt.patient_id, phqToken, phone
        )

        // Create GAD-7 assessment link + scheduled send
        const gadToken = crypto.randomBytes(16).toString('hex')
        db.run(
          `INSERT INTO assessment_links (token, patient_id, therapist_id, template_type, expires_at)
           VALUES (?, ?, ?, 'gad7', datetime('now', '+7 days'))`,
          gadToken, appt.patient_id, appt.therapist_id
        )
        db.run(
          `INSERT INTO scheduled_sends (therapist_id, patient_id, assessment_type, token, phone, send_at)
           VALUES (?, ?, 'GAD-7', ?, ?, datetime('now'))`,
          appt.therapist_id, appt.patient_id, gadToken, phone
        )

        // Mark appointment so we never double-send
        db.run('UPDATE appointments SET mbc_auto_sent = 1 WHERE id = ?', appt.appointment_id)
        queued++
      } catch (err) {
        console.error(`[mbc-auto] Failed for appointment ${appt.appointment_id}:`, err.message)
      }
    }
    if (queued > 0) {
      console.log(`[mbc-auto] Queued PHQ-9 + GAD-7 for ${queued} upcoming appointment(s)`)
      try { persist() } catch {}
    }
  })
  console.log('[scheduler] Started — MBC auto-send runs every 5 minutes (24h before sessions)')

  // ── Pillar 6: Proactive Outreach — every 15 minutes ──────────────────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { evaluateOutreachRules } = require('./outreach-engine')
      const count = await evaluateOutreachRules()
      if (count > 0) console.log(`[outreach] Executed ${count} outreach action(s)`)
    } catch (err) {
      if (!err.message?.includes('not initialised') && !err.message?.includes('Cannot find module')) {
        console.error('[outreach] Error:', err.message)
      }
    }
  })
  console.log('[scheduler] Started — Proactive outreach check runs every 15 minutes')

  // Daily research briefs — check every hour, generate for each therapist when it's 6–7am in their timezone
  cron.schedule('0 * * * *', async () => {
    let db
    try { db = getDb() } catch { return }

    try {
      const therapists = db.all(
        `SELECT id, preferred_timezone FROM therapists WHERE account_status = 'active'`
      )

      for (const t of therapists) {
        try {
          const tz = t.preferred_timezone || 'America/Los_Angeles'
          const localHour = parseInt(
            new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }),
            10
          )
          // Only fire between 6:00 and 6:59 AM in the therapist's timezone
          if (localHour !== 6) continue

          // Skip if already generated a non-crisis brief in the last 24 hours
          const recent = db.get(
            `SELECT id FROM research_briefs
             WHERE therapist_id = ? AND brief_type != 'crisis'
             AND created_at > datetime('now', '-24 hours')`,
            t.id
          )
          if (recent) continue

          // Only generate if they have at least one patient
          const hasPatients = db.get(
            'SELECT COUNT(*) as c FROM patients WHERE therapist_id = ?', t.id
          )
          if (!hasPatients?.c) continue

          console.log(`[researcher] Generating daily brief for therapist_id=${t.id} tz=${tz}`)
          generateBriefForTherapist(t.id, 'daily').catch(err =>
            console.error(`[researcher] Brief failed for therapist_id=${t.id}:`, err.message)
          )
        } catch (err) {
          console.error(`[researcher] Timezone check failed for therapist_id=${t.id}:`, err.message)
        }
      }
    } catch (err) {
      if (!err.message?.includes('no such table')) {
        console.error('[researcher] Daily brief scheduler error:', err.message)
      }
    }
  })

  console.log('[scheduler] Started — Daily research briefs check runs hourly (fires at 6am per therapist timezone)')

  // ── Proactive Daily "Your Day" briefing — hourly, fires at 6am local ─────
  cron.schedule('23 * * * *', async () => {
    try {
      await runMorningBriefings()
    } catch (err) {
      console.error('[daily-briefing] Scheduler error:', err.message)
    }
  })
  console.log('[scheduler] Started — Daily "Your Day" briefings fire at 6am per therapist timezone')

  // ── Pillar 5: Practice Intelligence — every Sunday at 6:00 AM ─────────────
  cron.schedule('0 6 * * 0', async () => {
    console.log('[insights] Starting weekly practice intelligence analysis')
    try {
      const { generatePracticeInsights } = require('./practice-intelligence')
      const count = await generatePracticeInsights()
      console.log(`[insights] Generated ${count} practice insight(s)`)
    } catch (err) {
      console.error('[insights] Weekly analysis error:', err.message)
    }
  })

  console.log('[scheduler] Started — Practice intelligence runs every Sunday at 6am')

  // Mental health news fetch — once daily at 5:17am
  cron.schedule('17 5 * * *', async () => {
    console.log('[newsService] Starting daily news refresh')
    try { await fetchAndStoreNews() } catch (err) {
      console.error('[newsService] News fetch error:', err.message)
    }
  })

  // Initial news fetch on startup (run once after 10 seconds)
  setTimeout(() => {
    fetchAndStoreNews().catch(e => console.error('[newsService] Startup fetch error:', e.message))
  }, 10000)

  console.log('[scheduler] Started — Mental health news refresh runs daily at 5:17am')

  // ── Research brief auto-decay ─────────────────────────────────────────
  // Delete unsaved briefs that are past their expiry:
  //   - Unopened after 3 days
  //   - Opened but unsaved after 7 days
  // Saved briefs are kept forever.
  cron.schedule('23 3 * * *', () => {
    let db
    try { db = getDb() } catch { return }
    try {
      const { changes } = db.run(
        `DELETE FROM research_briefs
         WHERE saved = 0
           AND (
             (opened_at IS NULL AND created_at < datetime('now', '-3 days'))
             OR (opened_at IS NOT NULL AND created_at < datetime('now', '-7 days'))
           )`
      )
      // changes is undefined in sql.js wrapper — just log success
      console.log('[scheduler] Research brief auto-decay complete')
    } catch (err) {
      console.error('[scheduler] Brief decay error:', err.message)
    }
  })
  console.log('[scheduler] Started — Research brief auto-decay runs daily at 3:23am')

  // ── AI budget auto-unpause at month rollover ────────────────────────────
  // Runs a few minutes after midnight on the 1st of each month. Clears the
  // ai_budget_paused flag on every therapist so they can use AI again.
  cron.schedule('7 0 1 * *', () => {
    let db
    try { db = getDb() } catch { return }
    try {
      db.run('UPDATE therapists SET ai_budget_paused = 0 WHERE ai_budget_paused = 1')
      console.log('[scheduler] Monthly AI budget reset — all therapists unpaused')
    } catch (err) {
      console.error('[scheduler] AI budget reset error:', err.message)
    }
  })

  console.log('[scheduler] Started — AI budget unpause runs at the start of each month')

  // ── Encrypted off-site DB backup ─────────────────────────────────────────
  // Runs daily at 03:11 UTC (20:11 PT previous day). Reads /data/mftbrain.db,
  // encrypts with AES-256-GCM using BACKUP_PASSPHRASE, emails the blob to
  // admin@miwa.care via Gmail API (Workspace BAA-covered). This is the
  // primary safety net against Railway volume loss / corruption.
  if (process.env.BACKUP_PASSPHRASE) {
    cron.schedule('11 3 * * *', async () => {
      try {
        const { runNightlyBackup } = require('./backup')
        await runNightlyBackup({ trigger: 'scheduled' })
      } catch (err) {
        console.error('[backup] scheduler tick error:', err.message)
      }
    })
    console.log('[scheduler] Started — Encrypted DB backup runs daily at 03:11 UTC')
  } else {
    console.warn('[scheduler] BACKUP_PASSPHRASE not set — nightly DB backups are DISABLED')
  }
}

module.exports = { startScheduler }
