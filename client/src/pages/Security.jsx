import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'
const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = { background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }

/* ── Sticky Nav ─────────────────────────────────────────────────────────── */
function Nav() {
  return (
    <nav
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-3"
      style={{ background: 'rgba(9,9,11,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
    >
      <Link to="/" className="flex items-center gap-2.5">
        <MiwaLogo size={32} />
        <span className="text-base font-bold text-white tracking-tight">Miwa</span>
      </Link>
      <div className="hidden md:flex items-center gap-6 text-sm text-white/55">
        <Link to="/features" className="hover:text-white transition-colors">Features</Link>
        <Link to="/for-trainees" className="hover:text-white transition-colors">For Trainees</Link>
        <Link to="/for-practices" className="hover:text-white transition-colors">For Practices</Link>
        <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
      </div>
      <div className="flex items-center gap-3">
        <Link to="/login" className="text-sm text-white/60 hover:text-white transition-colors">Sign In</Link>
        <Link to="/register" className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90"
          style={{ background: GRAD }}>
          Start Free
        </Link>
      </div>
    </nav>
  )
}

/* ── Scrubber Demo ──────────────────────────────────────────────────────── */
function ScrubberDemo() {
  return (
    <div className="rounded-2xl overflow-hidden text-left" style={{ background: '#0a0818', border: '1px solid rgba(96,71,238,0.2)' }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ background: '#0f0c22', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
        </div>
        <span className="text-xs text-white/25 ml-2">Miwa PHI Scrubber — live preview</span>
      </div>
      <div className="p-5 space-y-4">
        {/* Before */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-red-400/70 mb-2">① What you type</p>
          <div className="rounded-xl px-4 py-3 text-sm leading-relaxed text-white/60"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
            "Jordan M. presented with elevated anxiety. DOB 03/14/1991. Spoke with her psychiatrist Dr. Sarah Chen at 555-204-8811."
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(45,212,191,0.3))' }} />
          <div className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: 'rgba(45,212,191,0.1)', color: TEAL, border: '1px solid rgba(45,212,191,0.2)' }}>
            ⚡ Miwa scrubs PHI before sending to any model
          </div>
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(45,212,191,0.3), transparent)' }} />
        </div>

        {/* After */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: TEAL + 'aa' }}>② What the AI model sees</p>
          <div className="rounded-xl px-4 py-3 text-sm leading-relaxed"
            style={{ background: 'rgba(45,212,191,0.05)', border: '1px solid rgba(45,212,191,0.15)' }}>
            <span className="text-white/55">"</span>
            <span className="text-white/55">[CLIENT_A] presented with elevated anxiety. DOB </span>
            <span className="font-bold px-1 py-0.5 rounded text-xs" style={{ background: 'rgba(96,71,238,0.2)', color: PURPLE }}>■ ■ /■ ■ /■ ■ ■ ■</span>
            <span className="text-white/55">. Spoke with </span>
            <span className="font-bold px-1 py-0.5 rounded text-xs" style={{ background: 'rgba(96,71,238,0.2)', color: PURPLE }}>her psychiatrist</span>
            <span className="text-white/55"> </span>
            <span className="font-bold px-1 py-0.5 rounded text-xs" style={{ background: 'rgba(96,71,238,0.2)', color: PURPLE }}>[PROVIDER_1]</span>
            <span className="text-white/55"> at </span>
            <span className="font-bold px-1 py-0.5 rounded text-xs" style={{ background: 'rgba(96,71,238,0.2)', color: PURPLE }}>■ ■ ■ -■ ■ ■ -■ ■ ■ ■</span>
            <span className="text-white/55">."</span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 pt-1">
          {['Client name → [CLIENT_A]', 'Date of birth → redacted', 'Provider name → [PROVIDER_1]', 'Phone number → redacted'].map(tag => (
            <span key={tag} className="text-[10px] px-2.5 py-1 rounded-full font-medium"
              style={{ background: 'rgba(96,71,238,0.12)', color: PURPLE, border: '1px solid rgba(96,71,238,0.2)' }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ──────────────────────────────────────────────────────────── */
export default function Security() {
  return (
    <PublicPageShell>
      <Nav />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="pt-28 pb-20 px-6 text-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #07051a 0%, #0e0b2e 60%, #07051a 100%)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(96,71,238,0.18) 0%, transparent 70%)',
        }} />
        <div className="relative max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full mb-6"
            style={{ background: 'rgba(45,212,191,0.1)', color: TEAL, border: '1px solid rgba(45,212,191,0.2)' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            HIPAA-Conscious Architecture
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white mb-6 leading-tight" style={{ textWrap: 'balance' }}>
            Your clients' data stays{' '}
            <span style={GRAD_TEXT}>your clients' data</span>
          </h1>
          <p className="text-lg md:text-xl text-white/55 max-w-2xl mx-auto leading-relaxed">
            Miwa is built around minimum-necessary clinical data use: protect records in Azure, route PHI-capable AI through Azure OpenAI, and avoid sending more identifying detail than the task requires.
          </p>
        </div>
      </section>

      {/* ── Layer 1: PHI Scrubbing ──────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: '#07051a' }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-5"
                style={{ background: 'rgba(96,71,238,0.12)', color: PURPLE, border: '1px solid rgba(96,71,238,0.2)' }}>
                Layer 1 — PHI Scrubbing
              </span>
              <h2 className="text-3xl font-extrabold text-white mb-5 leading-tight">
                Names, dates, and identifiers are minimized before AI processing
              </h2>
              <p className="text-white/50 leading-relaxed mb-5">
                Miwa's privacy layer detects common identifiers such as patient names, dates of birth, phone numbers, addresses, and case numbers. When a task does not need the exact identifier, Miwa replaces it with clinical placeholders like <code className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(96,71,238,0.15)', color: PURPLE }}>[CLIENT_A]</code> before AI processing.
              </p>
              <p className="text-white/50 leading-relaxed mb-6">
                Some clinical workflows may still require PHI, such as summarizing a named chart or transcribing a session. Those PHI-capable workflows are routed through Miwa's Azure OpenAI path rather than consumer AI products.
              </p>
              <div className="space-y-3">
                {[
                  'Client names & pronouns',
                  'Dates of birth & session dates',
                  'Phone numbers & addresses',
                  'Provider names & clinic identifiers',
                  'Insurance IDs & case numbers',
                ].map(item => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(45,212,191,0.12)' }}>
                      <svg className="w-3 h-3" style={{ color: TEAL }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-sm text-white/65">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <ScrubberDemo />
            </div>
          </div>
        </div>
      </section>

      {/* ── Layer 2: API model policy ────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: '#0b091f' }}>
        <div className="max-w-5xl mx-auto">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-5"
            style={{ background: 'rgba(45,212,191,0.08)', color: TEAL, border: '1px solid rgba(45,212,191,0.15)' }}>
            Layer 2 — Model Selection Policy
          </span>
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-3xl font-extrabold text-white mb-5 leading-tight">
                AI is routed through approved Azure OpenAI deployments
              </h2>
              <p className="text-white/50 leading-relaxed mb-5">
                Miwa routes AI through <strong className="text-white/80">Azure OpenAI</strong> using Miwa's approved Azure deployment. This is not just about quality. It is a deliberate privacy choice.
              </p>
              <p className="text-white/50 leading-relaxed mb-5">
                PHI-bearing AI calls go through a controlled Azure endpoint, with vendor access governed by the applicable business associate and cloud service terms. This protection applies to configured business services, not consumer chat apps.
              </p>
              <p className="text-white/50 leading-relaxed">
                Miwa avoids direct consumer model APIs for PHI. The privacy posture comes from the configured Azure service path, vendor terms, access controls, and minimum-necessary prompting, not from a public chatbot or a model name.
              </p>
            </div>
            <div className="space-y-4">
              {/* Azure card */}
              <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #cc785c, #d4956a)' }}>A</div>
                  <div>
                    <p className="text-sm font-bold text-white">Azure OpenAI</p>
                    <p className="text-xs text-white/40">approved production deployment</p>
                  </div>
                </div>
                <blockquote className="text-xs text-white/55 leading-relaxed border-l-2 pl-3 italic"
                  style={{ borderColor: '#cc785c55' }}>
                  "Miwa routes AI requests through its Azure OpenAI deployment rather than consumer AI products."
                </blockquote>
                <p className="text-[10px] text-white/25 mt-2">— Miwa model routing policy</p>
              </div>

              {/* PHI routing card */}
              <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #10a37f, #1a7f64)' }}>O</div>
                  <div>
                    <p className="text-sm font-bold text-white">PHI routing</p>
                    <p className="text-xs text-white/40">Azure-only backend path</p>
                  </div>
                </div>
                <blockquote className="text-xs text-white/55 leading-relaxed border-l-2 pl-3 italic"
                  style={{ borderColor: '#10a37f55' }}>
                  "Miwa blocks direct model-provider calls from the backend and centralizes AI access through one approved client."
                </blockquote>
                <p className="text-[10px] text-white/25 mt-2">— PHI routing Terms of Service (verified)</p>
              </div>

              <div className="rounded-xl px-4 py-3 text-xs text-white/40 leading-relaxed"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                💡 <strong className="text-white/55">Note:</strong> These protections apply to API access specifically. Consumer chat products have different data policies and are not part of Miwa's PHI path.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why this matters vs. older tools ─────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: '#07051a' }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-extrabold text-white text-center mb-4">
            Why it matters which model your AI tool uses
          </h2>
          <p className="text-white/45 text-center max-w-2xl mx-auto mb-14 leading-relaxed">
            Not all "AI for therapy" tools are built the same. The model underneath changes everything about how your data is handled.
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: '🔴',
                label: 'Consumer AI apps',
                example: 'e.g. consumer chat apps',
                points: [
                  'Free or low-cost tiers',
                  'May not be covered by healthcare business terms',
                  'No enterprise data agreements',
                  'Not designed for clinical workflows',
                ],
                bad: true,
              },
              {
                icon: '🟡',
                label: 'Unapproved model paths',
                example: 'e.g. ad hoc APIs or unmanaged tools',
                points: [
                  'Often trained on uploaded user data',
                  'No contractual privacy guarantee',
                  'Significantly weaker performance',
                  'No enterprise compliance pathway',
                ],
                bad: true,
              },
              {
                icon: '🟢',
                label: 'Approved Azure path (Miwa)',
                example: 'Azure OpenAI business endpoint',
                points: [
                  'Contractual no-training guarantee',
                  'State-of-the-art clinical reasoning',
                  'Enterprise-grade data agreements',
                  'Minimum-necessary prompting on top',
                ],
                bad: false,
              },
            ].map(col => (
              <div key={col.label} className="rounded-2xl p-6"
                style={{
                  background: col.bad ? 'rgba(255,255,255,0.02)' : 'rgba(45,212,191,0.05)',
                  border: col.bad ? '1px solid rgba(255,255,255,0.06)' : `1px solid rgba(45,212,191,0.2)`,
                }}>
                <span className="text-xl mb-2 block">{col.icon}</span>
                <p className="text-sm font-bold text-white mb-0.5">{col.label}</p>
                <p className="text-[11px] text-white/30 mb-4">{col.example}</p>
                <ul className="space-y-2">
                  {col.points.map(pt => (
                    <li key={pt} className="flex items-start gap-2">
                      <span className="text-xs mt-0.5 flex-shrink-0">{col.bad ? '✗' : '✓'}</span>
                      <span className="text-xs leading-relaxed" style={{ color: col.bad ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)' }}>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Double protection summary ─────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: '#0b091f' }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-extrabold text-white text-center mb-14">Two independent layers of protection</h2>
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            <div className="rounded-2xl p-7" style={{ background: 'rgba(96,71,238,0.07)', border: '1px solid rgba(96,71,238,0.2)' }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-5" style={{ background: GRAD }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-3">Before the model: PHI scrubbing</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Miwa minimizes identifiers before AI processing when the exact identifier is not needed. The scrubber is a safeguard, not a promise that every clinical prompt is fully anonymized.
              </p>
            </div>
            <div className="rounded-2xl p-7" style={{ background: 'rgba(45,212,191,0.05)', border: '1px solid rgba(45,212,191,0.18)' }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'rgba(45,212,191,0.2)' }}>
                <svg className="w-5 h-5" style={{ color: TEAL }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-3">At the model: contractual no-training</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                PHI-capable AI workflows are routed through Azure OpenAI under the applicable Microsoft cloud and business associate terms. Miwa does not use clinical data to train models.
              </p>
            </div>
          </div>

          {/* Additional protections */}
          <h3 className="text-xl font-bold text-white text-center mb-8">Additional protections built in</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: '🔐', title: 'Encrypted at rest', desc: 'Production clinical data is protected by Azure-managed database and storage encryption.' },
              { icon: '🌐', title: 'HTTPS only', desc: 'All traffic between your browser and our servers is TLS-encrypted.' },
              { icon: '🗑️', title: 'You control your data', desc: 'Export or delete your account data at any time from Settings.' },
              { icon: '📋', title: 'HIPAA-aligned controls', desc: 'Designed to avoid PHI in URLs, reduce sensitive logging, and support clinical retention workflows.' },
            ].map(item => (
              <div key={item.title} className="rounded-xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="text-2xl mb-3 block">{item.icon}</span>
                <p className="text-sm font-bold text-white mb-1.5">{item.title}</p>
                <p className="text-xs text-white/40 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Honest limitations ─────────────────────────────────────────────── */}
      <section className="py-16 px-6" style={{ background: '#07051a' }}>
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl p-8" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 className="text-xl font-bold text-white mb-4">Being honest about what Miwa is and isn't</h3>
            <div className="space-y-4 text-sm text-white/50 leading-relaxed">
              <p>
                <strong className="text-white/70">Miwa is built for HIPAA-covered workflows.</strong> Therapists and practices remain responsible for their own HIPAA obligations as covered entities. Miwa is designed to operate as their business associate when a BAA and covered infrastructure are in place.
              </p>
              <p>
                <strong className="text-white/70">PHI scrubbing is pattern-based.</strong> Our scrubber catches common identifiers (names, DOBs, phone numbers, addresses) but is not infallible. Unusual name formats or highly specific local identifiers may occasionally slip through. Treat AI outputs as a drafting assistant, not a compliance guarantee.
              </p>
              <p>
                <strong className="text-white/70">Provider terms can change.</strong> We monitor Azure OpenAI and Microsoft cloud service terms and update Miwa's production configuration if a material data-use change affects PHI workflows.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 text-center" style={{ background: 'linear-gradient(180deg, #07051a 0%, #0e0b2e 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-5">
            Privacy-first, clinically powerful
          </h2>
          <p className="text-white/50 text-lg mb-10">
            Start your free trial. No credit card required. Cancel any time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register"
              className="px-8 py-4 rounded-2xl text-white font-bold text-lg transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{ background: GRAD, boxShadow: '0 8px 32px rgba(96,71,238,0.35)' }}>
              Start free trial
            </Link>
            <Link to="/docs"
              className="px-8 py-4 rounded-2xl font-bold text-lg text-white/70 hover:text-white transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              Read the docs →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="py-10 px-6 text-center" style={{ background: '#04030f', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-center gap-2 mb-5">
          <MiwaLogo size={24} />
          <span className="text-sm font-bold text-white/60">Miwa</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/30 mb-4">
          <Link to="/" className="hover:text-white/60 transition-colors">Home</Link>
          <Link to="/features" className="hover:text-white/60 transition-colors">Features</Link>
          <Link to="/pricing" className="hover:text-white/60 transition-colors">Pricing</Link>
          <Link to="/docs" className="hover:text-white/60 transition-colors">Docs</Link>
          <Link to="/security" className="hover:text-white/60 transition-colors text-white/50">Security & Privacy</Link>
          <Link to="/about" className="hover:text-white/60 transition-colors">About</Link>
        </div>
        <p className="text-xs text-white/20">© 2026 Miwa. Built for clinicians, by clinicians.</p>
      </footer>
    </PublicPageShell>
  )
}
