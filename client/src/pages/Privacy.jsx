import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'
const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'

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

/* ── Section Component ──────────────────────────────────────────────────── */
function Section({ title, children, id }) {
  return (
    <section id={id} className="mb-10">
      <h2 className="text-2xl font-bold text-zinc-900 mb-4" style={{ letterSpacing: '-0.02em' }}>{title}</h2>
      <div className="space-y-4 text-zinc-700 leading-relaxed">{children}</div>
    </section>
  )
}

function SubHeading({ children }) {
  return <h3 className="text-lg font-semibold text-zinc-900 mt-6 mb-2">{children}</h3>
}

function Bullet({ children }) {
  return (
    <li className="flex gap-3 text-zinc-700">
      <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

/* ── Main Page ──────────────────────────────────────────────────────────── */
export default function Privacy() {
  return (
    <PublicPageShell>
      <Nav />

      {/* Hero */}
      <header className="pt-32 pb-12 px-6" style={{ background: '#fafafa', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-3xl mx-auto">
          <p className="text-base font-semibold mb-3" style={{ color: PURPLE, letterSpacing: '0.1em' }}>PRIVACY POLICY</p>
          <h1 className="text-4xl md:text-5xl font-black text-zinc-900 mb-4" style={{ letterSpacing: '-0.03em' }}>
            How Miwa handles your data
          </h1>
          <p className="text-lg text-zinc-600 leading-relaxed">
            Plain-English notice of what we collect, why, how it's protected, and your rights. Miwa is built for
            licensed mental health therapists — we treat patient information as Protected Health Information (PHI)
            under HIPAA and handle it with the care that standard requires.
          </p>
          <p className="text-base text-zinc-500 mt-6">
            <span className="font-semibold">Effective date:</span> April 16, 2026 &nbsp;·&nbsp;
            <span className="font-semibold">Last updated:</span> April 30, 2026
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-16">
        <div className="max-w-3xl mx-auto">

          <Section title="1. Who we are" id="who">
            <p>
              Miwa ("we," "us," "our") is operated by Valdrex B.A. Philippe, based in Los Angeles, California,
              United States. We publish the Miwa clinical documentation and outcomes-tracking platform at
              <strong> miwa.care </strong> and through the Miwa Care mobile application available on Google Play.
            </p>
            <p>
              For any privacy questions, exercise of rights, or HIPAA-related requests, contact our Privacy
              Officer at <a href="mailto:privacy@miwa.care" className="font-semibold" style={{ color: PURPLE }}>privacy@miwa.care</a>.
            </p>
          </Section>

          <Section title="2. Scope of this policy" id="scope">
            <p>
              This policy applies to two groups, and the rules differ by role:
            </p>
            <SubHeading>Therapists (our direct customers)</SubHeading>
            <p>
              Licensed clinicians who create an account and use Miwa in their practice. We are the <em>data controller</em> for
              therapist account data.
            </p>
            <SubHeading>Patients and clients of those therapists</SubHeading>
            <p>
              Individuals who receive care from a Miwa-using therapist. We act as a <em>HIPAA Business Associate</em> to the
              therapist — the therapist remains the Covered Entity and primary owner of patient Protected Health Information (PHI).
              We process PHI only under the therapist's direction and, for covered workflows, under the applicable Business
              Associate Agreement (BAA) and cloud service terms.
            </p>
          </Section>

          <Section title="3. Information we collect" id="collect">
            <SubHeading>From therapists directly</SubHeading>
            <ul className="space-y-2">
              <Bullet><strong>Account data:</strong> name, email address, password (hashed), professional license information, practice address, phone number, time zone.</Bullet>
              <Bullet><strong>Billing data:</strong> Stripe customer ID and subscription status. Payment card numbers are handled by Stripe and never touch our servers.</Bullet>
              <Bullet><strong>Device and usage data:</strong> IP address, browser type, device model, OS version, timestamps of page views, feature usage, and error logs. Used to operate and secure the service.</Bullet>
              <Bullet><strong>Voice recordings:</strong> if the therapist uses session recording features, audio is processed for transcription and stored only as needed to provide or troubleshoot that workflow unless the therapist explicitly retains it.</Bullet>
            </ul>

            <SubHeading>Patient information (entered or generated by therapists)</SubHeading>
            <p>The following constitutes PHI and is handled under HIPAA safeguards:</p>
            <ul className="space-y-2">
              <Bullet>Patient identifiers (name, date of birth, contact information) as entered by the therapist.</Bullet>
              <Bullet>Session notes, treatment plans, and diagnoses.</Bullet>
              <Bullet>Assessment scores (PHQ-9, GAD-7, PCL-5, and similar validated instruments).</Bullet>
              <Bullet>Appointment history and session metadata.</Bullet>
              <Bullet>Patient-completed assessments submitted via secure links issued by the therapist.</Bullet>
            </ul>
            <p className="mt-4">
              We do <strong>not</strong> sell, rent, or monetize patient information under any circumstance.
            </p>

            <SubHeading>From the mobile app</SubHeading>
            <ul className="space-y-2">
              <Bullet>Microphone access (only when the therapist activates recording for a session).</Bullet>
              <Bullet>Push notification tokens, if enabled.</Bullet>
              <Bullet>Device identifiers for session management and security.</Bullet>
            </ul>
            <p className="mt-4">
              The app does <strong>not</strong> access contacts, SMS history, photos, location, or any data unrelated to clinical workflow.
            </p>
          </Section>

          <Section title="4. How we use information" id="use">
            <ul className="space-y-2">
              <Bullet>Provide, maintain, and improve the Miwa platform and its clinical features.</Bullet>
              <Bullet>Generate AI-assisted clinical documentation, treatment-plan suggestions, and progress analytics — always under the therapist's direction and review.</Bullet>
              <Bullet>Deliver secure assessment and portal links when requested by the therapist. SMS delivery is disabled until a messaging BAA, consent workflow, and launch controls are in place.</Bullet>
              <Bullet>Process billing and subscription management via Stripe.</Bullet>
              <Bullet>Detect and prevent security incidents, fraud, and abuse.</Bullet>
              <Bullet>Comply with legal obligations and maintain security, operational, and administrative logs appropriate to the service.</Bullet>
            </ul>
            <p className="mt-4">
              We do <strong>not</strong> use PHI to train machine-learning models. We do not use any patient or therapist data
              for advertising, and Miwa does not contain advertisements.
            </p>
          </Section>

          <Section title="5. How we share information" id="share">
            <p>
              We disclose information only in the following limited circumstances, and — when PHI is involved — only to
              vendors (subprocessors) operating under a signed Business Associate Agreement (BAA):
            </p>

            <SubHeading>Subprocessors</SubHeading>
            <div className="overflow-x-auto mt-3 rounded-xl border border-zinc-200">
              <table className="w-full text-base">
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-zinc-900">Vendor</th>
                    <th className="text-left px-4 py-3 font-semibold text-zinc-900">Purpose</th>
                    <th className="text-left px-4 py-3 font-semibold text-zinc-900">PHI access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  <tr>
                    <td className="px-4 py-3 font-medium">Microsoft Azure</td>
                    <td className="px-4 py-3 text-zinc-600">Application hosting, Azure PostgreSQL, Azure Blob Storage, and Azure OpenAI</td>
                    <td className="px-4 py-3 text-zinc-600">Yes - under applicable BAA/cloud terms</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Google Workspace</td>
                    <td className="px-4 py-3 text-zinc-600">Business email, document storage, calendar</td>
                    <td className="px-4 py-3 text-zinc-600">Yes — under BAA</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">SMS provider</td>
                    <td className="px-4 py-3 text-zinc-600">Planned text-message delivery for reminders and assessment links</td>
                    <td className="px-4 py-3 text-zinc-600">Not active for PHI until BAA and consent controls are complete</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Stripe</td>
                    <td className="px-4 py-3 text-zinc-600">Payment processing</td>
                    <td className="px-4 py-3 text-zinc-600">No — billing only, never PHI</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <SubHeading>Other disclosures</SubHeading>
            <ul className="space-y-2">
              <Bullet><strong>Legal requirements:</strong> We may disclose information if compelled by valid legal process (subpoena, court order), consistent with HIPAA.</Bullet>
              <Bullet><strong>Safety emergencies:</strong> We may disclose information to prevent imminent and serious harm to a person, consistent with HIPAA § 164.512(j).</Bullet>
              <Bullet><strong>Business transfers:</strong> If Miwa is acquired or merged, patient PHI transfers only under continued HIPAA-equivalent protections and with required notice.</Bullet>
            </ul>

            <p className="mt-4">
              <strong>We never sell personal information.</strong> This has been our position since day one.
            </p>
          </Section>

          <Section title="6. HIPAA notice" id="hipaa">
            <p>
              When we process PHI on behalf of a Covered Entity (a therapist or their practice), Miwa operates as a
              <strong> HIPAA Business Associate</strong>. Our obligations include:
            </p>
            <ul className="space-y-2">
              <Bullet>Using PHI only to perform the services requested by the therapist.</Bullet>
              <Bullet>Safeguarding PHI with appropriate administrative, physical, and technical controls.</Bullet>
              <Bullet>Reporting any use or disclosure not permitted by the BAA, including security incidents, within the required timeframes.</Bullet>
              <Bullet>Ensuring that any subcontractor with PHI access agrees to equivalent BAA restrictions.</Bullet>
              <Bullet>Returning or destroying PHI upon termination of services, where feasible.</Bullet>
            </ul>
            <p className="mt-4">
              A <strong>Business Associate Agreement</strong> is required before Miwa is used as a Business Associate for covered PHI workflows.
              Patients seeking to exercise HIPAA rights (access, amendment, accounting of disclosures) should contact
              their therapist directly — the therapist is the Covered Entity and holds the primary relationship.
            </p>
          </Section>

          <Section title="7. Data security" id="security">
            <p>Summary of our technical and administrative safeguards:</p>
            <ul className="space-y-2">
              <Bullet><strong>Encryption in transit:</strong> TLS 1.2+ for all network traffic.</Bullet>
              <Bullet><strong>Encryption at rest:</strong> Azure-managed database and storage encryption for production data and files.</Bullet>
              <Bullet><strong>Authentication:</strong> Password hashing with industry-standard algorithms and separate admin authentication controls.</Bullet>
              <Bullet><strong>Access control:</strong> Least-privilege principle. Therapists see only their own patients; engineering access to production data is logged and restricted.</Bullet>
              <Bullet><strong>Audit logging:</strong> Security, administrative, and operational events are logged according to Miwa's audit log policy as the product matures.</Bullet>
              <Bullet><strong>Hosting:</strong> HIPAA-eligible cloud infrastructure under applicable Microsoft cloud terms and BAA coverage.</Bullet>
              <Bullet><strong>Secure patient links:</strong> Patient-facing assessment and portal links use cryptographically random tokens with expiration.</Bullet>
              <Bullet><strong>Backups:</strong> Encrypted, geographically isolated, tested for restore integrity.</Bullet>
            </ul>
            <p className="mt-4 text-base text-zinc-600">
              No system is perfectly secure. If you believe you have found a security vulnerability, please disclose
              responsibly to <a href="mailto:security@miwa.care" className="font-semibold" style={{ color: PURPLE }}>security@miwa.care</a>.
            </p>
          </Section>

          <Section title="8. Data retention" id="retention">
            <ul className="space-y-2">
              <Bullet><strong>Therapist account data:</strong> Retained for the life of the account plus 30 days after deletion, to allow for recovery and billing reconciliation.</Bullet>
              <Bullet><strong>PHI (session notes, assessments, patient records):</strong> Retained according to the therapist's clinical record-keeping obligations — typically 7 years after the last date of service, longer for minors. PHI is not deleted by Miwa without explicit therapist direction, to preserve the clinical record.</Bullet>
              <Bullet><strong>Audit and operational logs:</strong> Retained according to Miwa's audit log policy and legal obligations.</Bullet>
              <Bullet><strong>Voice recordings:</strong> Retained only as needed for transcription, troubleshooting, or therapist-requested storage.</Bullet>
              <Bullet><strong>Backups:</strong> Encrypted backup and retention practices are maintained as part of the Miwa backup/retention plan.</Bullet>
            </ul>
          </Section>

          <Section title="9. Your rights" id="rights">

            <SubHeading>Therapist rights</SubHeading>
            <ul className="space-y-2">
              <Bullet>Access the account data we hold about you.</Bullet>
              <Bullet>Correct inaccurate information.</Bullet>
              <Bullet>Delete your account (subject to clinical record-retention obligations attached to PHI).</Bullet>
              <Bullet>Export your data in a portable format.</Bullet>
              <Bullet>Withdraw consent where processing is based on consent.</Bullet>
            </ul>

            <SubHeading>Patient rights (HIPAA)</SubHeading>
            <p>
              Patients of a Miwa-using therapist should exercise HIPAA rights through their therapist. The therapist is
              the Covered Entity. We will assist the therapist in responding to any such request within required timeframes.
            </p>

            <SubHeading>California residents (CCPA / CPRA)</SubHeading>
            <p>
              California residents have the right to know, delete, correct, and limit the use of personal information,
              and to not be discriminated against for exercising these rights. Note that HIPAA-regulated PHI is exempt
              from CCPA under Cal. Civ. Code § 1798.145(c)(1). Non-PHI personal information (account data, billing, usage
              telemetry) remains subject to CCPA.
            </p>
            <p>
              To exercise any of these rights, email <a href="mailto:privacy@miwa.care" className="font-semibold" style={{ color: PURPLE }}>privacy@miwa.care</a> from
              the address on file. We will respond within 30 days.
            </p>
          </Section>

          <Section title="10. Children's privacy" id="children">
            <p>
              Miwa is not directed at children under 13. Therapists may document sessions with minor patients (which is
              common in clinical practice), but minors do not interact with Miwa directly and do not create accounts. No
              data is knowingly collected from children under 13 without parent or guardian consent via the treating therapist.
            </p>
          </Section>

          <Section title="11. International users and data transfers" id="international">
            <p>
              Miwa operates from the United States, and all servers and subprocessors are located in or compliant with
              U.S. data protection standards. If you access Miwa from outside the U.S., your data will be processed in the U.S.
              At this time, Miwa is built for U.S.-licensed clinicians and is not offered in jurisdictions where its operation
              would require additional regulatory frameworks (e.g., full GDPR compliance for EU clinical practice).
            </p>
          </Section>

          <Section title="12. Changes to this policy" id="changes">
            <p>
              We may update this policy to reflect changes in our services, legal obligations, or industry standards.
              Material changes will be announced at least <strong>30 days before they take effect</strong>, by email to the
              address on file and by prominent notice within the application. Continued use of Miwa after the effective date
              of a change constitutes acceptance of the updated policy.
            </p>
          </Section>

          <Section title="13. Contact us" id="contact">
            <p>Questions, requests, or complaints:</p>
            <div className="mt-4 p-5 rounded-xl" style={{ background: '#f8fafc', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p className="font-semibold text-zinc-900">Valdrex B.A. Philippe — Privacy Officer</p>
              <p className="text-zinc-700 mt-1">Miwa</p>
              <p className="text-zinc-700">
                Email: <a href="mailto:admin@miwa.care" className="font-semibold" style={{ color: PURPLE }}>admin@miwa.care</a>
              </p>
              <p className="text-zinc-700">Web: <a href="https://miwa.care" className="font-semibold" style={{ color: PURPLE }}>miwa.care</a></p>
              <p className="text-zinc-500 text-base mt-3">Los Angeles, California, United States</p>
            </div>
            <p className="text-base text-zinc-500 mt-6">
              If you believe your rights under HIPAA have been violated, you may also file a complaint with the U.S.
              Department of Health and Human Services, Office for Civil Rights at
              <a href="https://www.hhs.gov/hipaa/filing-a-complaint" className="font-semibold ml-1" style={{ color: PURPLE }} target="_blank" rel="noopener noreferrer">hhs.gov/hipaa/filing-a-complaint</a>.
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
            <Link to="/about" className="hover:text-white">About</Link>
            <Link to="/security" className="hover:text-white">Security</Link>
            <Link to="/privacy" className="hover:text-white" style={{ color: 'white' }}>Privacy</Link>
            <Link to="/sms-policy" className="hover:text-white">SMS Policy</Link>
          </div>
          <p className="text-sm mt-6 opacity-60">© 2026 Miwa. All rights reserved.</p>
        </div>
      </footer>
    </PublicPageShell>
  )
}
