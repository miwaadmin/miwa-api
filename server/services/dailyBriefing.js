/**
 * Proactive Daily Briefing — "Your Day" morning summary.
 *
 * For every active therapist with appointments today, computes a rich
 * markdown brief that tells them:
 *   - How many sessions today (with times + client names)
 *   - Who's improving / who's plateauing / who has risk flags
 *   - Which pre-session briefs are ready
 *   - Any open treatment stagnation or crisis alerts
 *   - Overnight assessment completions
 *
 * Stored in `daily_briefings` table. Rendered on the Dashboard.
 * Runs at 6am local time per therapist (same cron as research briefs).
 */

const { getDb, persist } = require('../db');
const { clinicalReasoning } = require('../lib/aiExecutor');
const { sendMail } = require('./mailer');

function fmtTime(iso, tz) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

function getLocalDateString(tz) {
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);
}

/**
 * Compute briefing data for one therapist.
 * Returns { markdown, stats } or null if nothing worth reporting.
 */
function computeTodaysBriefing(db, therapistId) {
  const therapist = db.get(
    'SELECT id, first_name, full_name, preferred_timezone FROM therapists WHERE id = ?',
    therapistId
  );
  if (!therapist) return null;

  const tz = therapist.preferred_timezone || 'America/Los_Angeles';
  const todayLocal = getLocalDateString(tz);

  // Helper: query that degrades to empty array on any SQL/schema error.
  // Ensures one bad query can't kill the whole briefing.
  const safeAll = (label, fn) => {
    try { return fn() || []; }
    catch (err) {
      console.error(`[daily-briefing] ${label} query failed:`, err.message);
      return [];
    }
  };

  // Today's scheduled appointments
  const todayAppts = safeAll('todayAppts', () => db.all(
    `SELECT a.id, a.scheduled_start, a.scheduled_end, a.appointment_type,
            a.duration_minutes, a.status,
            p.id AS patient_id, p.client_id, p.display_name, p.client_display_name
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
      WHERE a.therapist_id = ?
        AND DATE(a.scheduled_start) = ?
        AND a.status != 'cancelled'
      ORDER BY a.scheduled_start ASC`,
    therapistId, todayLocal
  ));

  // Active clients
  const activeClients = safeAll('activeClients', () => db.all(
    `SELECT id, client_id, display_name FROM patients WHERE therapist_id = ?`,
    therapistId
  ));

  // Open (undismissed) alerts — prioritize CRITICAL/WARNING
  const openAlerts = safeAll('openAlerts', () => db.all(
    `SELECT pa.id, pa.type, pa.severity, pa.title, pa.description, pa.patient_id,
            pa.created_at, p.client_id, p.display_name
       FROM progress_alerts pa
       LEFT JOIN patients p ON p.id = pa.patient_id
      WHERE pa.therapist_id = ? AND pa.dismissed_at IS NULL
      ORDER BY CASE pa.severity
                 WHEN 'CRITICAL' THEN 0
                 WHEN 'WARNING' THEN 1
                 WHEN 'SUCCESS' THEN 2
                 ELSE 3 END, pa.created_at DESC
      LIMIT 8`,
    therapistId
  ));

  // Overnight completions: assessments submitted in last 14 hours
  const overnight = safeAll('overnight', () => db.all(
    `SELECT a.id, a.template_type, a.total_score, a.severity_level,
            a.is_improvement, a.is_deterioration, a.administered_at,
            p.client_id, p.display_name
       FROM assessments a
       JOIN patients p ON p.id = a.patient_id
      WHERE a.therapist_id = ?
        AND a.administered_at > datetime('now', '-14 hours')
      ORDER BY a.administered_at DESC
      LIMIT 8`,
    therapistId
  ));

  // Unsigned sessions — things that need the therapist's attention
  const unsignedCount = (() => {
    try {
      const row = db.get(
        `SELECT COUNT(*) AS c FROM sessions
          WHERE therapist_id = ? AND signed_at IS NULL
            AND (subjective IS NOT NULL OR assessment IS NOT NULL OR plan IS NOT NULL)`,
        therapistId
      );
      return row?.c || 0;
    } catch { return 0; }
  })();

  // Pre-session briefs ready for today's appointments
  const briefCount = todayAppts.length > 0
    ? (() => {
        try {
          const row = db.get(
            `SELECT COUNT(*) AS c FROM session_briefs sb
              WHERE sb.appointment_id IN (${todayAppts.map(() => '?').join(',') || 'NULL'})`,
            ...todayAppts.map(a => a.id)
          );
          return row?.c || 0;
        } catch { return 0; }
      })()
    : 0;

  // ── Build markdown ──────────────────────────────────────────────────────
  const md = [];
  const firstName = therapist.first_name || therapist.full_name?.split(' ')[0] || 'there';
  const dayStr = new Date().toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
  });

  md.push(`# Good morning, ${firstName}`);
  md.push(`${dayStr}`);
  md.push('');

  // Today's Schedule markdown section is intentionally omitted. It's now
  // rendered as per-session cards by the <TodaysSchedule /> React component
  // (structured data from GET /api/research/todays-schedule).

  // Overnight updates
  if (overnight.length > 0) {
    md.push('## Overnight Updates');
    for (const o of overnight) {
      const name = o.display_name || o.client_id || 'Client';
      const icon = o.is_improvement ? '↓' : o.is_deterioration ? '↑' : '·';
      const type = (o.template_type || '').toUpperCase().replace(/^(PHQ|GAD|PCL)(\d)/, '$1-$2');
      md.push(`- ${icon} ${name} completed **${type}**: score ${o.total_score} (${o.severity_level || 'unclassified'})`);
    }
    md.push('');
  }

  // Things that need attention
  const critical = openAlerts.filter(a => a.severity === 'CRITICAL');
  const warnings = openAlerts.filter(a => a.severity === 'WARNING');
  const successes = openAlerts.filter(a => a.severity === 'SUCCESS');

  // "Needs Attention" markdown section is intentionally omitted here.
  // The same information is surfaced three better ways already:
  //   1. OvernightUpdates component nested in the Your Day card shows
  //      per-patient cards with NEEDS ATTENTION / MIXED TREND badges
  //      for anyone whose overnight scores are concerning.
  //   2. The Your Day card header shows 🚨 N / ⚠️ N pill badges for
  //      total critical / warning counts.
  //   3. The dedicated alerts card below the Your Day card lists every
  //      open alert with its full description and dismiss action.
  // Showing the same names a fourth time as flat bullets was pure noise.
  //
  // "Good News" (success alerts — retention milestones, etc.) is also
  // surfaced in the dedicated alerts card below; omitting here for the
  // same reason.
  //
  // The stats object below still counts critical/warning/success so the
  // Your Day header badges have live numbers.

  // Generation timestamp is now surfaced on the client via dailyBriefing
  // metadata / UI chrome, not as an in-body footer. The "---" separator
  // looked like orphaned cruft at the bottom of the Your Day card.

  const markdown = md.join('\n');
  const stats = {
    session_count: todayAppts.length,
    brief_count: briefCount,
    critical_alerts: critical.length,
    warning_alerts: warnings.length,
    success_alerts: successes.length,
    overnight_completions: overnight.length,
    active_clients: activeClients.length,
  };

  return { markdown, stats, date: todayLocal };
}

