const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { getSupervisorSystemPrompt, getAnalysisSystemPrompt, getTreatmentPlanSystemPrompt } = require('../prompts');
const { normalizeAssistantProfile } = require('../lib/assistant');
const { scrubText, scrubObject } = require('../lib/scrubber');
const { MODELS, callAI, streamAI, streamAnalyzeNotes } = require('../lib/aiExecutor');
const { logCostEvent, assertBudgetOk } = require('../services/costTracker');
const { extractIntakeIdentity } = require('../services/intakeIdentityExtractor');
const {
  formatRuntimeForPrompt,
  getRuntimeSnapshot,
  recordConversationSignal,
} = require('../services/assistantRuntime');
const {
  generateAIResponse,
  generateAIResponseWithUsage,
  transcribeAudioBuffer,
  getAIConfigStatus,
  isAIServiceError,
  safeAIErrorResponse,
} = require('../services/aiClient');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Authenticated safe diagnostic. Exposes deployment wiring only, never keys or raw endpoints.
router.get('/audio-config', (_req, res) => {
  res.json(getAIConfigStatus());
});

function sendRouteError(res, err) {
  return res.status(isAIServiceError(err) ? 502 : 500).json(safeAIErrorResponse(err));
}

function sendAudioImportError(res, err) {
  if (isAIServiceError(err)) {
    const response = safeAIErrorResponse(err);
    return res.status(502).json({
      ...response,
      message: 'The audio service is temporarily unavailable. Please try again in a moment.',
    });
  }

  return res.status(400).json({ error: 'The audio file could not be processed. Please try again.' });
}

function uploadImportErrorMessage(err) {
  const message = String(err?.message || '');
  const allowedMessages = [
    'No file uploaded',
    'Unsupported file type. Please upload PDF, DOCX, or TXT intake forms.',
    'Unable to extract text or filled form values from this PDF. Try exporting/printing the filled form to a new PDF and upload that version.',
  ];

  return allowedMessages.includes(message)
    ? message
    : 'The uploaded file could not be processed. Please try a different file.';
}

// Use the owner's API key from environment — all users share it, covered by subscription
// Check if this therapist can use the workspace (subscription or trial)
async function checkWorkspaceAccess(therapistId) {
  const db = getAsyncDb();
  const row = await db.get(
    'SELECT subscription_status, workspace_uses, trial_limit FROM therapists WHERE id = ?',
    therapistId
  );
  if (!row) return { allowed: false, reason: 'Account not found' };
  if (row.subscription_status === 'active') return { allowed: true };
  // Trial mode
  const limit = row.trial_limit || 10;
  if (row.workspace_uses < limit) {
    return { allowed: true, trialRemaining: limit - row.workspace_uses };
  }
  return {
    allowed: false,
    reason: 'trial_ended',
    workspace_uses: row.workspace_uses,
    trial_limit: limit,
  };
}

async function incrementWorkspaceUse(therapistId) {
  const db = getAsyncDb();
  await db.run('UPDATE therapists SET workspace_uses = workspace_uses + 1 WHERE id = ?', therapistId);
}

async function loadAssistantProfile(therapistId) {
  const db = getAsyncDb();
  const row = await db.get(
    'SELECT assistant_action_mode, assistant_tone, assistant_orientation, assistant_verbosity, assistant_memory, assistant_permissions_json FROM therapists WHERE id = ?',
    therapistId
  );
  return normalizeAssistantProfile(row || {});
}

function assistantAllows(profile, scope) {
  return Array.isArray(profile?.permissions) && profile.permissions.includes(scope);
}

function cleanJson(text) {
  return (text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function normalizeFormFieldValue(field) {
  try {
    const name = field.getName?.() || '';
    const type = field.constructor?.name || '';

    if (type === 'PDFTextField' || type === 'PDFDropdown' || type === 'PDFOptionList') {
      const value = field.getText?.() || '';
      return value ? `${name}: ${value}` : '';
    }

    if (type === 'PDFCheckBox') {
      const checked = field.isChecked?.() ? 'Yes' : 'No';
      return `${name}: ${checked}`;
    }

    if (type === 'PDFRadioGroup') {
      const selected = field.getSelected?.() || '';
      return selected ? `${name}: ${selected}` : '';
    }
  } catch {}
  return '';
}

async function extractPdfFormFieldText(buffer) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const values = fields
      .map(normalizeFormFieldValue)
      .filter(Boolean);

    return values.length ? values.join('\n') : '';
  } catch {
    return '';
  }
}

async function buildIntakeDraftFromText(extractedText, originalName = 'uploaded source') {
  const safeSourceName = scrubText(originalName || 'uploaded source');
  const prompt = `You are Miwa, a privacy-conscious clinical intake assistant.

Read the uploaded intake/assessment document and produce:
1. a section-based intake draft a therapist can review
2. a mapped field object that can populate intake form controls

Only use information explicitly supported by the text. If a section or field is missing, return an empty string.

Return valid JSON only with exactly this shape:
{
  "draftSections": {
    "clientOverview": string,
    "presentingConcerns": string,
    "historyContext": string,
    "riskAndSafety": string,
    "clinicalObservations": string,
    "strengthsAndGoals": string
  },
  "fields": {
    "caseType": string,
    "presentingProblem": string,
    "ageRange": string,
    "referralSource": string,
    "livingSituation": string,
    "symptomOnsetDurationSeverity": string,
    "precipitatingMaintainingFactors": string,
    "culturalIdentityContext": string,
    "educationEmploymentContext": string,
    "legalMandatedContext": string,
    "safetyPlanDetails": string,
    "mentalHealthHistory": string,
    "medicalHistory": string,
    "medications": string,
    "substanceUse": string,
    "riskScreening": string,
    "familySocialHistory": string,
    "traumaHistory": string,
    "mentalStatusObservations": string,
    "strengthsProtectiveFactors": string,
    "functionalImpairments": string,
    "treatmentGoal": string,
    "firstName": string,
    "lastName": string,
    "displayName": string,
    "phone": string,
    "email": string,
    "gender": string
  }
}

Identity fields are allowed only when explicitly present in the provided document text. Return empty strings for identity fields if missing or redacted.

For caseType, use only one of:
- individual
- couple
- family
- group

If the document does not clearly support one of those, return an empty string.

Section guidance:
- clientOverview: case type, age range, referral source, living situation, high-level clinical frame
- presentingConcerns: why the client is seeking treatment now, core symptoms/problems, onset/duration/severity, precipitating and maintaining factors, functional distress
- historyContext: mental health history, medical history, medications, substance use, family/social context, trauma history, cultural/identity context, school/work/role functioning
- riskAndSafety: suicide risk, self-harm, violence risk, abuse, mandated reporting/legal context, safety planning, protective notes
- clinicalObservations: MSE, affect, thought process, behavior, insight/judgment, clinician observations
- strengthsAndGoals: strengths, supports, motivation, protective factors, functional goals, initial treatment goals

Source name: ${safeSourceName}
Document text:
"""
${extractedText.substring(0, 24000)}
"""`;

  const content = (await generateAIResponse([
    { role: 'system', content: 'You convert behavioral health intake forms into sectioned intake drafts and structured JSON. Return JSON only.' },
    { role: 'user', content: prompt },
  ], { maxTokens: 2200, jsonMode: true }) || '{}').replace(/[\u2014\u2013]/g, ' ');
  const parsed = JSON.parse(cleanJson(content));
  const fields = parsed.fields || {};
  const draftSections = parsed.draftSections || {};

  return {
    draftSections: {
      clientOverview: draftSections.clientOverview || '',
      presentingConcerns: draftSections.presentingConcerns || '',
      historyContext: draftSections.historyContext || '',
      riskAndSafety: draftSections.riskAndSafety || '',
      clinicalObservations: draftSections.clinicalObservations || '',
      strengthsAndGoals: draftSections.strengthsAndGoals || '',
    },
    fields: {
      caseType: fields.caseType || '',
      presentingProblem: fields.presentingProblem || '',
      ageRange: fields.ageRange || '',
      referralSource: fields.referralSource || '',
      livingSituation: fields.livingSituation || '',
      symptomOnsetDurationSeverity: fields.symptomOnsetDurationSeverity || '',
      precipitatingMaintainingFactors: fields.precipitatingMaintainingFactors || '',
      culturalIdentityContext: fields.culturalIdentityContext || '',
      educationEmploymentContext: fields.educationEmploymentContext || '',
      legalMandatedContext: fields.legalMandatedContext || '',
      safetyPlanDetails: fields.safetyPlanDetails || '',
      mentalHealthHistory: fields.mentalHealthHistory || '',
      medicalHistory: fields.medicalHistory || '',
      medications: fields.medications || '',
      substanceUse: fields.substanceUse || '',
      riskScreening: fields.riskScreening || '',
      familySocialHistory: fields.familySocialHistory || '',
      traumaHistory: fields.traumaHistory || '',
      mentalStatusObservations: fields.mentalStatusObservations || '',
      strengthsProtectiveFactors: fields.strengthsProtectiveFactors || '',
      functionalImpairments: fields.functionalImpairments || '',
      treatmentGoal: fields.treatmentGoal || '',
      firstName: fields.firstName || '',
      lastName: fields.lastName || '',
      displayName: fields.displayName || '',
      phone: fields.phone || '',
      email: fields.email || '',
      gender: fields.gender || '',
    },
  };
}

function mergeLocalIdentityFields(draft, identity) {
  const mergedFields = { ...(draft?.fields || {}) };
  const localIdentity = identity || {};

  ['firstName', 'lastName', 'displayName', 'phone', 'email', 'gender'].forEach((key) => {
    if (localIdentity[key]) mergedFields[key] = localIdentity[key];
  });

  return {
    ...draft,
    fields: mergedFields,
  };
}

async function transcribeAudioUpload(file) {
  const transcription = await transcribeAudioBuffer(
    file.buffer,
    file.originalname || 'recording.webm',
    file.mimetype || 'application/octet-stream',
  );
  return typeof transcription === 'string' ? transcription : (transcription.text || '');
}

async function extractTextFromUpload(file) {
  if (!file) throw new Error('No file uploaded');
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ext === '.txt') {
    return file.buffer.toString('utf8');
  }

  if (ext === '.pdf') {
    const formFieldText = await extractPdfFormFieldText(file.buffer);

    let parsedPageText = '';
    try {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: file.buffer });
      const result = await parser.getText();
      await parser.destroy();
      parsedPageText = result.text || '';
    } catch {}

    const combined = [
      formFieldText ? `PDF FORM FIELD VALUES\n${formFieldText}` : '',
      parsedPageText ? `PDF PAGE TEXT\n${parsedPageText}` : '',
    ].filter(Boolean).join('\n\n');

    if (combined.trim()) return combined;
    throw new Error('Unable to extract text or filled form values from this PDF. Try exporting/printing the filled form to a new PDF and upload that version.');
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT intake forms.');
}

