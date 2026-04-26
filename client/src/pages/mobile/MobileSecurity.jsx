/**
 * MobileSecurity — native security/compliance page.
 *
 * Mobile version of Security.jsx. Keeps the same factual/legal language
 * (HIPAA posture, PHI scrubbing, no-training contracts) but presents it
 * in a phone-friendly stack with collapsible sections so the reader can
 * navigate by topic without infinite scroll.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const PROTECTIONS = [
  { icon: '📋', title: 'HIPAA-conscious design', desc: 'No ePHI in URLs, request logs scrubbed, clinical retention controls built in.' },
  { icon: '🔒', title: 'Encryption in transit + at rest', desc: 'TLS 1.3 everywhere; sensitive fields encrypted before storage.' },
  { icon: '🔑', title: 'HttpOnly cookie auth', desc: 'Session tokens never exposed to JavaScript — protects against XSS exfiltration.' },
  { icon: '🛡️', title: 'Helmet + CSP + rate limits', desc: 'Hardened HTTP headers, Content-Security-Policy, per-route rate limiting.' },
  { icon: '🔐', title: 'Role-based access', desc: 'Clinicians see only their own clients. Admin dashboard is separately gated.' },
  { icon: '📊', title: 'PHI access audit log', desc: 'Every read of protected data is logged for review and export.' },
]

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left active:bg-gray-50"
      >
        <span className="text-[15px] font-semibold text-gray-900">{title}</span>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 text-[14px] text-gray-700 leading-relaxed space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

export default function MobileSecurity() {
  const navigate = useNavigate()

  return (
    <div
      className="min-h-screen flex flex-col bg-white"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-100 flex items-center gap-3 px-4 h-12">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center active:bg-gray-100"
          aria-label="Back"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-gray-900">Security</h1>
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6" style={{ background: 'linear-gradient(180deg, #0b0a20, #161245)' }}>
        <p className="text-xs font-bold uppercase tracking-widest text-teal-300 mb-2">Security & Compliance</p>
        <h2 className="text-2xl font-extrabold text-white leading-tight">
          HIPAA-conscious architecture,{' '}
          <span style={{ background: 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            honestly described.
          </span>
        </h2>
        <p className="text-[14px] text-white/60 mt-3 leading-relaxed">
          Clinical data deserves real protection, not marketing language. Here's how Miwa is built.
        </p>
      </div>

      {/* Two layers */}
      <div className="px-5 py-6">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3">Two independent layers</p>
        <div className="space-y-3">
          <div className="rounded-2xl p-4 border border-gray-100 bg-white shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-1">Before the model: PHI scrubbing</p>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              Every prompt passes through a scrubber that replaces names, dates of birth, addresses, phone numbers, and other identifiers with placeholders before reaching any AI model. Even if the provider retained the prompt, they would not have the client's identity.
            </p>
          </div>
          <div className="rounded-2xl p-4 border border-gray-100 bg-white shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-1">At the model: contractual no-training</p>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              Miwa routes PHI-capable AI through its Azure OpenAI deployment rather than consumer AI products. The production AI path is centralized so clinical data does not fan out to unapproved model providers.
            </p>
          </div>
        </div>
      </div>

      {/* Protections grid */}
      <div className="px-5 py-6 bg-gray-50 border-y border-gray-100">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3">Additional protections</p>
        <div className="grid grid-cols-1 gap-2.5">
          {PROTECTIONS.map(p => (
            <div key={p.title} className="flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-100">
              <span className="text-xl flex-shrink-0">{p.icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{p.title}</p>
                <p className="text-[12px] text-gray-600 leading-relaxed">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable details */}
      <div className="py-2">
        <Section title="Being honest about what Miwa is" defaultOpen>
          <p>
            <strong>Miwa is built for HIPAA-covered workflows.</strong> Therapists and practices remain responsible for their own HIPAA obligations as covered entities. Miwa is designed to operate as their business associate when a BAA and covered infrastructure are in place.
          </p>
          <p>
            The architecture is designed to make HIPAA-compliant use realistic: PHI scrubbing, vendor BAAs, audit logs, encryption, role-based access, Azure PostgreSQL, and Azure Blob Storage are all part of the protected production path.
          </p>
        </Section>

        <Section title="Data retention & export">
          <p>
            You own your clinical data. You can export any or all of it — patients, sessions, assessments, documents — as JSON at any time from Settings.
          </p>
          <p>
            Patient records are retained according to clinical record-retention rules, typically at least 7 years after the last date of service and longer where required. When a record becomes eligible for deletion, Miwa can remove it from active storage and allow it to age out of rolling backups.
          </p>
        </Section>

        <Section title="Authentication & sessions">
          <p>
            Sessions are managed via HttpOnly cookies — tokens never touch JavaScript, which protects against XSS exfiltration.
          </p>
          <p>
            Password reset and email verification are time-bounded and single-use.
          </p>
        </Section>

        <Section title="Breach notification">
          <p>
            If a security incident were to affect your account or data, Miwa would notify you by email within 72 hours of discovery, with a plain-language explanation of what happened and what (if anything) you need to do.
          </p>
        </Section>

        <Section title="Questions or concerns">
          <p>
            Email <a href="mailto:security@miwa.care" className="text-brand-600 font-semibold underline">security@miwa.care</a> for anything security- or privacy-related. Responsible disclosure welcomed — we'll acknowledge within 1 business day.
          </p>
        </Section>
      </div>

      {/* CTA */}
      <div className="px-6 py-8 flex flex-col gap-2">
        <Link
          to="/register"
          className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 text-center shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
        >
          Create a Miwa account
        </Link>
        <div className="flex gap-2 justify-center pt-2 text-sm">
          <Link to="/privacy" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">Privacy</Link>
          <Link to="/about" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">About</Link>
        </div>
      </div>
    </div>
  )
}
