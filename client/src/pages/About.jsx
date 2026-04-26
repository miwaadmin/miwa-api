import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'
import { useAuth } from '../context/AuthContext'

const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = { background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }

const values = [
  {
    icon: '🔒',
    title: 'Privacy-first architecture',
    desc: 'Miwa is built with HIPAA-conscious design from the ground up. Your clinical data is encrypted, never used to train AI models, and always under your control. Security is not an afterthought — it is the foundation.',
  },
  {
    icon: '🧠',
    title: 'Clinician judgment stays central',
    desc: "AI does not practice therapy. Miwa is a support tool that helps you document faster, think more clearly, and prepare for supervision. Every output is a starting point, not a final answer. That is what we mean by review-first.",
  },
  {
    icon: '🌱',
    title: 'Built for where you are',
    desc: 'Whether you are a first-year trainee or a licensed clinician with a decade of experience, Miwa adapts to your role. We built role-aware support because the needs of a practicum intern and a solo practitioner are genuinely different.',
  },
  {
    icon: '⚕️',
    title: 'Designed with clinical reality in mind',
    desc: 'Miwa was shaped by the actual workflows of therapists: shorthand session notes, documentation backlogs, supervision prep the night before, and the pressure to write well under time constraints.',
  },
]

export default function About() {
  const { therapist } = useAuth()

  return (
    <PublicPageShell>

      <PublicNav />

      {/* Hero */}
      <section className="pt-40 pb-24 px-5 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-base font-bold uppercase tracking-widest mb-5" style={{ color: '#2dd4bf' }}>About Miwa</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-6">
            Built to support the clinician,{' '}
            <span style={GRAD_TEXT}>not replace them</span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed max-w-2xl mx-auto">
            Miwa started from a simple frustration: AI tools for mental health were either too generic, too risky with client data, or designed for administrators instead of clinicians.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="max-w-[1200px] mx-auto px-5 pb-24">
        <div className="md:grid md:grid-cols-2 md:gap-16 items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-5">Why Miwa exists</h2>
            <div className="space-y-4 text-gray-500 leading-relaxed text-base">
              <p>
                Mental health clinicians carry enormous documentation burdens. Session notes, case conceptualizations, treatment plans, supervision prep. The paperwork can eclipse the clinical work itself.
              </p>
              <p>
                At the same time, existing AI tools came with a problem: they expected you to enter real client information. That creates risk for clients, and real legal exposure for clinicians.
              </p>
              <p>
                Miwa was built to thread this needle. The AI helps you think and write faster. The clinician stays responsible for everything that happens. Your data stays private and is never used to train models.
              </p>
              <p>
                The result is a tool that can meaningfully reduce documentation time without putting anyone at risk.
              </p>
              <p>
                Today, Miwa goes further. It watches your caseload between sessions — flagging when someone deteriorates or a risk concern appears in your notes. It prepares briefs 30 minutes before each appointment so you're never starting cold. It learns your clinical voice, so AI-drafted documentation already sounds like you. And it handles multi-step workflows — send assessments to your whole panel, draft ESA letters and attorney summaries, organize supervision prep — all through plain conversation.
              </p>
              <p className="text-gray-700 font-semibold">
                But every output is a draft. Every decision is yours.
              </p>
            </div>
          </div>
          <div className="mt-10 md:mt-0 rounded-2xl p-8 space-y-4 bg-white"
            style={{ border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 4px 24px rgba(96,71,238,0.08)' }}>
            <p className="text-sm font-bold uppercase tracking-widest" style={{ color: '#6047EE' }}>Our position</p>
            {[
              'Miwa is a clinical support tool, not an EHR.',
              'We do not store identifiable client records.',
              'All AI output must be reviewed by a licensed or supervised clinician.',
              'We are not a crisis service or a replacement for supervision.',
              'Your data is yours — never used to train AI models.',
            ].map(item => (
              <div key={item} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: GRAD }}>
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-base text-gray-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-white">
        <div className="max-w-[1400px] mx-auto px-5">
          <div className="text-center mb-12">
            <p className="text-base font-bold uppercase tracking-widest mb-3" style={{ color: '#2dd4bf' }}>Principles</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">What we believe</h2>
            <p className="text-gray-500 text-base max-w-xl mx-auto">The principles behind every design decision we make.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {values.map(({ icon, title, desc }) => (
              <div key={title} className="rounded-2xl p-7 bg-white"
                style={{ border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div className="text-3xl mb-4">{icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-base text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data & Security */}
      <section className="max-w-[1200px] mx-auto px-5 py-24">
        <div className="text-center mb-12">
          <p className="text-base font-bold uppercase tracking-widest mb-3" style={{ color: '#2dd4bf' }}>Security</p>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Data, privacy, and security</h2>
          <p className="text-gray-500 text-base max-w-2xl mx-auto">
            Specific answers to the questions your clients, supervisors, and licensing board might ask.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { q: 'What data do you store?', a: 'Miwa stores client records including clinical codes, assessment scores, and session notes. All data is encrypted in transit and at rest. Your data is never shared or used to train AI models.' },
            { q: 'What is NOT stored?', a: 'Real client names, contact information, insurance details, billing records, and any HIPAA-covered identifiers. These never enter the system.' },
            { q: 'Is client data used to train AI?', a: 'No. Your clinical data is never used to train models, shared with third parties, or sold. It belongs to you and your practice.' },
            { q: 'How is data encrypted?', a: 'All data is encrypted in transit (TLS 1.3) and at rest. Authentication uses HttpOnly cookies and JWTs. API keys are masked and never exposed in responses.' },
            { q: 'Do you offer a BAA?', a: 'Business Associate Agreements are available on Practice and Enterprise plans. Contact us at hello@miwa.care to request one before you start.' },
            { q: 'How long is data retained?', a: 'Your data is retained as long as your account is active. You can export or delete your data at any time. Inactive accounts are purged after 12 months.' },
          ].map(({ q, a }) => (
            <div key={q} className="rounded-2xl p-6 bg-white"
              style={{ border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p className="font-semibold text-gray-900 text-base mb-2">{q}</p>
              <p className="text-gray-500 text-base leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="max-w-3xl mx-auto px-5 py-24 text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Get in touch</h2>
        <p className="text-gray-500 leading-relaxed mb-8 max-w-xl mx-auto">
          Questions about Miwa, the clinical design, or how it fits into your practice? Reach out directly.
        </p>
        <a
          href="mailto:hello@miwa.care"
          className="inline-flex px-8 py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 hover:scale-105"
          style={{ background: GRAD }}
        >
          hello@miwa.care
        </a>
        <p className="text-sm text-gray-400 mt-5">We read every message and respond within 2 business days.</p>
      </section>

      <PublicFooter />

    </PublicPageShell>
  )
}