// POST /api/ai/intake-import
router.post('/intake-import', upload.single('file'), async (req, res) => {
  try {
    const rawText     = await extractTextFromUpload(req.file);
    const identity = extractIntakeIdentity(rawText, req.file.originalname);
    const extractedText = rawText.trim();
    // This importer is Azure-only and covered by the central AI client. Do not log this payload.
    const aiDraft = await buildIntakeDraftFromText(extractedText, req.file.originalname);
    const draft = mergeLocalIdentityFields(aiDraft, identity);

    res.json({
      fileName: req.file.originalname,
      extractedText,
      ...draft,
    });
  } catch (err) {
    if (isAIServiceError(err)) return sendRouteError(res, err);
    res.status(400).json({ error: uploadImportErrorMessage(err) });
  }
});

// POST /api/ai/audio-import
router.post('/audio-import', upload.single('file'), async (req, res) => {
  // Extend timeout for long recordings. Some app hosts default to 300s, but we set
  // it explicitly so a slow Whisper call doesn't silently drop the connection.
  req.socket.setTimeout(0);
  res.setTimeout(0);
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    const mode = req.body?.mode === 'intake' ? 'intake' : 'ongoing';
    const rawTranscript = await transcribeAudioUpload(req.file);

    if (!rawTranscript.trim()) {
      return res.status(400).json({ error: 'The audio could not be transcribed clearly. Try a cleaner recording or a different file.' });
    }

    const identity = extractIntakeIdentity(rawTranscript, req.file.originalname);
    // This importer is Azure-only and covered by the central AI client. Do not log this payload.
    const transcript = rawTranscript.trim();

    if (mode === 'intake') {
      const aiDraft = await buildIntakeDraftFromText(transcript, req.file.originalname);
      const draft = mergeLocalIdentityFields(aiDraft, identity);
      return res.json({
        fileName: req.file.originalname,
        transcript,
        ...draft,
      });
    }

    return res.json({
      fileName: req.file.originalname,
      transcript,
    });
  } catch (err) {
    sendAudioImportError(res, err);
  }
});

// POST /api/ai/convert-note — convert an existing note to a different format
router.post('/convert-note', async (req, res) => {
  try {
    const { sessionId, targetFormat, verbosity = 'standard' } = req.body;
    if (!sessionId || !targetFormat) return res.status(400).json({ error: 'sessionId and targetFormat required' });
    if (!['SOAP', 'BIRP', 'DAP', 'GIRP', 'DMH_SIR'].includes(targetFormat)) return res.status(400).json({ error: 'Invalid format. Use SOAP, BIRP, DAP, GIRP, or DMH_SIR.' });

    const db = getAsyncDb();
    const session = await db.get('SELECT * FROM sessions WHERE id = ? AND therapist_id = ?', sessionId, req.therapist.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Gather all existing note content
    const noteContent = [
      session.subjective ? `Subjective/Data/Behavior: ${session.subjective}` : '',
      session.objective ? `Objective/Intervention: ${session.objective}` : '',
      session.assessment ? `Assessment/Response: ${session.assessment}` : '',
      session.plan ? `Plan: ${session.plan}` : '',
      session.full_note ? `Full note: ${session.full_note}` : '',
    ].filter(Boolean).join('\n\n');

    if (!noteContent.trim()) return res.status(400).json({ error: 'Session has no note content to convert.' });

    const formatInstructions = {
      SOAP: 'S (Subjective): Client self-report, concerns, symptoms in their words.\nO (Objective): Clinician observations — affect, mood, speech, thought process, engagement, insight, judgment, behavioral observations.\nA (Assessment): Clinical formulation, diagnostic impressions, progress toward goals, risk assessment.\nP (Plan): Next steps, interventions, homework, referrals, safety planning.',
      BIRP: 'B (Behavior): Observable client behaviors, presentation, affect, mood, symptoms manifested.\nI (Intervention): Therapeutic interventions applied — specific techniques, modalities, psychoeducation.\nR (Response): Client response to interventions — engagement, insight, emotional reactions, progress.\nP (Plan): Future treatment direction, homework, session frequency, referrals.',
      DAP: 'D (Data): Combined objective and subjective data — what client reported AND clinician observed. Include behavioral observations alongside self-report.\nA (Assessment): Clinical interpretation, progress toward goals, diagnostic considerations, risk.\nP (Plan): Treatment plan updates, next session focus, homework, referrals.',
      GIRP: 'G (Goals): Treatment goals addressed this session and relevance to treatment plan.\nI (Intervention): Specific therapeutic interventions and techniques applied.\nR (Response): Client observable response, behavioral changes, insight gained, progress.\nP (Plan): Continued treatment direction, next session goals, homework.',
      DMH_SIR: 'S (Situation/Presentation): Client presentation, symptoms, stressors, session focus, and why care was clinically necessary today.\nI (Interventions Used): Specific clinician interventions, modalities, psychoeducation, skills practice, safety planning, collateral/linkage, and clinical rationale.\nR (Client Response): Client engagement, insight, affective/behavioral response, resistance, skill use, and progress/barriers.\nRisk/Safety Update: SI/HI/self-harm/substance/DV/abuse updates, protective factors, safety planning, and crisis resources if relevant.\nFunctioning/Medical Necessity: Functional impairment and level-of-care rationale across home, work/school, relationships, ADLs, and symptom impact.\nPlan/Homework/Next Steps: Homework, next focus, referrals, assessments, coordination, frequency, and follow-up.',
    };

    const verbosityInstructions = {
      concise: 'VERBOSITY: CONCISE — Use clinical shorthand. Each section 1-2 sentences max. Abbreviations encouraged (Pt, Dx, Tx, SI, HI, c/o, w/, r/t). No filler words. Write in complete sentences and paragraph form, not bullets.',
      standard: 'VERBOSITY: STANDARD — Professional clinical language. Each section 2-4 sentences. Clear and complete but not verbose.',
      detailed: 'VERBOSITY: DETAILED — Thorough documentation. Each section 4-6 sentences. Include clinical reasoning, specific quotes, and nuanced observations. Suitable for court or insurance review.',
    };

    const prompt = `Convert this existing session note into ${targetFormat} format. Use the content below — do not invent new clinical information. Reorganize and rewrite to fit the target format properly. ALWAYS write in complete sentences and paragraph form — never use bullet points or numbered lists.

${verbosityInstructions[verbosity] || verbosityInstructions.standard}

TARGET FORMAT (${targetFormat}):
${formatInstructions[targetFormat]}

EXISTING NOTE CONTENT:
${noteContent}

Return ONLY valid JSON:
${targetFormat === 'SOAP' ? '{"subjective": "...", "objective": "...", "assessment": "...", "plan": "..."}' :
  targetFormat === 'BIRP' ? '{"behavior": "...", "intervention": "...", "response": "...", "plan": "..."}' :
  targetFormat === 'DAP' ? '{"data": "...", "assessment": "...", "plan": "..."}' :
  targetFormat === 'DMH_SIR' ? '{"situation": "...", "interventions": "...", "response": "...", "risk_safety": "...", "functioning_medical_necessity": "...", "plan_homework": "..."}' :
  '{"goals": "...", "intervention": "...", "response": "...", "plan": "..."}'}`;

    const { getStyleHintsForPrompt } = require('../services/style-adaptation');
    const convertStyleHints = await getStyleHintsForPrompt(req.therapist.id);
    const raw = await callAI(
      MODELS.AZURE_MAIN,
      'You are a clinical documentation assistant. Convert notes between formats accurately. Do not invent clinical facts.' + convertStyleHints,
      prompt,
      2000,
      { therapistId: req.therapist.id, kind: 'convert_note' }
    );

    let parsed;
    try {
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      if (!jsonStr.startsWith('{')) {
        const s = jsonStr.indexOf('{'), e = jsonStr.lastIndexOf('}');
        if (s !== -1 && e > s) jsonStr = jsonStr.slice(s, e + 1);
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'Failed to parse converted note. Try again.' });
    }

    // Map format-specific fields to the standard SOAP-like storage
    let converted;
    if (targetFormat === 'SOAP') {
      converted = { subjective: parsed.subjective || '', objective: parsed.objective || '', assessment: parsed.assessment || '', plan: parsed.plan || '' };
    } else if (targetFormat === 'BIRP') {
      converted = { subjective: parsed.behavior || '', objective: parsed.intervention || '', assessment: parsed.response || '', plan: parsed.plan || '' };
    } else if (targetFormat === 'DAP') {
      converted = { subjective: parsed.data || '', objective: '', assessment: parsed.assessment || '', plan: parsed.plan || '' };
    } else if (targetFormat === 'GIRP') {
      converted = { goals: parsed.goals || '', intervention: parsed.intervention || '', response: parsed.response || '', plan: parsed.plan || '' };
    } else if (targetFormat === 'DMH_SIR') {
      converted = {
        situation: parsed.situation || '',
        interventions: parsed.interventions || parsed.intervention || '',
        response: parsed.response || '',
        risk_safety: parsed.risk_safety || '',
        functioning_medical_necessity: parsed.functioning_medical_necessity || '',
        plan_homework: parsed.plan_homework || parsed.plan || '',
      };
    }

    res.json({ converted, targetFormat, original_format: session.note_format });
  } catch (err) {
    console.error('[convert-note]', err.message);
    sendRouteError(res, err);
  }
});

