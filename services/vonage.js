/**
 * Vonage SMS service for Miwa.
 * Drop-in replacement for twilio.js — same exported function signatures.
 * Uses Vonage SMS API (REST) with no additional npm packages required.
 * PHI note: only client phone numbers are used — no names or clinical data in messages.
 */
const https = require('https')
const querystring = require('querystring')

function getCredentials() {
  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) {
    throw new Error('Vonage credentials not configured. Set VONAGE_API_KEY and VONAGE_API_SECRET.')
  }
  return { apiKey, apiSecret }
}

function getFromNumber() {
  const num = process.env.VONAGE_FROM_NUMBER
  if (!num) throw new Error('VONAGE_FROM_NUMBER is not set.')
  return num
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://miwa.care').replace(/\/$/, '')
}

/**
 * Send a message via Vonage SMS API.
 * Returns { messageId, status } on success, throws on failure.
 */
function sendSms(to, from, text) {
  const { apiKey, apiSecret } = getCredentials()
  const payload = querystring.stringify({ api_key: apiKey, api_secret: apiSecret, from, to, text })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'rest.nexmo.com',
        path: '/sms/json',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            const data = JSON.parse(body)
            const msg = data.messages?.[0]
            if (!msg) return reject(new Error('Vonage: empty response'))
            if (msg.status !== '0') {
              return reject(new Error(`Vonage SMS failed: [${msg.status}] ${msg['error-text'] || 'Unknown error'}`))
            }
            resolve({ messageId: msg['message-id'], status: 'sent' })
          } catch (err) {
            reject(new Error(`Vonage: failed to parse response — ${err.message}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/**
 * Send an assessment link via SMS.
 * @param {string} toPhone    - E.164 format phone number, e.g. +15551234567
 * @param {string} token      - Assessment token
 * @param {string} type       - e.g. 'PHQ-9', 'GAD-7', 'PCL-5'
 * @param {string} [customMsg] - Optional custom message from clinician
 */
async function sendAssessmentSms(toPhone, token, type, customMsg) {
  const from = getFromNumber()
  const link = `${getAppBaseUrl()}/assess/${token}`

  const body = customMsg
    ? `${customMsg}\n\n${link}`
    : `Your clinician has sent you a ${type} questionnaire. Please complete it when you have a few quiet minutes:\n\n${link}\n\nThis link is secure and was sent through Miwa Health.`

  return sendSms(toPhone, from, body)
}

/**
 * Send the therapist's telehealth link to a client via SMS.
 * @param {string} toPhone    - E.164 format phone number
 * @param {string} url        - Therapist's video URL
 * @param {string} [apptTime] - Human-readable appointment time
 */
async function sendTelehealthSms(toPhone, url, apptTime) {
  const from = getFromNumber()
  const timeStr = apptTime ? ` for your ${apptTime} session` : ''
  const body = `Here is your telehealth link${timeStr}:\n\n${url}\n\nClick this link at your appointment time to join your video session. This link was sent through Miwa Health.`
  return sendSms(toPhone, from, body)
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

module.exports = { sendAssessmentSms, sendTelehealthSms, normalisePhone }
