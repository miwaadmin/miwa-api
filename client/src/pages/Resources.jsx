import { useState } from 'react'
import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'
import { MiwaLogo } from '../components/Sidebar'
import { RESOURCES } from '../lib/resources'

const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = { background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }

/* ── Curated resource data (shared with dashboard) ─────────────────────── */

/* ── Resource card component ────────────────────────────────────────────── */
function ResourceCard({ item, color }) {
  // Internal routes (start with "/") open in the same tab via same-origin nav.
  // External URLs open in a new tab.
  const isInternal = typeof item.url === 'string' && item.url.startsWith('/')
  return (
    <a
      href={item.url}
      {...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      className="group block bg-white rounded-xl border border-gray-100 p-6 hover:shadow-md hover:border-gray-200 transition-all"
    >
      <div className="flex flex-col gap-4 h-full">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-sm font-semibold px-3 py-1 rounded-full"
              style={{ background: `${color}15`, color }}>
              {item.type}
            </span>
            {item.urgent && (
              <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                24/7
              </span>
            )}
          </div>
          <h4 className="text-xl font-semibold text-gray-900 leading-snug group-hover:text-brand-600 transition-colors">{item.name}</h4>
        </div>

        <p className="text-base text-gray-600 leading-relaxed flex-1">{item.description}</p>

        <div className="flex items-center justify-between pt-2 gap-2">
          <span className="text-sm text-gray-500 truncate">{item.source}</span>
          <svg className="w-5 h-5 text-gray-300 group-hover:text-gray-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
      </div>
    </a>
  )
}

/* ── Category section ──────────────────────────────────────────────────── */
function CategorySection({ category }) {
  const [open, setOpen] = useState(true)

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
          <p className="text-lg font-bold text-gray-900">{category.category}</p>
          <p className="text-sm text-gray-600 mt-1 truncate">{category.description}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm font-semibold px-3 py-1 rounded-full"
            style={{ background: category.bgColor, color: category.color }}>
            {category.items.length}
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
          {/* Crisis resources warning */}
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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function Resources() {
  const totalResources = RESOURCES.reduce((sum, cat) => sum + cat.items.length, 0)

  return (
    <PublicPageShell>
    <div className="bg-white">
      <PublicNav />

      {/* Hero */}
      <div className="px-6 pt-32 pb-16 sm:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Clinical Resources Hub
          </h1>
          <p className="text-xl text-gray-600 mb-3">
            {totalResources} curated evidence-based resources for mental health professionals
          </p>
          <p className="text-base text-gray-500">
            Assessment tools, treatment protocols, crisis hotlines, and professional development materials — all in one place.
          </p>
        </div>
      </div>

      {/* Quick crisis access */}
      <div className="px-6 pb-8">
        <div className="max-w-6xl mx-auto rounded-2xl px-6 py-5 flex items-center gap-6 flex-wrap"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-base font-bold text-red-700">Crisis lines quick access</span>
          </div>
          <div className="flex flex-wrap gap-5">
            {[
              { label: '988 Lifeline', sub: 'Call or text 988', url: 'https://988lifeline.org/' },
              { label: 'Crisis Text Line', sub: 'Text HOME to 741741', url: 'https://www.crisistextline.org/' },
              { label: 'SAMHSA Helpline', sub: '1-800-662-4357', url: 'https://www.samhsa.gov/find-help/national-helpline' },
            ].map(item => (
              <a key={item.label} href={item.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-base font-semibold text-red-700 hover:text-red-900 transition-colors">
                <span>{item.label}</span>
                <span className="text-red-400 font-normal">({item.sub})</span>
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Category sections */}
      <div className="px-6 pb-16">
        <div className="max-w-6xl mx-auto space-y-5">
          {RESOURCES.map(cat => (
            <CategorySection key={cat.id} category={cat} />
          ))}
        </div>
      </div>

      {/* Footer note */}
      <div className="px-6 py-12 border-t border-gray-100">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs text-gray-400 text-center">
            Resources link to official external sources. Miwa does not control third-party content. Verify all clinical materials before use.
          </p>
        </div>
      </div>

      {/* CTA: Login / Sign up */}
      <div className="px-6 py-12 bg-gradient-to-r from-brand-50 to-teal-50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Save resources for quick access
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Sign up for Miwa and bookmark your most-used resources. They'll be saved to your dashboard for instant access.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a href="/register"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #5746ed 0%, #0ac5a2 100%)' }}>
              Get Started Free
            </a>
            <a href="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-gray-700 border border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all">
              Sign In
            </a>
          </div>
        </div>
      </div>
    </div>
    <PublicFooter />
    </PublicPageShell>
  )
}
