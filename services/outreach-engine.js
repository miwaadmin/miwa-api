/**
 * outreach-engine.js
 *
 * Proactive Outreach Orchestration engine for Miwa therapist SaaS.
 *
 * Evaluates therapist-configured outreach rules and autonomously triggers
 * communications to clients.  Currently logs all actions to the outreach_log
 * table — actual SMS/email delivery will be wired in once channel integrations
 * are finalised.
 *
 * Runs on the scheduler (every 15 minutes via scheduler.js).
 *
 * Supported rule types:
 *   appointment_reminder  — 24h (configurable) before a scheduled appointment
 *   missed_session_checkin — 48h after a no-show
 *   assessment_overdue     — when last assessment exceeds a day threshold
 *   stalled_case           — when no session has occurred in N weeks
 *
 * Tables used (already exist in SQLite):
 *   outreach_rules   — therapist-defined rule configs
 *   outreach_log     — every outreach action is recorded here
 *   appointments     — scheduling data
 *   sessions         — session history
 *   patients         — client contact info
 *   assessments      — assessment history
 *   proactive_alerts — used by stalled_case to surface alerts
 */

const { getDb, persist } = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
// Rule Evaluators
// ─────────────────────────────────────────────────────────────────────────────
// Each evaluator receives (db, rule, config, therapistId) and returns an array
// of outreach actions to log.  An action is { patientId, channel, message, outreachType }.

/**
 * appointment_reminder
 *
 * Finds appointments scheduled roughly `hours_before` hours from now and
 * sends a reminder.  The match window is +/- 30 minutes to tolerate scheduler
 * jitter (the scheduler runs every 15 minutes).
 *
 * Skips appointments that already have a reminder in outreach_log.
 */
function evaluateAppointmentReminder(db, rule, config, therapistId) {
  const hoursBefore = config.hours_before || 24;
  const windowMinutes = 30;
  const actions = [];

  // Find appointments in the reminder window:
  //   scheduled_start BETWEEN (now + hoursBefore - 30min) AND (now + hoursBefore + 30min)
  const appointments = db.all(
    `SELECT a.id, a.patient_id, a.scheduled_start, a.client_code,
            p.display_name, p.phone, p.email, p.preferred_contact_method
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.therapist_id = ?
       AND a.status = 'scheduled'
       AND a.scheduled_start BETWEEN
             datetime('now', '+' || ? || ' minutes')
         AND datetime('now', '+' || ? || ' minutes')`,
    therapistId,
    (hoursBefore * 60) - windowMinutes,
    (hoursBefore * 60) + windowMinutes
  );

  for (const appt of appointments) {
    // Check if we already sent a reminder for this appointment
    const alreadySent = db.get(
      `SELECT id FROM outreach_log
       WHERE therapist_id = ? AND patient_id = ? AND rule_id = ?
         AND outreach_type = 'appointment_reminder'
         AND message_preview LIKE '%' || ? || '%'`,
      therapistId, appt.patient_id, rule.id,
      String(appt.id)
    );
    if (alreadySent) continue;

    const name = appt.display_name || appt.client_code || 'Client';
    const startTime = formatDateTime(appt.scheduled_start);
    const channel = resolveChannel(appt);
    const message = `Hi ${name}, this is a reminder about your upcoming appointment on ${startTime}. Please let us know if you need to reschedule.`;

    actions.push({
      patientId: appt.patient_id,
      channel,
      message,
      outreachType: 'appointment_reminder',
      // Store appointment ID in message for dedup
      messagePreview: `[appt:${appt.id}] ${message.slice(0, 200)}`,
    });
  }

  return actions;
}

/**
 * missed_session_checkin
 *
 * Finds appointments with status='no_show' that were scheduled roughly
 * `hours_after_noshow` hours ago (window: -1h to +1h).  Sends a check-in
 * message to the client.
 *
 * Supports a custom message template with {name} placeholder.
 */
