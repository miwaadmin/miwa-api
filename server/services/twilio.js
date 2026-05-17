/**
 * Twilio SMS service for Miwa closed beta.
 *
 * Compliance posture:
 * - Default disabled. Production sends require SMS_CLOSED_BETA_ENABLED=true.
 * - SMS is used only for consented, minimum-necessary HIPAA-compliant workflows.
 * - Message bodies are fixed minimum-necessary category templates only.
 */
const twilio = require('twilio')

const SMS_TEMPLATES = {
  assessment: (link) => `Miwa: You have an assessment to complete. ${link} Reply STOP to opt out.`,
  checkin: (link) => `Miwa: You have a check-in to complete. ${link} Reply STOP to opt out.`,
  portal: (link) => `Miwa: You have a secure portal message or update. ${link} Reply STOP to opt out.`,
  appointment: (link) => `Miwa: You have an appointment update.${link ? ` ${link}` : ''} Reply STOP to opt out.`,
}

function isSmsClosedBetaEnabled() {
  return String(process.env.SMS_CLOSED_BETA_ENABLED || '').toLowerCase() === 'true'
}

function hasTwilioCredentials() {
  const accountSid = !!process.env.TWILIO_ACCOUNT_SID
  const apiKeyPair = !!process.env.TWILIO_API_KEY_SID && !!process.env.TWILIO_API_KEY_SECRET
  const authToken = !!process.env.TWILIO_AUTH_TOKEN
  const sender = !!process.env.TWILIO_MESSAGING_SERVICE_SID || !!process.env.TWILIO_PHONE_NUMBER
  return accountSid && (apiKeyPair || authToken) && sender
}

function getSmsConfigStatus() {
  return {
    closedBetaEnabled: isSmsClosedBetaEnabled(),
    configured: hasTwilioCredentials(),
    baaStatus: 'pending',
    provider: hasTwilioCredentials() ? 'twilio' : null,
  }
}

function getClient() {
  if (!isSmsClosedBetaEnabled() || !hasTwilioCredentials()) return null

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKeySid = process.env.TWILIO_API_KEY_SID
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid })
  }

  return twilio(accountSid, authToken)
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
  return (process.env.APP_BASE_URL || process.env.APP_URL || 'https://miwa.care').replace(/\/$/, '')
}

function buildSmsBody(category, link) {
  const template = SMS_TEMPLATES[category]
  if (!template) throw new Error(`Unsupported SMS category: ${category}`)
  return template(link || '')
}

async function sendCategorySms(toPhone, category, link) {
  const phone = normalisePhone(toPhone)
  if (!phone) return { sid: null, status: 'skipped', reason: 'missing_phone' }

  const client = getClient()
  if (!client) {
    console.warn('[twilio] SMS skipped - closed beta disabled or Twilio not configured')
    return { sid: null, status: 'skipped', reason: 'not_configured_or_disabled' }
  }

  const messagingServiceSid = getMessagingServiceSid()
  const messageParams = { body: buildSmsBody(category, link), to: phone }
  if (messagingServiceSid) {
    messageParams.messagingServiceSid = messagingServiceSid
  } else {
    messageParams.from = getFromNumber()
  }

  const msg = await client.messages.create(messageParams)
  return { sid: msg.sid, status: msg.status }
}

async function sendAssessmentSms(toPhone, token) {
  const link = `${getAppBaseUrl()}/assess/${token}`
  return sendCategorySms(toPhone, 'assessment', link)
}

async function sendCheckinSms(toPhone, tokenOrUrl) {
  const raw = String(tokenOrUrl || '')
  const link = /^https?:\/\//i.test(raw) ? raw : `${getAppBaseUrl()}/checkin/${raw}`
  return sendCategorySms(toPhone, 'checkin', link)
}

async function sendPortalSms(toPhone, link) {
  return sendCategorySms(toPhone, 'portal', link)
}

async function sendAppointmentSms(toPhone, link) {
  return sendCategorySms(toPhone, 'appointment', link)
}

// Backward-compatible name used by older appointment code.
async function sendTelehealthSms(toPhone, url) {
  return sendAppointmentSms(toPhone, url)
}

/**
 * Validate and normalise a phone number to E.164.
 * Accepts: +15551234567, (555) 123-4567, 5551234567, 555-123-4567
 * Returns null if it can't be normalised.
 */
function normalisePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  if (digits.length > 7) return `+${digits}`
  return null
}

module.exports = {
  SMS_TEMPLATES,
  buildSmsBody,
  getSmsConfigStatus,
  hasTwilioCredentials,
  isSmsClosedBetaEnabled,
  normalisePhone,
  sendAppointmentSms,
  sendAssessmentSms,
  sendCategorySms,
  sendCheckinSms,
  sendPortalSms,
  sendTelehealthSms,
}
