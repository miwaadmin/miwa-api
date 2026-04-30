import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

/* Practice dashboard mockup */
function PracticeDashboardMockup() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: '#111113', border: '1px solid rgba(0,0,0,0.15)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#161618', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400/70" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/70" />
          <div className="w-2 h-2 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-white/25 ml-2">Practice Dashboard — Sunrise Therapy Group</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Active Clients', val: '47', color: '#6366f1' },
            { label: 'Clinicians', val: '6', color: '#22c55e' },
            { label: 'Alerts This Week', val: '4', color: '#f59e0b' },
          ].map((s) => (
            <div key={s.label} className="p-2.5 rounded-xl text-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-base font-bold" style={{ color: s.color }}>{s.val}</p>
              <p className="text-[9px] text-white/35 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide">Clinician Status</p>
        {[
          { name: 'Dr. Nguyen', clients: 9, flag: false },
          { name: 'J. Williams, LCSW', clients: 11, flag: true },
          { name: 'M. Torres (Trainee)', clients: 6, flag: false },
        ].map((c, i) => (
          <div key={i} className="flex items-center gap-3 px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-[9px] text-indigo-400 font-bold">{c.name[0]}</div>
            <div className="flex-1">
              <p className="text-[11px] text-white/70 font-medium">{c.name}</p>
              <p className="text-[9px] text-white/30">{c.clients} clients</p>
            </div>
            {c.flag && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">Alert</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ForPractices() {
  return (
    <PublicPageShell>
      <PublicNav />

      {/* Hero — Notion/Figma style */}
      <div className="text-center pt-32 pb-12 px-6 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6 leading-[1.05] tracking-tight">
          One AI assistant.<br />
          <span style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Your whole team.
          </span>
        </h1>
        <p className="text-gray-700 text-xl max-w-2xl mx-auto mb-4 leading-relaxed">
          Miwa for Teams is built from the ground up for how group practices actually work — trainees, associates, supervisors, and directors in one unified view.
        </p>
        <p className="text-gray-500 text-base max-w-xl mx-auto mb-8">
          Every clinician gets their own AI assistant trained on their documentation style. Directors get caseload-wide visibility into clinical quality and outcomes.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold text-indigo-700 mb-6"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
          Coming soon — join the waitlist
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a href="mailto:hello@miwa.care?subject=Miwa%20for%20Teams%20Waitlist" className="px-10 py-4 rounded-xl text-base font-bold text-white transition-all hover:opacity-90" style={{ background: '#111113' }}>
            Join the waitlist
          </a>
          <a href="mailto:hello@miwa.care"
            className="px-10 py-4 rounded-xl text-base font-medium text-gray-600 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            Talk to us →
          </a>
        </div>
      </div>

      {/* BIG mockup */}
      <div className="max-w-[1100px] mx-auto px-6 pb-20">
        <div className="rounded-3xl overflow-hidden shadow-2xl" style={{
          background: 'linear-gradient(180deg, rgba(99,102,241,0.04), rgba(139,92,246,0.04))',
          border: '1px solid rgba(99,102,241,0.15)',
          padding: 'clamp(20px, 3vw, 40px)',
        }}>
          <PracticeDashboardMockup />
        </div>
        <p className="text-center text-gray-500 text-sm mt-5 italic">
          Practice director's dashboard — caseload health across every clinician on the team.
        </p>
      </div>

      {/* Features grid */}
      <div className="max-w-[1200px] mx-auto px-6 py-20" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Built for how practices actually work</h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Not a solo tool with multi-seat licensing bolted on. A product designed for trainees, associates, supervisors, and directors from day one.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { title: 'Per-clinician AI copilot', desc: 'Every clinician gets their own Miwa — trained on their caseload, their tone, their documentation style. Learns their voice over time.', color: '#6366f1' },
            { title: 'Director morning briefing', desc: 'A morning dashboard for practice directors: clinician status, risk flags, new referrals, overdue assessments. Spot issues before they escalate.', color: '#14b8a6' },
            { title: 'Practice-wide letter generator', desc: 'Generate ESA letters, attorney summaries, insurance pre-auths, school 504 support across every clinician — all from the chart.', color: '#ec4899' },
            { title: 'Supervisor review workflow', desc: 'Trainees submit notes for supervisor review. Supervisors annotate, approve, or request revisions — all within Miwa.', color: '#f59e0b' },
            { title: 'Cross-team risk visibility', desc: 'Supervisors see when a trainee\'s session note contains risk language. Director dashboard surfaces practice-wide safety concerns.', color: '#ef4444' },
            { title: 'Quarterly outcome reports', desc: 'Generate practice-level outcome reports, compliance summaries, and aggregate progress reports in one conversation.', color: '#10b981' },
            { title: 'Trainee & associate management', desc: 'Trainees and associates join your practice with full Miwa access. Supervisors get visibility into their caseload management.', color: '#3b82f6' },
            { title: 'Practice-level dashboard', desc: 'Caseload health across your entire practice. Risk flags, overdue assessments, and outcome trends visible to practice directors.', color: '#8b5cf6' },
            { title: 'Dedicated onboarding', desc: 'Team plans include a live onboarding call. We configure Miwa for your workflows, documentation standards, and specialty areas.', color: '#64748b' },
          ].map((f, i) => (
            <div key={i} className="p-5 rounded-2xl bg-white transition-all hover:shadow-md" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${f.color}18` }}>
                <div className="w-4 h-4 rounded-full" style={{ background: f.color }} />
              </div>
              <h3 className="font-bold text-gray-900 mb-1.5 text-base">{f.title}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Enterprise trust signals */}
      <div className="py-16 px-6" style={{ background: 'rgba(0,0,0,0.02)', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="max-w-[1000px] mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">Designed for how practices actually work</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: '🔒', title: 'HIPAA-aligned infrastructure', desc: 'Built around Azure-hosted clinical data, Azure OpenAI PHI-capable AI workflows, and no clinical data used to train AI models.' },
              { icon: '👥', title: 'Role-based access', desc: 'Trainees see their caseload. Supervisors see their supervisees. Directors see the whole practice.' },
              { icon: '📋', title: 'Supervisor review workflow', desc: 'Trainees submit notes for approval. Supervisors annotate, approve, or request revisions inside Miwa.' },
              { icon: '🚀', title: 'Dedicated onboarding', desc: 'Every practice plan includes a live setup call. We configure Miwa to match your documentation standards.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="p-5 rounded-xl bg-white text-center" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold text-gray-900 text-base mb-2">{title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pricing callout */}
      <div className="max-w-[1000px] mx-auto px-6 pb-20">
        <div className="rounded-2xl p-8 text-center bg-gray-900">
          <h3 className="text-2xl font-bold text-white mb-2">Miwa for Teams — Planned Pricing</h3>
          <div className="flex items-end justify-center gap-1 mb-2">
            <span className="text-4xl font-extrabold text-white">$399</span>
            <span className="text-white/45 text-base mb-1.5">/mo base</span>
          </div>
          <p className="text-white/50 text-base mb-1">Includes 3 clinician seats. Additional clinicians: +$39/clinician/mo</p>
          <p className="text-white/40 text-base mb-1">10+ clinicians? Contact us for custom pricing.</p>
          <p className="text-emerald-400 text-base font-medium mb-6">Save 20% with annual billing</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="mailto:hello@miwa.care?subject=Miwa%20for%20Teams%20Waitlist" className="px-8 py-3 rounded-xl text-base font-bold text-gray-900 transition-all hover:opacity-90" style={{ background: '#fff' }}>
              Join the waitlist
            </a>
            <a href="mailto:hello@miwa.care"
              className="px-8 py-3 rounded-xl text-base font-medium text-white/60 hover:text-white transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
              Contact sales for 10+ seats
            </a>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center pb-24 px-6 pt-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Looking for the solo practitioner app?</h2>
        <p className="text-gray-500 text-base mb-6">Miwa is available now for individual therapists — trainees, associates, and licensed practitioners.</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/register" className="px-10 py-4 rounded-xl text-base font-bold text-white transition-all hover:opacity-90" style={{ background: '#111113' }}>
            Start free trial (solo)
          </Link>
          <Link to="/pricing" className="px-10 py-4 rounded-xl text-base font-medium text-gray-600 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            Compare solo plans →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
