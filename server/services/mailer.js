/**
 * Mailer service — sends transactional emails.
 *
 * Provider selection (checked in order, first one configured wins):
 *   1. Gmail API via HTTPS     (preferred HIPAA-covered path under Google Workspace BAA)
 *   2. Gmail/Workspace SMTP    (HIPAA-covered fallback where outbound SMTP is allowed)
 *   3. Resend REST API         (legacy fallback — NOT HIPAA-compliant without BAA)
 *   4. Console log             (dev fallback when nothing is configured)
 *
 * ⚠️  Anything touching patient PHI (assessment links with patient names,
 *     portal invites, reminders) MUST route through a BAA-covered provider.
 *
 * Env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   Full JSON key file from GCP service account
 *                                 (takes precedence over SMTP).
 *   GMAIL_IMPERSONATE_USER        User the service account impersonates for
 *                                 sending (e.g., admin@miwa.care). Required
 *                                 when GOOGLE_SERVICE_ACCOUNT_JSON is set.
 *   SMTP_HOST                     default: smtp.gmail.com
 *   SMTP_PORT                     default: 587
 *   SMTP_USER                     Gmail/Workspace address
 *   SMTP_PASS                     Google App Password
 *   FROM_EMAIL                    default: "Miwa <noreply@miwa.care>"
 *   RESEND_API_KEY                legacy fallback (non-BAA)
 *   APP_BASE_URL                  default: https://miwa.care
 */
const https = require('https');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GMAIL_IMPERSONATE_USER = process.env.GMAIL_IMPERSONATE_USER || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Miwa <noreply@miwa.care>';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://miwa.care';

// Lazily construct a reusable nodemailer transport only when SMTP is configured.
//
// NOTE on `family: 4` — some container hosts cannot reliably reach
// Gmail's IPv6 SMTP servers, returning ENETUNREACH. Node's default is to try
// IPv6 first via dual-stack, which fails before falling back to IPv4 (or
// sometimes not falling back at all). Forcing family=4 skips the IPv6 attempt
// entirely and is the bulletproof fix for the "works locally, fails on
// cloud SMTP connectivity issue.
let _smtpTransport = null;
function getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;
  if (!SMTP_USER || !SMTP_PASS) return null;
  _smtpTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Force IPv4 to avoid cloud host to Google IPv6 ENETUNREACH issues.
    family: 4,
    // Fail fast if the network path is broken (otherwise Nodemailer hangs
    // for ~60 sec per send attempt, blocking the Node event loop).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return _smtpTransport;
}

function hasHipaaCoveredProvider() {
  // Either Gmail API (preferred) or Gmail/Workspace SMTP qualifies under
  // the existing Google Workspace BAA.
  const hasGmailApi = !!(GOOGLE_SERVICE_ACCOUNT_JSON && GMAIL_IMPERSONATE_USER);
  const hasSmtp = !!(SMTP_USER && SMTP_PASS);
  return hasGmailApi || hasSmtp;
}

