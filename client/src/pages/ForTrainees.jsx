import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

/* Mini mockup showing supervision note */
function SupervisionMockup() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: '#111113', border: '1px solid rgba(0,0,0,0.15)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#161618', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400/70" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/70" />
          <div className="w-2 h-2 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-white/25 ml-2">Supervision Prep — CM-1055</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wide">Case Conceptualization</p>
          <p className="text-sm text-white/55 leading-relaxed">Client presents with PTSD following workplace trauma. Avoidance behaviors have decreased over 6 sessions of CPT. PHQ-9 trend: 18 → 12 → 9 (significant improvement).</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wide">Supervisor Questions</p>
          {['How to address upcoming anniversary trigger?', 'When to introduce stuck points work?'].map((q, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="w-1 h-1 rounded-full bg-emerald-400/50 mt-1.5 flex-shrink-0" />
              <p className="text-[11px] text-white/50">{q}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <MiwaLogo size={12} />
          <p className="text-[10px] text-emerald-400/80">Generated from session notes · Ready for supervision</p>
        </div>
      </div>
    </div>
  )
}

export default function ForTrainees() {
  return (
    <PublicPageShell>
      <PublicNav />

      {/* Hero — Notion/Figma style centered */}
      <div className="text-center pt-32 pb-12 px-6 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6 leading-[1.05] tracking-tight">
          The full AI copilot.<br />
          <span style={{ background: 'linear-gradient(135deg, #059669, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Pre-licensed pricing.
          </span>
        </h1>
        <p className="text-gray-700 text-xl max-w-2xl mx-auto mb-4 leading-relaxed">
          Whether you're a practicum intern, MFT trainee, AMFT, ACSW, or APCC — Miwa gives you the same AI assistant as fully licensed practitioners. Not a limited version. The full thing.
        </p>
        <p className="text-gray-500 text-base max-w-xl mx-auto mb-8">
          $39/mo for trainees and associates, with the clinical AI workspace priced for people still accruing hours.
        </p>
        <Link to="/register"
          className="inline-flex px-10 py-4 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
          style={{ background: '#111113' }}>
          Create free account, no credit card
        </Link>
      </div>

      {/* BIG hero mockup */}
      <div className="max-w-[1100px] mx-auto px-6 pb-20">
        <div className="rounded-3xl overflow-hidden shadow-2xl" style={{
          background: 'linear-gradient(180deg, rgba(16,185,129,0.04), rgba(45,212,191,0.04))',
          border: '1px solid rgba(16,185,129,0.15)',
          padding: 'clamp(20px, 3vw, 40px)',
        }}>
          <SupervisionMockup />
        </div>
        <p className="text-center text-gray-500 text-sm mt-5 italic">
          A structured case presentation for supervision — generated from your session notes in seconds.
        </p>
      </div>

      {/* Features — full-width grid */}
      <div className="max-w-[1200px] mx-auto px-6 py-16" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            The full AI copilot — not a stripped-down version.
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Every feature your supervisor would want you to have. Every safety net that protects your training. Every time-saver that lets you focus on learning the craft.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { title: 'Miwa copilot (full access)', desc: 'The exact same AI assistant used by licensed practitioners. No feature restrictions at the trainee tier.' },
            { title: 'Pre-session briefs', desc: 'A 60-second narrative ready 30 minutes before every session — where you left off, their mid-week check-ins, assessment shifts, two threads worth picking up.' },
            { title: 'Active risk monitor', desc: 'As you type session notes, Miwa flags SI/HI/self-harm/abuse language and nudges you to document the right screen (C-SSRS, Tarasoff). Your supervisor will know you caught it.' },
            { title: 'Morning briefing', desc: 'Every morning: which clients improved, who\'s overdue for an assessment, who needs a safety check-in. Sorted by clinical urgency.' },
            { title: 'Voice → clinical notes', desc: 'Dictate a recap. Miwa drafts SOAP, BIRP, DAP simultaneously with ICD-10 suggestions. You review and sign.' },
            { title: 'Learns your voice', desc: 'Every edit you make teaches Miwa your style. By the time you\'re licensed, drafts already sound like you.' },
            { title: 'Letter generator', desc: 'ESA letters, 504 accommodation requests, return-to-work — drafted from the chart. Review and sign.' },
            { title: 'Assessment delivery', desc: 'PHQ-9, GAD-7, PCL-5, and C-SSRS through secure links. Scores appear instantly with trend tracking. SMS is coming after BAA and consent controls are complete.' },
            { title: 'Living treatment plans', desc: 'Plans that update as sessions progress — goals, objectives, and auto-progress tracking.' },
            { title: 'Proactive alerts', desc: 'Deterioration detection, risk review flags, overdue assessment alerts between sessions.' },
            { title: 'Supervision documentation', desc: 'Structured case presentations, supervision notes, and progress summaries tailored for your supervisor.' },
            { title: 'Session attendance tracking', desc: 'Check-in, late arrival, no-show, and cancellation tracking for every session.' },
          ].map((f, i) => (
            <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex-shrink-0 mt-0.5 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-gray-900 font-semibold text-base mb-0.5">{f.title}</p>
                <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Why free */}
      <div className="py-20 px-6" style={{ background: 'rgba(0,0,0,0.02)', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="max-w-[1000px] mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Why does Miwa offer pre-licensed pricing when nobody else does?</h2>
          <p className="text-gray-500 leading-relaxed mb-6">
            Interns and associates build the foundation of their clinical identity during training. We want that foundation built with the best tools available — not the ones you could afford on a trainee salary.
            SimplePractice starts at $49/mo without AI notes. TherapyNotes starts at $69/mo without AI notes. With those platforms, adding AI notes means paying $84/mo or $109/mo. Miwa gives you the full AI copilot — AI notes, pre-session briefs, treatment plan tracking, proactive alerts, and more — for $39/mo.
          </p>
          <p className="text-gray-400 text-base">
            $39/mo (or $31/mo billed annually). Full agentic copilot, no feature restrictions. When you get fully licensed, you can choose to upgrade to Licensed Therapist — or stay as long as you need.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center pb-24 px-6">
        <Link to="/register"
          className="inline-flex px-12 py-4 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
          style={{ background: '#111113' }}>
          Get started free
        </Link>
        <p className="text-gray-400 text-base mt-4">14-day free trial. $39/mo after. Full agentic copilot, no feature restrictions.</p>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
