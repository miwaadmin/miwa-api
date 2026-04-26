/**
 * Google Meet service for Miwa — telehealth video links.
 *
 * Coverage model:
 *   - Meet spaces are created via the Meet API v2 by Miwa's service account
 *     impersonating a Workspace user inside our org (admin@miwa.care, or
 *     whoever GMAIL_IMPERSONATE_USER points at).
 *   - That Workspace org is covered by Miwa's signed Google BAA, which means
 *     calls hosted by it are HIPAA-covered regardless of whether the
 *     participants (therapist, client) are external to the org.
 *
 * Why Meet API v2 instead of just Calendar?
 *   - Calendar's conferenceData.createRequest uses the org's default Meet
 *     policy, which on most Workspace tenants means external guests get the
 *     "Please wait until a meeting host brings you into the call" knock
 *     screen — and the host (the service account identity) never actually
 *     joins, so nobody can let anybody in. Therapist + client both stuck.
 *   - Meet API v2's spaces.create supports config.accessType='OPEN', which
 *     lets ANYONE with the link join directly, no knock, no host required.
 *     This matches how Doxy / Zoom personal-meeting links work.
 *   - Trade-off: link possession = entry. Mitigated by:
 *       - Random opaque link IDs.
 *       - Delivery only via BAA-covered channels (Gmail API → therapist;
 *         Twilio SMS → client, and only after consent attestation).
 *       - One Meet space per appointment, regenerable on demand if leaked.
 *
 * GCP setup required (one-time, in Workspace admin console — Domain-wide
 * Delegation entry for the service account):
 *   1. Enable the Meet API in the GCP project (console.cloud.google.com →
 *      APIs & Services → Library → search "Google Meet API" → Enable).
 *   2. Add scope `https://www.googleapis.com/auth/meetings.space.created`
 *      to the service account's domain-wide delegation entry, ALONGSIDE
 *      the existing gmail.send and calendar.events scopes.
 *   3. Workspace Meet policy must permit external participants (default = on).
 *
 * Env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   service account credentials JSON
 *   GMAIL_IMPERSONATE_USER        user the service account impersonates
 *   MEET_CALENDAR_ID              optional — calendar to attach Meet events to
 */
const { google } = require('googleapis');
const crypto = require('crypto');

const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GMAIL_IMPERSONATE_USER = process.env.GMAIL_IMPERSONATE_USER || '';
const MEET_CALENDAR_ID = process.env.MEET_CALENDAR_ID || 'primary';

// Cached JWT clients — separate instances per scope set because Google's
// JWT helper caches the access token internally and a single client can
// only request one access token at a time.
let _calendarJwt = null;
let _meetJwt = null;

function buildJwt(scopes) {
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
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
    subject: GMAIL_IMPERSONATE_USER,
  });
}

function getCalendarAuth() {
  if (!_calendarJwt) _calendarJwt = buildJwt(['https://www.googleapis.com/auth/calendar.events']);
  return _calendarJwt;
}

function getMeetAuth() {
  if (!_meetJwt) _meetJwt = buildJwt(['https://www.googleapis.com/auth/meetings.space.created']);
  return _meetJwt;
}

function isConfigured() {
  return !!(GOOGLE_SERVICE_ACCOUNT_JSON && GMAIL_IMPERSONATE_USER);
}

/**
 * Create a Meet space with OPEN access (no knock screen) via Meet API v2.
 * Returns the meeting URL + the space's `name` (used by deleteMeetSpace
 * for cleanup) + the conferenceId (used to attach to a Calendar event).
 */
async function createOpenMeetSpace() {
  const auth = getMeetAuth();
  if (!auth) throw new Error('Meet API not configured');
  const meet = google.meet({ version: 'v2', auth });
  const res = await meet.spaces.create({
    requestBody: {
      config: {
        // OPEN = anyone with the link joins directly. No knock, no host wait.
        // The link itself is the access control.
        accessType: 'OPEN',
        entryPointAccess: 'ALL',
      },
    },
  });
  return {
    name: res.data.name,                           // "spaces/abc123" — for delete
    meetUrl: res.data.meetingUri,                  // "https://meet.google.com/xxx-yyyy-zzz"
    meetingCode: res.data.meetingCode,             // e.g. "xxx-yyyy-zzz"
  };
}

/**
 * End the active conference on a Meet space (best we can do — Meet API v2
 * doesn't expose a "delete space" call). Used when an appointment is
 * cancelled or its Meet link regenerated.
 */
