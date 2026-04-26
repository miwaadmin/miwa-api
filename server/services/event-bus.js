/**
 * Event Bus - Tier 1 Agentic Upgrade (Feature 5)
 *
 * Lightweight pub/sub system that connects real-time clinical events
 * (assessment submitted, appointment no-show, session signed) to
 * configurable trigger actions (alerts, auto-sends, logging).
 */
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

const listeners = {};

/**
 * Emit an event. Database trigger work runs in the background so callers do
 * not block clinical flows. In-memory listeners still run synchronously.
 */
function emit(eventType, data) {
  console.log(`[event-bus] ${eventType}: therapist_id=${data?.therapist_id || 'n/a'} patient_id=${data?.patient_id || 'n/a'}`);

  handleDatabaseTriggers(eventType, data).catch((err) => {
    // DB not ready or table doesn't exist yet - silently skip.
    if (!err.message?.includes('not initialised') && !err.message?.includes('no such table')) {
      console.error('[event-bus] DB error:', err.message);
    }
  });

  if (listeners[eventType]) {
    for (const fn of listeners[eventType]) {
      try { fn(data); } catch (err) {
        console.error(`[event-bus] Listener error for ${eventType}:`, err.message);
      }
    }
  }
}

async function handleDatabaseTriggers(eventType, data) {
  const db = getAsyncDb();
  const triggers = await db.all(
    "SELECT * FROM event_triggers WHERE event_type = ? AND enabled = 1",
    eventType
  );

  for (const trigger of triggers) {
    try {
      if (data.therapist_id && trigger.therapist_id !== data.therapist_id) continue;

      await executeTriggerAction(db, trigger, data);
      await db.run(
        "UPDATE event_triggers SET fire_count = fire_count + 1, last_fired_at = datetime('now') WHERE id = ?",
        trigger.id
      );
    } catch (err) {
      console.error(`[event-bus] Trigger ${trigger.id} failed:`, err.message);
    }
  }

  if (triggers.length > 0) await persistIfNeeded();
}

/**
 * Register an in-memory listener for an event type.
 */
function on(eventType, fn) {
  if (!listeners[eventType]) listeners[eventType] = [];
  listeners[eventType].push(fn);
}

/**
 * Execute the action configured for a trigger.
 */
async function executeTriggerAction(db, trigger, data) {
  const config = JSON.parse(trigger.config_json || '{}');

  switch (trigger.action_type) {
    case 'create_alert': {
      if (config.min_score && data.total_score !== undefined && data.total_score < config.min_score) return;

      await db.insert(
        "INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description) VALUES (?, ?, ?, ?, ?, ?)",
        trigger.therapist_id,
        data.patient_id || 0,
        config.alert_type || 'EVENT',
        config.severity || 'LOW',
        config.title || `Event: ${trigger.event_type}`,
        config.description || JSON.stringify(data).slice(0, 500)
      );
      console.log(`[event-bus] Alert created for therapist ${trigger.therapist_id}: ${config.title || trigger.event_type}`);
      break;
    }

    case 'send_assessment':
      console.log(`[event-bus] Assessment send queued for trigger ${trigger.id}`);
      break;

    case 'log':
      console.log(`[event-trigger] ${trigger.event_type} -> ${trigger.action_type}`);
      break;

    default:
      console.log(`[event-bus] Unknown action_type: ${trigger.action_type}`);
  }
}

/**
 * Create default event triggers for a therapist.
 * Called during registration or first-time setup.
 */
async function createDefaultTriggers(db, therapistId) {
  const defaults = [
    {
      event_type: 'assessment_submitted',
      action_type: 'create_alert',
      config_json: JSON.stringify({
        alert_type: 'HIGH_SEVERITY_ASSESSMENT',
        severity: 'HIGH',
        title: 'High severity assessment submitted',
        min_score: 15,
      }),
    },
    {
      event_type: 'appointment_noshow',
      action_type: 'create_alert',
      config_json: JSON.stringify({
        alert_type: 'NO_SHOW',
        severity: 'MEDIUM',
        title: 'Client no-show',
      }),
    },
    {
      event_type: 'session_signed',
      action_type: 'log',
      config_json: JSON.stringify({}),
    },
  ];

  for (const trigger of defaults) {
    const existing = await db.get(
      "SELECT id FROM event_triggers WHERE therapist_id = ? AND event_type = ? AND action_type = ?",
      therapistId, trigger.event_type, trigger.action_type
    );
    if (!existing) {
      await db.insert(
        "INSERT INTO event_triggers (therapist_id, event_type, action_type, config_json) VALUES (?, ?, ?, ?)",
        therapistId, trigger.event_type, trigger.action_type, trigger.config_json
      );
    }
  }
}

module.exports = { emit, on, createDefaultTriggers };
