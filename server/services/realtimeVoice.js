'use strict';

const { canSendPhiToTextAI, getTextAIProvider } = require('../lib/phiPolicy');

// Model IDs per OpenAI's published model catalog
// (https://developers.openai.com/api/docs/models):
//   gpt-realtime-1.5      — "the best voice model for audio in, audio out"
//                           per the catalog. Pinned as the primary because
//                           gpt-realtime-2 (the new reasoning model) was
//                           consistently 504-timing-out from Azure App
//                           Service's outbound path on production.
//   gpt-realtime-2        — reasoning model for realtime voice. Available
//                           as a fallback in case 1.5 has access issues on
//                           a given account.
//   gpt-realtime-whisper  — streaming transcription
//   gpt-realtime-translate — streaming speech-to-speech translation
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-1.5';
const DEFAULT_REALTIME_FALLBACK_MODEL = 'gpt-realtime-2';
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

  // Conversation + translation: realtime session.
  //
  // We're staying conservatively close to the minimal session shape OpenAI
  // documents in the official Node.js example (developers.openai.com/api/
  // docs/guides/realtime-webrtc):
  //
  //   { type, model, audio: { output: { voice } } }
  //
  // Plus an `instructions` field for our clinical guardrails. We previously
  // also passed output_modalities: ["audio", "text"] based on a guess; that
  // was not in the docs and coincided with prod responses being empty 504s
  // (OpenAI's backend hanging instead of erroring cleanly). Removed.
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

  // Validate the SDP shape WITHOUT mutating it. The previous version did
  // `String(sdp || '').trim()`, which stripped the trailing CRLF that
  // browsers always ship at the end of an SDP offer. OpenAI's realtime
  // service uses Pion (Go) to parse the SDP, and Pion treats "no trailing
  // \r\n on the final attribute" as a parse error — surfaced to us as
  // "failed to unmarshal SDP: EOF". We need to forward the body byte-for-
  // byte, only normalizing the trailing terminator if it's missing
  // entirely (some proxies / body parsers normalize \r\n to \n).
  let offer = String(sdp || '');
  // Strip a UTF-8 BOM if any reverse proxy added one. Preserve all other
  // bytes, including leading whitespace inside the body (rare but possible).
  if (offer.charCodeAt(0) === 0xFEFF) offer = offer.slice(1);
  if (!offer || !offer.includes('v=0')) {
    const err = new Error('Realtime SDP offer is missing or invalid.');
    err.statusCode = 400;
    err.code = 'REALTIME_SDP_INVALID';
    throw err;
  }
  // Ensure SDP ends with a CRLF. If it ends with a bare \n (line endings
  // got normalized somewhere), upgrade to CRLF; if it has no terminator
  // at all, append one. This is what was actually breaking Live Voice in
  // prod — Pion returned "failed to unmarshal SDP: EOF" because the
  // historical .trim() stripped the trailing CRLF.
  if (offer.endsWith('\r\n')) {
    // already correct, leave alone
  } else if (offer.endsWith('\n')) {
    offer = offer.slice(0, -1) + '\r\n';
  } else {
    offer = offer + '\r\n';
  }

  const apiKey = String(env.OPENAI_PHI_API_KEY || '').trim();
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (safetyIdentifier) headers['OpenAI-Safety-Identifier'] = String(safetyIdentifier);

  // OpenAI's /v1/realtime/calls usually answers in a few seconds. If it
  // doesn't, we'd rather fail fast than have Azure App Service's outbound
  // timeout (~30s) synthesize a no-body 504 — that loses the OpenAI
  // request_id and any error metadata, which is what was happening before
  // this change. 20s is generous for a healthy call and short enough to
  // surface a clean error.
  const REALTIME_FETCH_TIMEOUT_MS = Number(env.OPENAI_REALTIME_FETCH_TIMEOUT_MS) || 20000;

  const callRealtime = async (session) => {
    const form = new FormData();
    form.set('sdp', offer);
    form.set('session', JSON.stringify(session));

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REALTIME_FETCH_TIMEOUT_MS) : null;

    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers,
        body: form,
        signal: controller?.signal,
      });
    } catch (cause) {
      const aborted = cause?.name === 'AbortError';
      const err = new Error(aborted ? 'OpenAI Realtime call timed out.' : 'Could not reach OpenAI Realtime.');
      err.statusCode = aborted ? 504 : 502;
      err.code = aborted ? 'REALTIME_OPENAI_TIMEOUT' : 'REALTIME_OPENAI_NETWORK_ERROR';
      err.openai = {
        request_id: null,
        status: null,
        error_type: aborted ? 'timeout' : (cause?.name || 'network_error'),
        error_code: aborted ? 'fetch_aborted' : 'fetch_failed',
        error_param: null,
        error_message: aborted
          ? `Aborted after ${REALTIME_FETCH_TIMEOUT_MS}ms — OpenAI did not respond in time.`
          : (cause?.message || null),
      };
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
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
    // Narrow model fallback: when the model itself is rejected (account
    // doesn't have access on this tier/region) OR when the call fails in
    // a way that suggests the configured model is slow/unprovisioned on
    // this account (504 timeout, gateway timeout, abort). The new GA
    // gpt-realtime-2 has higher cold-start variance than the legacy
    // gpt-realtime, so a 504 from /v1/realtime/calls in prod is most often
    // "this model isn't warm for our account, use the older one." Don't
    // fall back on schema errors (invalid_offer, invalid_session) — those
    // mean the session JSON is wrong and a different model won't help.
    const modelErrorCodes = new Set(['invalid_model', 'model_not_found', 'model_not_available']);
    const timeoutLikeStatuses = new Set([502, 503, 504]);
    const isModelReject = modelErrorCodes.has(err?.openai?.error_code)
      || err?.openai?.error_type === 'model_not_found';
    const isLikelyProvisioningIssue = err?.code === 'REALTIME_OPENAI_TIMEOUT'
      || (err?.statusCode && timeoutLikeStatuses.has(err.statusCode) && !err?.openai?.error_code);
    const shouldRetryFallback = session.type === 'realtime'
      && config.fallbackModel
      && config.fallbackModel !== session.model
      && (isModelReject || isLikelyProvisioningIssue);
    if (!shouldRetryFallback) throw err;
    const fallbackSession = sessionForMode({ mode, pageContext, modelOverride: config.fallbackModel }, env);
    try {
      response = await callRealtime(fallbackSession);
      return {
        answer: response,
        model: fallbackSession.model,
        fallbackFrom: session.model,
        fallbackReason: isModelReject ? 'model_rejected' : 'primary_timeout',
        sessionType: fallbackSession.type,
      };
    } catch {
      // Throw the ORIGINAL error so the user sees the underlying cause, not
      // the fallback's secondary failure.
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