// ─── Caseload Status Synthesis ───────────────────────────────────────────────

/**
 * For each active patient, compute a concise status signal based on recent
 * activity:
 *   - `improving` — assessment scores trended down OR latest check-in mood high
 *   - `needs_attention` — latest assessment elevated / worsening, low check-in
 *     mood, unsigned notes, or a crisis alert open
 *   - `new_referral` — patient created in last 14 days AND fewer than 3 sessions
 *   - `overdue` — no session or check-in in 21+ days (but still active)
 *   - `stable` — everything else
 *
 * Returns a lean array suitable for both the narrative prompt and the UI.
 */
function computeCaseloadStatus(db, therapistId) {
  const patients = (() => {
    try {
      return db.all(
        `SELECT id, client_id, display_name, created_at, risk_screening
         FROM patients
         WHERE therapist_id = ?
           AND (archived_at IS NULL OR archived_at = '')`,
        therapistId
      ) || [];
    } catch {
      // If archived_at column doesn't exist, fall back without that filter.
      try {
        return db.all(
          `SELECT id, client_id, display_name, created_at, risk_screening
           FROM patients WHERE therapist_id = ?`,
          therapistId
        ) || [];
      } catch { return []; }
    }
  })();

  const now = Date.now();
  const daysAgo = (ms) => Math.round((now - ms) / (24 * 60 * 60 * 1000));
  const caseload = [];

  for (const p of patients) {
    let status = 'stable';
    const signals = [];
    let sortPriority = 3; // 0=highest (needs attention), 5=lowest

    // Most recent session
    let lastSession = null;
    try {
      lastSession = db.get(
        `SELECT session_date FROM sessions
         WHERE patient_id = ? AND therapist_id = ? AND signed_at IS NOT NULL
         ORDER BY session_date DESC LIMIT 1`,
        p.id, therapistId
      );
    } catch {}

    // Session count
    let sessionCount = 0;
    try {
      const r = db.get(
        `SELECT COUNT(*) AS c FROM sessions
         WHERE patient_id = ? AND therapist_id = ?`,
        p.id, therapistId
      );
      sessionCount = r?.c || 0;
    } catch {}

    // Last 2 assessments (any type) — look for worsening
    let latestAssessments = [];
    try {
      latestAssessments = db.all(
        `SELECT template_type, total_score, severity_level,
                is_improvement, is_deterioration, administered_at
         FROM assessments
         WHERE patient_id = ? AND therapist_id = ?
         ORDER BY administered_at DESC LIMIT 5`,
        p.id, therapistId
      ) || [];
    } catch {}

    // Last check-in
    let lastCheckin = null;
    try {
      lastCheckin = db.get(
        `SELECT mood_score, mood_notes, completed_at FROM checkin_links
         WHERE patient_id = ? AND therapist_id = ? AND completed_at IS NOT NULL
         ORDER BY completed_at DESC LIMIT 1`,
        p.id, therapistId
      );
    } catch {}

    // Open critical/warning alerts
    let openAlertCount = 0;
    try {
      const r = db.get(
        `SELECT COUNT(*) AS c FROM progress_alerts
         WHERE patient_id = ? AND therapist_id = ?
           AND dismissed_at IS NULL
           AND severity IN ('CRITICAL', 'WARNING')`,
        p.id, therapistId
      );
      openAlertCount = r?.c || 0;
    } catch {}

    // ── Status inference ──
    const lastActivityMs = lastSession?.session_date
      ? new Date(lastSession.session_date).getTime()
      : (lastCheckin?.completed_at ? new Date(lastCheckin.completed_at).getTime() : null);
    const daysSinceActivity = lastActivityMs ? daysAgo(lastActivityMs) : null;

    const createdAgeDays = p.created_at ? daysAgo(new Date(p.created_at).getTime()) : 9999;
    if (createdAgeDays <= 14 && sessionCount < 3) {
      status = 'new_referral';
      signals.push(`${createdAgeDays}d old, ${sessionCount} session${sessionCount === 1 ? '' : 's'}`);
      sortPriority = 1;
    }

    // Needs attention checks (override new_referral if serious)
    if (openAlertCount > 0) {
      status = 'needs_attention';
      signals.push(`${openAlertCount} open alert${openAlertCount === 1 ? '' : 's'}`);
      sortPriority = 0;
    }

    if (lastCheckin && lastCheckin.mood_score != null && lastCheckin.mood_score <= 2) {
      status = 'needs_attention';
      signals.push(`low mood check-in (${lastCheckin.mood_score}/5)`);
      sortPriority = 0;
    }

    // Worsening assessment — compare latest two of same type
    const byType = {};
    for (const a of latestAssessments) {
      const t = a.template_type;
      if (!byType[t]) byType[t] = [];
      byType[t].push(a);
    }
    let worstTrend = null;
    for (const [t, arr] of Object.entries(byType)) {
      if (arr.length >= 2 && arr[0].total_score > arr[1].total_score) {
        const diff = arr[0].total_score - arr[1].total_score;
        if (!worstTrend || diff > worstTrend.diff) {
          worstTrend = { type: t, from: arr[1].total_score, to: arr[0].total_score, diff };
        }
      }
    }
    if (worstTrend) {
      if (status !== 'needs_attention') {
        status = 'needs_attention';
        sortPriority = Math.min(sortPriority, 0);
      }
      signals.push(`${worstTrend.type.toUpperCase()} ${worstTrend.from}→${worstTrend.to}`);
    }

    // Improving: assessment trending down across 2+ or high-mood check-in
    let improving = false;
    for (const arr of Object.values(byType)) {
      if (arr.length >= 2 && arr[0].total_score < arr[1].total_score) {
        improving = true;
        signals.push(`${arr[0].template_type.toUpperCase()} ${arr[1].total_score}→${arr[0].total_score}`);
        break;
      }
    }
    if (!improving && lastCheckin && lastCheckin.mood_score >= 4) {
      improving = true;
      signals.push(`mood check-in ${lastCheckin.mood_score}/5`);
    }
    if (improving && status !== 'needs_attention' && status !== 'new_referral') {
      status = 'improving';
      sortPriority = 2;
    }

    // Overdue
    if (daysSinceActivity != null && daysSinceActivity >= 21 &&
        status !== 'needs_attention' && status !== 'new_referral') {
      status = 'overdue';
      signals.push(`${daysSinceActivity}d since last touch`);
      sortPriority = 2;
    }

    caseload.push({
      patient_id: p.id,
      name: p.display_name || p.client_id,
      status,
      signals,
      last_session_date: lastSession?.session_date || null,
      days_since_activity: daysSinceActivity,
      session_count: sessionCount,
      sort_priority: sortPriority,
    });
  }

  // Sort: needs_attention first, then new_referral, improving, overdue, stable
  caseload.sort((a, b) => a.sort_priority - b.sort_priority);
  return caseload;
}

