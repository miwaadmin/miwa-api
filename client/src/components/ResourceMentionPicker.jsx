import { useEffect, useMemo, useRef, useState } from 'react'
import { RESOURCES } from '../lib/resources'

/**
 * Inline picker that pops up below a textarea when the clinician types
 * "/resource" (followed by an optional query string). Lets them pick a
 * resource from the shared catalog (RESOURCES) and inserts a formatted
 * reference into the note.
 *
 * Insertion format (plain text, exports cleanly to PDF/Word/SOAP-style notes):
 *   Resource shared: PHQ-9 (Pfizer) — https://www.phqscreeners.com/
 *
 * Props:
 *   query   — the text the user has typed AFTER "/resource " (may be empty).
 *   onPick  — called with the selected catalog item.
 *   onClose — called when the user dismisses without picking (Esc / blur).
 */
export default function ResourceMentionPicker({ query, onPick, onClose }) {
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef(null)

  // Flatten the catalog into a single searchable list, retaining the
  // category for grouping in the dropdown UI.
  const allItems = useMemo(() => {
    const items = []
    for (const cat of RESOURCES) {
      for (const it of cat.items || []) {
        items.push({
          ...it,
          _category: cat.category,
          _categoryColor: cat.color,
        })
      }
    }
    return items
  }, [])

  // Filter against the trailing query. Match on name, type, source, category.
  const matches = useMemo(() => {
    const q = (query || '').trim().toLowerCase()
    if (!q) return allItems.slice(0, 30)
    return allItems
      .filter(it => {
        const hay = `${it.name} ${it.type || ''} ${it.source || ''} ${it._category}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 30)
  }, [allItems, query])

  // Reset highlight when matches change so we never point past the end.
  useEffect(() => { setHighlight(0) }, [query])

  // Keyboard navigation. Listening on document so the active <textarea>
  // doesn't swallow arrow keys before we see them.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(h => Math.min(h + 1, Math.max(matches.length - 1, 0)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(h => Math.max(h - 1, 0))
      } else if (e.key === 'Enter') {
        if (matches[highlight]) {
          e.preventDefault()
          onPick(matches[highlight])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [matches, highlight, onPick, onClose])

  // Group matches by category for cleaner scanning.
  const grouped = useMemo(() => {
    const map = new Map()
    matches.forEach((it, idx) => {
      const key = it._category
      if (!map.has(key)) map.set(key, { color: it._categoryColor, items: [] })
      map.get(key).items.push({ ...it, _idx: idx })
    })
    return [...map.entries()] // [ [category, { color, items }], ... ]
  }, [matches])

  return (
    <div
      ref={containerRef}
      className="mt-1.5 rounded-xl border border-indigo-200 bg-white shadow-lg overflow-hidden"
      style={{ maxHeight: 320 }}
    >
      <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-indigo-700">Insert resource</span>
          <span className="text-indigo-500">
            {query ? `"${query}"` : 'type to filter'}
          </span>
        </div>
        <div className="text-[10px] text-indigo-500 font-medium">
          ↑↓ navigate · ↵ insert · esc cancel
        </div>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
        {matches.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-500 italic">
            No resources match "{query}". Try a different keyword (e.g. "PHQ", "trauma", "crisis").
          </div>
        ) : (
          grouped.map(([cat, { color, items }]) => (
            <div key={cat}>
              <div
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide"
                style={{ background: `${color}10`, color }}
              >
                {cat}
              </div>
              {items.map(it => {
                const active = it._idx === highlight
                return (
                  <button
                    key={it.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); onPick(it) }}
                    onMouseEnter={() => setHighlight(it._idx)}
                    className={`w-full text-left px-3 py-2 border-b border-gray-50 last:border-b-0 transition-colors ${
                      active ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">{it.name}</span>
                      {it.type && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: `${color}15`, color }}
                        >
                          {it.type}
                        </span>
                      )}
                    </div>
                    {it.source && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{it.source}</div>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * Format a catalog item into the plain-text snippet that gets inserted
 * into a note. Exports cleanly to PDF/Word/text since it's just a line
 * of prose with the URL spelled out.
 */
export function formatResourceMention(item) {
  const source = item.source ? ` (${item.source})` : ''
  const url = item.url ? ` — ${item.url}` : ''
  return `Resource shared: ${item.name}${source}${url}`
}

/**
 * Detect a /resource trigger at the current caret position. Returns
 *   { triggerStart, query }
 * if the user is currently typing a /resource mention, else null.
 *
 * Trigger rules (matching Slack/Discord conventions):
 *   - The "/resource" must be at the start of the textarea OR preceded
 *     by whitespace (so URLs and paths like "/resources" in body text
 *     don't trip it).
 *   - Typing a newline cancels the mention.
 */
export function detectResourceTrigger(value, caret) {
  if (typeof value !== 'string' || typeof caret !== 'number') return null
  // Look backward from caret for a "/resource" preceded by start-of-string or whitespace.
  const upToCaret = value.slice(0, caret)
  const m = upToCaret.match(/(^|\s)\/resource(?:\s+([^\n]*))?$/i)
  if (!m) return null
  const triggerStart = (m.index ?? 0) + (m[1] ? m[1].length : 0)
  const query = (m[2] || '').trimStart()
  return { triggerStart, query }
}
