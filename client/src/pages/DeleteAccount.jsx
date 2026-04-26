import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'
const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'

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
      <div className="hidden md:flex items-center gap-6 text-base text-white/55">
        <Link to="/features" className="hover:text-white transition-colors">Features</Link>
        <Link to="/for-trainees" className="hover:text-white transition-colors">For Trainees</Link>
        <Link to="/for-practices" className="hover:text-white transition-colors">For Practices</Link>
        <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
      </div>
      <div className="flex items-center gap-3">
        <Link to="/login" className="text-base text-white/60 hover:text-white transition-colors">Sign In</Link>
        <Link to="/register" className="text-base font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90"
          style={{ background: GRAD }}>
          Start Free
        </Link>
      </div>
    </nav>
  )
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-2xl font-bold text-zinc-900 mb-4" style={{ letterSpacing: '-0.02em' }}>{title}</h2>
      <div className="space-y-4 text-zinc-700 leading-relaxed">{children}</div>
    </section>
  )
}

function Step({ num, title, children }) {
  return (
    <div className="flex gap-4 mb-6">
      <div
        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-white"
        style={{ background: GRAD }}
      >
        {num}
      </div>
      <div className="flex-1 pt-1">
        <h3 className="text-lg font-semibold text-zinc-900 mb-2">{title}</h3>
        <div className="text-zinc-700 leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  )
}

export default function DeleteAccount() {
  return (
    <PublicPageShell>
      <Nav />

      {/* Hero */}
      <header className="pt-32 pb-12 px-6" style={{ background: '#fafafa', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-3xl mx-auto">
          <p className="text-base font-semibold mb-3" style={{ color: PURPLE, letterSpacing: '0.1em' }}>MIWA — DATA &amp; ACCOUNT DELETION</p>
          <h1 className="text-4xl md:text-5xl font-black text-zinc-900 mb-4" style={{ letterSpacing: '-0.03em' }}>
            Delete your Miwa account
          </h1>
          <p className="text-lg text-zinc-600 leading-relaxed">
            You can request deletion of your Miwa (<strong>miwa.care</strong> / Miwa Care mobile app) therapist
            account and associated data at any time. Because Miwa is used in licensed clinical practice and handles
            Protected Health Information (PHI), deletion follows specific HIPAA rules — read the details below.
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-16">
        <div className="max-w-3xl mx-auto">

          <Section title="How to request account deletion">
            <p className="mb-6">
              Two paths are available. Use whichever is easier:
            </p>

            <div className="mb-8 p-6 rounded-2xl" style={{ background: '#f8fafc', border: '1px solid rgba(96,71,238,0.15)' }}>
              <h3 className="text-lg font-semibold text-zinc-900 mb-4">Option A — In-app deletion (fastest)</h3>
              <Step num="1" title="Sign in to Miwa">
                <p>Open the Miwa Care app or go to <a href="https://miwa.care/login" className="font-semibold" style={{ color: PURPLE }}>miwa.care/login</a>.</p>
              </Step>
              <Step num="2" title="Open Settings">
                <p>On web: click your name in the sidebar → <strong>Settings</strong>.<br />On mobile: tap <strong>More → Settings</strong>.</p>
              </Step>
              <Step num="3" title="Select “Delete account”">
                <p>Scroll to the <strong>Danger Zone</strong> section and tap <strong>Delete account</strong>. You'll be asked to confirm by re-entering your password.</p>
              </Step>
              <Step num="4" title="Confirm">
                <p>Once confirmed, your account is queued for deletion. You'll receive a confirmation email at the address on file.</p>
              </Step>
            </div>

            <div className="mb-8 p-6 rounded-2xl" style={{ background: '#f8fafc', border: '1px solid rgba(45,212,191,0.2)' }}>
              <h3 className="text-lg font-semibold text-zinc-900 mb-4">Option B — Email request</h3>
              <p>
                Email <a href="mailto:privacy@miwa.care" className="font-semibold" style={{ color: PURPLE }}>privacy@miwa.care</a> from
                the address associated with your account with the subject line <strong>“Account deletion request.”</strong>
              </p>
              <p className="mt-3">
                Include your registered full name and any additional verification the Privacy Officer may reasonably request
                to confirm identity. We respond within <strong>30 days</strong> and will confirm once deletion is complete.
              </p>
            </div>
          </Section>

          <Section title="What gets deleted">
            <p>When your account deletion request is processed, the following is <strong>permanently removed</strong>:</p>
            <ul className="mt-3 space-y-2">
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span>Your therapist profile, login credentials, and session tokens.</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span>Your profile settings, preferences, and app configuration.</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span>Device identifiers, push notification tokens, and usage telemetry.</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span>Any voice recordings that were temporarily stored (these are deleted within 24 hours of transcription regardless of deletion requests).</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span>Your billing account details (Stripe customer ID; Stripe retains its own payment records per its privacy policy).</span></li>
            </ul>
          </Section>

          <Section title="What is retained (and why)">
            <p>
              Because Miwa is used in licensed clinical practice, some information must be retained even after account
              deletion. This is a HIPAA and state-law requirement for mental health record-keeping, not a Miwa policy choice:
            </p>
            <ul className="mt-3 space-y-2">
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PURPLE }} />
                <span>
                  <strong>Patient clinical records</strong> (session notes, assessments, diagnoses, treatment plans)
                  created during your use of Miwa are retained per applicable record-retention law — typically 7 years after
                  last date of service for adults, and longer for minors. The therapist or successor clinician remains
                  responsible for these records as the HIPAA Covered Entity. On deletion request, we can export these to you
                  (or to a designated successor clinician) before deletion, or retain them under our Business Associate
                  Agreement until the retention period elapses.
                </span>
              </li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PURPLE }} />
                <span><strong>Audit logs</strong> — retained for a minimum of 6 years per HIPAA § 164.316(b)(2)(i). Logs
                  contain user IDs and access events but not patient content.</span>
              </li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PURPLE }} />
                <span><strong>Billing records</strong> — Stripe retains its own transaction records per its own retention
                  policies, independent of Miwa.</span>
              </li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PURPLE }} />
                <span><strong>Backups</strong> — encrypted backups roll over on a 35-day cycle. Data in backups older than
                  35 days is permanently overwritten.</span>
              </li>
            </ul>

            <p className="mt-4 text-base text-zinc-600">
              If you want patient clinical records exported or transferred before deletion, specify this in your email
              request to <a href="mailto:privacy@miwa.care" className="font-semibold" style={{ color: PURPLE }}>privacy@miwa.care</a>.
            </p>
          </Section>

          <Section title="Timelines">
            <ul className="space-y-2">
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span><strong>Identity verification:</strong> within 5 business days</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span><strong>Account deletion execution:</strong> within 30 days of verified request</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span><strong>Removal from encrypted backups:</strong> up to 35 additional days</span></li>
              <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} /><span><strong>Retained clinical records:</strong> released from retention per applicable state/federal law (typically 7+ years after last date of service)</span></li>
            </ul>
          </Section>

          <Section title="Patients of Miwa-using therapists">
            <p>
              If you are a patient whose therapist uses Miwa, your data is held in your therapist's Miwa account.
              Requests for access, correction, or deletion of your Protected Health Information should be directed to
              your therapist — they are the HIPAA Covered Entity. Miwa will support your therapist in fulfilling any
              lawful request within required timeframes.
            </p>
          </Section>

          <Section title="Questions">
            <p>
              Email our Privacy Officer at
              <a href="mailto:privacy@miwa.care" className="font-semibold ml-1" style={{ color: PURPLE }}>privacy@miwa.care</a>.
              Our full privacy policy is available at
              <Link to="/privacy" className="font-semibold ml-1" style={{ color: PURPLE }}>miwa.care/privacy</Link>.
            </p>
          </Section>

        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-10 text-center" style={{ background: '#0a0818', color: 'rgba(255,255,255,0.55)' }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-4">
            <MiwaLogo size={24} />
            <span className="text-white font-semibold">Miwa</span>
          </div>
          <div className="flex items-center justify-center gap-6 text-base">
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <Link to="/security" className="hover:text-white">Security</Link>
            <Link to="/delete-account" className="hover:text-white" style={{ color: 'white' }}>Delete Account</Link>
          </div>
          <p className="text-sm mt-6 opacity-60">© 2026 Miwa. All rights reserved.</p>
        </div>
      </footer>
    </PublicPageShell>
  )
}
