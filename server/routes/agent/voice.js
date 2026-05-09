const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const {
  transcribeAudioBuffer,
  generateSpeechBuffer,
  isAIServiceError,
} = require('../../services/aiClient');
const {
  createRealtimeCallAnswer,
  createRealtimeClientSecret,
  getRealtimeConfig,
  getRealtimeStatus,
  safeOpenAIDetails,
} = require('../../services/realtimeVoice');
const { sendRouteError } = require('./lib/helpers');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();

// ── Voice Transcription ────────────────────────────────────────────────────
// POST /api/agent/transcribe
// Accepts a short audio blob from the browser (WebM/OGG), sends to Whisper,
// returns { text }. No PHI scrubbing — the caller (MiwaChat) passes the text
// through the normal sendText → scrubNamesFromMessage pipeline.

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio received.' });
    const mime = req.file.mimetype || '';
    const origName = req.file.originalname || '';
    const ext = mime.includes('webm') ? 'webm'
              : mime.includes('ogg')  ? 'ogg'
              : mime.includes('mp4') || mime.includes('m4a') ? 'mp4'
              : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
              : mime.includes('wav')  ? 'wav'
              : mime.includes('flac') ? 'flac'
              : origName.match(/\.(webm|ogg|mp3|mp4|m4a|wav|flac)$/i)?.[1] || 'mp4'; // mp4 is safest fallback for mobile
    const text = await transcribeAudioBuffer(
      req.file.buffer,
      `recording.${ext}`,
      req.file.mimetype || 'audio/webm',
    );
    if (!text) return res.status(400).json({ error: 'Could not transcribe audio — try speaking more clearly.' });
    res.json({ text });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ── Text-to-Speech ─────────────────────────────────────────────────────────
// POST /api/agent/tts
// Converts Miwa's text response to speech using Azure OpenAI TTS.
// Returns raw audio/mpeg so the browser can play it directly.
// Cost: ~$0.015 per 1K characters (tts-1 model).

router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    // Cap to 4096 chars to avoid runaway costs on huge responses
    const truncated = text.trim().slice(0, 4096);
    const buffer = await generateSpeechBuffer(truncated, {
      voice: 'nova',
      responseFormat: 'mp3',
    });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    if (isAIServiceError(err) && err.ai?.error_code === 'azure_tts_deployment_missing') {
      return res.status(503).json({
        error: 'VOICE_UNAVAILABLE',
        message: 'Miwa voice playback is not configured yet. Text chat still works.',
      });
    }
    sendRouteError(res, err);
  }
});

router.post('/realtime/session', async (req, res) => {
  let mode = 'conversation';
  try {
    const body = req.body || {};
    mode = body.mode || 'conversation';
    const pageContext = body.pageContext || {};
    const secret = await createRealtimeClientSecret({ mode, pageContext });
    res.json(secret);
  } catch (err) {
    if (err.code === 'REALTIME_VOICE_UNAVAILABLE') {
      const config = getRealtimeConfig();
      return res.status(503).json({
        error: 'REALTIME_VOICE_UNAVAILABLE',
        message: 'Miwa Live Voice is not enabled for the PHI/ZDR OpenAI lane yet. Classic dictation and text chat still work.',
        requirements: {
          openaiPhiZdr: true,
          realtimePhiFlag: 'OPENAI_REALTIME_PHI_ENABLED=true',
          model: config.model,
          transcriptionModel: config.transcriptionModel,
        },
      });
    }
    console.error('[agent realtime] session failed', {
      code: err.code,
      statusCode: err.statusCode,
      openai: err.openai || null,
    });
    return res.status(err.statusCode || 502).json({
      error: err.code || 'REALTIME_SESSION_FAILED',
      message: 'Miwa Live Voice could not start. Classic dictation and text chat still work.',
      details: safeOpenAIDetails(err, process.env, mode),
    });
  }
});

router.get('/realtime/status', async (req, res) => {
  res.json(getRealtimeStatus());
});

router.post('/realtime/call', express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }), async (req, res) => {
  const mode = String(req.query.mode || 'conversation');
  try {
    let pageContext = {};
    try {
      pageContext = req.query.pageContext ? JSON.parse(String(req.query.pageContext)) : {};
    } catch {
      pageContext = {};
    }
    const safetyIdentifier = crypto
      .createHash('sha256')
      .update(`miwa-therapist:${req.therapist.id}`)
      .digest('hex');
    const result = await createRealtimeCallAnswer(req.body, { mode, pageContext, safetyIdentifier });
    res.type('application/sdp').send(result.answer);
  } catch (err) {
    if (err.code === 'REALTIME_VOICE_UNAVAILABLE') {
      const config = getRealtimeConfig();
      return res.status(503).json({
        error: 'REALTIME_VOICE_UNAVAILABLE',
        message: 'Miwa Live Voice is not enabled for the PHI/ZDR OpenAI lane yet. Classic dictation and text chat still work.',
        requirements: {
          openaiPhiZdr: true,
          realtimePhiFlag: 'OPENAI_REALTIME_PHI_ENABLED=true',
          model: config.model,
          transcriptionModel: config.transcriptionModel,
        },
      });
    }
    if (err.code === 'REALTIME_SDP_INVALID') {
      return res.status(400).json({
        error: 'REALTIME_SDP_INVALID',
        message: 'Miwa Live Voice could not read the browser voice offer. Please refresh and try again.',
      });
    }
    console.error('[agent realtime] call failed', {
      code: err.code,
      statusCode: err.statusCode,
      openai: err.openai || null,
    });
    return res.status(err.statusCode || 502).json({
      error: err.code || 'REALTIME_CALL_FAILED',
      message: 'Miwa Live Voice could not connect to the realtime service. Classic dictation and text chat still work.',
      details: safeOpenAIDetails(err, process.env, mode),
    });
  }
});
module.exports = router;
