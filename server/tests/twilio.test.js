const test = require('node:test');
const assert = require('node:assert/strict');

const TWILIO_PATH = require.resolve('../services/twilio');

function loadTwilio(envPatch = {}) {
  const original = { ...process.env };
  for (const key of [
    'APP_BASE_URL',
    'APP_URL',
    'SMS_CLOSED_BETA_ENABLED',
    'SMS_ENABLED',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_API_KEY_SID',
    'TWILIO_API_KEY_SECRET',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_MESSAGING_SERVICE_SID',
    'TWILIO_PHONE_NUMBER',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, envPatch);
  delete require.cache[TWILIO_PATH];
  const sms = require(TWILIO_PATH);
  return {
    sms,
    restore() {
      process.env = original;
      delete require.cache[TWILIO_PATH];
    },
  };
}

test('SMS closed beta is disabled by default and ignores legacy SMS_ENABLED', async () => {
  const { sms, restore } = loadTwilio({
    SMS_ENABLED: 'true',
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'secret',
    TWILIO_PHONE_NUMBER: '+18558064294',
  });

  try {
    assert.equal(sms.isSmsClosedBetaEnabled(), false);
    assert.equal(sms.hasTwilioCredentials(), true);
    const result = await sms.sendAssessmentSms('+15551234567', 'abc123');
    assert.deepEqual(result, { sid: null, status: 'skipped', reason: 'not_configured_or_disabled' });
  } finally {
    restore();
  }
});

test('SMS templates are fixed category copy with STOP opt-out and no clinical specifics', () => {
  const { sms, restore } = loadTwilio();
  const banned = /\b(PHQ-9|GAD-7|PCL-5|C-SSRS|score|diagnos|symptom|therapist|clinician|client name|treatment|crisis)\b/i;

  try {
    const bodies = [
      sms.buildSmsBody('assessment', 'https://miwa.care/assess/abc123'),
      sms.buildSmsBody('checkin', 'https://miwa.care/checkin/abc123'),
      sms.buildSmsBody('portal', 'https://miwa.care/portal/abc123'),
      sms.buildSmsBody('appointment', 'https://miwa.care/portal/abc123'),
    ];

    for (const body of bodies) {
      assert.match(body, /^Miwa:/);
      assert.match(body, /Reply STOP to opt out\.$/);
      assert.equal(banned.test(body), false, body);
    }
  } finally {
    restore();
  }
});

test('SMS config requires closed beta flag and Twilio sender credentials', () => {
  const { sms, restore } = loadTwilio({
    SMS_CLOSED_BETA_ENABLED: 'true',
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_API_KEY_SID: 'SK123',
    TWILIO_API_KEY_SECRET: 'secret',
    TWILIO_MESSAGING_SERVICE_SID: 'MG123',
  });

  try {
    assert.deepEqual(sms.getSmsConfigStatus(), {
      closedBetaEnabled: true,
      configured: true,
      baaStatus: 'pending',
      provider: 'twilio',
    });
  } finally {
    restore();
  }
});