function evaluateMissedSessionCheckin(db, rule, config, therapistId) {
  const hoursAfter = config.hours_after_noshow || 48;
  const windowMinutes = 60;
  const actions = [];

  const noShows = db.all(
    `SELECT a.id, a.patient_id, a.scheduled_start, a.client_code,
            p.display_name, p.phone, p.email, p.preferred_contact_method
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.therapist_id = ?
       AND a.status = 'no_show'
       AND a.scheduled_start BETWEEN
             datetime('now', '-' || ? || ' minutes')
         AND datetime('now', '-' || ? || ' minutes')`,
    therapistId,
    (hoursAfter * 60) + windowMinutes,
    (hoursAfter * 60) - windowMinutes
  );

  for (const appt of noShows) {
    // Don't re-send if already sent for this appointment
    const alreadySent = db.get(
      `SELECT id FROM outreach_log
       WHERE therapist_id = ? AND patient_id = ? AND rule_id = ?
         AND outreach_type = 'missed_session_checkin'
         AND message_preview LIKE '%' || ? || '%'`,
      therapistId, appt.patient_id, rule.id,
      String(appt.id)
    );
    if (alreadySent) continue;

    const name = appt.display_name || appt.client_code || 'Client';
    const channel = resolveChannel(appt);
    const defaultMessage = `Hi ${name}, we missed you at your recent appointment. We hope everything is okay. Please reach out when you're ready to reschedule — we're here for you.`;
    const message = config.message
      ? config.message.replace(/\{name\}/gi, name)
      : defaultMessage;

    actions.push({
      patientId: appt.patient_id,
      channel,
      message,
      outreachType: 'missed_session_checkin',
      messagePreview: `[appt:${appt.id}] ${message.slice(0, 200)}`,
    });
  }

  return actions;
}

/**
 * assessment_overdue
 *
 * Finds patients whose most recent assessment was more than `days_threshold`
 * days ago.  Sends a gentle nudge to complete their next assessment.
 *
 * Debounce: skips patients who received this outreach type within the last
 * 7 days to avoid spamming.
 */
function evaluateAssessmentOverdue(db, rule, config, therapistId) {
  const daysThreshold = config.days_threshold || 30;
  const actions = [];

  const overduePatients = db.all(
    `SELECT p.id AS patient_id, p.display_name, p.client_id, p.phone, p.email,
            p.preferred_contact_method,
            MAX(a.administered_at) AS last_assessment_at
     FROM patients p
     LEFT JOIN assessments a ON a.patient_id = p.id
     WHERE p.therapist_id = ?
     GROUP BY p.id
     HAVING last_assessment_at IS NOT NULL
        AND last_assessment_at < datetime('now', '-' || ? || ' days')`,
    therapistId,
    daysThreshold
  );

  for (const patient of overduePatients) {
    // Check if we already sent this outreach type in the last 7 days
    const recentlySent = db.get(
      `SELECT id FROM outreach_log
       WHERE therapist_id = ? AND patient_id = ? AND rule_id = ?
         AND outreach_type = 'assessment_overdue'
         AND created_at > datetime('now', '-7 days')`,
      therapistId, patient.patient_id, rule.id
    );
    if (recentlySent) continue;

    const name = patient.display_name || patient.client_id || 'Client';
    const channel = resolveChannel(patient);
    const message = `Hi ${name}, it's been a while since your last check-in assessment. Completing a brief questionnaire helps us track your progress and adjust your care. Your clinician will send you a link shortly.`;

    actions.push({
      patientId: patient.patient_id,
      channel,
      message,
      outreachType: 'assessment_overdue',
      messagePreview: message.slice(0, 250),
    });
  }

  return actions;
}

/**
 * stalled_case
 *
 * Finds patients with no session recorded in the last `weeks_threshold` weeks.
 * Instead of sending outreach directly to the client, this creates a
 * proactive_alert for the therapist to review.
 */
