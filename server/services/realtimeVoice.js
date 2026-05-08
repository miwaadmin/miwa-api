'use strict';

const { canSendPhiToTextAI } = require('../lib/phiPolicy');

const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
const DEFAULT_TRANSLATION_MODEL = 'gpt-realtime-2';
const DEFAULT_VOICE = 'marin';

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function realtimeEnabled(env = process.env) {
  return canSendPhiToTextAI(env) && isTruthy(env.OPENAI_REALTIME_PHI_ENABLED);
}

function getRealtimeConfig(env = process.env) {
  return {
    enabled: realtimeEnabled(env),
    model: String(env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL).trim(),
    transcriptionModel: String(env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL).trim(),
    translationModel: String(env.OPENAI_REALTIME_TRANSLATION_MODEL || DEFAULT_TRANSLATION_MODEL).trim(),
    voice: String(env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE).trim(),
  };
}

function pageContextLine(pageContext = {}) {
  const parts = [
    pageContext.label ? `page=${pageContext.label}` : null,
    pageContext.surface ? `surface=${pageContext.surface}` : null,
    pageContext.patientName ? `client=${pageContext.patientName}` : null,
  ].filter(Boolean);
  return parts.length ? `Current Miwa UI context: ${parts.join(', ')}.` : '';
}

function clinicalRealtimeInstructions({ mode = 'conversation', pageContext = {} } = {}) {
  const context = pageContextLine(pageContext);
  const base = [
    'You are Miwa, a HIPAA-focused clinical copilot for therapists.',
    'Use the current Miwa page context to be concise and clinically useful.',
    'Do not claim you created, sent, scheduled, or changed anything unless Miwa confirms through server-side tools.',
    'For clinically risky content, encourage careful assessment, documentation, consultation, and emergency escalation when appropriate.',
    'When the clinician asks for durable actions, summarize the next action and ask for confirmation.',
    context,
  ].filter(Boolean).join(' ');

  if (mode === 'dictation') {
    return [
      base,
      'This is live dictation mode. Focus on accurately capturing the clinician transcript. Do not add facts.',
    ].join(' ');
  }

  if (mode === 'translate') {
    return [
      base,
      'This is clinical translation support mode. Translate faithfully, preserve clinical meaning, and avoid adding advice unless asked.',
    ].join(' ');
  }

  return [
    base,
    'This is live voice mode. Keep spoken responses brief, warm, and action-oriented.',
  ].join(' ');
}

function sessionForMode({ mode = 'conversation', pageContext = {} } = {}, env = process.env) {
  const config = getRealtimeConfig(env);
  const normalizedMode = ['conversation', 'dictation', 'translate'].includes(mode) ? mode : 'conversation';
  const model = normalizedMode === 'translate' ? config.translationModel : config.model;

  if (normalizedMode === 'dictation') {
    return {
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model: config.transcriptionModel,
          },
        },
      },
    };
  }

  return {
    type: 'realtime',
    model,
    instructions: clinicalRealtimeInstructions({ mode: normalizedMode, pageContext }),
    audio: {
      input: {
        transcription: {
          model: config.transcriptionModel,
        },
      },
      output: {
        voice: config.voice,
      },
    },
  };
}

async function createRealtimeClientSecret({ mode = 'conversation', pageContext = {} } = {}, env = process.env, fetchImpl = fetch) {
  const config = getRealtimeConfig(env);
  if (!config.enabled) {
    const err = new Error('Realtime voice is not enabled for the PHI/ZDR lane.');
    err.statusCode = 503;
    err.code = 'REALTIME_VOICE_UNAVAILABLE';
    throw err;
  }

  const apiKey = String(env.OPENAI_PHI_API_KEY || '').trim();
  const session = sessionForMode({ mode, pageContext }, env);
  const response = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error('Could not start Miwa Live Voice.');
    err.statusCode = response.status || 502;
    err.code = 'REALTIME_SESSION_FAILED';
    err.openai = {
      request_id: response.headers?.get?.('x-request-id') || null,
      status: response.status,
      error_type: data?.error?.type || null,
      error_code: data?.error?.code || null,
    };
    throw err;
  }

  return {
    ...data,
    miwa: {
      mode,
      model: session.model || config.transcriptionModel,
      realtimeUrl: `https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model || config.model)}`,
      sessionType: session.type,
    },
  };
}

module.exports = {
  clinicalRealtimeInstructions,
  createRealtimeClientSecret,
  getRealtimeConfig,
  realtimeEnabled,
  sessionForMode,
};
