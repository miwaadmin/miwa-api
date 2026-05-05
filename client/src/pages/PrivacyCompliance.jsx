import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'
const INK = '#111827'
const MUTED = '#5f6673'
const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const trustBadges = [
  { mark: 'H', title: 'HIPAA-aligned', text: 'Administrative, technical, and physical safeguards for covered clinical workflows.' },
  { mark: 'B', title: 'BAA available', text: 'Business Associate Agreement available for covered entities and practices.' },
  { mark: 'O', title: 'OpenAI BAA + ZDR', text: 'OpenAI API use limited to BAA-covered, Zero Data Retention eligible endpoints.' },
  { mark: 'A', title: 'Azure hosted', text: 'Clinical infrastructure built on HIPAA-eligible Microsoft Azure services.' },
  { mark: 'G', title: 'Google Workspace BAA', text: 'Business operations supported by Google Workspace under BAA-backed controls.' },
  { mark: 'N', title: 'No AI training', text: 'Clinical data and PHI are not used to train AI models.' },
]

const privacyPromises = [
  {
    title: 'Your clinical data does not train AI models',
    body: 'Miwa does not use client notes, transcripts, assessments, treatment plans, or protected health information to train AI models. AI processing is configured through covered business paths, including OpenAI API Zero Data Retention eligible endpoints where OpenAI is used.',
  },
  {
    title: 'PHI stays inside approved vendor pathways',
    body: 'Miwa reviews vendors before they can receive, store, transmit, or process PHI. Azure, OpenAI API, and Google Workspace are handled through signed BAA-backed relationships. Stripe is billing-only and should never receive clinical details.',
  },
  {
    title: 'Minimum necessary data is the default',
    body: 'Miwa is designed to send only the clinical context needed for a task. The app avoids putting PHI in URLs, billing metadata, marketing systems, or non-clinical support tools.',
  },
  {
    title: 'Clinicians stay in control',
    body: 'Miwa drafts, organizes, and summarizes. Clinicians review and approve. The platform supports documentation, but it does not replace professional judgment, consent obligations, supervision, or clinical recordkeeping.',
  },
]

const safeguards = [
  'Encryption in transit and at rest',
  'Role-based access controls',
  'Restricted production data access',
  'Audit and operational logging',
  'Vendor BAA review before PHI use',
  'Incident response procedures',
  'Risk analysis and risk register',
  'SMS disabled until BAA and consent workflow are complete',
]

const faqs = [
  {
    q: 'Is Miwa HIPAA compliant?',
    a: 'Miwa is built for HIPAA-covered clinical workflows with BAA-backed infrastructure, HIPAA-oriented policies, and safeguards for ePHI. Covered entities should execute a BAA with Miwa before using the platform for PHI.',
  },
  {
    q: 'Do you sign a BAA?',
    a: 'Yes. Miwa can make a Business Associate Agreement available to covered entities and practices using Miwa for covered clinical workflows.',
  },
  {
    q: 'Does OpenAI train on Miwa data?',
    a: 'No. Miwa does not permit clinical data or PHI to be used for AI model training. OpenAI API use is limited to BAA-covered, Zero Data Retention eligible API endpoints where OpenAI is used.',
  },
  {
    q: 'Can Miwa staff access PHI?',
    a: 'Access is restricted to minimum-necessary operational needs, such as security, support, or troubleshooting. Production access should be logged, limited, and reviewed.',
  },
  {
    q: 'Do you sell data?',
    a: 'No. Miwa does not sell client data, therapist data, session data, transcripts, notes, assessment results, or de-identified clinical datasets.',
  },
  {
    q: 'Do you have SOC 2 or HITRUST?',
    a: 'Not yet. Miwa does not claim SOC 2 or HITRUST certification. Those are future trust milestones. This page reflects Miwa\'s current HIPAA-aligned program and BAA-backed vendor posture.',
  },
]

function Badge({ mark, title, text }) {
  return (
    <div className="rounded-lg bg-white p-5" style={{ border: '1px solid rgba(17,24,39,0.08)', boxShadow: '0 10px 30px rgba(15,23,42,0.05)' }}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg text-lg font-black text-white" style={{ background: GRAD }}>
        {mark}
      </div>
      <h3 className="text-base font-bold" style={{ color: INK }}>{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: MUTED }}>{text}</p>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="mb-3 text-sm font-bold uppercase tracking-widest" style={{ color: TEAL }}>
      {children}
    </p>
  )
}