async function endMeetSpace(spaceName) {
  if (!spaceName) return;
  const auth = getMeetAuth();
  if (!auth) return;
  const meet = google.meet({ version: 'v2', auth });
  try {
    await meet.spaces.endActiveConference({ name: spaceName });
  } catch (err) {
    // 404 / 400 (no active conference) are fine — the space is already idle.
    const code = err.code || err.response?.status;
    if (code !== 404 && code !== 400) {
      console.error('[googleMeet] endActiveConference error:', err.message);
    }
  }
}

/**
 * Create a Meet space (OPEN access) and attach it to a Calendar event so
 * admin@miwa.care has a visible reminder. The Meet API gives us the link
 * and access control; the Calendar event is just bookkeeping.
 *
 * Returns { meetUrl, eventId, spaceName, calendarId } — we persist meetUrl
 * + eventId + spaceName on the appointment row so we can clean up later.
 *
 * Backward compatible: callers (server/routes/agent.js) still get back
 * { meetUrl, eventId } and don't need to change.
 */
async function createMeetEvent({ title, startISO, endISO, timezone, attendeeEmails, description }) {
  if (!isConfigured()) throw new Error('Google Meet not configured (set GOOGLE_SERVICE_ACCOUNT_JSON + GMAIL_IMPERSONATE_USER)');

  // 1) Create the Meet space with OPEN access via Meet API v2. This is the
  //    line that fixes the "ask to join" knock screen — Calendar's built-in
  //    conferenceData.createRequest does NOT let us set accessType.
  const space = await createOpenMeetSpace();

  // 2) Best-effort: attach the link to a Calendar event for admin visibility.
  //    If this fails (e.g., calendar API scope missing) we still return the
  //    Meet URL — the appointment workflow doesn't require the calendar row.
  let eventId = null;
  let calendarId = null;
  try {
    const auth = getCalendarAuth();
    if (auth) {
      const calendar = google.calendar({ version: 'v3', auth });
      const event = {
        summary: title || 'Therapy Session',
        description: [
          description || 'Telehealth session via Miwa.',
          ``,
          `Join: ${space.meetUrl}`,
          `(Direct join — no knock-to-enter required.)`,
        ].join('\n'),
        start: { dateTime: startISO, timeZone: timezone || undefined },
        end:   { dateTime: endISO,   timeZone: timezone || undefined },
        // We deliberately do NOT use conferenceData.createRequest here —
        // that would create a SECOND, knock-gated Meet on the same event.
        // Instead we link to our OPEN Meet space in the description.
        location: space.meetUrl,
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        guestsCanSeeOtherGuests: false,
        visibility: 'private',
        reminders: { useDefault: false, overrides: [] },
      };
      if (Array.isArray(attendeeEmails) && attendeeEmails.length) {
        event.attendees = attendeeEmails
          .filter(Boolean)
          .map(email => ({ email, responseStatus: 'needsAction' }));
      }
      const res = await calendar.events.insert({
        calendarId: MEET_CALENDAR_ID,
        sendUpdates: attendeeEmails && attendeeEmails.length ? 'all' : 'none',
        requestBody: event,
      });
      eventId = res.data.id;
      calendarId = MEET_CALENDAR_ID;
    }
  } catch (err) {
    console.warn('[googleMeet] Calendar attach failed (non-fatal):', err.message);
  }

  return {
    meetUrl: space.meetUrl,
    eventId,                  // may be null if calendar attach failed
    calendarId,
    spaceName: space.name,    // for endMeetSpace() on regenerate/cancel
    meetingCode: space.meetingCode,
  };
}

/**
 * Tear down the resources we created for an appointment. Called when an
 * appointment is cancelled or its Meet link regenerated. Accepts either:
 *   - eventId  (legacy callers — best-effort delete the calendar event)
 *   - spaceName (new path — also ends the Meet conference)
 */
async function deleteMeetEvent(eventId, calendarId, spaceName) {
  // End the Meet space first so anyone in the room gets kicked.
  if (spaceName) {
    await endMeetSpace(spaceName);
  }
  // Then drop the Calendar event so it doesn't linger as a ghost.
  if (eventId) {
    const auth = getCalendarAuth();
    if (!auth) return;
    const calendar = google.calendar({ version: 'v3', auth });
    try {
      await calendar.events.delete({
        calendarId: calendarId || MEET_CALENDAR_ID,
        eventId,
        sendUpdates: 'none',
      });
    } catch (err) {
      const code = err.code || err.response?.status;
      if (code !== 404 && code !== 410) {
        console.error('[googleMeet] delete event error:', err.message);
      }
    }
  }
}

module.exports = { createMeetEvent, deleteMeetEvent, endMeetSpace, isConfigured };
