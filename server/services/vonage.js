/**
 * Legacy Vonage SMS service placeholder.
 *
 * Closed-beta SMS is implemented only through server/services/twilio.js so all
 * sends share the same consent, environment, and fixed-template rules.
 */

function normalisePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  if (digits.length > 7) return `+${digits}`
  return null
}

async function sendAssessmentSms() {
  return { sid: null, status: 'skipped', reason: 'vonage_disabled_pending_baa' }
}

async function sendTelehealthSms() {
  return { sid: null, status: 'skipped', reason: 'vonage_disabled_pending_baa' }
}

module.exports = { sendAssessmentSms, sendTelehealthSms, normalisePhone }