export default function PrivacyCompliance() {
  return (
    <PublicPageShell>
      <PublicNav />

      <section className="px-5 pb-16 pt-36 md:pt-40" style={{ background: '#fbfcff' }}>
        <div className="mx-auto grid max-w-[1200px] gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <SectionLabel>Privacy and compliance</SectionLabel>
            <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight md:text-6xl" style={{ color: INK }}>
              Built for therapy data, not ad data.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: MUTED }}>
              Miwa is designed for clinicians who handle sensitive mental health information. Our platform uses HIPAA-eligible infrastructure, signed BAAs with key vendors, and privacy-preserving AI configuration so clinical documentation can move faster without treating client data casually.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/privacy" className="rounded-xl px-6 py-3 text-center text-base font-bold text-white transition hover:opacity-90" style={{ background: GRAD }}>
                Read privacy policy
              </Link>
              <a href="mailto:privacy@miwa.care" className="rounded-xl px-6 py-3 text-center text-base font-bold transition hover:bg-gray-50" style={{ border: '1px solid rgba(17,24,39,0.12)', color: INK }}>
                Request BAA
              </a>
            </div>
            <p className="mt-5 text-sm" style={{ color: '#7a8190' }}>
              Last reviewed May 2026. Compliance claims should be reviewed with counsel before enterprise rollout.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {trustBadges.map((badge) => (
              <Badge key={badge.title} {...badge} />
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20" style={{ background: '#0d0b24' }}>
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-3xl">
            <SectionLabel>Our promises</SectionLabel>
            <h2 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Privacy commitments that clinicians can explain to clients.
            </h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {privacyPromises.map(({ title, body }) => (
              <div key={title} className="rounded-lg p-6" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
                <h3 className="text-lg font-bold text-white">{title}</h3>
                <p className="mt-3 text-base leading-relaxed text-white/60">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20" style={{ background: '#f5f7fb' }}>
        <div className="mx-auto max-w-[1200px]">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <SectionLabel>Security safeguards</SectionLabel>
              <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl" style={{ color: INK }}>
                The flag only matters if the controls exist behind it.
              </h2>
              <p className="mt-5 text-base leading-relaxed" style={{ color: MUTED }}>
                HIPAA is an operating program, not a logo. Miwa maintains a risk analysis packet, vendor BAA register, access control policy, and incident response plan. The public promise is backed by internal evidence and should keep improving as Miwa grows.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {safeguards.map((item) => (
                <div key={item} className="flex min-h-[72px] items-center gap-3 rounded-lg bg-white px-4 py-3" style={{ border: '1px solid rgba(17,24,39,0.08)' }}>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: TEAL }}>
                    ✓
                  </div>
                  <p className="text-sm font-semibold leading-snug" style={{ color: INK }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 bg-white">
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-3xl">
            <SectionLabel>Vendor posture</SectionLabel>
            <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl" style={{ color: INK }}>
              PHI goes only where we have a reason and a contract.
            </h2>
          </div>
          <div className="mt-10 overflow-hidden rounded-lg" style={{ border: '1px solid rgba(17,24,39,0.1)' }}>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead style={{ background: '#eef2f7', color: INK }}>
                <tr>
                  <th className="px-5 py-4 font-bold">Service</th>
                  <th className="px-5 py-4 font-bold">Use</th>
                  <th className="px-5 py-4 font-bold">PHI posture</th>
                  <th className="px-5 py-4 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-5 py-4 font-semibold" style={{ color: INK }}>Microsoft Azure</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>Hosting, database, storage, AI infrastructure</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>HIPAA-eligible services under Microsoft BAA</td>
                  <td className="px-5 py-4 font-semibold" style={{ color: TEAL }}>Approved path</td>
                </tr>
                <tr>
                  <td className="px-5 py-4 font-semibold" style={{ color: INK }}>OpenAI API</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>AI processing where configured</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>BAA signed; Zero Data Retention eligible endpoints only</td>
                  <td className="px-5 py-4 font-semibold" style={{ color: TEAL }}>Covered when configured</td>
                </tr>
                <tr>
                  <td className="px-5 py-4 font-semibold" style={{ color: INK }}>Google Workspace</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>Business email, documents, compliance operations</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>BAA signed; minimum necessary use</td>
                  <td className="px-5 py-4 font-semibold" style={{ color: TEAL }}>Approved support path</td>
                </tr>
                <tr>
                  <td className="px-5 py-4 font-semibold" style={{ color: INK }}>Stripe</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>Billing and subscriptions</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>No intentional PHI in metadata, notes, or descriptions</td>
                  <td className="px-5 py-4 font-semibold" style={{ color: '#b7791f' }}>Billing only</td>
                </tr>
                <tr>
                  <td className="px-5 py-4 font-semibold" style={{ color: INK }}>SMS provider</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>Future reminders and assessment links</td>
                  <td className="px-5 py-4" style={{ color: MUTED }}>Not approved for PHI until BAA and consent controls are complete</td>
                  <td className="px-5 py-4 font-semibold" style={{ color: '#b91c1c' }}>Disabled</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="px-5 py-20" style={{ background: '#fbfcff' }}>
        <div className="mx-auto max-w-[1000px]">
          <div className="text-center">
            <SectionLabel>FAQ</SectionLabel>
            <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl" style={{ color: INK }}>
              Direct answers to the privacy questions that matter.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {faqs.map(({ q, a }) => (
              <div key={q} className="rounded-lg bg-white p-6" style={{ border: '1px solid rgba(17,24,39,0.08)' }}>
                <h3 className="text-base font-bold" style={{ color: INK }}>{q}</h3>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: MUTED }}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 text-center" style={{ background: '#0d0b24' }}>
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-extrabold text-white">Need a BAA or security review?</h2>
          <p className="mt-4 text-base leading-relaxed text-white/60">
            Send your compliance questions before using Miwa in a covered clinical workflow. We will help confirm the right contract, vendor path, and privacy configuration.
          </p>
          <a href="mailto:privacy@miwa.care" className="mt-8 inline-flex rounded-xl px-7 py-3 text-base font-bold text-white transition hover:opacity-90" style={{ background: GRAD }}>
            privacy@miwa.care
          </a>
        </div>
      </section>

      <PublicFooter />
    </PublicPageShell>
  )
}
