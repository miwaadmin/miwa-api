const express = require('express');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { generateAIResponse, isAIServiceError, safeAIErrorResponse } = require('../services/aiClient');

const router = express.Router({ mergeParams: true });

const DEFAULT_MAP = {
  version: 1,
  people: [],
  relationships: [],
  annotations: [],
  events: [],
  viewport: { x: 0, y: 0, scale: 1 },
};

function safeJsonParse(value, fallback) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeMap(value) {
  const map = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    people: Array.isArray(map.people) ? map.people : [],
    relationships: Array.isArray(map.relationships) ? map.relationships : [],
    annotations: Array.isArray(map.annotations) ? map.annotations : [],
    events: Array.isArray(map.events) ? map.events : [],
    viewport: map.viewport && typeof map.viewport === 'object' ? map.viewport : DEFAULT_MAP.viewport,
  };
}

function normalizeTitle(value, patient) {
  const text = String(value || '').trim().slice(0, 140);
  if (text) return text;
  return `${patient.display_name || patient.client_id || 'Client'} family map`;
}

async function getPatient(db, patientId, therapistId) {
  return db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
}

async function getGenogram(db, patientId, therapistId) {
  const row = await db.get(
    'SELECT * FROM genograms WHERE patient_id = ? AND therapist_id = ?',
    patientId,
    therapistId,
  );
  if (!row) return null;
  return {
    ...row,
    map: normalizeMap(safeJsonParse(row.map_json, DEFAULT_MAP)),
    ai_draft: safeJsonParse(row.ai_draft_json, null),
  };
}

function familyText(patient, sessions) {
  const chunks = [
    `Client: ${patient.display_name || patient.client_id || ''}`,
    `Case type: ${patient.case_type || patient.client_type || ''}`,
    `Age/gender: ${[patient.age || patient.age_range, patient.gender].filter(Boolean).join(', ')}`,
    `Presenting concerns: ${patient.presenting_concerns || ''}`,
    `Family/social history: ${patient.family_social_history || ''}`,
    `Mental health history: ${patient.mental_health_history || ''}`,
    `Substance use: ${patient.substance_use || ''}`,
    `Risk screening: ${patient.risk_screening || ''}`,
    `Trauma history: ${patient.trauma_history || ''}`,
    `Notes: ${patient.notes || ''}`,
    ...sessions.map((s, index) => {
      const note = [s.subjective, s.objective, s.assessment, s.plan, s.full_note]
        .filter(Boolean)
        .join('\n')
        .replace(/\s+/g, ' ')
        .slice(0, 1000);
      return `Session ${index + 1} (${s.session_date || s.created_at || ''}): ${note}`;
    }),
  ];
  return chunks.filter((chunk) => chunk.replace(/^[^:]+:\s*/, '').trim()).join('\n');
}

function fallbackDraft(patient) {
  const displayName = patient.display_name || patient.client_id || 'Client';
  const person = {
    id: `person-${Date.now()}`,
    name: displayName,
    role: 'client',
    gender: String(patient.gender || '').toLowerCase().includes('female') ? 'female'
      : String(patient.gender || '').toLowerCase().includes('male') ? 'male'
        : 'unknown',
    birthYear: '',
    age: patient.age || patient.age_range || '',
    x: 420,
    y: 330,
    tags: ['identified-client'],
    notes: patient.presenting_concerns || '',
  };
  return {
    map: { ...DEFAULT_MAP, people: [person] },
    clinicalSummary: 'Started a family map from the client chart. Add family members and relationship lines as the clinical picture develops.',
    insights: [
      'Only chart-level data was available, so Miwa created a starter map centered on the client.',
      patient.family_social_history ? 'Family/social history is present in the chart and may contain useful genogram details.' : 'No structured family/social history was found yet.',
    ],
  };
}

function normalizeAIDraft(raw, patient) {
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== 'object') return fallbackDraft(patient);
  const map = normalizeMap(parsed.map || parsed);
  return {
    map,
    clinicalSummary: String(parsed.clinicalSummary || parsed.summary || '').trim().slice(0, 2000),
    insights: Array.isArray(parsed.insights) ? parsed.insights.map(String).slice(0, 8) : [],
  };
}

