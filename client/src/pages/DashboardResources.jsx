import { useMemo, useState, useEffect } from 'react'
import { RESOURCES } from '../lib/resources'

/* ── Debounce hook ─────────────────────────────────────────────────────── */
function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/* ── Prominent horizontal search bar (shared between Resources pages) ──── */
function ResourceSearchBar({ value, onChange, placeholder = 'Search resources...' }) {
  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 110-15 7.5 7.5 0 010 15z" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search resources"
        className="w-full pl-12 pr-12 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 text-base focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/60 placeholder:text-gray-400"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}


/* ── Bookmark button ───────────────────────────────────────────────────── */
function BookmarkBtn({ isBookmarked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark this resource'}
      className="p-1.5 rounded-lg transition-colors"
      style={isBookmarked
        ? { color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }
        : { color: '#d1d5db', background: 'transparent' }
      }
    >
      <svg className="w-4 h-4" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    </button>
  )
}

/* ── Resource card ─────────────────────────────────────────────────────── */
function ResourceCard({ item, color, isBookmarked, onToggleBookmark }) {
  return (
    <div className="group bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md hover:border-gray-200 transition-all flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: `${color}15`, color }}>
              {item.type}
            </span>
            {item.urgent && (
              <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                24/7
              </span>
            )}
          </div>
          <h4 className="text-sm font-semibold text-gray-900 leading-snug">{item.name}</h4>
        </div>
        <BookmarkBtn isBookmarked={isBookmarked} onToggle={() => onToggleBookmark(item.id)} />
      </div>

      <p className="text-xs text-gray-500 leading-relaxed flex-1">{item.description}</p>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[13px] text-gray-400 truncate max-w-[55%]">{item.source}</span>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
          style={{ background: `${color}12`, color }}
        >
          Open
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  )
}

/* ── Category section ──────────────────────────────────────────────────── */
function CategorySection({ category, bookmarks, onToggleBookmark, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-2xl border border-gray-100 overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: category.bgColor, color: category.color, border: `1px solid ${category.borderColor}` }}>
          {category.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{category.category}</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{category.description}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: category.bgColor, color: category.color }}>
            {category.items.length} resources
          </span>
          <svg
            className="w-4 h-4 text-gray-400 transition-transform duration-200"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Items */}
      {open && (
        <div className="px-5 pb-5 pt-1" style={{ borderTop: `1px solid ${category.borderColor}` }}>
          {/* Crisis resources get a warning banner */}
          {category.id === 'crisis-safety' && (
            <div className="mb-4 mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-red-700 font-medium">
                For active safety emergencies, call 911. These resources are for client referral and clinical consultation.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {category.items.map(item => (
              <ResourceCard
                key={item.id}
                item={item}
                color={category.color}
                isBookmarked={bookmarks.includes(item.id)}
                onToggleBookmark={onToggleBookmark}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Bookmarks panel ───────────────────────────────────────────────────── */
function BookmarkedPanel({ bookmarks, onToggleBookmark }) {
  if (bookmarks.length === 0) return null

  const bookmarkedItems = []
  for (const cat of RESOURCES) {
    for (const item of cat.items) {
      if (bookmarks.includes(item.id)) {
        bookmarkedItems.push({ ...item, color: cat.color })
      }
    }
  }

  if (bookmarkedItems.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
        <h3 className="text-sm font-bold text-gray-800">Bookmarked Resources</h3>
        <span className="text-xs text-gray-500 ml-auto">{bookmarkedItems.length} saved</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {bookmarkedItems.map(item => (
          <div key={item.id} className="bg-white rounded-xl border border-amber-100 p-3 flex items-center justify-between gap-2 hover:shadow-sm transition-all">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
              <p className="text-[12px] text-gray-400 truncate">{item.source}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <a href={item.url} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <BookmarkBtn isBookmarked={true} onToggle={() => onToggleBookmark(item.id)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────────────────── */
export default function DashboardResources() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = localStorage.getItem('miwa_bookmarked_resources')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  const toggleBookmark = (id) => {
    setBookmarks(prev => {
      const next = prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
      try { localStorage.setItem('miwa_bookmarked_resources', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Total resource count
  const totalResources = RESOURCES.reduce((sum, cat) => sum + cat.items.length, 0)

  // Flattened items for search
  const allItems = useMemo(() => {
    const items = []
    for (const category of RESOURCES) {
      for (const item of category.items) {
        items.push({ ...item, categoryId: category.id, categoryName: category.category, color: category.color })
      }
    }
    return items
  }, [])

  const normalizedQuery = debouncedQuery.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!normalizedQuery) return []
    return allItems.filter(item => {
      const haystack = [item.name, item.type, item.description, item.source, item.categoryName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return normalizedQuery.split(/\s+/).every(term => haystack.includes(term))
    })
  }, [allItems, normalizedQuery])

  const isSearching = normalizedQuery.length > 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clinical Resources</h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalResources} curated resources across assessment guides, treatment protocols, and crisis services.
            {' '}Bookmark frequently used tools, they persist across sessions.
          </p>
        </div>
        {bookmarks.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            {bookmarks.length} bookmarked
          </span>
        )}
      </div>

      {/* Prominent always-on search bar */}
      <ResourceSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search trauma, housing, PHQ, IPV, child abuse, legal aid..."
      />

      {/* Search results (replace categories when query is active) */}
      {isSearching ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {matches.length} result{matches.length === 1 ? '' : 's'} for "{debouncedQuery.trim()}"
            </p>
            <p className="text-xs text-gray-400">For nuanced searches, ask Miwa and bookmark what you use.</p>
          </div>

          {matches.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-gray-700">No resources found</p>
              <p className="mt-1 text-xs text-gray-500">Try a broader phrase, or ask Miwa to search by client need.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {matches.map(item => (
                <ResourceCard
                  key={item.id}
                  item={item}
                  color={item.color}
                  isBookmarked={bookmarks.includes(item.id)}
                  onToggleBookmark={toggleBookmark}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
      {/* Bookmarks panel (if any) */}
      <BookmarkedPanel bookmarks={bookmarks} onToggleBookmark={toggleBookmark} />

      {/* Quick-access crisis strip */}
      <div className="rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap"
        style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-xs font-bold text-red-700">Crisis lines quick access</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { label: '988 Lifeline', sub: 'Call or text 988', url: 'https://988lifeline.org/' },
            { label: 'Crisis Text Line', sub: 'Text HOME to 741741', url: 'https://www.crisistextline.org/' },
            { label: 'SAMHSA Helpline', sub: '1-800-662-4357', url: 'https://www.samhsa.gov/find-help/national-helpline' },
          ].map(item => (
            <a key={item.label} href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:text-red-900 transition-colors">
              <span>{item.label}</span>
              <span className="text-red-400 font-normal">({item.sub})</span>
              <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      </div>

      {/* Category sections */}
      {RESOURCES.map((cat, i) => (
        <CategorySection
          key={cat.id}
          category={cat}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          defaultOpen={i === 0}
        />
      ))}

      {/* Footer note */}
      <p className="text-xs text-gray-400 text-center pb-4">
        Resources link to official external sources. Miwa does not control third-party content. Verify all clinical materials before use.
      </p>
        </>
      )}
    </div>
  )
}