// Gmail API (HTTPS) - preferred production mail path.
//
// Uses a Google Cloud service account with domain-wide delegation to
// impersonate a Workspace user (admin@miwa.care) and send via the Gmail API
// over HTTPS port 443. This avoids SMTP egress blocks and is
// covered by the Google Workspace BAA we already have on file.
let _googleJwt = null;
function getGoogleJwtClient() {
  if (_googleJwt) return _googleJwt;
  if (!GOOGLE_SERVICE_ACCOUNT_JSON || !GMAIL_IMPERSONATE_USER) return null;
  let credentials;
  try {
    credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`);
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key');
  }
  _googleJwt = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: GMAIL_IMPERSONATE_USER, // the Workspace user to impersonate
  });
  return _googleJwt;
}

async function sendViaGmailApi({ to, subject, html, text, attachments }) {
  const auth = getGoogleJwtClient();
  if (!auth) throw new Error('Gmail API not configured');

  const gmail = google.gmail({ version: 'v1', auth });

  // Build the MIME message via nodemailer's MailComposer so we get correct
  // UTF-8 header encoding (RFC 2047 for the Subject), quoted-printable body
  // encoding, and proper multipart/alternative structure — all the details
  // that are painful and error-prone to hand-roll.
  const MailComposer = require('nodemailer/lib/mail-composer');
  const composer = new MailComposer({
    from: FROM_EMAIL,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    text,
    attachments,
  });

  const rawBuffer = await new Promise((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) return reject(err);
      resolve(message);
    });
  });

  const raw = rawBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me', // 'me' = the impersonated user (GMAIL_IMPERSONATE_USER)
    requestBody: { raw },
  });

  return { ok: true, id: result.data?.id || null, provider: 'gmail-api' };
}

// ── Shared email template shell ─────────────────────────────────────────────
// All emails use this consistent wrapper for brand cohesion.
function emailShell({ preheader, body }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  ${preheader ? `<!--[if !mso]><!--><span style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</span><!--<![endif]-->` : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f0eef6;
      color: #374151;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .wrapper { padding: 40px 16px; }
    .card {
      background: #ffffff;
      border-radius: 20px;
      max-width: 520px;
      margin: 0 auto;
      padding: 48px 40px 40px;
      box-shadow: 0 4px 32px rgba(87, 70, 237, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
    }
    .logo-row {
      margin-bottom: 32px;
      text-align: left;
    }
    .logo {
      display: inline-block;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #5746ed, #0ac5a2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .logo-dot {
      display: inline-block;
      width: 8px; height: 8px;
      background: #0ac5a2;
      border-radius: 50%;
      margin-left: 2px;
      vertical-align: super;
    }
    h2 {
      color: #111827;
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 8px;
      letter-spacing: -0.3px;
    }
    .subtitle {
      color: #6b7280;
      font-size: 15px;
      margin-bottom: 28px;
    }
    p { color: #4b5563; font-size: 15px; line-height: 1.7; margin-bottom: 16px; }
    .greeting { color: #111827; font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .btn-wrap { text-align: center; margin: 28px 0 32px; }
    .btn {
      display: inline-block;
      padding: 15px 40px;
      background: linear-gradient(135deg, #5746ed 0%, #0ac5a2 100%);
      color: #ffffff !important;
      border-radius: 14px;
      text-decoration: none;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.2px;
      box-shadow: 0 4px 16px rgba(87, 70, 237, 0.25);
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.92; }
    .info-box {
      background: #f5f3ff;
      border: 1px solid #e0d4fc;
      border-radius: 12px;
      padding: 14px 18px;
      font-size: 13px;
      color: #5746ed;
      margin: 20px 0;
    }
    .warning-box {
      background: #fef9c3;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 14px 18px;
      font-size: 13px;
      color: #713f12;
      margin: 20px 0;
    }
    .muted { font-size: 13px; color: #9ca3af; }
    .divider { border: none; border-top: 1px solid #f3f4f6; margin: 32px 0 20px; }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #b0b0b0;
      line-height: 1.5;
    }
    .footer a { color: #5746ed; text-decoration: none; }
    .footer-brand {
      font-weight: 700;
      background: linear-gradient(135deg, #5746ed, #0ac5a2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    @media (max-width: 600px) {
      .card { padding: 32px 24px 28px; border-radius: 16px; }
      .wrapper { padding: 20px 12px; }
      h2 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-row">
        <span class="logo">Miwa</span><span class="logo-dot"></span>
      </div>
      ${body}
      <hr class="divider">
      <div class="footer">
        <span class="footer-brand">Miwa</span> &bull; AI-powered clinical documentation<br>
        <a href="${APP_BASE_URL}">miwa.care</a><br>
        <span style="color:#d1d5db;">This is an automated message. Please do not reply.</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Name resolution helper ──────────────────────────────────────────────────
function resolveName(firstName, fullName) {
  if (firstName && firstName.trim()) return firstName.trim();
  if (fullName && fullName.trim()) return fullName.trim().split(' ')[0];
  return null;
}

/**
 * Send email. Provider resolution:
 *   1. Gmail API via HTTPS  (preferred, HIPAA-covered)
 *   2. Gmail/Workspace SMTP (HIPAA-covered fallback)
 *   3. Resend REST API      (legacy — NOT HIPAA-compliant without BAA)
 *   4. Console log          (dev)
 */
async function sendMail({ to, subject, html, text, attachments }) {
  // ─── Path 1: Gmail API (HTTPS) ───────────────────────────────────────────
  // This is the production path. HIPAA-covered via the Google Workspace BAA.
  // Works through HTTPS on port 443. Failures throw loudly rather than
  // falling back to a non-BAA provider.
  if (GOOGLE_SERVICE_ACCOUNT_JSON && GMAIL_IMPERSONATE_USER) {
    try {
      return await sendViaGmailApi({ to, subject, html, text, attachments });
    } catch (err) {
      throw new Error(`Gmail API send failed: ${err.message}`);
    }
  }

  const smtp = getSmtpTransport();

  // ─── Path 2: Gmail/Workspace SMTP ────────────────────────────────────────
  // HIPAA-covered, but often blocked by cloud egress controls. Kept as an
  // option for deployments where SMTP is explicitly allowed.
  if (smtp) {
    try {
      const info = await smtp.sendMail({
        from: FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        attachments,
      });
      return { ok: true, id: info.messageId, provider: 'smtp' };
    } catch (err) {
      // Propagate so callers can report failure upstream; do NOT silently
      // fall back to Resend for a PHI-containing message, because that would
      // route PHI through a non-BAA vendor.
      throw new Error(`SMTP send failed: ${err.message}`);
    }
  }

  // Legacy fallback: Resend REST API (NOT BAA-covered — not safe for PHI)
  if (RESEND_API_KEY) {
    const payload = JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.resend.com',
          path: '/emails',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (res.statusCode >= 400) {
                return reject(new Error(`Resend API error ${res.statusCode}: ${data.message || body}`));
              }
              resolve({ ok: true, id: data.id, provider: 'resend' });
            } catch {
              reject(new Error(`Resend: failed to parse response — ${body}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // Dev fallback: no provider configured
  console.log(`\n[MAILER DEV] To: ${to}\nSubject: ${subject}\n${text || ''}\n`);
  return { ok: true, dev: true, provider: 'console' };
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a verification link to the trainee's school/program email.
 */
async function sendSchoolEmailVerification({ schoolEmail, firstName, fullName, token }) {
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-credential/${token}`;
  const name = resolveName(firstName, fullName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  const subject = 'Verify your trainee status on Miwa';

  const text = `${greeting}

Thanks for signing up for Miwa as a trainee! To confirm your program enrollment, click the link below:

${verifyUrl}

This link expires in 7 days.

— The Miwa Team`;

  const html = emailShell({
    preheader: 'Confirm your trainee enrollment to unlock the $39/mo rate.',
    body: `
      <h2>Verify your trainee status</h2>
      <p class="subtitle">One quick step to confirm your program enrollment.</p>
      <p class="greeting">${greeting}</p>
      <p>You registered for Miwa as a <strong>trainee</strong>. Click the button below to verify your school email and unlock the trainee rate.</p>
      <div class="info-box">
        Sent to: <strong>${schoolEmail}</strong>
      </div>
      <div class="btn-wrap">
        <a href="${verifyUrl}" class="btn">Verify My Trainee Status</a>
      </div>
      <p class="muted">This link expires in <strong>7 days</strong>. If you didn't create this account, you can safely ignore this email.</p>
    `,
  });

  return sendMail({ to: schoolEmail, subject, html, text });
}

/**
 * Sends a password reset link to a therapist.
 */
async function sendPasswordResetEmail({ toEmail, firstName, fullName, resetToken }) {
  const resetUrl = `${APP_BASE_URL}/reset-password?token=${resetToken}`;
  const name = resolveName(firstName, fullName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  const subject = 'Reset your Miwa password';

  const text = `${greeting}

We received a request to reset your Miwa password. Click the link below to set a new password:

${resetUrl}

This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.

— The Miwa Team`;

  const html = emailShell({
    preheader: 'You requested a password reset for your Miwa account.',
    body: `
      <h2>Reset your password</h2>
      <p class="subtitle">Choose a new password for your Miwa account.</p>
      <p class="greeting">${greeting}</p>
      <p>We received a request to reset your password. Click the button below to choose a new one.</p>
      <div class="btn-wrap">
        <a href="${resetUrl}" class="btn">Reset Password</a>
      </div>
      <p class="muted">This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email — your password won't change.</p>
    `,
  });

  return sendMail({ to: toEmail, subject, html, text });
}

/**
 * Sends an assessment link to a client via email.
 */
async function sendAssessmentEmail({ toEmail, token, type, clientName, customMsg }) {
  const link = `${APP_BASE_URL}/assess/${token}`;
  const name = clientName?.trim() || null;
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  const subject = `Your ${type} assessment is ready`;

  const text = customMsg
    ? `${customMsg}\n\n${link}`
    : `${greeting}\n\nYour therapist has sent you a ${type} questionnaire to complete. Please take a few quiet minutes to answer the questions honestly.\n\n${link}\n\nThis link is secure and expires in 7 days.\n\n— Sent via Miwa`;

  const html = emailShell({
    preheader: `Your therapist sent you a ${type} questionnaire to complete.`,
    body: `
      <h2>${type} Assessment</h2>
      <p class="subtitle">Your therapist has a quick questionnaire for you.</p>
      <p class="greeting">${greeting}</p>
      ${customMsg ? `<p>${customMsg}</p>` : `<p>Your therapist has sent you a <strong>${type}</strong> questionnaire. Please take a few quiet minutes to answer honestly — there are no right or wrong answers.</p>`}
      <div class="btn-wrap">
        <a href="${link}" class="btn">Complete Assessment</a>
      </div>
      <p class="muted">This link is secure and expires in <strong>7 days</strong>. Your responses are confidential and shared only with your therapist.</p>
    `,
  });

  return sendMail({ to: toEmail, subject, html, text });
}

/**
 * Sends a welcome email to the newly registered therapist.
 */
async function sendWelcomeEmail({ toEmail, firstName, fullName, credentialType, pendingVerification }) {
  const name = resolveName(firstName, fullName) || 'there';

  const subject = credentialType === 'trainee' && pendingVerification
    ? `Welcome to Miwa, ${name} — verification pending`
    : `Welcome to Miwa, ${name}!`;

  const verificationNote = pendingVerification
    ? `<div class="warning-box">
        <strong>One more step:</strong> We sent a verification link to your school email. Click it to confirm your trainee status — your account is active right away.
      </div>`
    : '';

  const html = emailShell({
    preheader: `Welcome to Miwa! Your AI-powered clinical documentation copilot is ready.`,
    body: `
      <h2>Welcome to Miwa, ${name}!</h2>
      <p class="subtitle">Your AI-powered clinical documentation copilot is ready.</p>
      <p>You're all set to start writing notes, tracking outcomes, scheduling assessments, and more. Miwa learns your preferences over time — the more you use it, the better it gets.</p>
      ${verificationNote}
      <div class="btn-wrap">
        <a href="${APP_BASE_URL}/dashboard" class="btn">Open Your Dashboard</a>
      </div>
      <p class="muted">Questions? Visit <a href="${APP_BASE_URL}" style="color:#5746ed;text-decoration:none;">miwa.care</a> or reply to this email.</p>
    `,
  });

  return sendMail({
    to: toEmail,
    subject,
    html,
    text: `Welcome to Miwa, ${name}! Open your dashboard at ${APP_BASE_URL}/dashboard`,
  });
}

/**
 * Sends a practice invite email to a clinician.
 */
async function sendPracticeInviteEmail({ toEmail, inviterName, practiceName, role, inviteUrl }) {
  const subject = `You're invited to join ${practiceName} on Miwa`;

  const html = emailShell({
    preheader: `${inviterName} invited you to join ${practiceName} on Miwa.`,
    body: `
      <h2>You're invited!</h2>
      <p class="subtitle">${inviterName} wants you to join their practice on Miwa.</p>
      <p>You've been invited to join <strong>${practiceName}</strong> as a <strong>${role}</strong>. Miwa is an AI-powered clinical documentation copilot that helps therapists write notes, track outcomes, and manage their caseload.</p>
      <div class="info-box">
        Practice: <strong>${practiceName}</strong><br>
        Role: <strong>${role}</strong><br>
        Invited by: <strong>${inviterName}</strong>
      </div>
      <div class="btn-wrap">
        <a href="${inviteUrl}" class="btn">Accept Invite</a>
      </div>
      <p class="muted">If you don't have a Miwa account yet, you'll be prompted to create one first. Your subscription is covered by the practice plan.</p>
    `,
  });

  return sendMail({
    to: toEmail,
    subject,
    html,
    text: `${inviterName} invited you to join ${practiceName} on Miwa. Accept here: ${inviteUrl}`,
  });
}

/**
 * Sends a verification link to confirm a newly registered therapist's email
 * address. Required before the account can sign in.
 */
async function sendAccountVerificationEmail({ toEmail, firstName, fullName, token }) {
  const verifyUrl = `${APP_BASE_URL}/verify-email?token=${token}`;
  const name = resolveName(firstName, fullName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  const subject = 'Verify your Miwa email address';

  const text = `${greeting}

Welcome to Miwa! Please verify this email address to activate your account:

${verifyUrl}

This link expires in 24 hours. If you didn't create a Miwa account, you can ignore this email — no account will be created without verification.

— The Miwa Team`;

  const html = emailShell({
    preheader: 'Confirm your email address to activate your Miwa account.',
    body: `
      <h2>Verify your email</h2>
      <p class="subtitle">One quick click and you're in.</p>
      <p class="greeting">${greeting}</p>
      <p>Welcome to Miwa! Please confirm this email address to activate your account.</p>
      <div class="btn-wrap">
        <a href="${verifyUrl}" class="btn">Verify Email Address</a>
      </div>
      <p class="muted">This link expires in <strong>24 hours</strong>. If you didn't create a Miwa account, you can safely ignore this email — nothing will happen without your confirmation.</p>
    `,
  });

  return sendMail({ to: toEmail, subject, html, text });
}

/**
 * Sent when someone tries to register with an email that already has an
 * account. Tells them to sign in or reset their password instead — without
 * leaking the existence of the account through the registration response.
 */
async function sendDuplicateRegistrationEmail({ toEmail, firstName, fullName }) {
  const loginUrl = `${APP_BASE_URL}/login`;
  const resetUrl = `${APP_BASE_URL}/forgot-password`;
  const name = resolveName(firstName, fullName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  const subject = 'A Miwa account already exists for this email';

  const text = `${greeting}

Someone (possibly you) just tried to register a Miwa account using this email — but you already have one.

If it was you and you forgot you have an account:
- Sign in here: ${loginUrl}
- Forgot your password? Reset it here: ${resetUrl}

If it wasn't you, no action is needed. Your existing account is unchanged.

— The Miwa Team`;

  const html = emailShell({
    preheader: 'Someone tried to register with this email — but you already have an account.',
    body: `
      <h2>You already have a Miwa account</h2>
      <p class="subtitle">No new account was created.</p>
      <p class="greeting">${greeting}</p>
      <p>Someone (possibly you) just tried to register a Miwa account using this email address. You already have an account, so nothing new was created.</p>
      <div class="btn-wrap">
        <a href="${loginUrl}" class="btn">Sign In</a>
      </div>
      <p>Forgot your password? <a href="${resetUrl}" style="color:#5746ed;font-weight:600;">Reset it here</a>.</p>
      <p class="muted">If this wasn't you, you can safely ignore this email. Your existing account is unchanged.</p>
    `,
  });

  return sendMail({ to: toEmail, subject, html, text });
}

/**
 * Sends a follow-up to the therapist when their submitted feedback is
 * resolved (and optionally responded to) by the Miwa team in the admin
 * panel. Quotes their original message back so the email is self-contained
 * — they don't need to remember what they wrote.
 */
async function sendFeedbackResolutionEmail({ toEmail, firstName, fullName, originalMessage, adminResponse, category }) {
  const name = resolveName(firstName, fullName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const catLabel = category === 'bug' ? 'bug report'
    : category === 'feature' ? 'feature request'
    : 'feedback';

  const subject = adminResponse
    ? `Re: your Miwa ${catLabel}`
    : `Your Miwa ${catLabel} has been reviewed`;

  const trimmedOriginal = (originalMessage || '').trim();
  const trimmedResponse = (adminResponse || '').trim();

  const text = `${greeting}

Thanks for sending us this ${catLabel} through Miwa chat. Quick update from the Miwa team:

${trimmedResponse || 'Your feedback has been reviewed and the issue has been marked resolved. Thanks for helping us improve Miwa.'}

Your original message:
"${trimmedOriginal}"

If anything is still off or you want to follow up, reply to this email or send another note through Miwa chat — we read every one.

— The Miwa Team`;

  const html = emailShell({
    preheader: adminResponse ? `Reply to your Miwa ${catLabel}.` : `Your Miwa ${catLabel} has been reviewed.`,
    body: `
      <h2>Re: your ${catLabel}</h2>
      <p class="subtitle">Quick update from the Miwa team.</p>
      <p class="greeting">${greeting}</p>
      <p>Thanks for sending us this ${catLabel} through Miwa chat. Here's where it landed:</p>
      ${trimmedResponse
        ? `<div class="info-box" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;white-space:pre-wrap;">${escapeHtmlBasic(trimmedResponse)}</div>`
        : `<p>Your feedback has been reviewed and marked <strong>resolved</strong>. Thanks for helping us improve Miwa.</p>`}
      <p style="margin-top:18px;font-size:13px;color:#6b7280;"><strong>Your original message:</strong></p>
      <div style="border-left:3px solid #e5e7eb;padding:6px 12px;color:#6b7280;font-size:13px;font-style:italic;white-space:pre-wrap;">${escapeHtmlBasic(trimmedOriginal)}</div>
      <p class="muted" style="margin-top:24px;">If anything is still off or you want to follow up, reply to this email or send another note through Miwa chat — we read every one.</p>
    `,
  });

  return sendMail({ to: toEmail, subject, html, text });
}

// Local minimal HTML escaper for the feedback email — avoids pulling in a
// dependency for one user-supplied string field.
function escapeHtmlBasic(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  sendMail,
  sendSchoolEmailVerification,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendAssessmentEmail,
  sendPracticeInviteEmail,
  sendAccountVerificationEmail,
  sendDuplicateRegistrationEmail,
  sendFeedbackResolutionEmail,
  hasHipaaCoveredProvider,
};