router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patientId = parseInt(req.params.patientId, 10);
    const patient = await getPatient(db, patientId, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const genogram = await getGenogram(db, patientId, req.therapist.id);
    if (!genogram) {
      return res.json({
        genogram: null,
        map: DEFAULT_MAP,
        title: normalizeTitle('', patient),
        clinical_summary: '',
        ai_draft: null,
        versions: [],
      });
    }

    const versions = await db.all(
      `SELECT id, title, change_note, created_at
       FROM genogram_versions
       WHERE genogram_id = ? AND therapist_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      genogram.id,
      req.therapist.id,
    );

    res.json({
      genogram: {
        id: genogram.id,
        patient_id: genogram.patient_id,
        therapist_id: genogram.therapist_id,
        title: genogram.title,
        clinical_summary: genogram.clinical_summary || '',
        created_at: genogram.created_at,
        updated_at: genogram.updated_at,
      },
      map: genogram.map,
      title: genogram.title,
      clinical_summary: genogram.clinical_summary || '',
      ai_draft: genogram.ai_draft,
      versions,
    });
  } catch (err) {
    console.error('[genograms/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patientId = parseInt(req.params.patientId, 10);
    const patient = await getPatient(db, patientId, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const map = normalizeMap(req.body?.map);
    const title = normalizeTitle(req.body?.title, patient);
    const clinicalSummary = String(req.body?.clinical_summary || '').trim().slice(0, 4000);
    const changeNote = String(req.body?.change_note || 'Saved family map').trim().slice(0, 240);
    const mapJson = JSON.stringify(map);
    const existing = await getGenogram(db, patientId, req.therapist.id);

    let genogramId;
    if (existing) {
      genogramId = existing.id;
      await db.run(
        `UPDATE genograms
         SET title = ?, map_json = ?, clinical_summary = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND therapist_id = ?`,
        title,
        mapJson,
        clinicalSummary || null,
        genogramId,
        req.therapist.id,
      );
    } else {
      const created = await db.insert(
        `INSERT INTO genograms (patient_id, therapist_id, title, map_json, clinical_summary)
         VALUES (?, ?, ?, ?, ?)`,
        patientId,
        req.therapist.id,
        title,
        mapJson,
        clinicalSummary || null,
      );
      genogramId = created.lastInsertRowid;
    }

    await db.insert(
      `INSERT INTO genogram_versions (genogram_id, patient_id, therapist_id, title, map_json, clinical_summary, change_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      genogramId,
      patientId,
      req.therapist.id,
      title,
      mapJson,
      clinicalSummary || null,
      changeNote,
    );
    await persistIfNeeded();

    res.json({ ok: true, genogram: await getGenogram(db, patientId, req.therapist.id) });
  } catch (err) {
    console.error('[genograms/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/draft', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patientId = parseInt(req.params.patientId, 10);
    const patient = await getPatient(db, patientId, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const sessions = await db.all(
      `SELECT session_date, created_at, subjective, objective, assessment, plan, full_note
       FROM sessions
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY COALESCE(session_date, created_at) DESC
       LIMIT 8`,
      patientId,
      req.therapist.id,
    );

    const source = familyText(patient, sessions);
    let draft = fallbackDraft(patient);

    if (source.length > 120) {
      const prompt = `Build a draft clinical genogram JSON from the chart text below.

Return only valid JSON:
{
  "map": {
    "version": 1,
    "people": [
      {"id":"p1","name":"","role":"client|mother|father|partner|sibling|child|grandparent|other","gender":"female|male|nonbinary|unknown","age":"","birthYear":"","x":420,"y":320,"tags":[""],"notes":""}
    ],
    "relationships": [
      {"id":"r1","from":"p1","to":"p2","type":"parent_child|partner|former_partner|sibling|emotional","quality":"close|distant|conflict|cutoff|fused|abusive|supportive|unknown","label":"","notes":""}
    ],
    "annotations": [{"id":"a1","text":"","x":300,"y":260}],
    "events": [{"id":"e1","year":"","label":"","notes":""}],
    "viewport": {"x":0,"y":0,"scale":1}
  },
  "clinicalSummary": "",
  "insights": []
}

Rules:
- Use only facts supported by the text. Do not invent names, diagnoses, abuse, or trauma.
- Use "unknown" when a person is mentioned but details are missing.
- Put the identified client near x=420 y=330; parents above; children below; partners beside; siblings nearby.
- Relationship quality should stay "unknown" unless clearly supported.
- Keep notes concise and clinically neutral.

Chart text:
${source.slice(0, 18000)}`;

      try {
        const raw = await generateAIResponse([
          { role: 'system', content: 'You produce structured, clinically cautious genogram drafts for therapists. Return JSON only.' },
          { role: 'user', content: prompt },
        ], { maxTokens: 2500, jsonMode: true });
        draft = normalizeAIDraft(raw, patient);
      } catch (err) {
        if (!isAIServiceError(err)) throw err;
        draft = fallbackDraft(patient);
        draft.insights = [
          ...draft.insights,
          'The AI service was unavailable, so Miwa created a safe starter map instead.',
        ];
      }
    }

    const existing = await getGenogram(db, patientId, req.therapist.id);
    if (existing) {
      await db.run(
        'UPDATE genograms SET ai_draft_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND therapist_id = ?',
        JSON.stringify(draft),
        existing.id,
        req.therapist.id,
      );
    }
    await persistIfNeeded();
    res.json({ ok: true, draft });
  } catch (err) {
    console.error('[genograms/draft]', err);
    if (isAIServiceError(err)) return res.status(502).json(safeAIErrorResponse(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
