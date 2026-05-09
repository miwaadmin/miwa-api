const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { getAsyncDb } = require('../../../db/asyncDb');
const { MODELS, callAI } = require('../../../lib/aiExecutor');
const { makeStorageKey, uploadLocalFile } = require('../../../services/fileStorage');
const { scrubText } = require('../../../lib/scrubber');
const { safeJsonParse } = require('./helpers');

const REPORTS_DIR = path.join(__dirname, '..', '..', '..', 'generated_reports');

async function buildReviewPayload({ patient, sessions, assessments, reportSpec, therapistId = null }) {
  const safeSessions = sessions.map(s => ({
    session_date: s.session_date,
    note_format: s.note_format,
    subjective: scrubText(s.subjective || ''),
    objective: scrubText(s.objective || ''),
    assessment: scrubText(s.assessment || ''),
    plan: scrubText(s.plan || ''),
    icd10_codes: s.icd10_codes || '',
    ai_feedback: scrubText(s.ai_feedback || ''),
    treatment_plan: scrubText(s.treatment_plan || ''),
  }));

  const safeAssessments = assessments.map(a => ({
    template_type: a.template_type,
    score: a.score,
    severity: a.severity,
    date: (a.created_at || '').slice(0, 10),
    is_improvement: a.is_improvement,
    is_deterioration: a.is_deterioration,
  }));

  const prompt = `You are writing a formal clinical progress review for a therapist-facing system.

Audience/viewer: ${reportSpec.viewer || 'therapist'}
Purpose: ${reportSpec.purpose || 'progress review'}
Focus requested by clinician: ${reportSpec.focus || 'balanced progress summary'}
Timeframe requested: ${reportSpec.timeframe || 'all available sessions'}
Include charts: ${reportSpec.includeCharts ? 'yes' : 'no'}

Return JSON only with this shape:
{
  "title": string,
  "executiveSummary": string,
  "clientContext": string,
  "presentingProblem": string,
  "progressAndThemes": string,
  "interventions": string,
  "currentStatus": string,
  "futurePlan": string,
  "viewerNotes": string,
  "chartCallouts": [string]
}

Rules:
- Use polished clinical language.
- Emphasize where the client started, where they are now, what has been worked on, and what comes next.
- Adapt tone for the stated audience.
- If the viewer is court/insurance/referral/supervision, make the wording formal and defensible.
- If the viewer is trainee, make it educational and concise.
- Do not invent facts.
- Keep it readable as a report that can be exported to PDF.

Patient profile:
${JSON.stringify({
  client_id: patient.client_id,
  age: patient.age,
  age_range: patient.age_range,
  client_type: patient.client_type,
  presenting_concerns: scrubText(patient.presenting_concerns || ''),
  diagnoses: scrubText(patient.diagnoses || ''),
  strengths_protective_factors: scrubText(patient.strengths_protective_factors || ''),
  functional_impairments: scrubText(patient.functional_impairments || ''),
  treatment_goals: scrubText(patient.treatment_goals || ''),
  medical_history: scrubText(patient.medical_history || ''),
  medications: scrubText(patient.medications || ''),
  trauma_history: scrubText(patient.trauma_history || ''),
  family_social_history: scrubText(patient.family_social_history || ''),
  risk_screening: scrubText(patient.risk_screening || ''),
}, null, 2)}

Sessions:
${JSON.stringify(safeSessions.slice(-25), null, 2)}

Assessments:
${JSON.stringify(safeAssessments.slice(-25), null, 2)}`;

  const rawReport = await callAI(
    MODELS.AZURE_MAIN,
    'Return valid JSON only.',
    prompt,
    2000,
    { therapistId, kind: 'progress_report' }
  );
  let report = {};
  try {
    report = safeJsonParse(rawReport);
  } catch {
    report = {};
  }
  report.title = report.title || `${patient.client_id} Progress Review`;
  report.executiveSummary = report.executiveSummary || '';
  report.clientContext = report.clientContext || '';
  report.presentingProblem = report.presentingProblem || '';
  report.progressAndThemes = report.progressAndThemes || '';
  report.interventions = report.interventions || '';
  report.currentStatus = report.currentStatus || '';
  report.futurePlan = report.futurePlan || '';
  report.viewerNotes = report.viewerNotes || '';
  report.chartCallouts = Array.isArray(report.chartCallouts) ? report.chartCallouts : [];
  return report;
}

