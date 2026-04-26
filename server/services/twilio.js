/**
 * Twilio SMS service for Miwa.
 * Sends assessment links to clients via SMS.
 * PHI note: only client phone numbers are used — no names or clinical data in messages.
 */
const twilio = require('twilio')

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  if (!accountSid) return null   // Gracefully return null — callers must check

  const apiKeySid = process.env.TWILIO_API_KEY_SID
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid })
  }

  if (authToken) {
    return twilio(accountSid, authToken)
  }

  return null // No credentials configured
}

function getFromNumber() {
  const num = process.env.TWILIO_PHONE_NUMBER
  if (!num) throw new Error('TWILIO_PHONE_NUMBER is not set.')
  return num
}

function getMessagingServiceSid() {
  return (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim() || null
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://miwa.care').replace(/\/$/, '')
}

/**
 * Send an assessment link via SMS.
 * @param {string} toPhone   - E.164 format phone number, e.g. +15551234567
 * @param {string} token     - Assessment token (the URL-safe token from assessment_links table)
 * @param {string} type      - e.g. 'PHQ-9', 'GAD-7', 'PCL-5'
 * @param {string} [customMsg] - Optional custom message from clinician
 */
async function sendAssessmentSms(toPhone, token, type, customMsg) {
  const client = getClient()
  if (!client) { console.warn('[twilio] SMS skipped — Twilio not configured'); return { sid: null, status: 'skipped' } }
  const from = getFromNumber()
  const messagingServiceSid = getMessagingServiceSid()
  const link = `${getAppBaseUrl()}/assess/${token}`

  const baseBody = customMsg
    ? `${customMsg}\n\n${link}`
    : `Your clinician has sent you a ${type} questionnaire. Please complete it when you have a few quiet minutes:\n\n${link}\n\nThis link is secure and was sent through Miwa Health.`
  const body = `${baseBody}\n\nReply STOP to opt out, HELP for help. Msg & data rates may apply.`

  const messageParams = { body, to: toPhone }
  if (messagingServiceSid) {
    messageParams.messagingServiceSid = messagingServiceSid
  } else {
    messageParams.from = from
  }

  const msg = await client.messages.create(messageParams)
  return { sid: msg.sid, status: msg.status }
}

/**
 * Validate and normalise a phone number to E.164.
 * Accepts: +15551234567, (555) 123-4567, 5551234567, 555-123-4567
 * Returns null if it can't be normalised.
 */
function normalisePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`            // US number without country code
  if (digits.length === 11 && digits[0] === '1') return `+${digits}` // US with leading 1
  if (digits.length > 7) return `+${digits}`               // International (best effort)
  return null
}

/**
 * Send the therapist's telehealth link to a client via SMS.
 * @param {string} toPhone    - E.164 format phone number
 * @param {string} url        - Therapist's video URL (Zoom, Doxy, etc.)
 * @param {string} [apptTime] - Human-readable appointment time, e.g. "Friday at 2:00 PM"
 */
async function sendTelehealthSms(toPhone, url, apptTime) {
  const client = getClient()
  if (!client) { console.warn('[twilio] Telehealth SMS skipped — Twilio not configured'); return { sid: null, status: 'skipped' } }
  const from = getFromNumber()
  const messagingServiceSid = getMessagingServiceSid()

  const timeStr = apptTime ? ` for your ${apptTime} session` : ''
  const body = `Here is your telehealth link${timeStr}:\n\n${url}\n\nClick this link at your appointment time to join your video session. This link was sent through Miwa Health.\n\nReply STOP to opt out, HELP for help. Msg & data rates may apply.`

  const messageParams = { body, to: toPhone }
  if (messagingServiceSid) {
    messageParams.messagingServiceSid = messagingServiceSid
  } else {
    messageParams.from = from
  }

  const msg = await client.messages.create(messageParams)
  return { sid: msg.sid, status: msg.status }
}

module.exports = { sendAssessmentSms, sendTelehealthSms, normalisePhone }
