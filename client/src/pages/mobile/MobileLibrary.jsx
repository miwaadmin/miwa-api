/**
 * MobileLibrary — native Resources / in-app library.
 *
 * Mobile version of DashboardResources.jsx. Flat searchable list of
 * every clinical resource by default, with category chips to filter
 * down. Bookmarks are stored in localStorage (same key as the desktop
 * version) so they persist across views.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { RESOURCES } from '../../lib/resources.jsx'

const BOOKMARK_KEY = 'miwa.resource.bookmarks.v1'

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function saveBookmarks(set) {
  try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set])) } catch {}
}

export default function MobileLibrary() {
  const navigate = useNavigate()
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks())

  const toggleBookmark = (id) => {
    setBookmarks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      saveBookmarks(next)
      return next
    })
  }

  // Flatten all items with their parent category info
  const allItems = useMemo(() => {
    const flat = []
    for (const cat of RESOURCES) {
      for (const it of (cat.items || [])) {
        flat.push({ ...it, _category: cat.category, _color: cat.color, _categoryId: cat.id })
      }
    }
    return flat
  }, [])

  const categories = [
    { id: 'all',       label: `All (${allItems.length})` },
    { id: 'bookmarks', label: `★ Saved (${bookmarks.size})` },
    ...RESOURCES.map(c => ({
      id: c.id,
      label: c.category,
      color: c.color,
      count: (c.items || []).length,
    })),
  ]

  const filtered = useMemo(() => {
    let list = allItems
    if (category === 'bookmarks') list = list.filter(i => bookmarks.has(i.id))
    else if (category !== 'all')  list = list.filter(i => i._categoryId === category)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.type || '').toLowerCase().includes(q) ||
        (i._category || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [allItems, category, search, bookmarks])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Resources</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">Clinical tools, hotlines, and worksheets</p>
        </div>
        <button
          onClick={() => navigate('/m/more')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Search + filter */}
      <div className="bg-white px-4 pt-3 pb-3 border-b border-gray-100">
        <input
          type="search"
          inputMode="search"
          placeholder="Search resources…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-[15px] bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
        />
        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 -mx-1 px-1">
          {categories.map(c => {
            const active = category === c.id
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 active:bg-gray-100'
                }`}
                style={active ? { background: c.color || '#111' } : {}}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {filtered.length === 0 ? (
          <div className="text-center pt-10">
            <p className="text-sm text-gray-500">
              {category === 'bookmarks' ? "You haven't saved any resources yet. Tap ★ on a card to save it." : 'No resources match your search.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => {
              const internal = typeof item.url === 'string' && item.url.startsWith('/')
              const isBookmarked = bookmarks.has(item.id)
              return (
                <div key={item.id} className="rounded-2xl bg-white border border-gray-100 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: `${item._color}15`, color: item._color, border: `1px solid ${item._color}33` }}
                      >
                        {item.type || item._category}
                      </span>
                      {item.urgent && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                          24/7
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleBookmark(item.id)}
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 active:bg-gray-100"
                      aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                    >
                      <svg className="w-4 h-4" fill={isBookmarked ? '#f59e0b' : 'none'} viewBox="0 0 24 24" stroke={isBookmarked ? '#f59e0b' : '#d1d5db'} strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                  </div>

                  <p className="text-[14px] font-semibold text-gray-900 leading-snug mb-1">{item.name}</p>
                  <p className="text-[12px] text-gray-600 leading-relaxed mb-3">{item.description}</p>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                    <p className="text-[11px] text-gray-400 truncate flex-1">{item.source}</p>
                    {internal ? (
                      <button
                        onClick={() => navigate(item.url)}
                        className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg"
                        style={{ background: `${item._color}15`, color: item._color }}
                      >
                        Open
                      </button>
                    ) : (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg"
                        style={{ background: `${item._color}15`, color: item._color }}
                      >
                        Open ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
