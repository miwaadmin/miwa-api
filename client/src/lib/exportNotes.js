/**
 * Utility for exporting clinical notes to PDF and formatted text
 */

/**
 * Escape HTML special characters (XSS prevention)
 */
function escapeHTML(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Format text content (convert markdown-style formatting to HTML)
 */
function formatText(text) {
  if (!text) return ''
  return text
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .trim()
}

/**
 * Resolve notes from a session object — handles both the nested notes_json
 * format ({SOAP: {...}, BIRP: {...}}) and flat column format ({subjective, objective, ...}).
 * Returns the fields for the given note_format.
 */
function resolveNotes(session) {
  const fmt = session.note_format || 'SOAP'
  let raw = null

  // notes_json may be a string or already-parsed object
  if (session.notes_json) {
    if (typeof session.notes_json === 'string') {
      try { raw = JSON.parse(session.notes_json) } catch { raw = null }
    } else {
      raw = session.notes_json
    }
  }

  // If we have nested format data, extract the right format's fields
  if (raw && raw[fmt]) {
    return raw[fmt]
  }

  // Fallback: flat fields on the raw object
  if (raw && (raw.subjective || raw.objective || raw.assessment || raw.plan || raw.goals)) {
    return raw
  }

  // Fallback: individual session columns
  return {
    subjective: session.subjective || '',
    objective: session.objective || '',
    assessment: session.assessment || '',
    plan: session.plan || '',
    goals: session.goals || '',
    intervention: session.intervention || '',
    response: session.response || '',
    situation: session.situation || '',
    interventions: session.interventions || '',
    risk_safety: session.risk_safety || '',
    functioning_medical_necessity: session.functioning_medical_necessity || '',
    plan_homework: session.plan_homework || '',
  }
}

/**
 * Label maps for each note format
 */
const FORMAT_LABELS = {
  SOAP: [
    { key: 'subjective', label: 'Subjective',  letter: 'S' },
    { key: 'objective',  label: 'Objective',   letter: 'O' },
    { key: 'assessment', label: 'Assessment',  letter: 'A' },
    { key: 'plan',       label: 'Plan',        letter: 'P' },
  ],
  BIRP: [
    { key: 'subjective', label: 'Behavior',     letter: 'B' },
    { key: 'objective',  label: 'Intervention', letter: 'I' },
    { key: 'assessment', label: 'Response',     letter: 'R' },
    { key: 'plan',       label: 'Plan',         letter: 'P' },
  ],
  DAP: [
    { key: 'subjective', label: 'Data',       letter: 'D' },
    { key: 'assessment', label: 'Assessment', letter: 'A' },
    { key: 'plan',       label: 'Plan',       letter: 'P' },
  ],
  GIRP: [
    { key: 'goals',        label: 'Goals',        letter: 'G' },
    { key: 'intervention', label: 'Intervention', letter: 'I' },
    { key: 'response',     label: 'Response',     letter: 'R' },
    { key: 'plan',         label: 'Plan',         letter: 'P' },
  ],
  DMH_SIR: [
    { key: 'situation', label: 'Situation / Presentation', letter: 'S' },
    { key: 'interventions', label: 'Interventions Used', letter: 'I' },
    { key: 'response', label: 'Client Response', letter: 'R' },
    { key: 'risk_safety', label: 'Risk / Safety Update', letter: '!' },
    { key: 'functioning_medical_necessity', label: 'Functioning / Medical Necessity', letter: 'M' },
    { key: 'plan_homework', label: 'Plan / Homework / Next Steps', letter: 'P' },
  ],
  INTAKE: [
    { key: 'subjective', label: 'Subjective', letter: 'S' },
    { key: 'objective',  label: 'Objective',  letter: 'O' },
    { key: 'assessment', label: 'Assessment', letter: 'A' },
    { key: 'plan',       label: 'Plan',       letter: 'P' },
  ],
}

/**
 * Format a session into HTML for export
 */
export function formatSessionForExport(session, patientName, therapistName) {
  if (!session) return ''

  const sessionDate = new Date(session.session_date).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const fmt = session.note_format || 'SOAP'
  const notes = resolveNotes(session)
  const fields = FORMAT_LABELS[fmt] || FORMAT_LABELS.SOAP

  let html = `
    <div class="session-note">
      <div class="session-header">
        <h3 class="session-date">${sessionDate}</h3>
        <div class="session-meta">
          ${session.duration_minutes ? `<span class="meta-pill">${session.duration_minutes} min</span>` : ''}
          <span class="meta-pill format-pill">${fmt}</span>
        </div>
      </div>
  `

  // Formatted sections (active format only — no raw transcript)
  for (const field of fields) {
    const content = notes[field.key]
    if (content && content.trim()) {
      html += `
        <div class="note-section">
          <h4 class="section-label">${field.label}</h4>
          <div class="section-content">${formatText(content)}</div>
        </div>
      `
    }
  }

  // ICD-10 + CPT
  if (session.icd10_codes || session.cpt_code) {
    html += `<div class="codes-row">`
    if (session.icd10_codes) html += `<span class="code-item"><strong>ICD-10:</strong> ${escapeHTML(session.icd10_codes)}</span>`
    if (session.cpt_code)   html += `<span class="code-item"><strong>CPT:</strong> ${escapeHTML(session.cpt_code)}</span>`
    html += `</div>`
  }

  html += `</div>`
  return html
}

/**
 * Generate a complete HTML document for PDF export
 */
export function generateExportHTML(sessions, patientName, therapistName, dateRange = null) {
  const exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const sortedSessions = [...sessions].sort((a, b) =>
    new Date(b.session_date) - new Date(a.session_date)
  )

  const sessionHTML = sortedSessions
    .map(s => formatSessionForExport(s, patientName, therapistName))
    .join('<div class="page-break"></div>')

  const exportDateShort = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Progress Notes — ${escapeHTML(patientName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      line-height: 1.7;
      color: #1a1a2e;
      background: white;
      padding: 40px 48px;
      font-size: 13px;
    }

    .doc-header {
      margin-bottom: 28px;
      padding-bottom: 16px;
      border-bottom: 2px solid #1a1a2e;
    }

    .doc-header h1 {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .doc-header .confidential {
      font-size: 10px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 14px;
    }

    .header-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 40px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .header-grid .label { font-weight: 600; color: #666; }
    .header-grid .value { color: #1a1a2e; }

    .session-note {
      margin-bottom: 32px;
      page-break-inside: avoid;
    }

    .session-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 18px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ddd;
    }

    .session-date {
      font-size: 14px;
      font-weight: 700;
      color: #1a1a2e;
    }

    .session-meta { display: flex; gap: 12px; font-size: 11px; color: #888; }

    .meta-pill {
      font-size: 11px;
      font-weight: 500;
      color: #666;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .format-pill {
      font-weight: 700;
      color: #1a1a2e;
    }

    .note-section {
      margin-bottom: 16px;
      page-break-inside: avoid;
    }

    .section-label {
      font-size: 12px;
      font-weight: 700;
      color: #1a1a2e;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      border-left: 3px solid #1a1a2e;
      padding-left: 8px;
    }

    .section-letter {
      display: inline;
      font-weight: 700;
      color: #1a1a2e;
    }

    .section-content {
      font-size: 13px;
      line-height: 1.8;
      color: #333;
      margin: 0;
      padding-left: 11px;
      text-align: justify;
    }

    .section-content p { margin-bottom: 6px; }

    .codes-row {
      display: flex;
      gap: 24px;
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #eee;
      font-size: 11px;
      color: #666;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .code-item strong { color: #333; }

    .page-break {
      page-break-after: always;
      height: 0;
      margin: 0;
      border: none;
    }

    .footer {
      margin-top: 40px;
      padding-top: 10px;
      border-top: 1px solid #ddd;
      font-size: 9px;
      color: #bbb;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    @media print {
      body { padding: 24px; }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <h1>Progress Notes</h1>
    <p class="confidential">Confidential Clinical Documentation</p>
    <div class="header-grid">
      <div><span class="label">Patient:</span> <span class="value">${escapeHTML(patientName)}</span></div>
      <div><span class="label">Clinician:</span> <span class="value">${escapeHTML(therapistName)}</span></div>
      <div><span class="label">Sessions:</span> <span class="value">${sortedSessions.length}</span></div>
      <div><span class="label">Date:</span> <span class="value">${exportDateShort}</span></div>
    </div>
  </div>
  <div class="sessions-container">
    ${sessionHTML}
  </div>
  <div class="footer">
    Miwa Care &mdash; Confidential clinical record
  </div>
</body>
</html>`
}

/**
 * Export to PDF using html2pdf library (bundled locally)
 */
export async function exportToPDF(htmlContent, filename = 'clinical-notes.pdf') {
  // Dynamic import — bundled by Vite, no CDN needed
  const html2pdf = (await import('html2pdf.js')).default

  const wrapper = document.createElement('div')
  wrapper.innerHTML = htmlContent
  document.body.appendChild(wrapper)

  const options = {
    margin: [8, 8, 12, 8],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { orientation: 'portrait', unit: 'mm', format: 'letter' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  }

  try {
    await html2pdf().set(options).from(wrapper).save()
  } finally {
    setTimeout(() => { try { document.body.removeChild(wrapper) } catch {} }, 500)
  }
}

/**
 * Export as formatted plain text
 */
export function exportAsText(sessions, patientName, therapistName) {
  const exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const sortedSessions = [...sessions].sort((a, b) =>
    new Date(b.session_date) - new Date(a.session_date)
  )

  const line = '\u2500'.repeat(56)
  const doubleLine = '\u2550'.repeat(56)

  let text = ''
  text += `${doubleLine}\n`
  text += `  CLINICAL NOTES EXPORT\n`
  text += `  Confidential Clinical Documentation\n`
  text += `${doubleLine}\n\n`
  text += `  Patient:       ${patientName}\n`
  text += `  Therapist:     ${therapistName}\n`
  text += `  Exported:      ${exportDate}\n`
  text += `  Total Sessions: ${sortedSessions.length}\n\n`
  text += `${doubleLine}\n`

  for (const session of sortedSessions) {
    const sessionDate = new Date(session.session_date).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const fmt = session.note_format || 'SOAP'
    const notes = resolveNotes(session)
    const fields = FORMAT_LABELS[fmt] || FORMAT_LABELS.SOAP

    text += `\n  SESSION: ${sessionDate}\n`
    text += `  Format: ${fmt}`
    if (session.duration_minutes) text += `  |  Duration: ${session.duration_minutes} min`
    text += `\n  ${line}\n`

    // Format fields (active format only — no raw transcript)
    for (const field of fields) {
      const content = notes[field.key]
      if (content && content.trim()) {
        text += `\n  [${field.letter}] ${field.label.toUpperCase()}:\n`
        text += wrapText(content, 52, '    ')
      }
    }

    // Codes
    if (session.icd10_codes) text += `\n  ICD-10: ${session.icd10_codes}`
    if (session.cpt_code) text += `\n  CPT:    ${session.cpt_code}`

    text += `\n\n${doubleLine}\n`
  }

  text += `\n  Generated by Miwa Care\n`
  text += `  This document contains confidential clinical information.\n`

  return text
}

/**
 * Wrap text to a maximum width with proper indentation
 */
function wrapText(text, maxWidth, indent) {
  if (!text) return ''
  const paragraphs = text.split(/\n\n+/)
  let result = ''

  for (const para of paragraphs) {
    const lines = para.split(/\n/)
    for (const rawLine of lines) {
      const words = rawLine.trim().split(/\s+/)
      let currentLine = ''

      for (const word of words) {
        if (!word) continue
        if ((currentLine + ' ' + word).trim().length > maxWidth) {
          if (currentLine.trim()) result += indent + currentLine.trim() + '\n'
          // If word itself exceeds maxWidth, output it as-is (prevent infinite loop)
          if (word.length > maxWidth) {
            result += indent + word + '\n'
            currentLine = ''
            continue
          }
          currentLine = word
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word
        }
      }
      if (currentLine.trim()) {
        result += indent + currentLine.trim() + '\n'
      }
    }
    result += '\n'
  }

  return result
}

/**
 * Trigger a download of text content
 */
export function downloadText(content, filename = 'clinical-notes.txt') {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