// ─── Azure OpenAI Narrative for the Morning ────────────────────────────────────────

/**
 * Turn the structured morning data (appointments, caseload, overnight
 * completions, alerts) into a spoken-brief opener for the therapist.
 *
 * Tone: a trusted ops partner giving the morning rundown. Direct, warm,
 * concrete. Names the patients who need attention first. Ends with a
 * suggested order for prep.
 *
 * Runs best-effort. Falls back to a templated opener if the AI call fails.
 */
async function generateMorningNarrative({
  firstName, dayStr, todayAppts, caseload, overnight, unsignedCount, therapistId,
}) {
  const attentionList = caseload.filter(c => c.status === 'needs_attention');
  const improvingList = caseload.filter(c => c.status === 'improving');
  const newReferrals = caseload.filter(c => c.status === 'new_referral');
  const overdue = caseload.filter(c => c.status === 'overdue');
  const stableCount = caseload.filter(c => c.status === 'stable').length;

  const lines = [];
  lines.push(`Therapist first name: ${firstName || 'there'}`);
  lines.push(`Date: ${dayStr}`);
  lines.push(`Total active caseload: ${caseload.length}`);
  lines.push(`Today's scheduled sessions: ${todayAppts.length}`);
  if (todayAppts.length > 0) {
    const aList = todayAppts.slice(0, 10).map(a => {
      const name = a.display_name || a.client_id || 'Client';
      const time = a.scheduled_start ? a.scheduled_start.slice(11, 16) : '?';
      return `  ${time} — ${name} (${a.appointment_type || 'session'})`;
    });
    lines.push(`Today's schedule:\n${aList.join('\n')}`);
  }
  if (unsignedCount > 0) {
    lines.push(`Unsigned notes waiting: ${unsignedCount}`);
  }
  if (attentionList.length > 0) {
    lines.push(`NEEDS ATTENTION (${attentionList.length}):`);
    attentionList.slice(0, 6).forEach(c => {
      lines.push(`  - ${c.name}: ${c.signals.join(', ') || 'flagged'}`);
    });
  }
  if (newReferrals.length > 0) {
    lines.push(`NEW REFERRALS (${newReferrals.length}):`);
    newReferrals.slice(0, 4).forEach(c => {
      lines.push(`  - ${c.name}: ${c.signals.join(', ')}`);
    });
  }
  if (improvingList.length > 0) {
    lines.push(`IMPROVING (${improvingList.length}):`);
    improvingList.slice(0, 4).forEach(c => {
      lines.push(`  - ${c.name}: ${c.signals.join(', ')}`);
    });
  }
  if (overdue.length > 0) {
    lines.push(`OVERDUE / NO RECENT CONTACT (${overdue.length}):`);
    overdue.slice(0, 4).forEach(c => {
      lines.push(`  - ${c.name}: ${c.signals.join(', ')}`);
    });
  }
  if (stableCount > 0) {
    lines.push(`Stable: ${stableCount} clients`);
  }
  if (overnight.length > 0) {
    lines.push(`Overnight assessment completions:`);
    overnight.slice(0, 6).forEach(o => {
      const name = o.display_name || o.client_id || 'Client';
      const t = (o.template_type || '').toUpperCase();
      lines.push(`  - ${name}: ${t} score ${o.total_score} (${o.severity_level || 'n/a'})`);
    });
  }

  const dataPacket = lines.join('\n');

  const systemPrompt = `You are Miwa, the morning operations partner for a licensed mental health therapist.

You are writing the single thing they read at 7am to orient the day. It should feel like a trusted
colleague giving the rundown — warm, direct, concrete. The therapist is sipping coffee with one
thumb on their phone; every line needs to earn its place.

STRUCTURE (flexible — drop any paragraph that has no content):
  1. Warm one-line opener that names the number of sessions and the number of clients who need
     attention. Don't be cheesy. Don't use exclamation points.
  2. Needs attention: name each client and the specific signal. Suggest one concrete action per client
     where possible (re-screen, outreach, session prep focus).
  3. Good news: improving clients — name them and the specific improvement. Suggest acknowledging in session.
  4. New referrals / overdue clients: one line each, concrete next step.
  5. Suggested prep order: "If you have 20 minutes before your first session, read X's brief, then scan Y,
     then draft outreach to Z." Rank by clinical urgency, not schedule order.
  6. Optional single-line sign-off.

RULES:
  • NEVER invent a client or a signal that isn't in the data.
  • Use first names / display names exactly as given.
  • No markdown headers, no bullet points inside paragraphs — just plain prose with short paragraphs.
  • Hard cap: under 250 words. This has to be readable in one coffee sip.
  • Don't moralize or over-encourage. The therapist is a professional, not a student.
  • If the caseload is entirely stable with no sessions today, say that simply and suggest a catch-up task.
`;

  const userPrompt =
    `Structured morning data:\n\n${dataPacket}\n\n` +
    `Write the morning brief now.`;

  try {
    const text = await clinicalReasoning(
      systemPrompt,
      userPrompt,
      900,
      false,
      { therapistId, kind: 'morning_briefing', skipBudgetCheck: false }
    );
    return (text || '').trim() || null;
  } catch (err) {
    console.warn('[morning-briefing] narrative failed:', err.message);
    return null;
  }
}

