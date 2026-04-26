/**
 * Shared markdown renderer for all clinical AI output across Miwa.
 *
 * Used by: SessionNote (AI Analysis, Treatment Plan), PatientDetail,
 * Supervisor, MiwaChat, MobileMiwa, Briefs, Consult, Workspace.
 *
 * Renders a small, safe subset of markdown with clinical-grade styling:
 *   - # / ## / ### / #### headers (colored left borders + uppercase)
 *   - **bold** and *italic*
 *   - - / * / • bullet lists (with accent bullets)
 *   - 1. / 2. numbered lists (with accent numbers)
 *   - ICD-10 codes like F33.1 auto-highlighted as pill badges
 *   - PHQ-9/GAD-7/PCL-5 scores auto-highlighted
 *   - Blank lines become paragraph breaks
 *
 * All output wraps with classes `prose-clinical` defined in index.css.
 * Call as `<div className="prose-clinical" dangerouslySetInnerHTML={{ __html: renderClinical(text) }} />`.
 */

// Escape raw HTML first so user content can't inject script tags
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Group consecutive <li> elements of the same kind into a proper <ul>/<ol>
function groupLists(html) {
  // Unordered lists
  html = html.replace(/(?:<li data-kind="ul">[\s\S]*?<\/li>\s*)+/g, m => {
    const items = m.replace(/data-kind="ul"/g, '')
    return `<ul class="clinical-list clinical-list--bullet">${items}</ul>`
  })
  // Ordered lists
  html = html.replace(/(?:<li data-kind="ol">[\s\S]*?<\/li>\s*)+/g, m => {
    const items = m.replace(/data-kind="ol"/g, '')
    return `<ol class="clinical-list clinical-list--numbered">${items}</ol>`
  })
  return html
}

export function renderClinical(text) {
  if (!text) return ''
  let s = escapeHtml(text)

  // ── Headings (before inline replacements so $1 content is clean) ─────────
  s = s.replace(/^####\s+(.+)$/gm, '<h4 class="clinical-h4">$1</h4>')
  s = s.replace(/^###\s+(.+)$/gm,  '<h3 class="clinical-h3">$1</h3>')
  s = s.replace(/^##\s+(.+)$/gm,   '<h2 class="clinical-h2">$1</h2>')
  s = s.replace(/^#\s+(.+)$/gm,    '<h1 class="clinical-h1">$1</h1>')

  // Numbered section titles like "1. Primary diagnosis" rendered as h3
  // (catches AI output that uses "1.", "2." at line start as section headers,
  //  but only when the line stands alone and looks like a title — under 80 chars,
  //  no trailing punctuation besides colons)
  s = s.replace(/^(\d+)\.\s+([A-Z][^\n.!?]{3,80}:?)$/gm,
    '<h3 class="clinical-h3"><span class="clinical-h3-num">$1.</span> $2</h3>')

  // ── Bullet lists ─────────────────────────────────────────────────────────
  // - item, * item, • item at line start
  s = s.replace(/^\s*[-*•]\s+(.+)$/gm, '<li data-kind="ul">$1</li>')

  // ── Numbered lists (that weren't already caught as headings above) ───────
  s = s.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li data-kind="ol"><span class="clinical-num">$1.</span> $2</li>')

  // Group runs of <li> into <ul>/<ol>
  s = groupLists(s)

  // ── Inline formatting ────────────────────────────────────────────────────
  // Bold: **text**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="clinical-strong">$1</strong>')
  // Italic: *text* (only when not part of ** or bullet)
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g,
    '$1<em class="clinical-em">$2</em>')

  // ── ICD-10-CM codes: F33.1, G47.00, etc. ────────────────────────────────
  s = s.replace(/\b([A-TV-Z]\d{2}(?:\.\d{1,4})?[A-Z]?)\b(?![^<]*<\/code>|[^<]*<\/h[1-6])/g,
    '<code class="clinical-icd">$1</code>')

  // ── Assessment scores: PHQ-9: 18, GAD-7: 12, PCL-5: 45 ─────────────────
  s = s.replace(/\b(PHQ-9|GAD-7|PCL-5|C-SSRS)\b(?:\s*[:=]\s*(\d+))?/g, (_m, name, score) => {
    if (score) return `<span class="clinical-score">${name}: <strong>${score}</strong></span>`
    return `<span class="clinical-score-name">${name}</span>`
  })

  // ── Paragraphs: two or more newlines = paragraph break ──────────────────
  // Wrap remaining loose text into paragraphs, but don't wrap block-level tags
  const blocks = s.split(/\n{2,}/)
  const wrapped = blocks.map(block => {
    const trimmed = block.trim()
    if (!trimmed) return ''
    // If block starts with a block-level tag, leave it as-is
    if (/^<(h[1-6]|ul|ol|pre|blockquote|div)\b/i.test(trimmed)) return trimmed
    // Otherwise, wrap in <p> and convert single \n to <br/>
    return `<p class="clinical-p">${trimmed.replace(/\n/g, '<br/>')}</p>`
  })

  return wrapped.join('\n')
}

// For places that want the content as plain text (copy-to-clipboard, search, etc.)
export function clinicalToPlain(text) {
  if (!text) return ''
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,4}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
