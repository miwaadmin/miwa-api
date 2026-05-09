const express = require('express');
const { getAsyncDb } = require('../../db/asyncDb');
const { readStoredFile, storedFileExists } = require('../../services/fileStorage');
const { sendRouteError, safePdfDownloadName } = require('./lib/helpers');

const router = express.Router();

router.get('/reports/:id/download', async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get('SELECT * FROM agent_reports WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Report not found' });
    if (!row.pdf_path || !(await storedFileExists(row.pdf_path))) {
      return res.status(404).json({ error: 'PDF file is missing' });
    }
    const downloadName = safePdfDownloadName(row.title);
    if (!row.pdf_path.startsWith('azure-blob://')) {
      return res.download(row.pdf_path, downloadName);
    }
    const pdf = await readStoredFile(row.pdf_path);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return res.send(pdf);
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/reports/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get('SELECT * FROM agent_reports WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Report not found' });
    res.json({
      id: row.id,
      title: row.title,
      audience: row.audience,
      purpose: row.purpose,
      report: row.report_json ? JSON.parse(row.report_json) : null,
      downloadUrl: `/api/agent/reports/${row.id}/download`,
      created_at: row.created_at,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});
module.exports = router;