function evaluateStalledCase(db, rule, config, therapistId) {
  const weeksThreshold = config.weeks_threshold || 3;
  const daysThreshold = weeksThreshold * 7;
  const actions = [];

  const stalledPatients = db.all(
    `SELECT p.id AS patient_id, p.display_name, p.client_id,
            MAX(s.session_date) AS last_session_date
     FROM patients p
     LEFT JOIN sessions s ON s.patient_id = p.id AND s.therapist_id = ?
     WHERE p.therapist_id = ?
     GROUP BY p.id
     HAVING last_session_date IS NOT NULL
        AND last_session_date < datetime('now', '-' || ? || ' days')`,
    therapistId,
    therapistId,
    daysThreshold
  );

  for (const patient of stalledPatients) {
    // Check if a stalled_case alert already exists and hasn't been dismissed
    const existingAlert = db.get(
      `SELECT id FROM proactive_alerts
       WHERE therapist_id = ? AND patient_id = ? AND alert_type = 'STALLED_CASE'
         AND dismissed_at IS NULL
         AND created_at > datetime('now', '-7 days')`,
      therapistId, patient.patient_id
    );
    if (existingAlert) continue;

    // Check if we already logged this outreach type in the last 7 days
    const recentlyLogged = db.get(
      `SELECT id FROM outreach_log
       WHERE therapist_id = ? AND patient_id = ? AND rule_id = ?
         AND outreach_type = 'stalled_case'
         AND created_at > datetime('now', '-7 days')`,
      therapistId, patient.patient_id, rule.id
    );
    if (recentlyLogged) continue;

    const name = patient.display_name || patient.client_id || 'Client';
    const daysSince = Math.floor(
      (Date.now() - new Date(patient.last_session_date).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Create a proactive alert instead of sending outreach
    db.insert(
      `INSERT INTO proactive_alerts
         (therapist_id, patient_id, alert_type, severity, title, description, metric_value)
       VALUES (?, ?, 'STALLED_CASE', 'MEDIUM', ?, ?, ?)`,
      therapistId,
      patient.patient_id,
      `${name} has not had a session in ${daysSince} days`,
      `No session recorded since ${patient.last_session_date}. Consider reaching out to re-engage.`,
      daysSince
    );

    // Log to outreach_log for tracking (channel = 'alert' since no direct outreach)
    actions.push({
      patientId: patient.patient_id,
      channel: 'alert',
      message: `Stalled case alert created: ${name} — ${daysSince} days since last session`,
      outreachType: 'stalled_case',
      messagePreview: `[alert] ${name} — ${daysSince} days since last session`,
    });
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule Type Registry
// ─────────────────────────────────────────────────────────────────────────────

const RULE_EVALUATORS = {
  appointment_reminder: evaluateAppointmentReminder,
  missed_session_checkin: evaluateMissedSessionCheckin,
  assessment_overdue: evaluateAssessmentOverdue,
  stalled_case: evaluateStalledCase,
};

// ─────────────────────────────────────────────────────────────────────────────
// Core Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main evaluation loop — called by the scheduler every 15 minutes.
 *
 * Iterates through all enabled outreach_rules, evaluates each using the
 * appropriate evaluator, and logs resulting actions to outreach_log.
 *
 * @returns {number} Total number of outreach actions taken across all rules.
 */
async function evaluateOutreachRules() {
  const db = getDb();
  let totalActions = 0;

  const rules = db.all(
    `SELECT * FROM outreach_rules WHERE enabled = 1 ORDER BY therapist_id, rule_type`
  );

  for (const rule of rules) {
    const evaluator = RULE_EVALUATORS[rule.rule_type];
    if (!evaluator) {
      console.warn(`[outreach] Unknown rule type: ${rule.rule_type} (rule_id=${rule.id})`);
      continue;
    }

    let config;
    try {
      config = JSON.parse(rule.config_json || '{}');
    } catch (err) {
      console.error(`[outreach] Invalid config JSON for rule_id=${rule.id}: ${err.message}`);
      continue;
    }

    try {
      const actions = evaluator(db, rule, config, rule.therapist_id);

      for (const action of actions) {
        db.insert(
          `INSERT INTO outreach_log
             (therapist_id, patient_id, rule_id, outreach_type, channel, message_preview, status)
           VALUES (?, ?, ?, ?, ?, ?, 'logged')`,
          rule.therapist_id,
          action.patientId,
          rule.id,
          action.outreachType,
          action.channel,
          action.messagePreview || action.message.slice(0, 250)
        );
        totalActions++;
      }

      // Update rule execution metadata
      if (actions.length > 0) {
        db.run(
          `UPDATE outreach_rules
              SET last_executed_at = datetime('now'),
                  execute_count = execute_count + ?
            WHERE id = ?`,
          actions.length,
          rule.id
        );
      }
    } catch (err) {
      console.error(`[outreach] Error evaluating rule_id=${rule.id} (${rule.rule_type}): ${err.message}`);
    }
  }

  if (totalActions > 0) {
    try { persist(); } catch {}
  }

  return totalActions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the default set of outreach rules for a newly registered therapist.
 *
 * Called during therapist onboarding.  Idempotent — skips creation if any
 * outreach_rules already exist for the therapist.
 *
 * @param {number} therapistId
 * @returns {{ created: number, rules: string[] }}
 */
function createDefaultRules(therapistId) {
  const db = getDb();

  // Idempotent: don't duplicate if rules already exist
  const existing = db.get(
    'SELECT COUNT(*) AS count FROM outreach_rules WHERE therapist_id = ?',
    therapistId
  );
  if (existing && existing.count > 0) {
    return { created: 0, rules: [] };
  }

  const defaults = [
    {
      rule_type: 'appointment_reminder',
      label: 'Appointment Reminder (24h)',
      config: { hours_before: 24 },
      enabled: 1,
    },
    {
      rule_type: 'missed_session_checkin',
      label: 'Missed Session Check-in (48h)',
      config: {
        hours_after_noshow: 48,
        message: 'Hi {name}, we missed you at your recent appointment. We hope everything is okay. Please reach out when you\'re ready to reschedule — we\'re here for you.',
      },
      enabled: 1,
    },
    {
      rule_type: 'assessment_overdue',
      label: 'Overdue Assessment Reminder (30 days)',
      config: { days_threshold: 30 },
      enabled: 0, // disabled by default — therapist opts in
    },
    {
      rule_type: 'stalled_case',
      label: 'Stalled Case Alert (3 weeks)',
      config: { weeks_threshold: 3 },
      enabled: 1,
    },
  ];

  const createdLabels = [];

  for (const rule of defaults) {
    db.insert(
      `INSERT INTO outreach_rules
         (therapist_id, rule_type, label, config_json, enabled)
       VALUES (?, ?, ?, ?, ?)`,
      therapistId,
      rule.rule_type,
      rule.label,
      JSON.stringify(rule.config),
      rule.enabled
    );
    createdLabels.push(rule.label);
  }

  return { created: defaults.length, rules: createdLabels };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the recent outreach log for a therapist.
 *
 * @param {number} therapistId
 * @param {number} [limit=50]
 * @returns {Object[]} Array of outreach log entries with patient info
 */
function getOutreachLog(therapistId, limit = 50) {
  const db = getDb();
  return db.all(
    `SELECT ol.*,
            p.display_name AS patient_name,
            p.client_id AS patient_code,
            r.label AS rule_label
     FROM outreach_log ol
     LEFT JOIN patients p ON p.id = ol.patient_id
     LEFT JOIN outreach_rules r ON r.id = ol.rule_id
     WHERE ol.therapist_id = ?
     ORDER BY ol.created_at DESC
     LIMIT ?`,
    therapistId,
    limit
  );
}

/**
 * Get all outreach rules for a therapist with execution stats.
 *
 * @param {number} therapistId
 * @returns {Object[]} Array of rule objects with parsed config and recent action count
 */
function getOutreachRules(therapistId) {
  const db = getDb();
  const rules = db.all(
    `SELECT r.*,
            (SELECT COUNT(*) FROM outreach_log ol
             WHERE ol.rule_id = r.id
               AND ol.created_at > datetime('now', '-7 days')
            ) AS actions_last_7_days,
            (SELECT COUNT(*) FROM outreach_log ol
             WHERE ol.rule_id = r.id
            ) AS total_actions
     FROM outreach_rules r
     WHERE r.therapist_id = ?
     ORDER BY r.created_at ASC`,
    therapistId
  );

  return rules.map((rule) => ({
    ...rule,
    config: safeParse(rule.config_json),
    enabled: Boolean(rule.enabled),
  }));
}

/**
 * Update an outreach rule's enabled state and/or configuration.
 *
 * Only the owning therapist can update their own rules.
 *
 * @param {number} ruleId
 * @param {number} therapistId
 * @param {Object} updates          - Fields to update
 * @param {boolean} [updates.enabled]     - Toggle rule on/off
 * @param {Object}  [updates.config]      - New config object (merged with existing)
 * @param {string}  [updates.label]       - New display label
 * @returns {Object|null} Updated rule or null if not found
 */
function updateOutreachRule(ruleId, therapistId, updates) {
  const db = getDb();

  // Verify ownership
  const rule = db.get(
    'SELECT * FROM outreach_rules WHERE id = ? AND therapist_id = ?',
    ruleId,
    therapistId
  );
  if (!rule) return null;

  const setClauses = [];
  const params = [];

  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }

  if (updates.config !== undefined) {
    // Merge with existing config so partial updates are supported
    const existingConfig = safeParse(rule.config_json);
    const mergedConfig = { ...existingConfig, ...updates.config };
    setClauses.push('config_json = ?');
    params.push(JSON.stringify(mergedConfig));
  }

  if (updates.label !== undefined) {
    setClauses.push('label = ?');
    params.push(updates.label);
  }

  if (setClauses.length === 0) return rule;

  params.push(ruleId, therapistId);
  db.run(
    `UPDATE outreach_rules SET ${setClauses.join(', ')} WHERE id = ? AND therapist_id = ?`,
    ...params
  );

  // Return the updated rule
  return db.get(
    'SELECT * FROM outreach_rules WHERE id = ? AND therapist_id = ?',
    ruleId,
    therapistId
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine the outreach channel based on patient preferences and available
 * contact info.  Falls back to 'sms' when both are available and no
 * preference is set.
 *
 * @param {Object} patient - Must have phone, email, preferred_contact_method
 * @returns {string} 'sms' | 'email'
 */
function resolveChannel(patient) {
  const pref = (patient.preferred_contact_method || '').toLowerCase();

  if (pref === 'email' && patient.email) return 'email';
  if (pref === 'sms' && patient.phone) return 'sms';

  // 'ask' or unset — prefer SMS if phone is available, else email
  if (patient.phone) return 'sms';
  if (patient.email) return 'email';

  // No contact info — default to sms (will fail at send time)
  return 'sms';
}

/**
 * Format an ISO datetime string into a human-readable form.
 * Example: "2026-04-13T14:00:00" -> "Apr 13 at 2:00 PM"
 *
 * @param {string} isoString
 * @returns {string}
 */
function formatDateTime(isoString) {
  if (!isoString) return 'your scheduled time';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minStr = minutes < 10 ? `0${minutes}` : String(minutes);
    return `${month} ${day} at ${hours}:${minStr} ${ampm}`;
  } catch {
    return isoString;
  }
}

/**
 * Safely parse JSON with a fallback to empty object.
 *
 * @param {string} jsonStr
 * @returns {Object}
 */
function safeParse(jsonStr) {
  try {
    return JSON.parse(jsonStr || '{}');
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  evaluateOutreachRules,
  createDefaultRules,
  getOutreachLog,
  getOutreachRules,
  updateOutreachRule,
};