function getChartData(assessments) {
  return assessments
    .filter(a => a.total_score !== null && a.total_score !== undefined)
    .map(a => ({
      label: (a.administered_at || '').slice(0, 10) || a.template_type,
      score: Number(a.total_score),
      template_type: a.template_type,
    }));
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function createReportPdf({ patient, report, chartData, audience, purpose }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const createdAt = new Date().toLocaleString();
  const pageSize = [612, 792];
  const margin = 44;

  function addPageWithState() {
    const page = pdfDoc.addPage(pageSize);
    const { width, height } = page.getSize();
    return { page, width, height, y: height - margin };
  }

  function drawFooter(page, width, height, pageNumber) {
    page.drawLine({ start: { x: margin, y: 36 }, end: { x: width - margin, y: 36 }, thickness: 1, color: rgb(0.88, 0.89, 0.93) });
    page.drawText(`Miwa · Clinical Progress Review`, { x: margin, y: 22, size: 8.5, font, color: rgb(0.45, 0.45, 0.52) });
    page.drawText(`Page ${pageNumber}`, { x: width - margin - 44, y: 22, size: 8.5, font, color: rgb(0.45, 0.45, 0.52) });
  }

  function ensureSpace(state, needed = 22) {
    if (state.y < margin + needed) {
      drawFooter(state.page, state.width, state.height, state.pageNumber);
      const next = addPageWithState();
      next.pageNumber = state.pageNumber + 1;
      return next;
    }
    return state;
  }

  function writeLine(state, text, options = {}) {
    state = ensureSpace(state, options.size || 11);
    state.page.drawText(text, {
      x: options.x ?? margin,
      y: state.y,
      size: options.size || 10.5,
      font: options.font || font,
      color: options.color || rgb(0.16, 0.16, 0.2),
    });
    state.y -= options.lineGap || Math.max(13, (options.size || 10.5) + 3);
    return state;
  }

  function drawParagraph(state, text, options = {}) {
    const lines = wrapText(text || '(not provided)', options.width || 88);
    for (const line of lines) state = writeLine(state, line, options);
    return state;
  }

  function drawSection(state, title, body) {
    state = writeLine(state, title, { size: 12, font: bold, color: rgb(0.11, 0.11, 0.18), lineGap: 15 });
    state = drawParagraph(state, body, { size: 10.5, color: rgb(0.18, 0.18, 0.23) });
    state.y -= 8;
    return state;
  }

  function drawTag(page, x, y, label, fill, textColor) {
    const width = Math.max(52, label.length * 5.2 + 16);
    page.drawRoundedRectangle({ x, y: y - 12, width, height: 18, color: fill, borderColor: fill, borderWidth: 0, borderRadius: 7 });
    page.drawText(label, { x: x + 8, y: y - 1, size: 8.2, font: bold, color: textColor });
  }

  // Cover page
  let state = addPageWithState();
  state.pageNumber = 1;
  state.page.drawRectangle({ x: 0, y: 0, width: state.width, height: state.height, color: rgb(0.98, 0.99, 1) });
  state.page.drawText('Miwa', { x: margin, y: state.height - 112, size: 18, font: bold, color: rgb(0.32, 0.25, 0.95) });
  state.page.drawText(report.title || `${patient.client_id} Progress Review`, { x: margin, y: state.height - 146, size: 28, font: bold, color: rgb(0.08, 0.09, 0.14) });
  state.page.drawText('Clinical progress review export', { x: margin, y: state.height - 182, size: 13, font, color: rgb(0.35, 0.36, 0.42) });

  const summaryBoxTop = state.height - 240;
  state.page.drawRoundedRectangle({ x: margin, y: summaryBoxTop - 150, width: state.width - margin * 2, height: 150, color: rgb(1, 1, 1), borderColor: rgb(0.88, 0.89, 0.94), borderWidth: 1, borderRadius: 16 });
  state.page.drawText(`Client code: ${patient.client_id}`, { x: margin + 18, y: summaryBoxTop - 22, size: 12, font: bold, color: rgb(0.13, 0.13, 0.18) });
  state.page.drawText(`Audience: ${audience || 'therapist'}`, { x: margin + 18, y: summaryBoxTop - 42, size: 10.5, font, color: rgb(0.22, 0.22, 0.28) });
  state.page.drawText(`Purpose: ${purpose || 'progress review'}`, { x: margin + 18, y: summaryBoxTop - 59, size: 10.5, font, color: rgb(0.22, 0.22, 0.28) });
  state.page.drawText(`Prepared: ${createdAt}`, { x: margin + 18, y: summaryBoxTop - 76, size: 10.5, font, color: rgb(0.22, 0.22, 0.28) });
  state.page.drawText('This export is designed for clinical review, referral, supervision, court, or insurance documentation.', { x: margin + 18, y: summaryBoxTop - 106, size: 9.8, font, color: rgb(0.33, 0.33, 0.38) });
  drawTag(state.page, margin + 18, summaryBoxTop - 128, 'Formal clinical format', rgb(0.92, 0.94, 1), rgb(0.27, 0.24, 0.82));
  drawTag(state.page, margin + 170, summaryBoxTop - 128, 'Exportable PDF', rgb(0.91, 0.98, 0.97), rgb(0.08, 0.52, 0.46));

  drawFooter(state.page, state.width, state.height, state.pageNumber);

  // Narrative pages
  state = addPageWithState();
  state.pageNumber = 2;
  state.page.drawText('Clinical narrative', { x: margin, y: state.height - margin, size: 18, font: bold, color: rgb(0.08, 0.09, 0.14) });
  state.y = state.height - 74;
  state = drawSection(state, 'Executive summary', report.executiveSummary);
  state = drawSection(state, 'Client context', report.clientContext);
  state = drawSection(state, 'Presenting problem', report.presentingProblem);
  state = drawSection(state, 'Progress and themes', report.progressAndThemes);
  state = drawSection(state, 'Interventions', report.interventions);
  state = drawSection(state, 'Current status', report.currentStatus);
  state = drawSection(state, 'Future plan', report.futurePlan);
  state = drawSection(state, 'Viewer notes', report.viewerNotes);
  drawFooter(state.page, state.width, state.height, state.pageNumber);

  // Charts page
  state = addPageWithState();
  state.pageNumber = 3;
  const page = state.page;
  const { width, height } = state;
  page.drawText('Assessment trends', { x: margin, y: height - margin, size: 18, font: bold, color: rgb(0.08, 0.09, 0.14) });
  page.drawText('Assessment scores are shown below when the chart history is available.', { x: margin, y: height - 66, size: 10.2, font, color: rgb(0.33, 0.34, 0.4) });

  const chartX = margin;
  const chartY = 406;
  const chartW = width - margin * 2;
  const chartH = 190;
  page.drawRoundedRectangle({ x: chartX, y: chartY, width: chartW, height: chartH, color: rgb(1, 1, 1), borderColor: rgb(0.86, 0.88, 0.93), borderWidth: 1, borderRadius: 14 });

  if (chartData.length >= 2) {
    const scores = chartData.map(d => Number(d.score));
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = Math.max(1, max - min);
    const points = chartData.map((d, idx) => ({
      x: chartX + 26 + ((chartW - 52) * (idx / Math.max(1, chartData.length - 1))),
      y: chartY + 26 + (((Number(d.score) - min) / span) * (chartH - 52)),
    }));

    page.drawText(`Lowest: ${min}   Highest: ${max}`, { x: chartX + 18, y: chartY + chartH - 22, size: 9.2, font, color: rgb(0.34, 0.34, 0.4) });
    for (let i = 0; i < points.length - 1; i++) {
      page.drawLine({ start: points[i], end: points[i + 1], thickness: 2.2, color: rgb(0.31, 0.39, 0.96) });
    }
    points.forEach((pt, idx) => {
      page.drawCircle({ x: pt.x, y: pt.y, size: 3.9, borderColor: rgb(0.11, 0.72, 0.61), color: rgb(0.11, 0.72, 0.61) });
      const label = String(chartData[idx].label || '').slice(0, 10);
      page.drawText(label, { x: Math.max(chartX + 8, pt.x - 16), y: chartY + 12, size: 7.3, font, color: rgb(0.44, 0.45, 0.5) });
      page.drawText(String(chartData[idx].score), { x: pt.x - 4, y: pt.y + 7, size: 8, font: bold, color: rgb(0.18, 0.18, 0.23) });
    });
  } else {
    page.drawText('Not enough assessment data to build a trend chart.', { x: chartX + 18, y: chartY + 72, size: 11, font, color: rgb(0.25, 0.26, 0.31) });
  }

  const insights = report.chartCallouts?.length ? report.chartCallouts : [];
  page.drawText('Chart callouts', { x: margin, y: 300, size: 13, font: bold, color: rgb(0.11, 0.11, 0.17) });
  let y = 281;
  if (insights.length === 0) {
    page.drawText('No additional callouts were generated for this report.', { x: margin, y, size: 10.5, font, color: rgb(0.25, 0.26, 0.31) });
    y -= 16;
  } else {
    for (const item of insights.slice(0, 6)) {
      const lines = wrapText(item, 92);
      for (const line of lines) {
        page.drawText(`• ${line}`, { x: margin, y, size: 10.2, font, color: rgb(0.2, 0.2, 0.25) });
        y -= 13;
      }
      y -= 4;
    }
  }

  page.drawText('Timeline summary', { x: margin, y: 170, size: 13, font: bold, color: rgb(0.11, 0.11, 0.17) });
  y = 150;
  const timelineRows = chartData.slice(-8).map(row => `${row.label} — ${row.template_type.toUpperCase()} score ${row.score}`);
  if (timelineRows.length === 0) timelineRows.push('No assessment entries available.');
  for (const line of timelineRows) {
    const lines = wrapText(line, 88);
    for (const part of lines) {
      page.drawText(part, { x: margin, y, size: 10, font, color: rgb(0.2, 0.2, 0.25) });
      y -= 13;
    }
    y -= 4;
  }
  drawFooter(page, width, height, state.pageNumber);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function createAndStoreReport({ therapistId, patient, report, chartData, audience, purpose }) {
  const db = getAsyncDb();
  const pdfBuffer = await createReportPdf({ patient, report, chartData, audience, purpose });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  const filePath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filePath, pdfBuffer);
  const storedPath = await uploadLocalFile({
    localPath: filePath,
    key: makeStorageKey({
      therapistId,
      patientId: patient.id,
      originalName: 'miwa-report.pdf',
    }).replace('documents/', 'reports/'),
    contentType: 'application/pdf',
  });

  if (storedPath !== filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  const insert = await db.insert(
    `INSERT INTO agent_reports (therapist_id, patient_id, title, audience, purpose, report_json, pdf_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    therapistId,
    patient.id,
    report.title,
    audience || null,
    purpose || null,
    JSON.stringify({ ...report, chartData }),
    storedPath,
  );

  return {
    reportId: insert.lastInsertRowid,
    filePath: storedPath,
    title: report.title,
  };
}

module.exports = {
  REPORTS_DIR,
  buildReviewPayload,
  getChartData,
  wrapText,
  createReportPdf,
  createAndStoreReport,
};
