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

function Section({ title, children, id }) {
  return (
    <section id={id} className="mb-10">
      <h2 className="text-2xl font-bold text-zinc-900 mb-4" style={{ letterSpacing: '-0.02em' }}>{title}</h2>
      <div className="space-y-4 text-zinc-700 leading-relaxed">{children}</div>
    </section>
  )
}

function Bullet({ children }) {
  return (
    <li className="flex gap-3 text-zinc-700">
      <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TEAL }} />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

export default function SmsPolicy() {
  return (
    <PublicPageShell>
      <Nav />

      <header className="pt-32 pb-12 px-6" style={{ background: '#fafafa', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-3xl mx-auto">
          <p className="text-base font-semibold mb-3" style={{ color: PURPLE, letterSpacing: '0.1em' }}>MESSAGING POLICY</p>
          <h1 className="text-4xl md:text-5xl font-black text-zinc-900 mb-4" style={{ letterSpacing: '-0.03em' }}>
            SMS messaging &amp; consent
          </h1>
          <p className="text-lg text-zinc-600 leading-relaxed">
            How Miwa uses SMS, how clients opt in, what they receive, and how to stop receiving messages at any time.
            This page applies to text messages sent from Miwa's toll-free number on behalf of licensed therapists who
            use the platform.
          </p>
          <p className="text-base text-zinc-500 mt-6">
            <span className="font-semibold">Effective date:</span> April 17, 2026 &nbsp;·&nbsp;
            <span className="font-semibold">Last updated:</span> April 17, 2026
          </p>
        </div>
      </header>

      <main className="px-6 py-16">
        <div className="max-w-3xl mx-auto">

          <Section title="1. Who sends Miwa SMS messages" id="who">
            <p>
              Miwa is a clinical documentation platform used by licensed mental health therapists in the United States.
              When a therapist sends an assessment, mood check-in, or appointment-related message to one of their
              clients, Miwa transmits that message via Twilio from a verified toll-free number on the therapist's behalf.
            </p>
            <p>
              The therapist remains the originator of the communication and the HIPAA Covered Entity for any client
              data referenced in the message. Miwa acts as a Business Associate handling delivery.
            </p>
          </Section>

          <Section title="2. How clients opt in" id="opt-in">
            <p>
              Miwa does not collect SMS consent directly from clients through a web form. Consent is collected by the
              client's therapist as part of the existing therapeutic relationship, in one of two ways:
            </p>
            <ul className="space-y-2 mt-4">
              <Bullet>
                <strong>In-session consent:</strong> the therapist explains in person (or during a telehealth session)
                that they would like to send the client assessment links, mood check-ins, and appointment reminders by
                text. The client agrees verbally or in writing.
              </Bullet>
              <Bullet>
                <strong>Intake-form consent:</strong> the therapist's intake paperwork (paper or electronic) includes
                explicit language asking the client to authorize SMS communication, including the types of messages
                they will receive and the right to opt out at any time.
              </Bullet>
            </ul>
            <p className="mt-4">
              Before saving a client's mobile number into Miwa, the therapist must affirmatively check a confirmation
              box stating: <em>"I have obtained this client's consent to receive SMS messages from Miwa on my behalf
              for assessments, check-ins, and appointment-related communication."</em> Miwa records the timestamp of
              that confirmation alongside the phone number. SMS to that number is blocked until the confirmation is on
              file.
            </p>
            <p>
              Mobile phone numbers and SMS consent records are never sold, rented, shared with third parties for
              marketing, or used for any purpose other than the therapist-to-client communication described here.
            </p>
          </Section>

          <Section title="3. Messages clients receive" id="messages">
            <p>Clients only receive messages their therapist initiates. Miwa does not send marketing, promotional, or
              automated content to clients on its own. The categories of messages are:</p>
            <ul className="space-y-2 mt-4">
              <Bullet><strong>Assessment links</strong> — a short message with a secure link to complete a clinical
                instrument the therapist has assigned (PHQ-9, GAD-7, PCL-5, and similar).</Bullet>
              <Bullet><strong>Mood check-ins</strong> — a short prompt with a secure link to log how the client is
                feeling between sessions.</Bullet>
              <Bullet><strong>Appointment-related messages</strong> — telehealth links and reminders the therapist
                chooses to send.</Bullet>
            </ul>
            <p className="mt-6"><strong>Sample messages:</strong></p>
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-base text-zinc-800 leading-relaxed mt-2">
              Your clinician has sent you a PHQ-9 questionnaire. Please complete it when you have a few quiet
              minutes:<br />
              https://miwa.care/assess/abc123<br />
              Reply STOP to opt out, HELP for help. Msg &amp; data rates may apply.
            </div>
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-base text-zinc-800 leading-relaxed mt-2">
              Hi — checking in. How are things going since our last session? Tap here to share a quick
              update:<br />
              https://miwa.care/checkin/xyz789<br />
              Reply STOP to opt out, HELP for help. Msg &amp; data rates may apply.
            </div>
          </Section>

          <Section title="4. Frequency, costs, and supported carriers" id="frequency">
            <ul className="space-y-2">
              <Bullet><strong>Frequency:</strong> messages are only sent when the client's therapist initiates one.
                Typical volume is fewer than 5 messages per month per client.</Bullet>
              <Bullet><strong>Cost:</strong> Miwa does not charge clients for messages. Standard message-and-data
                rates from the client's mobile carrier may apply.</Bullet>
              <Bullet><strong>Carriers:</strong> messages are delivered through Twilio across all major U.S. mobile
                carriers. Miwa is not liable for delays or failed messages caused by carriers.</Bullet>
            </ul>
          </Section>

          <Section title="5. How to stop receiving messages (opt out)" id="opt-out">
            <p>Clients may opt out of SMS at any time using any of the following methods:</p>
            <ul className="space-y-2 mt-4">
              <Bullet>Reply <strong>STOP</strong>, <strong>END</strong>, <strong>CANCEL</strong>,
                <strong> UNSUBSCRIBE</strong>, or <strong>QUIT</strong> to any message from Miwa. Twilio will
                automatically block further SMS to that number and send a one-time confirmation reply.</Bullet>
              <Bullet>Ask their therapist directly to remove their phone number or disable SMS — the therapist can do
                this from the client's profile in Miwa.</Bullet>
              <Bullet>Email <a href="mailto:support@miwa.care" className="font-semibold" style={{ color: PURPLE }}>
                support@miwa.care</a> from any address and request removal.</Bullet>
            </ul>
            <p className="mt-4">
              To resume messages after opting out, reply <strong>START</strong> to any prior Miwa message, or ask the
              therapist to send a new consent confirmation.
            </p>
          </Section>

          <Section title="6. How to get help" id="help">
            <p>
              Reply <strong>HELP</strong> to any Miwa SMS for an automated response with contact information, or
              email <a href="mailto:support@miwa.care" className="font-semibold" style={{ color: PURPLE }}>
              support@miwa.care</a> for a human reply.
            </p>
            <p>
              If a message reaches a number whose owner has not consented to Miwa SMS (for example, the wrong number
              was entered), please reply STOP and email <a href="mailto:privacy@miwa.care" className="font-semibold"
              style={{ color: PURPLE }}>privacy@miwa.care</a> so we can investigate and remove the number from the
              sending therapist's account.
            </p>
          </Section>

          <Section title="7. Privacy of message content" id="privacy">
            <p>
              SMS messages from Miwa are intentionally minimal. They contain only the secure link a client needs to
              act on, the therapist's optional one-line note (if any), the required STOP/HELP/rate language, and the
              Miwa identifier. They never include diagnoses, scores, session content, or other Protected Health
              Information.
            </p>
            <p>
              See our full <Link to="/privacy" className="font-semibold" style={{ color: PURPLE }}>Privacy Policy</Link>
              {' '}for how Miwa handles all data, including PHI.
            </p>
          </Section>

          <Section title="8. Contact" id="contact">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6">
              <p className="text-zinc-700">Operator: Valdrex B.A. Philippe, dba Miwa</p>
              <p className="text-zinc-700">Support: <a href="mailto:support@miwa.care" className="font-semibold" style={{ color: PURPLE }}>support@miwa.care</a></p>
              <p className="text-zinc-700">Privacy: <a href="mailto:privacy@miwa.care" className="font-semibold" style={{ color: PURPLE }}>privacy@miwa.care</a></p>
              <p className="text-zinc-500 text-base mt-3">Los Angeles, California, United States</p>
            </div>
          </Section>

        </div>
      </main>

      <footer className="px-6 py-10 text-center" style={{ background: '#0a0818', color: 'rgba(255,255,255,0.55)' }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-4">
            <MiwaLogo size={24} />
            <span className="text-white font-semibold">Miwa</span>
          </div>
          <div className="flex items-center justify-center gap-6 text-base">
            <Link to="/about" className="hover:text-white">About</Link>
            <Link to="/security" className="hover:text-white">Security</Link>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <Link to="/sms-policy" className="hover:text-white" style={{ color: 'white' }}>SMS Policy</Link>
          </div>
          <p className="text-sm mt-6 opacity-60">© 2026 Miwa. All rights reserved.</p>
        </div>
      </footer>
    </PublicPageShell>
  )
}
