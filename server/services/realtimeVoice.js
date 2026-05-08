'use strict';

const { canSendPhiToTextAI, getTextAIProvider } = require('../lib/phiPolicy');

// Model IDs per OpenAI's published model catalog
// (https://developers.openai.com/api/docs/models):
//   gpt-realtime-2        — reasoning model for realtime voice (conversation)
//   gpt-realtime-1.5      — prior-gen voice model, used as conversation fallback
//   gpt-realtime-whisper  — streaming transcription
//   gpt-realtime-translate — streaming speech-to-speech translation
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2';
const DEFAULT_REALTIME_FALLBACK_MODEL = 'gpt-realtime';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
const DEFAULT_TRANSLATION_MODEL = 'gpt-realtime-translate';
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
    fallbackModel: String(env.OPENAI_REALTIME_FALLBACK_MODEL || DEFAULT_REALTIME_FALLBACK_MODEL).trim(),
    transcriptionModel: String(env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL).trim(),
    translationModel: String(env.OPENAI_REALTIME_TRANSLATION_MODEL || DEFAULT_TRANSLATION_MODEL).trim(),
    voice: String(env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE).trim(),
  };
}

function getRealtimeStatus(env = process.env) {
  const config = getRealtimeConfig(env);
  return {
    enabled: config.enabled,
    textProvider: getTextAIProvider(env),
    openaiPhiKeyConfigured: Boolean(String(env.OPENAI_PHI_API_KEY || '').trim()),
    openaiPhiZdrEnabled: isTruthy(env.OPENAI_PHI_ZDR_ENABLED),
    hipaaOpenAIBlocked: ['0', 'false', 'no', 'off'].includes(String(env.HIPAA_OPENAI_ENABLED || '').trim().toLowerCase()),
    realtimePhiEnabled: isTruthy(env.OPENAI_REALTIME_PHI_ENABLED),
    model: config.model,
    fallbackModel: config.fallbackModel,
    transcriptionModel: config.transcriptionModel,
    translationModel: config.translationModel,
    voice: config.voice,
  };
}

function safeOpenAIDetails(err, env = process.env, mode = 'conversation') {
  const config = getRealtimeConfig(env);
  return {
    mode,
    status: err?.statusCode || null,
    openaiStatus: err?.openai?.status || null,
    openaiErrorType: err?.openai?.error_type || null,
    openaiErrorCode: err?.openai?.error_code || null,
    openaiErrorParam: err?.openai?.error_param || null,
    openaiErrorMessage: err?.openai?.error_message || null,
    openaiRequestId: err?.openai?.request_id || null,
    model: config.model,
    fallbackModel: config.fallbackModel,
    transcriptionModel: config.transcriptionModel,
    translationModel: config.translationModel,
    voice: config.voice,
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

function sessionForMode({ mode = 'conversation', pageContext = {}, modelOverride = null } = {}, env = process.env) {
  const config = getRealtimeConfig(env);
  const normalizedMode = ['conversation', 'dictation', 'translate'].includes(mode) ? mode : 'conversation';
  const model = modelOverride || (normalizedMode === 'translate' ? config.translationModel : config.model);

  if (normalizedMode === 'dictation') {
    // Transcription-only session: no model at top level, no output_modalities.
    // The model lives on audio.input.transcription.model per the realtime
    // transcription_sessions schema.
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

  // Conversation + translation: realtime session. The new GA realtime API
  // requires `output_modalities` to be set explicitly — leaving it off
  // returns an `invalid_offer` from /v1/realtime/calls because the model
  // can't decide whether to produce audio, text, or both. We default to
  // both so the WebRTC audio track has data AND the data channel still
  // gets transcript events for the on-screen "Live transcript" panel.
  return {
    type: 'realtime',
    model,
    instructions: clinicalRealtimeInstructions({ mode: normalizedMode, pageContext }),
    output_modalities: ['audio', 'text'],
    audio: {
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
      realtimeUrl: 'https://api.openai.com/v1/realtime/calls',
      sessionType: session.type,
    },
  };
}

async function createRealtimeCallAnswer(sdp, { mode = 'conversation', pageContext = {}, safetyIdentifier = null } = {}, env = process.env, fetchImpl = fetch) {
  const config = getRealtimeConfig(env);
  if (!config.enabled) {
    const err = new Error('Realtime voice is not enabled for the PHI/ZDR lane.');
    err.statusCode = 503;
    err.code = 'REALTIME_VOICE_UNAVAILABLE';
    throw err;
  }

  const offer = String(sdp || '').trim();
  if (!offer || !offer.includes('v=0')) {
    const err = new Error('Realtime SDP offer is missing or invalid.');
    err.statusCode = 400;
    err.code = 'REALTIME_SDP_INVALID';
    throw err;
  }

  const apiKey = String(env.OPENAI_PHI_API_KEY || '').trim();
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (safetyIdentifier) headers['OpenAI-Safety-Identifier'] = String(safetyIdentifier);

  const callRealtime = async (session) => {
    const form = new FormData();
    form.set('sdp', offer);
    form.set('session', JSON.stringify(session));

    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers,
        body: form,
      });
    } catch (cause) {
      const err = new Error('Could not reach OpenAI Realtime.');
      err.statusCode = 502;
      err.code = 'REALTIME_OPENAI_NETWORK_ERROR';
      err.openai = {
        request_id: null,
        status: null,
        error_type: cause?.name || 'network_error',
        error_code: 'fetch_failed',
      };
      throw err;
    }

    const answer = await response.text().catch(() => '');
    if (!response.ok) {
      let parsed = {};
      try { parsed = JSON.parse(answer); } catch {}
      const err = new Error('Could not start Miwa Live Voice.');
      err.statusCode = response.status || 502;
      err.code = 'REALTIME_CALL_FAILED';
      err.openai = {
        request_id: response.headers?.get?.('x-request-id') || null,
        status: response.status,
        error_type: parsed?.error?.type || null,
        error_code: parsed?.error?.code || null,
        error_param: parsed?.error?.param || null,
        error_message: parsed?.error?.message || null,
      };
      throw err;
    }

    return answer;
  };

  const session = sessionForMode({ mode, pageContext }, env);
  let response;
  try {
    response = await callRealtime(session);
  } catch (err) {
    // Narrow fallback: only when the model itself is rejected (the account
    // doesn't have access to the configured model on this tier/region).
    // Don't fall back on schema errors like invalid_offer — those mean the
    // session JSON is wrong, and retrying with a different model won't help.
    const modelErrorCodes = new Set(['invalid_model', 'model_not_found', 'model_not_available']);
    const shouldRetryFallback = session.type === 'realtime'
      && config.fallbackModel
      && config.fallbackModel !== session.model
      && (modelErrorCodes.has(err?.openai?.error_code) || err?.openai?.error_type === 'model_not_found');
    if (!shouldRetryFallback) throw err;
    const fallbackSession = sessionForMode({ mode, pageContext, modelOverride: config.fallbackModel }, env);
    try {
      response = await callRealtime(fallbackSession);
      return {
        answer: response,
        model: fallbackSession.model,
        fallbackFrom: session.model,
        sessionType: fallbackSession.type,
      };
    } catch {
      throw err;
    }
  }

  return {
    answer: response,
    model: session.model || config.transcriptionModel,
    sessionType: session.type,
  };
}

module.exports = {
  clinicalRealtimeInstructions,
  createRealtimeCallAnswer,
  createRealtimeClientSecret,
  getRealtimeConfig,
  getRealtimeStatus,
  realtimeEnabled,
  safeOpenAIDetails,
  sessionForMode,
};
