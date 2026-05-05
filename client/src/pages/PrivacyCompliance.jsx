import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const TEAL = '#2dd4bf'
const INK = '#111827'
const MUTED = '#5f6673'
const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'

const trustBadges = [
  { mark: 'H', title: 'HIPAA-aligned', text: 'Built around safeguards for covered clinical workflows.' },
  { mark: 'B', title: 'BAA available', text: 'Business Associate Agreement available for eligible organizations.' },
  { mark: 'N', title: 'No AI training', text: 'Clinical data is not used to train AI models.' },
  { mark: 'E', title: 'Encrypted', text: 'Data is protected in transit and at rest.' },
  { mark: 'A', title: 'Access controls', text: 'Clinical records are limited to authorized users.' },
  { mark: 'R', title: 'Review ready', text: 'Security details are available during practice review.' },
]

const privacyPromises = [
  {
    title: 'Clinical data does not train AI models',
    body: 'Miwa does not use client notes, transcripts, assessments, treatment plans, or protected health information to train AI models.',
  },
  {
    title: 'Sensitive data stays in clinical workflows',
    body: 'Miwa is designed to keep client information inside the product areas that need it, with safeguards around storage, AI assistance, documentation, and support.',
  },
  {
    title: 'Minimum necessary data is the default',
    body: 'Miwa is built to use the least amount of clinical context needed for a task and avoid placing sensitive information where it does not belong.',
  },
  {
    title: 'Clinicians stay in control',
    body: 'Miwa drafts, organizes, and summarizes. Clinicians review and approve. The platform supports documentation, but it does not replace professional judgment, consent obligations, supervision, or clinical recordkeeping.',
  },
]

const safeguards = [
  'Encryption in transit and at rest',
  'Role-based access controls',
  'Clinical data access limits',
  'Operational logging',
  'Vendor review before clinical use',
  'Incident response process',
  'Data minimization practices',
  'AI training opt-out by design',
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
    q: 'Does AI train on Miwa data?',
    a: 'No. Miwa does not permit clinical data or protected health information to be used for AI model training.',
  },
  {
    q: 'Can Miwa staff access PHI?',
    a: 'Access is limited to authorized operational needs, such as security, support, or troubleshooting.',
  },
  {
    q: 'Do you sell data?',
    a: 'No. Miwa does not sell client data, therapist data, session data, transcripts, notes, assessment results, or de-identified clinical datasets.',
  },
  {
    q: 'Do you have SOC 2 or HITRUST?',
    a: 'Not yet. Miwa does not claim SOC 2 or HITRUST certification. We will update this page as additional independent reviews are completed.',
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
              Miwa is designed for clinicians who handle sensitive mental health information. The platform pairs documentation support with practical safeguards, so care teams can move faster without treating client data casually.
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
              Last reviewed May 2026. Security details are available for practice review.
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
                Practical safeguards for sensitive clinical work.
              </h2>
              <p className="mt-5 text-base leading-relaxed" style={{ color: MUTED }}>
                Miwa protects client information with layered controls across access, storage, AI assistance, support, and operational review. Practices can request additional security detail during onboarding.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {safeguards.map((item) => (
                <div key={item} className="flex min-h-[72px] items-center gap-3 rounded-lg bg-white px-4 py-3" style={{ border: '1px solid rgba(17,24,39,0.08)' }}>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ background: TEAL }}>
                    OK
                  </div>
                  <p className="text-sm font-semibold leading-snug" style={{ color: INK }}>{item}</p>
                </div>
              ))}
            </div>
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
            Send your compliance questions before using Miwa in a covered clinical workflow. We will help confirm the right contract and privacy configuration.
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
