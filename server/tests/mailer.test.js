const test = require('node:test');
const assert = require('node:assert/strict');

const MAILER_PATH = require.resolve('../services/mailer');

function loadMailer(envPatch = {}) {
  const original = { ...process.env };
  for (const key of [
    'NODE_ENV',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'GMAIL_IMPERSONATE_USER',
    'SMTP_USER',
    'SMTP_PASS',
    'RESEND_API_KEY',
    'ALLOW_LEGACY_RESEND_EMAIL',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, envPatch);
  delete require.cache[MAILER_PATH];
  const mailer = require(MAILER_PATH);
  return {
    mailer,
    restore() {
      process.env = original;
      delete require.cache[MAILER_PATH];
    },
  };
}

test('mailer blocks non-BAA fallbacks in production', async () => {
  const { mailer, restore } = loadMailer({
    NODE_ENV: 'production',
    RESEND_API_KEY: 'test_resend_key',
  });

  try {
    await assert.rejects(
      () => mailer.sendMail({
        to: 'clinician@example.com',
        subject: 'Diagnostic',
        text: 'No PHI',
      }),
      /HIPAA-covered email provider/
    );
  } finally {
    restore();
  }
});

test('mailer still allows console fallback outside production', async () => {
  const { mailer, restore } = loadMailer({ NODE_ENV: 'test' });
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));

  try {
    const result = await mailer.sendMail({
      to: 'clinician@example.com',
      subject: 'Diagnostic',
      text: 'No PHI',
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'console');
    assert.equal(lines.some((line) => line.includes('[MAILER DEV]')), true);
  } finally {
    console.log = originalLog;
    restore();
  }
});

test('mailer config status reports HIPAA-covered provider without secrets', () => {
  const { mailer, restore } = loadMailer({
    NODE_ENV: 'production',
    SMTP_USER: 'admin@miwa.care',
    SMTP_PASS: 'super-secret-app-password',
  });

  try {
    const status = mailer.getMailerConfigStatus();
    assert.equal(status.smtpConfigured, true);
    assert.equal(status.hipaaCoveredProvider, true);
    assert.equal(JSON.stringify(status).includes('super-secret'), false);
  } finally {
    restore();
  }
});
