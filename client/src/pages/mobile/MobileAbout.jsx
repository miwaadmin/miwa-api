/**
 * MobileAbout — native-feeling mission page.
 *
 * Replaces the full desktop About page's grid hero + 4-column values
 * grid with a clean stack of readable paragraphs and value cards sized
 * for thumb-scrolling.
 */
import { Link, useNavigate } from 'react-router-dom'

const VALUES = [
  { icon: '🔒', title: 'Privacy-first', desc: 'HIPAA-aligned infrastructure, Azure-hosted clinical data, and no clinical data used to train AI models.' },
  { icon: '🧠', title: 'Clinician judgment stays central', desc: 'AI does not practice therapy. Miwa helps you document faster and think more clearly — every output is a starting point, not a final answer.' },
  { icon: '🌱', title: 'Built for where you are', desc: 'Whether you\'re a first-year trainee or a decade-in licensed clinician, Miwa adapts to your role and experience.' },
  { icon: '⚕️', title: 'Clinical reality, not corporate software', desc: 'Shaped by actual therapist workflows: shorthand notes, documentation backlogs, supervision prep the night before.' },
]

export default function MobileAbout() {
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
        <h1 className="text-sm font-semibold text-gray-900">About Miwa</h1>
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6">
        <div
          className="w-12 h-12 rounded-2xl mb-4 flex items-center justify-center text-white font-bold"
          style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
        >
          M
        </div>
        <h2 className="text-3xl font-extrabold text-gray-900 leading-tight tracking-tight">
          A therapist's{' '}
          <span style={{ background: 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            AI copilot.
          </span>
        </h2>
        <p className="text-base text-gray-600 mt-3 leading-relaxed">
          Miwa is a clinical documentation and workflow assistant built specifically for licensed mental health therapists and trainees.
        </p>
      </div>

      {/* Mission */}
      <div className="px-6 pb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2">Why Miwa exists</p>
        <div className="space-y-3 text-[15px] text-gray-700 leading-relaxed">
          <p>
            Mental health clinicians carry enormous documentation burdens. Session notes, case conceptualizations, treatment plans, supervision prep. The paperwork can eclipse the clinical work itself.
          </p>
          <p>
            Clinical AI tools have to handle real client information carefully. That creates responsibility for the product, the clinician, and every vendor in the workflow.
          </p>
          <p>
            Miwa threads this needle. The AI helps you think and write faster. The clinician stays responsible for everything that happens. Your data stays private and is never used to train models.
          </p>
          <p>
            Today, Miwa goes further. It watches your caseload between sessions — flagging when someone deteriorates or a risk concern appears in your notes. It prepares briefs 30 minutes before each appointment so you're never starting cold. It learns your clinical voice, so AI-drafted documentation already sounds like you.
          </p>
          <p className="font-semibold text-gray-900">
            Every output is a draft. Every decision is yours.
          </p>
        </div>
      </div>

      {/* Values */}
      <div className="px-4 pb-8">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3 px-2">What we believe</p>
        <div className="space-y-3">
          {VALUES.map(v => (
            <div key={v.title} className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{v.icon}</span>
                <div>
                  <p className="text-sm font-bold text-gray-900 mb-1">{v.title}</p>
                  <p className="text-[13px] text-gray-600 leading-relaxed">{v.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Position */}
      <div className="px-6 py-6 bg-gray-50 border-y border-gray-100">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3">Our position</p>
        <ul className="space-y-2 text-[14px] text-gray-700 leading-relaxed">
          {[
            'Miwa is a clinical support tool, not an EHR.',
            'Miwa stores clinical records needed to provide the service and protects them in HIPAA-aligned Azure infrastructure.',
            'All AI output must be reviewed by a licensed or supervised clinician.',
            'Miwa does not replace supervision, consultation, or professional judgment.',
            'You own your clinical data. You can export or delete it at any time.',
          ].map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Links */}
      <div className="px-6 py-8 flex flex-col gap-2">
        <Link
          to="/register"
          className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 text-center shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
        >
          Create a Miwa account
        </Link>
        <div className="flex gap-2 justify-center pt-2 text-sm">
          <Link to="/security" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">Security</Link>
          <Link to="/privacy" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">Privacy</Link>
          <Link to="/pricing" className="text-brand-600 active:text-brand-800 font-medium px-3 py-2">Pricing</Link>
        </div>
      </div>
    </div>
  )
}