// ─── Morning Email ───────────────────────────────────────────────────────────

/**
 * Send the morning briefing as an email. HIPAA-conscious: we include
 * per-client names and signals that are PHI, so this can only go out
 * via a BAA-covered email transport (Gmail API is what's configured).
 *
 * The mailer throws if no BAA transport is available — we catch and log
 * rather than failing the whole briefing generation.
 */
async function sendMorningEmail({ therapist, narrative, stats, caseload, dayStr, todayAppts }) {
  if (!therapist?.email) return { skipped: true, reason: 'no therapist email' };

  const appLink = process.env.APP_URL || 'https://miwa.care/dashboard';

  const apptListHtml = todayAppts.length === 0
    ? '<p style="color:#6b7280;font-size:14px;">No sessions scheduled today.</p>'
    : '<ul style="padding-left:20px;margin:8px 0;">' +
        todayAppts.slice(0, 10).map(a => {
          const name = a.display_name || a.client_id || 'Client';
          const time = a.scheduled_start ? a.scheduled_start.slice(11, 16) : '';
          return `<li style="margin:3px 0;font-size:13px;"><strong>${time}</strong> — ${name}</li>`;
        }).join('') + '</ul>';

  const attention = caseload.filter(c => c.status === 'needs_attention').slice(0, 6);
  const attentionHtml = attention.length === 0
    ? ''
    : '<h3 style="margin-top:24px;color:#991b1b;font-size:15px;">Needs attention</h3>' +
      '<ul style="padding-left:20px;margin:8px 0;">' +
        attention.map(c => `<li style="margin:4px 0;font-size:13px;"><strong>${c.name}</strong> — ${c.signals.join(', ')}</li>`).join('') +
      '</ul>';

  const narrativeHtml = narrative
    ? `<div style="white-space:pre-line;color:#111827;font-size:14px;line-height:1.6;margin:16px 0;">${narrative.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
    : '<p style="color:#6b7280;">Morning brief narrative is not available this morning.</p>';

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;background:#f9fafb;color:#111827;">
  <table style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <tr><td style="padding:28px 32px 12px;">
      <p style="margin:0;color:#6047EE;font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Your day · ${dayStr}</p>
      <h1 style="margin:4px 0 0;font-size:22px;color:#111827;">Good morning, ${(therapist.first_name || therapist.full_name || 'there').split(' ')[0]}</h1>
    </td></tr>
    <tr><td style="padding:12px 32px 8px;">
      ${narrativeHtml}
    </td></tr>
    <tr><td style="padding:4px 32px 8px;">
      <h3 style="margin:8px 0 0;color:#374151;font-size:15px;">Today's schedule (${todayAppts.length})</h3>
      ${apptListHtml}
      ${attentionHtml}
    </td></tr>
    <tr><td style="padding:16px 32px 28px;">
      <a href="${appLink}" style="display:inline-block;padding:10px 20px;background:#6047EE;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;">Open Miwa →</a>
      <p style="color:#9ca3af;font-size:11px;margin:16px 0 0;">Summary: ${stats.session_count} session${stats.session_count === 1 ? '' : 's'} · ${stats.critical_alerts || 0} critical alert${stats.critical_alerts === 1 ? '' : 's'} · ${stats.warning_alerts || 0} warning${stats.warning_alerts === 1 ? '' : 's'} · ${stats.overnight_completions || 0} overnight completion${stats.overnight_completions === 1 ? '' : 's'}</p>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await sendMail({
      to: therapist.email,
      subject: `Miwa morning brief — ${dayStr}`,
      html,
      text: narrative || `Your day: ${stats.session_count} sessions scheduled. Log in at ${appLink}`,
    });
    return { sent: true };
  } catch (err) {
    console.warn('[morning-briefing] email send failed:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Generate & store today's briefing for one therapist. Idempotent — returns
 * existing briefing if one already exists for today.
 */
async function generateDailyBriefing(therapistId, { sendEmail = false, force = false } = {}) {
  try {
    const db = getDb();

    const therapist = db.get(
      `SELECT id, first_name, full_name, email, preferred_timezone
       FROM therapists WHERE id = ?`,
      therapistId
    );
    if (!therapist) return null;
    const tz = therapist.preferred_timezone || 'America/Los_Angeles';
    const todayLocal = getLocalDateString(tz);

    // Skip if already generated today (by local date), unless forced
    if (!force) {
      const existing = db.get(
        `SELECT id FROM daily_briefings
          WHERE therapist_id = ? AND local_date = ?`,
        therapistId, todayLocal
      );
      if (existing) return { id: existing.id, skipped: true };
    }

    const computed = computeTodaysBriefing(db, therapistId);
    if (!computed) return null;

    // ── Caseload status synthesis (fast, no AI) ──
    let caseload = [];
    try {
      caseload = computeCaseloadStatus(db, therapistId);
    } catch (err) {
      console.warn('[daily-briefing] caseload status failed:', err.message);
    }

    // ── Azure OpenAI narrative (best-effort) ──
    const dayStr = new Date().toLocaleDateString('en-US', {
      timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
    });
    const firstName = therapist.first_name || therapist.full_name?.split(' ')[0] || 'there';

    // Re-fetch today's appointments + overnight for narrative context.
    // computeTodaysBriefing has already queried these but doesn't return them
    // in structured form. Pull fresh — cheap with indexes.
    const todayAppts = (() => {
      try {
        return db.all(
          `SELECT a.id, a.scheduled_start, a.appointment_type,
                  p.id AS patient_id, p.client_id, p.display_name
           FROM appointments a
           LEFT JOIN patients p ON p.id = a.patient_id
           WHERE a.therapist_id = ? AND DATE(a.scheduled_start) = ?
             AND a.status != 'cancelled'
           ORDER BY a.scheduled_start ASC`,
          therapistId, todayLocal
        );
      } catch { return []; }
    })();

    const overnight = (() => {
      try {
        return db.all(
          `SELECT a.template_type, a.total_score, a.severity_level,
                  p.client_id, p.display_name
           FROM assessments a JOIN patients p ON p.id = a.patient_id
           WHERE a.therapist_id = ? AND a.administered_at > datetime('now', '-14 hours')
           ORDER BY a.administered_at DESC LIMIT 8`,
          therapistId
        );
      } catch { return []; }
    })();

    const narrative = await generateMorningNarrative({
      firstName, dayStr,
      todayAppts, caseload, overnight,
      unsignedCount: computed.stats?.unsigned_count || 0,
      therapistId,
    });

    // ── Insert or update ──
    let briefingId;
    if (force) {
      // Upsert
      const existing = db.get(
        `SELECT id FROM daily_briefings WHERE therapist_id = ? AND local_date = ?`,
        therapistId, todayLocal
      );
      if (existing) {
        db.run(
          `UPDATE daily_briefings
           SET markdown = ?, stats_json = ?, narrative = ?, caseload_json = ?
           WHERE id = ?`,
          computed.markdown, JSON.stringify(computed.stats),
          narrative, JSON.stringify(caseload),
          existing.id
        );
        briefingId = existing.id;
      } else {
        const insert = db.insert(
          `INSERT INTO daily_briefings
             (therapist_id, local_date, markdown, stats_json, narrative, caseload_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          therapistId, computed.date, computed.markdown,
          JSON.stringify(computed.stats),
          narrative, JSON.stringify(caseload)
        );
        briefingId = insert.lastInsertRowid;
      }
    } else {
      const insert = db.insert(
        `INSERT INTO daily_briefings
           (therapist_id, local_date, markdown, stats_json, narrative, caseload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        therapistId, computed.date, computed.markdown,
        JSON.stringify(computed.stats),
        narrative, JSON.stringify(caseload)
      );
      briefingId = insert.lastInsertRowid;
    }

    // ── Email (best-effort) ──
    let emailResult = null;
    if (sendEmail && therapist.email) {
      emailResult = await sendMorningEmail({
        therapist, narrative, stats: computed.stats,
        caseload, dayStr, todayAppts,
      });
      if (emailResult?.sent) {
        try {
          db.run(
            `UPDATE daily_briefings SET emailed_at = ? WHERE id = ?`,
            new Date().toISOString(), briefingId
          );
        } catch {}
      }
    }

    try { persist(); } catch {}

    return {
      id: briefingId,
      skipped: false,
      stats: computed.stats,
      narrative_ok: !!narrative,
      emailed: !!emailResult?.sent,
    };
  } catch (err) {
    console.error('[daily-briefing] Error for therapist', therapistId, err.message);
    return null;
  }
}

/**
 * Run for all active therapists whose local time is 6am.
 * Called from the scheduler every hour. Emails the brief so the therapist's
 * 7am phone-check shows Miwa at the top of their inbox.
 */
async function runMorningBriefings() {
  try {
    const db = getDb();
    const therapists = db.all(
      `SELECT id, preferred_timezone FROM therapists
        WHERE account_status = 'active'`
    );
    let count = 0;
    for (const t of therapists) {
      try {
        const tz = t.preferred_timezone || 'America/Los_Angeles';
        const localHour = parseInt(
          new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }),
          10
        );
        if (localHour !== 6) continue;
        const result = await generateDailyBriefing(t.id, { sendEmail: true });
        if (result && !result.skipped) count++;
      } catch {}
    }
    if (count > 0) console.log(`[daily-briefing] Generated ${count} morning briefing(s)`);
    return count;
  } catch (err) {
    console.error('[daily-briefing] Run error:', err.message);
    return 0;
  }
}

module.exports = {
  generateDailyBriefing,
  runMorningBriefings,
  computeTodaysBriefing,
  computeCaseloadStatus,
  generateMorningNarrative,
};
