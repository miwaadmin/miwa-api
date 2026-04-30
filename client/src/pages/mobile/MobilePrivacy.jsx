/**
 * MobilePrivacy — native privacy policy page.
 *
 * Mobile version of Privacy.jsx. Same underlying legal commitments,
 * organized as an expandable list so a user can scan to the section
 * that matters to them (data collection, AI use, retention, etc.).
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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

export default function MobilePrivacy() {
  const navigate = useNavigate()
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

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
        <h1 className="text-sm font-semibold text-gray-900">Privacy</h1>
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2">Privacy Policy</p>
        <h2 className="text-2xl font-extrabold text-gray-900 leading-tight">
          Your clinical data{' '}
          <span style={{ background: 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            stays yours.
          </span>
        </h2>
        <p className="text-[14px] text-gray-600 mt-3 leading-relaxed">
          Plain-language summary of what Miwa does and doesn't do with your information.
        </p>
        <p className="text-xs text-gray-400 mt-3">Effective as of {today}</p>
      </div>

      {/* Key promises */}
      <div className="px-5 pb-6">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3">The short version</p>
          <ul className="space-y-2 text-[13px] text-gray-700 leading-relaxed">
            {[
              'We do not sell your data. Ever.',
              'Your clinical data is not used to train AI models.',
              'Identifiers are minimized before AI processing when the task does not require them.',
              'You can export or delete your data at any time.',
              'Encrypted in transit (TLS 1.3) and at rest.',
            ].map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Expandable sections */}
      <div className="py-2">
        <Section title="What we collect" defaultOpen>
          <p>
            <strong>Account info:</strong> name, email, credential type, timezone, license number where applicable.
          </p>
          <p>
            <strong>Clinical data you enter:</strong> patients, session notes, assessments, documents you upload. This is what you intentionally create inside Miwa to do your job.
          </p>
          <p>
            <strong>Usage telemetry:</strong> page loads on the public marketing site (via Umami, cookie-less). Authenticated app pages are not tracked.
          </p>
        </Section>

        <Section title="How we use AI models">
          <p>
            Miwa uses Azure OpenAI for note drafting, assessment analysis, transcription-related workflows, and clinical reasoning. PHI-capable AI work is routed through the approved Azure path, and clinical data is not used to train models.
          </p>
          <p>
            When exact identifiers are not needed, Miwa minimizes names, dates of birth, addresses, phone numbers, and other identifiers before AI processing. Some clinical workflows may still require PHI, so minimum-necessary prompting matters.
          </p>
          <p>
            We log the fact that a request was made (for billing + rate limiting) but do not persistently store model prompt content.
          </p>
        </Section>

        <Section title="What we share">
          <p>
            Miwa does not sell, rent, or share your clinical data with third parties for marketing purposes.
          </p>
          <p>
            We share only with service vendors necessary to operate the product: hosting and database services on Microsoft Azure, AI model hosting through Azure OpenAI, email through Google Workspace under BAA, and payments through Stripe. SMS delivery is not active for PHI until a messaging BAA and consent workflow are complete.
          </p>
          <p>
            We will disclose information if legally required (subpoena, court order). When legally permitted, we will notify you first.
          </p>
        </Section>

        <Section title="Retention & deletion">
          <p>
            We retain clinical records while your account is active and according to the therapist's record-retention obligations, typically at least 7 years after the last date of service and longer where law or professional rules require it.
          </p>
          <p>
            Deleted non-clinical account data ages out of rolling backups after the backup retention window. Clinical records may remain locked for the applicable retention period before permanent deletion.
          </p>
          <p>
            You can request full account deletion at any time from Settings or by emailing <a href="mailto:admin@miwa.care" className="text-brand-600 underline">admin@miwa.care</a>.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You have the right to access, export, correct, and delete your data. You also have the right to know who has processed your data.
          </p>
          <p>
            California residents: you have additional rights under CCPA/CPRA. Email <a href="mailto:privacy@miwa.care" className="text-brand-600 underline">privacy@miwa.care</a> to exercise them.
          </p>
        </Section>

        <Section title="Children & minor clients">
          <p>
            Miwa is intended for use by licensed clinicians and trainees, not by children directly. When a clinician documents sessions for a minor client, Miwa treats that record with the same protections as any other clinical record. Parents/guardians should contact the treating clinician for record requests.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            When we change this policy, we'll email every active user with a plain-language summary of what changed and when it takes effect. Material changes take effect 30 days after notice.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Privacy questions: <a href="mailto:privacy@miwa.care" className="text-brand-600 font-semibold underline">privacy@miwa.care</a>
          </p>
          <p>
            Security incidents: <a href="mailto:security@miwa.care" className="text-brand-600 font-semibold underline">security@miwa.care</a>
          </p>
        </Section>
      </div>

      {/* CTA */}
      <div className="px-6 py-8 flex flex-col gap-2">
        <div className="flex gap-2 justify-center pt-2 text-sm">
          <Link to="/security" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">Security</Link>
          <Link to="/about" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">About</Link>
          <Link to="/delete-account" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">Delete account</Link>
        </div>
      </div>
    </div>
  )
}