// POST /api/ai/dictate-session — transcribe verbal session summary and parse into SOAP/BIRP/DAP/GIRP/DMH_SIR
router.post('/dictate-session', upload.single('audio'), async (req, res) => {
  req.socket.setTimeout(0);
  res.setTimeout(0);
  try {
    const providedTranscript = typeof req.body?.transcript === 'string' ? req.body.transcript : '';
    if (!req.file && !providedTranscript.trim()) {
      return res.status(400).json({ error: 'No audio or transcript received.' });
    }

    const rawTranscript = req.file
      ? await transcribeAudioUpload(req.file)
      : providedTranscript;
    if (!rawTranscript.trim()) {
      return res.status(400).json({ error: 'Could not transcribe audio. Try speaking more clearly or in a quieter environment.' });
    }

    const transcript = scrubText(rawTranscript);
    const verbosity = req.body?.verbosity || 'standard';

    const verbosityRule = {
      concise: 'VERBOSITY: CONCISE — Each field 1-2 sentences MAX. Use clinical shorthand and abbreviations (Pt, Dx, Tx, SI, HI, c/o, w/, r/t). No filler. Write in complete sentences and paragraph form, not bullets.',
      standard: 'VERBOSITY: STANDARD — Each field 2-4 sentences. Professional clinical language. Clear and complete.',
      detailed: 'VERBOSITY: DETAILED — Each field 4-6 sentences. Thorough documentation with clinical reasoning, specific examples, and nuanced observations.',
    }[verbosity] || '';

    const dictateSystemPrompt = `You are a clinical documentation assistant for licensed therapists. Parse a verbal session summary or transcript into chart-ready progress notes in SOAP, BIRP, DAP, GIRP, and DMH_SIR formats.

${verbosityRule}

CRITICAL GUIDELINES:

1. OBJECTIVE/BEHAVIORAL OBSERVATIONS — This is the most important part.
   Analyze the transcript carefully for OBSERVABLE behavioral indicators:
   - Speech: rate (rapid/slow/normal), volume (soft/loud), coherence, pressured speech, latency
   - Affect: congruent/incongruent with mood, range (full/restricted/flat/blunted/labile), tearfulness
   - Mood: as stated by client AND as observed (anxious, depressed, irritable, euthymic, elevated)
   - Thought process: linear/goal-directed, tangential, circumstantial, disorganized, perseverative
   - Thought content: suicidal ideation (SI), homicidal ideation (HI), delusions, obsessions — note presence or DENIAL
   - Engagement: cooperative, guarded, resistant, avoidant, forthcoming, defensive
   - Insight: good/fair/poor — does client recognize their patterns?
   - Judgment: intact/impaired — are they making reasonable decisions?
   - Behavioral cues from transcript: topic avoidance, emotional shifts, crying, anger, shutting down
   - If the clinician mentions any observations (e.g., "client was tearful", "seemed agitated"), include them verbatim.
   - Mark anything you inferred from speech patterns with [observed from transcript] so clinician can verify.

2. Write CONCISE clinical notes — NOT transcript summaries. Each field 2-5 sentences max.

Return ONLY valid JSON — no markdown, no explanation:
{
  "SOAP": {
    "subjective": "Client self-report in their own words: presenting concerns, mood, symptoms, stressors. What the client SAYS. 2-4 sentences.",
    "objective": "Clinician observations and behavioral data: affect, mood, speech, thought process, engagement, insight, judgment, and any behavioral indicators noted during session. Include mental status observations. 3-5 sentences.",
    "assessment": "Clinical formulation: diagnostic impressions, progress toward treatment goals, risk assessment, clinical conceptualization. 2-4 sentences.",
    "plan": "Treatment plan updates: interventions for next session, homework assigned, referrals, safety planning if needed, follow-up timeline."
  },
  "BIRP": {
    "behavior": "Observable client behaviors and presentation: affect, mood, behavioral patterns discussed, interpersonal dynamics observed, symptoms manifested during session. 3-5 sentences.",
    "intervention": "Therapeutic interventions applied: specific techniques (CBT, MI, DBT skills, etc.), psychoeducation provided, topics explored, therapeutic stance. 2-4 sentences.",
    "response": "Client's response to interventions: engagement level, emotional reactions, insight demonstrated, resistance noted, breakthroughs or setbacks. 2-4 sentences.",
    "plan": "Next steps: continued interventions, homework, session frequency, referrals, safety considerations."
  },
  "DAP": {
    "data": "Combined objective and subjective data: what client reported AND what clinician observed. Include behavioral observations, affect, mood, speech patterns, engagement level alongside client's self-report. 4-6 sentences.",
    "assessment": "Clinical interpretation: progress toward goals, diagnostic considerations, risk level, treatment effectiveness. 2-4 sentences.",
    "plan": "Treatment plan updates: next session focus, homework, referrals, safety planning."
  },
  "GIRP": {
    "goals": "Treatment goals addressed this session and relevance to overall treatment plan. 2-3 sentences.",
    "intervention": "Specific therapeutic interventions and techniques applied. Name the modality. 2-4 sentences.",
    "response": "Client's observable response: behavioral changes, emotional shifts, insight gained, engagement quality, progress indicators. 2-4 sentences.",
    "plan": "Continued treatment direction: next session goals, homework, adjustments to approach."
  },
  "DMH_SIR": {
    "situation": "Situation / Presentation: client's presentation, symptoms, stressors, clinical focus, and why the session was medically necessary today. 3-5 sentences.",
    "interventions": "Interventions Used: specific clinician interventions, modality, skills practice, psychoeducation, safety planning, linkage/collateral work, and clinical rationale. 3-5 sentences.",
    "response": "Client Response: engagement, affective/behavioral response, insight, resistance, regulation, skill use, progress, or barriers. 2-4 sentences.",
    "risk_safety": "Risk / Safety Update: SI/HI/self-harm/substance/DV/abuse updates, protective factors, safety plan changes, crisis resources, or rationale if no acute risk was indicated. 2-4 sentences.",
    "functioning_medical_necessity": "Functioning / Medical Necessity: symptom impact and functional impairment across home, work/school, relationships, ADLs, level-of-care rationale, and why ongoing treatment remains indicated. 2-4 sentences.",
    "plan_homework": "Plan / Homework / Next Steps: next session focus, homework, referrals, assessments, coordination, frequency, and follow-up plan. 2-4 sentences."
  }
}

Rules:
- ALWAYS write in complete sentences and paragraph form. NEVER use bullet points or numbered lists in the note sections.
- CONCISE but CLINICALLY RICH. Quality over brevity.
- For Objective/Behavior sections: ALWAYS include affect, mood, thought process, engagement, and insight even if you have to infer from speech patterns. Mark inferences.
- Extract ONLY what is stated or reasonably observable. Do not fabricate symptoms not mentioned.
- Use professional clinical language. Abbreviations OK (Pt, Dx, Tx, SI, HI, MSE).
- If risk-relevant content is present (SI, HI, self-harm, DV), ALWAYS document it in assessment + plan.
- Empty string "" if a section truly has no relevant content.
- BIRP uses "behavior" and "intervention" not "subjective" and "objective".
- DAP uses "data" not "subjective".
- DMH_SIR must include all six fields, even when brief. Use empty string only when the transcript truly gives no information for that field.`;

    // Inject per-therapist style hints (learned from their edits) into the
    // system prompt. Returns empty string until they have enough samples.
    const { getStyleHintsForPrompt } = require('../services/style-adaptation');
    const styleHints = await getStyleHintsForPrompt(req.therapist.id);

    const rawDictate = await callAI(
      MODELS.AZURE_MAIN,
      dictateSystemPrompt + styleHints,
      `Session transcript/summary:\n${transcript}`,
      3000,
      { therapistId: req.therapist.id, kind: 'dictate_session' }
    );

    let sections = {
      SOAP: { subjective: '', objective: '', assessment: '', plan: '' },
      BIRP: { subjective: '', objective: '', assessment: '', plan: '' },
      DAP:  { subjective: '', assessment: '', plan: '' },
      GIRP: { goals: '', intervention: '', response: '', plan: '' },
      DMH_SIR: { situation: '', interventions: '', response: '', risk_safety: '', functioning_medical_necessity: '', plan_homework: '' },
    };
    try {
      let rawJson = rawDictate.trim();
      // Strip markdown code fences if present
      const fenceMatch = rawJson.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) rawJson = fenceMatch[1].trim();
      if (!rawJson.startsWith('{')) {
        const braceStart = rawJson.indexOf('{');
        const braceEnd = rawJson.lastIndexOf('}');
        if (braceStart !== -1 && braceEnd > braceStart) rawJson = rawJson.slice(braceStart, braceEnd + 1);
      }
      const parsed = JSON.parse(rawJson);
      if (parsed.SOAP) sections.SOAP = {
        subjective: parsed.SOAP.subjective || '',
        objective: parsed.SOAP.objective || '',
        assessment: parsed.SOAP.assessment || '',
        plan: parsed.SOAP.plan || '',
      };
      if (parsed.BIRP) sections.BIRP = {
        // BIRP uses behavior/intervention/response — map to subjective/objective/assessment for UI compatibility
        subjective: parsed.BIRP.behavior || parsed.BIRP.subjective || '',
        objective: parsed.BIRP.intervention || parsed.BIRP.objective || '',
        assessment: parsed.BIRP.response || parsed.BIRP.assessment || '',
        plan: parsed.BIRP.plan || '',
      };
      if (parsed.DAP) sections.DAP = {
        // DAP uses data — map to subjective for UI compatibility
        subjective: parsed.DAP.data || parsed.DAP.subjective || '',
        assessment: parsed.DAP.assessment || '',
        plan: parsed.DAP.plan || '',
      };
      if (parsed.GIRP) sections.GIRP = {
        goals: parsed.GIRP.goals || '',
        intervention: parsed.GIRP.intervention || '',
        response: parsed.GIRP.response || '',
        plan: parsed.GIRP.plan || '',
      };
      if (parsed.DMH_SIR) sections.DMH_SIR = {
        situation: parsed.DMH_SIR.situation || '',
        interventions: parsed.DMH_SIR.interventions || parsed.DMH_SIR.intervention || '',
        response: parsed.DMH_SIR.response || '',
        risk_safety: parsed.DMH_SIR.risk_safety || parsed.DMH_SIR.riskSafety || '',
        functioning_medical_necessity: parsed.DMH_SIR.functioning_medical_necessity || parsed.DMH_SIR.functioningMedicalNecessity || '',
        plan_homework: parsed.DMH_SIR.plan_homework || parsed.DMH_SIR.planHomework || parsed.DMH_SIR.plan || '',
      };
    } catch (parseErr) {
      console.error('[dictate-session] JSON parse error:', parseErr.message);
    }

    return res.json({ transcript, sections });
  } catch (err) {
    console.error('[ai/dictate-session]', err.message);
    sendRouteError(res, err);
  }
});

