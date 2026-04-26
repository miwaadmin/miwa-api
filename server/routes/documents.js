const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not supported. Allowed: PDF, DOCX, TXT, PNG, JPG, WEBP`));
  },
});

async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  // Images — return null; the file_path is stored so Azure OpenAI can read it via base64
  return null;
}

function isImage(filename) {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filename).toLowerCase());
}

// Verify the patient belongs to the requesting therapist
function ownedPatient(db, patientId, therapistId) {
  return db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
}

// GET /api/patients/:patientId/documents
router.get('/', (req, res) => {
  try {
    const db = getDb();
    if (!ownedPatient(db, req.params.patientId, req.therapist.id)) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    const docs = db.all(
      'SELECT id, original_name, file_type, document_label, document_kind, created_at, file_path FROM documents WHERE patient_id = ? ORDER BY created_at DESC',
      req.params.patientId
    );
    // Add is_image flag, omit extracted_text from list (can be large)
    res.json(docs.map(d => ({ ...d, is_image: isImage(d.original_name) })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/patients/:patientId/documents
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const db = getDb();
    if (!ownedPatient(db, req.params.patientId, req.therapist.id)) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Patient not found' });
    }
    const { document_label, document_kind } = req.body;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = ext.replace('.', '').toUpperCase();

    let extractedText = null;
    try {
      extractedText = await extractText(req.file.path, req.file.originalname);
    } catch (extractErr) {
      console.warn('Text extraction warning:', extractErr.message);
      extractedText = `[Text extraction failed: ${extractErr.message}]`;
    }

    const normalizedKind = document_kind === 'intake_source' ? 'intake_source' : 'record';

    const result = db.insert(
      `INSERT INTO documents (patient_id, therapist_id, original_name, file_type, document_label, document_kind, extracted_text, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.params.patientId,
      req.therapist.id,
      req.file.originalname,
      fileType,
      document_label || null,
      normalizedKind,
      extractedText,
      req.file.path
    );

    res.json({
      id: result.lastInsertRowid,
      original_name: req.file.originalname,
      file_type: fileType,
      document_label: document_label || null,
      document_kind: normalizedKind,
      is_image: isImage(req.file.originalname),
      extracted: extractedText !== null,
    });
  } catch (err) {
    // Clean up file on DB error
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/patients/:patientId/documents/:docId
router.delete('/:docId', (req, res) => {
  try {
    const db = getDb();
    if (!ownedPatient(db, req.params.patientId, req.therapist.id)) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    const doc = db.get(
      'SELECT file_path FROM documents WHERE id = ? AND patient_id = ?',
      req.params.docId, req.params.patientId
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Remove physical file
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }

    db.run('DELETE FROM documents WHERE id = ?', req.params.docId);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/patients/:patientId/documents/:docId/content
// Returns extracted text (or base64 for images) for AI consumption
router.get('/:docId/content', (req, res) => {
  try {
    const db = getDb();
    if (!ownedPatient(db, req.params.patientId, req.therapist.id)) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    const doc = db.get(
      'SELECT * FROM documents WHERE id = ? AND patient_id = ?',
      req.params.docId, req.params.patientId
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (isImage(doc.original_name) && doc.file_path && fs.existsSync(doc.file_path)) {
      const ext = path.extname(doc.original_name).toLowerCase().replace('.', '');
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      const base64 = fs.readFileSync(doc.file_path).toString('base64');
      return res.json({ type: 'image', media_type: mimeMap[ext] || 'image/jpeg', data: base64 });
    }

    res.json({ type: 'text', content: doc.extracted_text || '' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
