const { MODELS, callAI } = require('../../../lib/aiExecutor');
const { escapeJsonForPrompt, safeJsonParse } = require('./helpers');

async function planRequest(message, context, therapistId = null, therapistTz = 'America/Los_Angeles') {
  const prompt = `You are Miwa, an internal clinical operations agent for a therapist-facing app.

Classify the clinician request into exactly one of these intents:
- create_client
- schedule_appointment
- schedule_assessment_sms
- batch_send_assessments
- generate_report
- get_client_assessments
- get_client_sessions
- get_caseload_summary
- submit_feedback
- clarify
- general

Return JSON only with this shape:
{
  "intent": "create_client|schedule_appointment|schedule_assessment_sms|batch_send_assessments|generate_report|get_client_assessments|get_client_sessions|get_caseload_summary|submit_feedback|clarify|general",
  "reply": string,
  "needsApproval": boolean,
  "appointment": {
    "patientCode": string,
    "appointmentType": string,
    "scheduledStart": string,
    "scheduledEnd": string,
    "durationMinutes": number,
    "location": string,
    "notes": string
  },
  "assessmentSms": {
    "patientCode": string,
    "assessmentType": string,
    "sendAt": string,
    "customMessage": string,
    "spreadOption": "now|spread"
  },
  "clientLookup": {
    "patientCode": string,
    "filter": "risk_flagged|overdue_assessment|improving|deteriorating|all"
  },
  "report": {
    "patientCode": string,
    "viewer": string,
    "purpose": string,
    "focus": string,
    "timeframe": string,
    "includeCharts": boolean,
    "title": string
  },
  "feedback": {
    "message": string,
    "category": "bug|feature|general"
  },
  "questions": [string]
}

Rules:
- If the clinician says something isn't working, reports a bug, gives a complaint, suggests a feature, or says "send feedback to support", use submit_feedback. Extract the feedback text into feedback.message and pick the best category: bug (something broken), feature (something they want), or general (anything else).
- If the clinician mentions a NEW client who doesn't exist in the system yet, use create_client. The client doesn't need to already be in the system. "New client", "new intake", "new patient", or any name that hasn't been seen before in context = create_client. If they also want to schedule an appointment, create_client first then schedule_appointment.
- IMPORTANT: For couples, families, or groups — create EXACTLY ONE client profile with the appropriate client_type ("couple", "family", or "group"). Do NOT create separate profiles for each member of a couple/family. One profile per case unit, not per person.
- If the clinician asks to schedule an appointment and the client is identifiable, fill the appointment object.
- Recognize client codes written like "Client 001", "client 001", "Patient 014", or a bare code such as "001" when it clearly refers to a chart. Preserve the code in patientCode.
- NEVER ask for session type, duration, or location/modality — always infer from the patient context:
  * appointmentType: use SCHEDULING DEFAULTS.appointment_type from the patient context if shown; otherwise infer from client_type (couple→"couple session", family→"family session", group→"group session", else "individual session").
  * durationMinutes: use SCHEDULING DEFAULTS.duration_minutes (typically 50). Never ask.
  * location: use SCHEDULING DEFAULTS.location if set. If not set, omit it entirely — do NOT ask.
- The ONLY thing you should clarify for scheduling is the date/time if it was not provided.
- If the clinician asks to send an assessment, questionnaire, or screener to a client, create a secure assessment link. SMS may only be sent in closed beta for clients with recorded SMS consent; do not claim SMS is HIPAA-covered while the Twilio BAA is pending.
  Fill assessmentSms.assessmentType with the type name (PHQ-9, GAD-7, PCL-5, etc.).
  Fill assessmentSms.sendAt with an ISO datetime string — if the clinician says "the day before" an appointment, calculate it; if they say "now" use current time.
  If no assessment type is specified, default to "PHQ-9".
  Fill spreadOption with "spread" if they ask to stagger/spread the sends over time, "now" otherwise.
- If the clinician asks to send assessments to multiple clients at once (batch send), use batch_send_assessments and fill assessmentSms.
- If the clinician asks to see or review a specific client's assessments, use get_client_assessments with patientCode.
- If the clinician asks what was discussed in sessions, use get_client_sessions with patientCode.
- If the clinician asks about their caseload, who is struggling, who is improving, use get_caseload_summary with optional filter.
- If the clinician asks for a session review, progress review, chart summary, exportable report, court letter, insurance review, or supervision review, treat it as generate_report.
- If key details are missing, set intent to clarify ONLY for things that cannot be inferred. Put each missing item in questions.
- If the request is not a tool task, set intent to general and provide a short reply only.
- scheduledStart and scheduledEnd should be natural ISO-like strings when possible.
- Do not invent facts; use only the provided context.
- Clinician's local date/time: ${new Date().toLocaleDateString('en-US', { timeZone: therapistTz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { timeZone: therapistTz, hour: 'numeric', minute: '2-digit', hour12: true })} (${therapistTz})
- Today's date for scheduling: ${new Date().toLocaleString('sv-SE', { timeZone: therapistTz }).split(' ')[0]}
- CRITICAL: When the clinician says "today", use the date above. NEVER use UTC date.

Current patient context (if any):
${escapeJsonForPrompt(context.patientSummary || '')}

Clinician message:
${message}`;

  const content = await callAI(
    MODELS.AZURE_MAIN,
    'Return valid JSON only.',
    prompt,
    900,
    { therapistId, kind: 'plan_request' }
  );
  let parsed = {};
  try {
    parsed = safeJsonParse(content);
  } catch {
    parsed = {};
  }
  parsed.intent = parsed.intent || 'general';
  parsed.reply = parsed.reply || '';
  parsed.needsApproval = !!parsed.needsApproval;
  parsed.questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 1) : [];
  parsed.appointment = parsed.appointment || {};
  parsed.report = parsed.report || {};
  return parsed;
}

module.exports = { planRequest };