// POST /api/ai/convert-full-note — Convert full session note into a specific format (SOAP/BIRP/DAP/GIRP/DMH_SIR)
router.post('/convert-full-note', async (req, res) => {
  try {
    const { fullNote, targetFormat = 'SOAP', patientContext = {} } = req.body;
    if (!fullNote || !fullNote.trim()) {
      return res.status(400).json({ error: 'Full note cannot be empty' });
    }

    const validFormats = ['SOAP', 'BIRP', 'DAP', 'GIRP', 'DMH_SIR'];
    const fmt = validFormats.includes(targetFormat) ? targetFormat : 'SOAP';

    const cleanNote = scrubText(fullNote.trim());

    // Build format-specific prompt
    const formatPrompts = {
      SOAP: `{
  "subjective": "Client self-report: what the client said, mood, symptoms, week recap. Use direct quotes when helpful.",
  "objective": "Clinician observations: mental status, affect, behavior, appearance, cognition, insight, judgment, screening scores.",
  "assessment": "Clinical interpretation: progress toward goals, diagnostic impressions, functional status, risk assessment.",
  "plan": "Next steps: interventions used, homework assigned, next session focus, referrals, crisis plan if applicable."
}`,
      BIRP: `{
  "subjective": "Behavior: client presentation, mood, affect, reported symptoms, functioning since last session.",
  "objective": "Intervention: techniques used, topics addressed, therapeutic modalities applied.",
  "assessment": "Response: client's response to interventions, engagement level, insight gained, progress.",
  "plan": "Plan: homework assigned, next session focus, referrals, safety planning if indicated."
}`,
      DAP: `{
  "subjective": "Data: all observable and reported information combined — self-report, clinician observations, mental status, affect, scores.",
  "assessment": "Assessment: clinical interpretation, diagnostic impressions, progress toward goals, risk assessment.",
  "plan": "Plan: next steps, interventions, homework, next session focus, referrals."
}`,
      GIRP: `{
  "goals": "Treatment goals addressed in this session: what the client is working toward, linked to the treatment plan.",
  "intervention": "Clinician interventions: techniques used, topics addressed, therapeutic modalities applied, exercises aligned with goals.",
  "response": "Client's response to interventions: engagement, progress toward goals, insight gained, barriers encountered.",
  "plan": "Next steps: homework, goals for next session, referrals, adjustments to treatment approach."
}`,
      DMH_SIR: `{
  "situation": "Situation / Presentation: client presentation, symptoms, stressors, session focus, and medical necessity for today's service.",
  "interventions": "Interventions Used: specific interventions, modalities, skills, psychoeducation, safety planning, linkage/collateral work, and rationale.",
  "response": "Client Response: engagement, insight, affective/behavioral response, resistance, progress, barriers, and skill use.",
  "risk_safety": "Risk / Safety Update: SI/HI/self-harm/substance/DV/abuse updates, protective factors, safety plan changes, crisis resources, or rationale if no acute risk.",
  "functioning_medical_necessity": "Functioning / Medical Necessity: functional impairment, symptom impact, level-of-care rationale, and why ongoing care remains indicated.",
  "plan_homework": "Plan / Homework / Next Steps: next session focus, homework, referrals, assessments, coordination, frequency, and follow-up."
}`,
    };

    const convertSystemPrompt = `You are a clinical documentation assistant. A therapist has provided a full session note. Parse it and extract information to populate a ${fmt} format note.

Return ONLY a valid JSON object with this exact structure — no markdown, no explanation:
${formatPrompts[fmt]}

Rules:
- Extract ONLY what is clearly stated in the full note. Do not invent or embellish.
- Use professional clinical language appropriate for a licensed therapist's chart note.
- If information for a field is not present, return an empty string "" for that field.
- Be thorough and detailed — include all relevant information from the full note.
${patientContext.diagnosis ? `- Context: Primary diagnosis is ${patientContext.diagnosis}. Ensure notes reflect this diagnosis where relevant.` : ''}`;

    const rawConvert = await callAI(
      MODELS.AZURE_MAIN,
      convertSystemPrompt,
      `Full Note:\n${cleanNote}`,
      1500,
      { therapistId: req.therapist.id, kind: 'convert_full_note' }
    );

    let result = {};
    try {
      result = JSON.parse(rawConvert);
    } catch (parseErr) {
      console.error('[convert-full-note] JSON parse error:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    // Return in nested format: { [fmt]: { ...fields } }
    return res.json({ [fmt]: result, targetFormat: fmt });
  } catch (err) {
    console.error('[ai/convert-full-note]', err.message);
    return sendRouteError(res, err);
  }
});

// POST /api/ai/document-to-profile
router.post('/document-to-profile', async (req, res) => {
  try {
    const { patientId, documentId } = req.body;
    if (!patientId || !documentId) {
      return res.status(400).json({ error: 'patientId and documentId are required' });
    }

    const db = getAsyncDb();
    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientId, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const doc = await db.get(
      'SELECT original_name, extracted_text, document_kind FROM documents WHERE id = ? AND patient_id = ? AND therapist_id = ?',
      documentId,
      patientId
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.extracted_text) return res.status(400).json({ error: 'This document does not contain readable text yet.' });

    const prompt = `You are Miwa, a privacy-conscious clinical intake assistant.

Using the intake/assessment source below, extract structured updates for the client profile. Use only supported facts. Return valid JSON only with exactly these keys:
{
  "case_type": string,
  "age_range": string,
  "referral_source": string,
  "living_situation": string,
  "presenting_concerns": string,
  "diagnoses": string,
  "notes": string,
  "mental_health_history": string,
  "substance_use": string,
  "risk_screening": string,
  "family_social_history": string,
  "mental_status_observations": string,
  "treatment_goals": string,
  "medical_history": string,
  "medications": string,
  "trauma_history": string,
  "strengths_protective_factors": string,
  "functional_impairments": string
}

Document name: ${doc.original_name}
Document text:
"""
${scrubText(String(doc.extracted_text)).substring(0, 18000)}
"""`;

    const content = (await generateAIResponse([
      { role: 'system', content: 'You update de-identified client profiles from intake documents. Return JSON only.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 800, jsonMode: true }) || '{}').replace(/[\u2014\u2013]/g, ' ');
    const rawFields = JSON.parse(cleanJson(content));
    // Scrub any PHI that may have slipped through in the AI response before writing to DB
    const fields = scrubObject(rawFields);

    await db.run(
      `UPDATE patients SET
         case_type = ?, age_range = ?, referral_source = ?, living_situation = ?,
         presenting_concerns = ?, diagnoses = ?, notes = ?, mental_health_history = ?,
         substance_use = ?, risk_screening = ?, family_social_history = ?, mental_status_observations = ?,
         treatment_goals = ?, medical_history = ?, medications = ?, trauma_history = ?,
         strengths_protective_factors = ?, functional_impairments = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      fields.case_type || patient.case_type,
      fields.age_range || patient.age_range,
      fields.referral_source || patient.referral_source,
      fields.living_situation || patient.living_situation,
      fields.presenting_concerns || patient.presenting_concerns,
      fields.diagnoses || patient.diagnoses,
      fields.notes || patient.notes,
      fields.mental_health_history || patient.mental_health_history,
      fields.substance_use || patient.substance_use,
      fields.risk_screening || patient.risk_screening,
      fields.family_social_history || patient.family_social_history,
      fields.mental_status_observations || patient.mental_status_observations,
      fields.treatment_goals || patient.treatment_goals,
      fields.medical_health_history || fields.medical_history || patient.medical_history,
      fields.medications || patient.medications,
      fields.trauma_history || patient.trauma_history,
      fields.strengths_protective_factors || patient.strengths_protective_factors,
      fields.functional_impairments || patient.functional_impairments,
      patientId,
      req.therapist.id
    );

    const updated = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientId, req.therapist.id);
    res.json({ patient: updated });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// POST /api/ai/analyze-notes  (SSE streaming)
router.post('/analyze-notes', async (req, res) => {
  try {
    const _b0 = scrubObject(req.body);
    const { patientContext, noteFormat, subjective, objective, assessment, plan, patientId } = _b0;
    const userRole = req.therapist.user_role || 'licensed';

    // Pull uploaded documents for this patient if patientId provided
    let docsBlock = '';
    if (patientId) {
      const db = getAsyncDb();
      const docs = await db.all(
        'SELECT original_name, document_label, file_type, extracted_text FROM documents WHERE patient_id = ? AND extracted_text IS NOT NULL ORDER BY created_at DESC LIMIT 3',
        patientId
      );
      if (docs.length > 0) {
        docsBlock = '\n\n**Uploaded Assessment Documents:**\n' + docs.map(d => {
          const label = d.document_label || d.original_name;
          const safe  = scrubText(d.extracted_text || ''); // scrub before including in AI prompt
          const preview = safe.substring(0, 2000);
          return `--- ${label} (${d.file_type}) ---\n${preview}${safe.length > 2000 ? '\n[...truncated]' : ''}`;
        }).join('\n\n');
      }
    }

    const format = noteFormat || 'SOAP';
    const fieldLabels = {
      SOAP: { subjective: 'Subjective', objective: 'Objective', assessment: 'Assessment', plan: 'Plan' },
      BIRP: { subjective: 'Behavior', objective: 'Intervention', assessment: 'Response', plan: 'Plan' },
      DAP:  { subjective: 'Data', objective: null, assessment: 'Assessment', plan: 'Plan' },
      GIRP: { subjective: 'Goals', objective: 'Intervention', assessment: 'Response', plan: 'Plan' },
      DMH_SIR: { subjective: 'Situation / Presentation', objective: 'Interventions Used', assessment: 'Client Response + Risk/Safety + Functioning/Medical Necessity', plan: 'Plan / Homework / Next Steps' },
    }[format] || { subjective: 'Subjective', objective: 'Objective', assessment: 'Assessment', plan: 'Plan' };

    const prompt = `Please analyze the following ${format} session note and return a concise, clinically usable review with these exact sections:

1. Primary diagnosis / working impression
2. ICD-10-CM codes
3. Risk / safety snapshot
4. Key clinical themes
5. Clinical feedback
6. Treatment recommendations

Requirements:
- lead with the most clinically useful information
- keep the primary diagnosis and risk visible near the top
- use short paragraphs or tight bullets, not long prose
- avoid meta commentary, disclaimers, or filler
- if information is unclear, say so directly and briefly

**Patient Context:**
${patientContext || 'No patient context provided'}${docsBlock}

**${format} Note:**

**${fieldLabels.subjective}:**
${subjective || '(not provided)'}
${fieldLabels.objective ? `\n**${fieldLabels.objective}:**\n${objective || '(not provided)'}` : ''}
**${fieldLabels.assessment}:**
${assessment || '(not provided)'}

**${fieldLabels.plan}:**
${plan || '(not provided)'}

Format the response with clear headings in the same order as above.`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullText = '';
    const stream = streamAnalyzeNotes(
      getAnalysisSystemPrompt(userRole),
      prompt,
      2000,
      { therapistId: req.therapist.id }
    );

    for await (const rawChunk of stream) {
      const text = rawChunk.replace(/[\u2014\u2013]/g, ' ');
      if (text) {
        fullText += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, feedback: fullText })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendRouteError(res, err);
    } else {
      res.write(`data: ${JSON.stringify(safeAIErrorResponse(err))}\n\n`);
      res.end();
    }
  }
});

// POST /api/ai/chat (SSE streaming)
router.post('/chat', async (req, res) => {
  try {
    const { message: _rawMsg, contextType, contextId, responseStyle } = req.body;
    const message = scrubText(_rawMsg);
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const db = getAsyncDb();
    const userRole = req.therapist.user_role || 'licensed';

    const tid = req.therapist.id;
    const therapistRow = await db.get('SELECT full_name, first_name, last_name FROM therapists WHERE id = ?', tid);
    // Use first_name so Miwa addresses the therapist by first name only
    const therapistName = therapistRow?.first_name
      || (therapistRow?.full_name ? therapistRow.full_name.split(' ')[0] : null)
      || null;
    const assistantRuntime = await getRuntimeSnapshot(db, tid, {
      surface: 'consult',
      context_type: contextType || null,
      context_id: contextId || null,
    });
    const assistantProfile = assistantRuntime.profile || await loadAssistantProfile(tid);
    const assistantRuntimePrompt = formatRuntimeForPrompt(assistantRuntime);
    const effectiveResponseStyle = responseStyle || assistantProfile.verbosity;
    const canUseHistory = assistantAllows(assistantProfile, 'history');
    const canUsePatientContext = assistantAllows(assistantProfile, 'patient_context');
    const canUseSessionContext = assistantAllows(assistantProfile, 'session_context');
    const canUseDocuments = assistantAllows(assistantProfile, 'documents');

    // Save user message
    await db.insert(
      'INSERT INTO chat_messages (therapist_id, role, content, context_type, context_id) VALUES (?, ?, ?, ?, ?)',
      tid, 'user', message, contextType || null, contextId || null
    );

    const requestedContextType = contextType || null;
    const permittedContextType = requestedContextType === 'patient' && !canUsePatientContext
      ? null
      : requestedContextType === 'session' && !canUseSessionContext
        ? null
        : requestedContextType;

    // Load last 20 Consult messages (excludes MiwaChat 'agent' rows so the
    // two surfaces don't cross-contaminate conversational memory).
    const historyRows = canUseHistory
      ? await db.all(
          `SELECT role, content FROM chat_messages
            WHERE therapist_id = ?
              AND (context_type IS NULL OR context_type != 'agent')
            ORDER BY created_at DESC LIMIT 20`,
          tid
        )
      : [];
    const history = historyRows.reverse();

    // Build context block if patient/session context selected and permitted
    let contextBlock = '';
    if (permittedContextType === 'patient' && contextId) {
      const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', contextId, tid);
      if (patient) {
        const sessions = await db.all(
          'SELECT * FROM sessions WHERE patient_id = ? AND therapist_id = ? ORDER BY session_date DESC LIMIT 5',
          contextId, tid
        );
        const docs = canUseDocuments
          ? await db.all(
              'SELECT id, original_name, document_label, file_type, extracted_text FROM documents WHERE patient_id = ? AND therapist_id = ? AND extracted_text IS NOT NULL ORDER BY created_at DESC LIMIT 5',
              contextId, tid
            )
          : [];
        let docBlock = '';
        if (docs.length > 0) {
          docBlock = '\n\nUploaded Assessment Documents:\n' + docs.map(d => {
            const label = d.document_label || d.original_name;
            const safe  = scrubText(d.extracted_text || ''); // scrub doc text before AI
            const preview = safe.substring(0, 1500);
            return `--- ${label} (${d.file_type}) ---\n${preview}${safe.length > 1500 ? '\n[...truncated]' : ''}`;
          }).join('\n\n');
        }
        // Scrub all clinical fields before injecting into the Azure AI context block
        contextBlock = `\n\n[CASE CONTEXT - De-identified]\nClient ID: ${patient.client_id}\nAge: ${patient.age || 'N/A'}\nGender: ${patient.gender || 'N/A'}\nPresenting Concerns: ${scrubText(patient.presenting_concerns || 'N/A')}\nCurrent Diagnoses: ${scrubText(patient.diagnoses || 'N/A')}\n\nRecent Sessions (${sessions.length}):\n${sessions.map(s => `- ${s.session_date}: ${scrubText(s.assessment || 'No assessment')}`).join('\n')}${docBlock}`;
      }
    } else if (permittedContextType === 'session' && contextId) {
      const session = await db.get(
        `SELECT s.*, p.client_id, p.age, p.gender, p.presenting_concerns, p.diagnoses
         FROM sessions s JOIN patients p ON s.patient_id = p.id
         WHERE s.id = ? AND s.therapist_id = ? AND p.therapist_id = ?`,
        contextId, tid, tid
      );
      if (session) {
        // Scrub all note fields before injecting into the Azure AI context block
        contextBlock = `\n\n[SESSION CONTEXT - De-identified]\nClient ID: ${session.client_id}\nAge: ${session.age || 'N/A'}\nGender: ${session.gender || 'N/A'}\nSession Date: ${session.session_date}\nSubjective: ${scrubText(session.subjective || 'N/A')}\nObjective: ${scrubText(session.objective || 'N/A')}\nAssessment: ${scrubText(session.assessment || 'N/A')}\nPlan: ${scrubText(session.plan || 'N/A')}`;
      }
    }

    const messages = history.map(h => ({ role: h.role, content: h.content }));
    if (contextBlock && messages.length > 0) {
      messages[messages.length - 1] = {
        role: messages[messages.length - 1].role,
        content: messages[messages.length - 1].content + contextBlock,
      };
    } else if (permittedContextType && !contextBlock && requestedContextType && requestedContextType !== permittedContextType) {
      messages.push({
        role: 'system',
        content: `The clinician requested ${requestedContextType} context, but the current assistant permissions do not allow that scope. Explain the limitation plainly and continue without assuming access.`,
      });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Enforce budget before we spend any tokens
    try { assertBudgetOk(tid); } catch (budgetErr) {
      res.write(`data: ${JSON.stringify({ error: budgetErr.message })}\n\n`);
      res.end();
      return;
    }

    let fullResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const chatModel = MODELS.GPT_MINI;

    const result = await generateAIResponseWithUsage([
        {
          role: 'system',
          content: `${getSupervisorSystemPrompt(userRole, therapistName, effectiveResponseStyle, assistantProfile)}${assistantRuntimePrompt ? `\n\n${assistantRuntimePrompt}` : ''}`,
        },
        ...messages,
      ], { maxTokens: 2000 });
    const text = (result.text || '').replace(/[\u2014\u2013]/g, ' ');
    if (text) {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    inputTokens = result.usage?.input || 0;
    outputTokens = result.usage?.output || 0;

    logCostEvent({
      therapistId: tid,
      kind: 'chat',
      provider: 'azure-openai',
      model: chatModel,
      inputTokens,
      outputTokens,
    });

    // Save assistant response
    await db.insert(
      'INSERT INTO chat_messages (therapist_id, role, content, context_type, context_id) VALUES (?, ?, ?, ?, ?)',
      tid, 'assistant', fullResponse, contextType || null, contextId || null
    );
    await recordConversationSignal(db, tid, {
      surface: 'consult',
      context_type: contextType || null,
      context_id: contextId || null,
      userMessage: message,
      assistantResponse: fullResponse,
    }).catch(() => {});
    await persistIfNeeded();

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendRouteError(res, err);
    } else {
      res.write(`data: ${JSON.stringify(safeAIErrorResponse(err))}\n\n`);
      res.end();
    }
  }
});

// POST /api/ai/treatment-plan  (SSE streaming)
router.post('/treatment-plan', async (req, res) => {
  try {
    const _b1 = scrubObject(req.body);
    const { patientContext, diagnoses, sessionNotes, goals } = _b1;
    const userRole = req.therapist.user_role || 'licensed';

    const prompt = `Generate a clinically practical treatment plan from the information below.

**Patient Context:**
${patientContext || 'Not provided'}

**Diagnoses:**
${diagnoses || 'Not specified'}

**Clinical Notes/Presentation:**
${sessionNotes || 'Not provided'}

**Therapist's Initial Goal Ideas:**
${goals || 'Not specified'}

Return a concise, structured plan with these exact sections and in this order:
1. Problem List
2. Long-Term Goals
3. Short-Term Objectives
4. Interventions
5. Progress Monitoring
6. Barriers / Contingencies
7. Risk / Crisis Considerations

Requirements:
- keep the problem list near the top and tie it clearly to the diagnoses
- use measurable language for goals, objectives, and monitoring
- keep interventions specific and clinically actionable
- call out risk or crisis considerations explicitly when relevant
- avoid long introductory prose and avoid generic filler`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try { assertBudgetOk(req.therapist.id); } catch (budgetErr) {
      res.write(`data: ${JSON.stringify({ error: budgetErr.message })}\n\n`);
      res.end();
      return;
    }

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const planModel = MODELS.GPT_MINI;
    const result = await generateAIResponseWithUsage([
        { role: 'system', content: getTreatmentPlanSystemPrompt(userRole) },
        { role: 'user', content: prompt },
      ], { maxTokens: 3000 });
    const text = (result.text || '').replace(/[\u2014\u2013]/g, ' ');
    if (text) {
      fullText += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    inputTokens = result.usage?.input || 0;
    outputTokens = result.usage?.output || 0;

    logCostEvent({
      therapistId: req.therapist.id,
      kind: 'treatment_plan',
      provider: 'azure-openai',
      model: planModel,
      inputTokens,
      outputTokens,
    });

    res.write(`data: ${JSON.stringify({ done: true, plan: fullText })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendRouteError(res, err);
    } else {
      res.write(`data: ${JSON.stringify(safeAIErrorResponse(err))}\n\n`);
      res.end();
    }
  }
});

// POST /api/ai/similar-cases
router.post('/similar-cases', async (req, res) => {
  try {
    const { keywords, diagnoses, presenting_concerns } = req.body;
    const db = getAsyncDb();

    const searchTerms = [
      ...(keywords || '').split(/\s+/).filter(k => k.length > 3),
      ...(diagnoses || '').split(/[,\s]+/).filter(k => k.length > 3),
      ...(presenting_concerns || '').split(/[,\s]+/).filter(k => k.length > 3),
    ].slice(0, 10);

    if (searchTerms.length === 0) return res.json({ cases: [] });

    // Run individual searches and merge
    const seen = new Set();
    const cases = [];
    for (const term of searchTerms) {
      const q = `%${term}%`;
      const rows = await db.all(
        `SELECT s.id, s.session_date, s.assessment, s.plan, s.icd10_codes,
                p.client_id, p.age, p.gender, p.presenting_concerns, p.diagnoses
         FROM sessions s JOIN patients p ON s.patient_id = p.id
         WHERE s.therapist_id = ? AND (s.subjective LIKE ? OR s.assessment LIKE ? OR p.presenting_concerns LIKE ? OR p.diagnoses LIKE ?)
         LIMIT 5`,
        req.therapist.id, q, q, q, q
      );
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          cases.push(row);
        }
      }
      if (cases.length >= 5) break;
    }

    res.json({ cases: cases.slice(0, 5) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// POST /api/ai/workspace (SSE streaming)
router.post('/workspace', async (req, res) => {
  try {
    // Check subscription / trial access
    const access = await checkWorkspaceAccess(req.therapist.id);
    if (!access.allowed) {
      return res.status(402).json({
        error: 'subscription_required',
        message: 'Your free trial has ended. Subscribe to keep using Session Workspace.',
        workspace_uses: access.workspace_uses,
        trial_limit: access.trial_limit,
      });
    }

    const _b2 = scrubObject(req.body);
    const {
      sessionType,
      caseType, noteFormat, therapeuticOrientation,
      presentingProblem, treatmentGoal, sessionNotes,
      ongoingSituation, ongoingInterventions, ongoingResponse,
      ongoingRiskSafety, ongoingFunctioningMedicalNecessity, ongoingPlanHomework,
      verbosity = 'standard',
      // intake-specific
      ageRange, referralSource, livingSituation,
      symptomOnsetDurationSeverity, precipitatingMaintainingFactors,
      culturalIdentityContext, educationEmploymentContext,
      legalMandatedContext, safetyPlanDetails,
      mentalHealthHistory, substanceUse, riskScreening,
      familySocialHistory, mentalStatusObservations,
      medicalHistory, medications, traumaHistory,
      strengthsProtectiveFactors, functionalImpairments,
    } = _b2;
    const userRole = req.therapist.user_role || 'licensed';
    const isTrainee = userRole === 'trainee';
    const isIntake = sessionType === 'intake';

    // ── Supervision section (shared across both modes) ────────────────────
    const supervisionSection = `===SUPERVISION===
Write this section as a direct, warm, and engaged supervision conversation — Miwa speaking personally to the clinician. Do NOT produce a generic bullet list. Speak in first person as the supervisor, as if you are sitting together reviewing this case.

${isTrainee
  ? 'Tone: Warm but rigorous supervisor working with a trainee. Use Socratic questioning. Help them find their own answers. Explore countertransference and developmental edges.'
  : 'Tone: Collegial peer consultant to a licensed clinician. Be direct and clinically rich. Share your perspective. Debate hypotheses as equals.'}

${isIntake
  ? `Structure:
1. **First impression** — What stands out from this intake picture? What are you most curious about? (2-3 sentences)
2. **Conceptualization questions** — 2-3 questions probing how they're making sense of this case: attachment history, systemic dynamics, diagnostic hypotheses, what might be missing from the picture
3. **The clinician in the room** — What was it like to sit with this client in the first session? Any pulls, reactions, or early countertransference to name?
4. **Treatment direction** — What do you want them to think carefully about before committing to a treatment approach? Any red flags about fit, pacing, or scope of practice?
5. **Safety & documentation priorities** — Name any safety concerns, mandatory reporting considerations, or documentation requirements they need to address right away.`
  : `Structure:
1. **Opening observation** — Start with something you genuinely noticed from the session notes. What stood out? What are you curious about? (2-3 sentences)
2. **Probe their clinical thinking** — Ask 2-3 layered Socratic questions about conceptualization, assumptions, what they might be missing
3. **The clinician in the room** — Ask one question about their internal experience in the session. Countertransference, parallel process, moments of being stuck or pulled
4. **What to sit with** — One or two things to reflect on before the next session
5. **Red flags or priorities** — Safety, ethical, legal, or documentation concerns — name them directly. If none, note what you'd be watching for.`}`;

    // ── INTAKE prompt ─────────────────────────────────────────────────────
    const intakePrompt = `You are Miwa, an expert clinical supervisor with 25+ years of experience. The clinician has just completed an intake session. Using the de-identified intake information below, generate four clearly separated clinical sections using the exact markers provided.

**Intake Information:**
- Case Type: ${caseType || 'Individual'}
- Therapeutic Orientation: ${therapeuticOrientation || 'Integrative'}
- Clinician Role: ${isTrainee ? 'Trainee / Pre-Licensed' : 'Licensed Clinician'}
- Age Range: ${ageRange || '(not provided)'}
- Referral Source: ${referralSource || '(not provided)'}
- Living Situation: ${livingSituation || '(not provided)'}
- Presenting Problem: ${presentingProblem || '(not provided)'}
- Symptom Onset / Duration / Severity: ${symptomOnsetDurationSeverity || '(not provided)'}
- Precipitating / Maintaining Factors: ${precipitatingMaintainingFactors || '(not provided)'}
- Cultural / Identity Context: ${culturalIdentityContext || '(not provided)'}
- School / Work / Role Functioning: ${educationEmploymentContext || '(not provided)'}
- Legal / Mandated Reporting Context: ${legalMandatedContext || '(not provided)'}
- Mental Health History: ${mentalHealthHistory || '(not provided)'}
- Medical History: ${medicalHistory || '(not provided)'}
- Medications: ${medications || '(not provided)'}
- Substance Use: ${substanceUse || '(not provided)'}
- Risk Screening: ${riskScreening || '(not provided)'}
- Safety Plan / Crisis Plan: ${safetyPlanDetails || '(not provided)'}
- Family / Social History: ${familySocialHistory || '(not provided)'}
- Trauma History: ${traumaHistory || '(not provided)'}
- Mental Status Observations: ${mentalStatusObservations || '(not provided)'}
- Strengths / Protective Factors: ${strengthsProtectiveFactors || '(not provided)'}
- Functional Impairments / Medical Necessity: ${functionalImpairments || '(not provided)'}
- Initial Treatment Goals: ${treatmentGoal || '(not provided)'}

Return exactly five sections using these markers (do not change the markers):

===DOCUMENTATION===
Write a comprehensive biopsychosocial intake assessment. This is the primary intake document — it stays as-is and is NOT converted into a SOAP/BIRP note. Use professional clinical language. Include:
- Identifying Information and Referral: brief de-identified demographics and reason for referral
- Presenting Problem: detailed clinical description of chief complaint, onset, duration, severity, precipitating and maintaining factors
- Mental Health History: prior diagnoses, hospitalizations, treatment history, current medications
- Substance Use History: current and past use, patterns, impact on functioning
- Medical History: relevant medical conditions noted
- Family and Social History: family mental health history, key relationships, cultural/social context, support system
- Cultural / Identity / Role Context: cultural identity, language, spirituality, school/work, caregiving, legal, financial, and role-functioning context when provided
- Mental Status Examination: appearance, behavior, affect, mood, speech, thought process/content, cognition, insight, judgment
- Risk Assessment: SI, HI, self-harm, abuse/neglect, mandated reporting/legal considerations, safety planning, crisis plan, protective actions
- Functional Assessment: impact on work, relationships, daily living
- Strengths and Protective Factors: client resources and resilience factors

===CLINICAL_THINKING===
Write a concise clinical formulation in short paragraphs. Include:
- Predisposing factors (developmental, biological, psychological)
- Precipitating factors (what triggered the current crisis/presentation)
- Perpetuating factors (what maintains the problem)
- Protective factors (strengths, supports, resilience)
- Case conceptualization within the ${therapeuticOrientation || 'integrative'} framework
Aim for about 180-260 words total.

===DIAGNOSIS===
Write concise diagnostic impressions. Include:
- Primary diagnosis (if supportable) with ICD-10-CM code
- Secondary diagnoses if applicable
- 1-3 differential or rule-out considerations
- Brief note on what additional assessment is needed (standardized measures, collateral info)
Aim for about 120-220 words total.

===TREATMENT_REC===
Write initial treatment plan recommendations. Include:
- Recommended level of care (outpatient, intensive outpatient, etc.)
- Recommended session frequency and modality (individual, group, family)
- Recommended therapeutic approach based on presentation and ${therapeuticOrientation || 'integrative'} orientation
- Initial treatment goals (3-5 measurable goals with target metrics if applicable)
- Recommended standardized assessments to administer (PHQ-9, GAD-7, PCL-5, etc.)
- Referrals needed (psychiatry, medical, social services, etc.)
- Safety planning considerations if risk factors present
Aim for about 200-300 words total.

${supervisionSection}

VERBOSITY LEVEL: ${verbosity === 'concise' ? 'CONCISE — Short, tight clinical shorthand. Abbreviations OK (Pt, Dx, Tx, SI, HI). Minimum words, maximum clinical value.' : verbosity === 'detailed' ? 'DETAILED — Thorough, comprehensive documentation suitable for court or insurance review. Include clinical reasoning and specific examples.' : 'STANDARD — Professional clinical language. Complete but not verbose.'}

Formatting rules for ALL sections:
- Write like polished clinical documentation — professional, structured, chart-ready
- Use markdown headers (## for major sections, ### for subsections) to organize content clearly
- Use **bold** for section labels and key clinical terms
- Use bullet points (-) for lists of symptoms, risk factors, goals, recommendations
- Use numbered lists (1. 2. 3.) for treatment goals and sequential recommendations
- Use proper paragraph spacing between sections
- Sound like a senior clinician's documentation — not a chatbot, not an essay
- Be thorough in the biopsychosocial, concise in formulation and diagnosis
- Always include ICD-10 codes where applicable (e.g., F41.1, F32.1)`;

    // ── ONGOING SESSION prompt ────────────────────────────────────────────
    const ongoingPrompt = `You are Miwa, an expert clinical supervisor with 25+ years of experience. The clinician has shared de-identified session context below. Using their own words and clinical observations, generate four clearly separated sections. Your job is to take their shorthand and elevate it into polished, professional clinical language — do not invent facts, stay true to what they wrote.

**Session Context:**
- Case Type: ${caseType || 'Individual'}
- Note Format: ${noteFormat || 'SOAP'}
- Therapeutic Orientation: ${therapeuticOrientation || 'Integrative'}
- Clinician Role: ${isTrainee ? 'Trainee / Pre-Licensed' : 'Licensed Clinician'}
- Presenting Problem: ${presentingProblem || '(not provided)'}
- Treatment Goal: ${treatmentGoal || '(not provided)'}
- DMH/SIR Situation / Presentation: ${ongoingSituation || '(not provided)'}
- DMH/SIR Interventions Used: ${ongoingInterventions || '(not provided)'}
- DMH/SIR Client Response: ${ongoingResponse || '(not provided)'}
- DMH/SIR Risk / Safety Update: ${ongoingRiskSafety || '(not provided)'}
- DMH/SIR Functioning / Medical Necessity: ${ongoingFunctioningMedicalNecessity || '(not provided)'}
- DMH/SIR Plan / Homework / Next Steps: ${ongoingPlanHomework || '(not provided)'}
- Session Notes / Bullet Points:
${sessionNotes || '(not provided)'}

Return exactly four sections using these markers (do not change the markers):

===DOCUMENTATION===
Write a CONCISE ${noteFormat || 'SOAP'} note using the clinician's session notes. Elevate their language into professional clinical documentation. Use proper ${noteFormat || 'SOAP'} format with labeled sections. Stay faithful to what they wrote — do not add content they didn't mention.

LENGTH: Each ${noteFormat || 'SOAP'} section should be 2-5 sentences. The entire note should be 150-350 words total. This is a chart note, not a narrative — be crisp and clinical. Use abbreviations where appropriate (Pt, Dx, Tx, Hx, SI/HI, etc.).

===CLINICAL_THINKING===
Provide clinical hypotheses, case conceptualization within the ${therapeuticOrientation || 'integrative'} framework, key dynamics observed in this session, and evidence-based intervention options to consider going forward.

===DIAGNOSIS===
List differential diagnoses with ICD-10-CM codes and diagnostic reasoning based on the session content. Note what additional information would sharpen the diagnostic picture. Flag any safety concerns.

${supervisionSection}

VERBOSITY LEVEL: ${verbosity === 'concise' ? 'CONCISE — Each section 1-3 sentences MAX. Clinical shorthand and abbreviations encouraged. No filler.' : verbosity === 'detailed' ? 'DETAILED — Each section 4-8 sentences. Thorough with clinical reasoning and specific examples.' : 'STANDARD — Each section 2-5 sentences. Professional and complete.'}

Formatting rules for ALL sections:
- sound like polished clinical writing, not a chatbot
- avoid filler phrases and generic encouragement
- avoid sounding like ChatGPT or an essay generator
- prefer concise clinical paragraphs, short labels, and clean documentation language`;

    const prompt = isIntake ? intakePrompt : ongoingPrompt;

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send an immediate heartbeat so the client knows the connection is alive
    res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);

    try { assertBudgetOk(req.therapist.id); } catch (budgetErr) {
      res.write(`data: ${JSON.stringify({ error: budgetErr.message })}\n\n`);
      res.end();
      return;
    }

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const supervisorModel = MODELS.GPT_MINI;

    const result = await generateAIResponseWithUsage([
        {
          role: 'system',
          content: `You are Miwa, a seasoned clinical supervisor with 25+ years of experience in MFT, trauma-informed care, family systems, and evidence-based practice. You are warm, direct, and clinically rigorous. You speak to clinicians as a real supervisor would — personally, thoughtfully, and with genuine investment in their development. You never produce generic lists when a real conversation is called for. All client information shared with you is de-identified.

IMPORTANT FORMATTING: Write naturally like a colleague talking. Do NOT use markdown headers (##, ###), bold markers (**), or numbered lists unless absolutely necessary. Just write in clean, conversational paragraphs. Use dashes sparingly for short lists only.`,
        },
        { role: 'user', content: prompt },
      ], { maxTokens: isIntake ? 5000 : 3500 });
    const text = (result.text || '').replace(/[\u2014\u2013]/g, ' ');
    if (text) {
      fullText += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    inputTokens = result.usage?.input || 0;
    outputTokens = result.usage?.output || 0;

    logCostEvent({
      therapistId: req.therapist.id,
      kind: 'supervisor_session',
      provider: 'azure-openai',
      model: supervisorModel,
      inputTokens,
      outputTokens,
    });

    // Parse sections from full accumulated text
    const parse = (marker) => {
      const start = fullText.indexOf(marker);
      if (start === -1) return '';
      const contentStart = start + marker.length;
      const markers = ['===DOCUMENTATION===', '===INTAKE_NOTE===', '===CLINICAL_THINKING===', '===DIAGNOSIS===', '===TREATMENT_REC===', '===SUPERVISION==='];
      let end = fullText.length;
      for (const m of markers) {
        const idx = fullText.indexOf(m, contentStart);
        if (idx !== -1 && idx < end) end = idx;
      }
      return fullText.slice(contentStart, end).trim();
    };

    // Track usage for trial/billing
    await incrementWorkspaceUse(req.therapist.id);
    const updatedAccess = await checkWorkspaceAccess(req.therapist.id);

    res.write(`data: ${JSON.stringify({
      done: true,
      trialRemaining: updatedAccess.trialRemaining ?? null,
      sections: {
        documentation: parse('===DOCUMENTATION==='),
        intakeNote: parse('===INTAKE_NOTE==='),
        clinicalThinking: parse('===CLINICAL_THINKING==='),
        diagnosis: parse('===DIAGNOSIS==='),
        treatmentRec: parse('===TREATMENT_REC==='),
        supervision: parse('===SUPERVISION==='),
      },
    })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendRouteError(res, err);
    } else {
      res.write(`data: ${JSON.stringify(safeAIErrorResponse(err))}\n\n`);
      res.end();
    }
  }
});

// POST /api/ai/client-summary  — synthesizes all sessions into one overview (SSE)
router.post('/client-summary', async (req, res) => {
  try {
    const { patientId, patient: _rawPatient, sessions: _rawSessions } = req.body;
    // Scrub the patient object and every session's free-text note fields
    const patient  = scrubObject(_rawPatient  || {});
    const sessions = (_rawSessions || []).map(s => ({
      ...s,
      subjective: scrubText(s.subjective || ''),
      objective:  scrubText(s.objective  || ''),
      assessment: scrubText(s.assessment || ''),
      plan:       scrubText(s.plan       || ''),
      notes_json: s.notes_json
        ? (() => {
            try {
              return JSON.stringify(scrubObject(JSON.parse(s.notes_json)));
            } catch { return s.notes_json; }
          })()
        : null,
    }));

    const userRole = req.therapist.user_role || 'licensed';

    // Build a compact representation of all sessions
    const sessionBlocks = sessions.map((s, i) => {
      let noteText = '';
      try {
        if (s.notes_json) {
          const nj = JSON.parse(s.notes_json);
          const fmt = ['BIRP','SOAP','DAP','GIRP','DMH_SIR'].find(f => Object.values(nj[f] || {}).some(v => v)) || 'SOAP';
          const n = nj[fmt] || {};
          noteText = Object.values(n).filter(Boolean).join(' | ');
        }
      } catch {}
      noteText = noteText || [s.subjective, s.objective, s.assessment, s.plan].filter(Boolean).join(' | ');
      return `Session ${i + 1} (${s.session_date}): ${noteText.substring(0, 600)}`;
    }).join('\n\n');

    const prompt = `Write a concise clinical summary with these exact sections and labels:

Primary diagnosis / working formulation:
Risk / safety:
Key clinical themes:
Current treatment focus:

Requirements:
- keep each section to 1-3 short sentences
- lead with the most clinically useful information
- keep the summary easy to scan and easy to edit later
- avoid introductory prose, disclaimers, or filler
- if risk is not present, say so plainly

Client: Age ${patient?.age || 'N/A'}, ${patient?.gender || ''}, Dx: ${patient?.diagnoses || 'unspecified'}
Concerns: ${patient?.presenting_concerns || 'not specified'}
Sessions (${(sessions || []).length} total):
${sessionBlocks || 'No notes yet.'}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try { assertBudgetOk(req.therapist.id); } catch (budgetErr) {
      res.write(`data: ${JSON.stringify({ error: budgetErr.message })}\n\n`);
      res.end();
      return;
    }

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const summaryModel = MODELS.GPT_MINI;
    const result = await generateAIResponseWithUsage([
        { role: 'system', content: 'You are a clinical supervisor. Write a concise, sectioned client summary using the exact headings provided by the user. No preamble, no filler, and no flowing prose outside the labeled sections.' },
        { role: 'user', content: prompt },
      ], { maxTokens: 450 });
    const text = (result.text || '').replace(/[\u2014\u2013]/g, ' ');
    if (text) {
      fullText += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    inputTokens = result.usage?.input || 0;
    outputTokens = result.usage?.output || 0;

    logCostEvent({
      therapistId: req.therapist.id,
      kind: 'client_summary',
      provider: 'azure-openai',
      model: summaryModel,
      inputTokens,
      outputTokens,
    });

    res.write(`data: ${JSON.stringify({ done: true, summary: fullText })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendRouteError(res, err);
    } else {
      res.write(`data: ${JSON.stringify(safeAIErrorResponse(err))}\n\n`);
      res.end();
    }
  }
});

// GET /api/ai/chat-history — Consult (Supervisor) chat only.
//
// chat_messages stores transcripts from multiple surfaces:
//   - MiwaChat (FAB): context_type='agent'
//   - Consult (this page): context_type IS NULL / 'patient' / 'session'
//
// This endpoint must exclude 'agent' rows so the Consult page doesn't bleed
// MiwaChat history into its transcript.
router.get('/chat-history', async (req, res) => {
  try {
    const db = getAsyncDb();
    const limit = parseInt(req.query.limit) || 50;
    const messages = await db.all(
      `SELECT * FROM chat_messages
        WHERE therapist_id = ?
          AND (context_type IS NULL OR context_type != 'agent')
        ORDER BY created_at ASC
        LIMIT ?`,
      req.therapist.id, limit
    );
    res.json(messages);
  } catch (err) {
    sendRouteError(res, err);
  }
});

// DELETE /api/ai/chat-history — Clears Consult transcript only.
// Must not touch MiwaChat ('agent') messages — otherwise clearing the Consult
// page nukes the user's FAB chat history as well.
router.delete('/chat-history', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      `DELETE FROM chat_messages
        WHERE therapist_id = ?
          AND (context_type IS NULL OR context_type != 'agent')`,
      req.therapist.id,
    );
    res.json({ message: 'Chat history cleared' });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Pillar 7: Agentic Documentation — Note Enrichment Pipeline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ai/enrich-session
 * After a session note is dictated/saved, enrich it with:
 * - Suggested ICD-10 codes
 * - Continuity threads (themes from prior sessions)
 * - Risk language flags
 * - Treatment goal alignment
 * - Smart Plan suggestions
 */
router.post('/enrich-session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const { enrichSessionNote } = require('../services/note-enrichment');
    const enrichments = await enrichSessionNote(sessionId, req.therapist.id);
    res.json(enrichments);
  } catch (err) {
    console.error('[enrich] Error:', err.message);
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/enrichments/:sessionId
 * Fetch all enrichments for a session note
 */
router.get('/enrichments/:sessionId', async (req, res) => {
  try {
    const { getEnrichments } = require('../services/note-enrichment');
    const enrichments = await getEnrichments(parseInt(req.params.sessionId), req.therapist.id);
    res.json(enrichments);
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * POST /api/ai/enrichments/:id/accept
 * Mark an enrichment suggestion as accepted (for preference learning)
 */
router.post('/enrichments/:id/accept', async (req, res) => {
  try {
    const { acceptEnrichment } = require('../services/note-enrichment');
    await acceptEnrichment(parseInt(req.params.id), req.therapist.id);
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * POST /api/ai/enrichments/:id/dismiss
 * Mark an enrichment suggestion as dismissed
 */
router.post('/enrichments/:id/dismiss', async (req, res) => {
  try {
    const { dismissEnrichment } = require('../services/note-enrichment');
    await dismissEnrichment(parseInt(req.params.id), req.therapist.id);
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Pillar 1: Pre-Session Briefs API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai/briefs/upcoming
 * Get all pre-session briefs for today's upcoming appointments
 */
router.get('/briefs/upcoming', async (req, res) => {
  try {
    const { getUpcomingBriefs } = require('../services/brief-generator');
    // getUpcomingBriefs already returns parsed summary rows — pass them through.
    const briefs = await getUpcomingBriefs(req.therapist.id);
    res.json(briefs);
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/briefs/:id
 * Get a specific brief and mark as viewed.
 * `getBrief` already parses `brief_json` and returns it under `brief`.
 */
router.get('/briefs/:id', async (req, res) => {
  try {
    const { getBrief } = require('../services/brief-generator');
    const row = await getBrief(parseInt(req.params.id), req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Brief not found' });
    res.json({
      id: row.id,
      appointment_id: row.appointment_id,
      patient_id: row.patient_id,
      brief: row.brief,
      viewed: !!row.viewed_at,
      generated_at: row.created_at,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/briefs/by-appointment/:appointmentId
 * Fetch the brief for a specific appointment (if any). Used by PatientDetail
 * to surface a brief when an appointment is imminent.
 */
router.get('/briefs/by-appointment/:appointmentId', async (req, res) => {
  try {
    const { getAsyncDb } = require('../db/asyncDb');
    const db = getAsyncDb();
    const appointmentId = parseInt(req.params.appointmentId);
    const row = await db.get(
      `SELECT id FROM session_briefs
       WHERE appointment_id = ? AND therapist_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      appointmentId, req.therapist.id
    );
    if (!row) return res.json({ brief: null });

    const { getBrief } = require('../services/brief-generator');
    const full = await getBrief(row.id, req.therapist.id);
    res.json({
      id: full.id,
      appointment_id: full.appointment_id,
      patient_id: full.patient_id,
      brief: full.brief,
      viewed: !!full.viewed_at,
      generated_at: full.created_at,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * POST /api/ai/briefs/regenerate/:appointmentId
 * Drop any existing brief for this appointment and build a fresh one, pulling
 * the latest sessions, check-ins, and assessments and re-running the Azure OpenAI
 * narrative. Used by the "Refresh brief" action.
 */
router.post('/briefs/regenerate/:appointmentId', async (req, res) => {
  try {
    const { regenerateBrief } = require('../services/brief-generator');
    const appointmentId = parseInt(req.params.appointmentId);
    const { briefId, brief } = await regenerateBrief(req.therapist.id, appointmentId);
    res.json({ id: briefId, brief });
  } catch (err) {
    console.error('[briefs/regenerate] error:', err.message);
    sendRouteError(res, err);
  }
});

/**
 * POST /api/ai/briefs/generate/:appointmentId
 * On-demand generate a brief if one doesn't exist yet (e.g. therapist opened a
 * same-day appointment before the scheduler window fired). Idempotent — if a
 * brief already exists it returns that one.
 */
router.post('/briefs/generate/:appointmentId', async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId);
    const { getAsyncDb } = require('../db/asyncDb');
    const db = getAsyncDb();
    const existing = await db.get(
      `SELECT id FROM session_briefs
       WHERE appointment_id = ? AND therapist_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      appointmentId, req.therapist.id
    );
    if (existing) {
      const { getBrief } = require('../services/brief-generator');
      const full = await getBrief(existing.id, req.therapist.id);
      return res.json({ id: full.id, brief: full.brief, generated: false });
    }
    const { generateBrief } = require('../services/brief-generator');
    const { briefId, brief } = await generateBrief(req.therapist.id, appointmentId);
    res.json({ id: briefId, brief, generated: true });
  } catch (err) {
    console.error('[briefs/generate] error:', err.message);
    sendRouteError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Style Adaptation — Miwa learns each clinician's voice from edits
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ai/style/capture
 * Body: { session_id?, source, ai_draft: {...}, final_text: {...} }
 *
 * Captures an AI-draft → therapist-saved pair. One row per changed field.
 * Fires a background profile rebuild when enough new samples exist.
 */
router.post('/style/capture', async (req, res) => {
  try {
    const { session_id, source, ai_draft, final_text } = req.body || {};
    if (!ai_draft || !final_text) {
      return res.status(400).json({ error: 'ai_draft and final_text are required' });
    }
    const { captureSample, maybeRebuildProfile } = require('../services/style-adaptation');
    const captured = await captureSample({
      therapistId: req.therapist.id,
      sessionId: session_id || null,
      source: source || 'manual',
      aiDraft: ai_draft,
      finalText: final_text,
    });
    maybeRebuildProfile(req.therapist.id);
    res.json({ captured });
  } catch (err) {
    // Non-blocking — capture should never fail a save
    console.warn('[style/capture] error:', err.message);
    res.json({ captured: 0, error: 'Style capture failed' });
  }
});

/**
 * GET /api/ai/style/profile
 * Return the therapist's current distilled style profile (or null).
 */
router.get('/style/profile', async (req, res) => {
  try {
    const { getProfile } = require('../services/style-adaptation');
    res.json({ profile: await getProfile(req.therapist.id) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * POST /api/ai/style/rebuild
 * Force a profile rebuild (useful for "Refresh my voice" in settings).
 */
router.post('/style/rebuild', async (req, res) => {
  try {
    const { rebuildProfile } = require('../services/style-adaptation');
    const result = await rebuildProfile(req.therapist.id);
    res.json({ ok: !!result, profile: result });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Clinical Letter / Document Generator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai/letters/templates
 * List the templates available for generation.
 */
router.get('/letters/templates', async (req, res) => {
  try {
    const { listTemplates } = require('../services/document-generator');
    res.json({ templates: listTemplates() });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * POST /api/ai/letters/generate
 * Body: { patient_id, template_id, options }
 * Pulls the chart data, calls Azure OpenAI, stores a draft, returns it.
 */
router.post('/letters/generate', async (req, res) => {
  try {
    const { patient_id, template_id, options } = req.body || {};
    if (!patient_id || !template_id) {
      return res.status(400).json({ error: 'patient_id and template_id are required' });
    }
    const { generateDocument } = require('../services/document-generator');
    const doc = await generateDocument({
      therapistId: req.therapist.id,
      patientId: parseInt(patient_id),
      templateId: template_id,
      options: options || {},
    });
    res.json(doc);
  } catch (err) {
    console.error('[letters/generate] error:', err.message);
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/letters
 * List generated documents for this therapist.
 * Optional ?patient_id=N to scope to a patient.
 */
router.get('/letters', async (req, res) => {
  try {
    const { listDocumentsForTherapist } = require('../services/document-generator');
    const docs = await listDocumentsForTherapist(req.therapist.id, {
      patientId: req.query.patient_id ? parseInt(req.query.patient_id) : undefined,
    });
    res.json({ documents: docs });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/letters/:id
 * Fetch one generated document (owner-only).
 */
router.get('/letters/:id', async (req, res) => {
  try {
    const { getDocument } = require('../services/document-generator');
    const doc = await getDocument(req.therapist.id, parseInt(req.params.id));
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * PUT /api/ai/letters/:id
 * Body: { content?, title?, status? }  — edit the draft, or finalize it.
 */
router.put('/letters/:id', async (req, res) => {
  try {
    const { updateDocument } = require('../services/document-generator');
    const doc = await updateDocument(req.therapist.id, parseInt(req.params.id), req.body || {});
    res.json(doc);
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * DELETE /api/ai/letters/:id
 */
router.delete('/letters/:id', async (req, res) => {
  try {
    const { deleteDocument } = require('../services/document-generator');
    const ok = await deleteDocument(req.therapist.id, parseInt(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Document not found' });
    res.json({ deleted: true });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Active Risk Monitor
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ai/risk-scan
 *
 * Scan session-note text as it's being typed. Returns risks that are present
 * in the text AND not already covered by a recent screener. Non-blocking:
 * the UI shows a nudge; the therapist can keep typing or address the nudge.
 *
 * Body:
 *   {
 *     text: string,              // required — the note text
 *     patient_id?: number,       // enables screener-coverage check
 *     skip_llm?: boolean,        // force fast path, no Haiku confirmation
 *   }
 *
 * Response:
 *   {
 *     status: 'ok'|'error',
 *     risks: [
 *       { id, label, snippet, nudge, covered: false }, ...
 *     ],
 *     scanned_chars: number,
 *     duration_ms: number,
 *   }
 */
router.post('/risk-scan', async (req, res) => {
  try {
    const { text, patient_id, skip_llm } = req.body || {};
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    const { scanNote } = require('../services/risk-monitor');
    const result = await scanNote({
      text,
      patientId: patient_id != null ? parseInt(patient_id) : null,
      therapistId: req.therapist.id,
      skipLLM: !!skip_llm,
    });
    res.json(result);
  } catch (err) {
    console.error('[risk-scan] error:', err.message);
    // Non-blocking: return ok with empty risks rather than erroring the UI.
    res.json({ status: 'error', risks: [], ...safeAIErrorResponse(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Pillar 3: Treatment Plan REST API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai/treatment-plan/:patientId
 * Get treatment plan and goals for a patient
 */
router.get('/treatment-plan/:patientId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patientId = parseInt(req.params.patientId);
    const plan = await db.get(
      "SELECT * FROM treatment_plans WHERE patient_id = ? AND therapist_id = ? AND status = 'active'",
      patientId, req.therapist.id
    );
    if (!plan) return res.json({ plan: null });

    const goals = await db.all('SELECT * FROM treatment_goals WHERE plan_id = ? ORDER BY id', plan.id);
    res.json({
      plan: {
        ...plan,
        goals: goals.map(g => ({
          ...g,
          interventions: JSON.parse(g.interventions_json || '[]'),
          progress_notes: JSON.parse(g.progress_notes_json || '[]'),
        })),
      },
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/outreach-rules
 * Get outreach rules for current therapist
 */
router.get('/outreach-rules', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rules = await db.all('SELECT * FROM outreach_rules WHERE therapist_id = ? ORDER BY created_at', req.therapist.id);
    const enriched = [];
    for (const r of rules) {
      const actions7d = (await db.get(
        "SELECT COUNT(*) as c FROM outreach_log WHERE rule_id = ? AND created_at > datetime('now', '-7 days')",
        r.id
      ))?.c || 0;
      enriched.push({
        ...r,
        config: JSON.parse(r.config_json || '{}'),
        actions_7d: actions7d,
      });
    }
    res.json(enriched);
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * PUT /api/ai/outreach-rules/:id
 * Toggle or update an outreach rule
 */
router.put('/outreach-rules/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rule = await db.get('SELECT * FROM outreach_rules WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    const { enabled, config, label } = req.body;
    if (enabled !== undefined) await db.run('UPDATE outreach_rules SET enabled = ? WHERE id = ?', enabled ? 1 : 0, rule.id);
    if (label) await db.run('UPDATE outreach_rules SET label = ? WHERE id = ?', label, rule.id);
    if (config) {
      const merged = { ...JSON.parse(rule.config_json || '{}'), ...config };
      await db.run('UPDATE outreach_rules SET config_json = ? WHERE id = ?', JSON.stringify(merged), rule.id);
    }
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err);
  }
});

/**
 * GET /api/ai/outreach-log
 * Get recent outreach activity
 */
router.get('/outreach-log', async (req, res) => {
  try {
    const db = getAsyncDb();
    const limit = parseInt(req.query.limit) || 20;
    const log = await db.all(
      `SELECT ol.*, p.display_name as patient_name, p.client_id
       FROM outreach_log ol
       LEFT JOIN patients p ON p.id = ol.patient_id
       WHERE ol.therapist_id = ?
       ORDER BY ol.created_at DESC LIMIT ?`,
      req.therapist.id, limit
    );
    res.json(log);
  } catch (err) {
    sendRouteError(res, err);
  }
});

module.exports = router;
