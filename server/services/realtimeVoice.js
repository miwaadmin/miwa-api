'use strict';

const { canSendPhiToTextAI, getTextAIProvider } = require('../lib/phiPolicy');

const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2';
const DEFAULT_REALTIME_FALLBACK_MODEL = 'gpt-realtime';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
// whisper-1 is the universally-available transcription model on OpenAI; it's
// the safe-harbor fallback when an account doesn't have access to the
// optimistic transcription model (gpt-realtime-whisper / gpt-4o-transcribe).
const DEFAULT_TRANSCRIPTION_FALLBACK_MODEL = 'whisper-1';
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
    fallbackModel: String(env.OPENAI_REALTIME_FALLBACK_MODEL || DEFAULT_REALTIME_FALLBACK_MODEL).trim(),
    transcriptionModel: String(env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL).trim(),
    transcriptionFallbackModel: String(env.OPENAI_REALTIME_TRANSCRIPTION_FALLBACK_MODEL || DEFAULT_TRANSCRIPTION_FALLBACK_MODEL).trim(),
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
    transcriptionFallbackModel: config.transcriptionFallbackModel,
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

  // Decide whether the error from OpenAI is a model-rejection signal worth
  // retrying with the configured fallback model. OpenAI surfaces this in
  // several different shapes depending on the endpoint:
  //   - error_code = invalid_model | model_not_found | model_not_available
  //   - error_type = model_not_found
  //   - error_code = invalid_offer | invalid_session | invalid_request_error
  //     when the SDP+session payload is rejected because the requested model
  //     isn't available on this account/region (this is what users see when
  //     OPENAI_REALTIME_MODEL=gpt-realtime-2 isn't enabled for their key)
  //   - error_param = "model" or message contains "model" + "not"
  //
  // Without this widened check, a "Live Voice could not connect (invalid_offer)"
  // message permanently blocks Live / Dictate / Translate even though the
  // configured fallback model would work fine.
  const isModelRejection = (err) => {
    const code = String(err?.openai?.error_code || '').toLowerCase();
    const type = String(err?.openai?.error_type || '').toLowerCase();
    const param = String(err?.openai?.error_param || '').toLowerCase();
    const msg = String(err?.openai?.error_message || err?.message || '').toLowerCase();
    if (['invalid_model', 'model_not_found', 'model_not_available',
         'invalid_offer', 'invalid_session', 'invalid_request_error'].includes(code)) return true;
    if (type === 'model_not_found' || type === 'invalid_request_error') return true;
    if (param === 'model') return true;
    if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('not available') || msg.includes('access'))) return true;
    return false;
  };

  const session = sessionForMode({ mode, pageContext }, env);
  let response;
  try {
    response = await callRealtime(session);
  } catch (err) {
    if (!isModelRejection(err)) throw err;

    // Build a fallback session appropriate to the original session type.
    // Realtime sessions retry with config.fallbackModel; transcription
    // sessions retry by overriding the inner transcription.model field with
    // config.transcriptionFallbackModel (whisper-1 by default). Translation
    // mode also rides config.fallbackModel since it uses the realtime API.
    let fallbackSession = null;
    let fallbackLabel = null;
    if (session.type === 'realtime' && config.fallbackModel && config.fallbackModel !== session.model) {
      fallbackSession = sessionForMode({ mode, pageContext, modelOverride: config.fallbackModel }, env);
      fallbackLabel = config.fallbackModel;
    } else if (session.type === 'transcription'
        && config.transcriptionFallbackModel
        && config.transcriptionFallbackModel !== config.transcriptionModel) {
      // Build a transcription session with the fallback transcription model
      // baked into audio.input.transcription.model.
      fallbackSession = {
        type: 'transcription',
        audio: { input: { transcription: { model: config.transcriptionFallbackModel } } },
      };
      fallbackLabel = config.transcriptionFallbackModel;
    }
    if (!fallbackSession) throw err;

    try {
      response = await callRealtime(fallbackSession);
      return {
        answer: response,
        model: fallbackLabel,
        fallbackFrom: session.type === 'realtime' ? session.model : config.transcriptionModel,
        sessionType: fallbackSession.type,
      };
    } catch {
      // Throw the ORIGINAL error so the user sees the underlying cause, not
      // the fallback's secondary error.
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
