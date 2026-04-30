import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const PLANS = [
  {
    id: 'trainee',
    name: 'Trainee / Intern',
    badge: null,
    monthlyPrice: 39,
    annualPrice: 31,
    desc: 'MFT Trainee, ACSW Trainee, LPCC Intern. Requires supervisor verification.',
    cta: 'Start free trial',
    ctaHref: '/register',
    highlight: false,
    credType: 'trainee',
    includesFrom: null,
    features: [
      'Full Miwa AI copilot (no feature restrictions)',
      'Unlimited clients & sessions',
      'Voice → clinical notes (SOAP/BIRP/DAP/GIRP)',
      'Pre-session briefs — 60-second narrative 30 min before each session',
      'Active risk monitor — SI/HI/self-harm flags as you type',
      'Morning dashboard briefing with caseload triage',
      'Letter generator — ESA, school 504, return-to-work',
      'Learns your voice (style adapts after ~10 edits)',
      'Assessment delivery through secure links',
      'Living treatment plans with goal tracking',
      'Proactive alerts (deterioration, risk, overdue)',
      'Session attendance tracking',
      'Voice-first mobile app',
    ],
    notIncluded: ['Automated SMS outreach', 'Multi-step workflows', 'Court & insurance reports', 'Priority support'],
  },
  {
    id: 'associate',
    name: 'Associate',
    badge: null,
    monthlyPrice: 69,
    annualPrice: 55,
    desc: 'AMFT, ACSW, APCC — licensed associate.',
    cta: 'Start free trial',
    ctaHref: '/register',
    highlight: true,
    credType: 'associate',
    includesFrom: 'Trainee',
    features: [
      'Drafted outreach workflows',
      'Multi-step workflows (onboard, close, court prep)',
      'Batch assessment sender',
      'Attorney summaries & insurance pre-auth letters',
      'Court, insurance & supervision reports',
      'Practice intelligence (cross-client patterns)',
      'Document intake parsing (AI)',
      'Export to PDF',
      'Priority support',
    ],
    notIncluded: [],
  },
  {
    id: 'licensed',
    name: 'Licensed Therapist',
    badge: null,
    monthlyPrice: 129,
    annualPrice: 103,
    desc: 'LMFT, LCSW, LPCC — fully licensed. No verification needed.',
    cta: 'Start free trial',
    ctaHref: '/register',
    highlight: false,
    credType: 'licensed',
    includesFrom: 'Associate',
    features: [
      'No verification required',
      'All multi-step workflows unlocked',
      'Court prep & legal documentation',
      'Full practice intelligence dashboard',
      'Advanced report exports',
    ],
    notIncluded: [],
  },
]

const COMPETITORS = [
  { feature: 'Starting price (with AI notes)', miwa: '$39/mo', upheal: '$45/mo*', sp: '$84/mo**', tn: '$109/mo***' },
  { feature: 'AI notes included in base price', miwa: true, upheal: true, sp: 'Add-on $35/mo', tn: 'Add-on $40/mo' },
  { feature: 'Multi-step task execution', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Pre-session narrative briefs', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Active risk monitor (SI/HI flags as you type)', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Clinical letter generator (ESA, 504, etc.)', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Morning caseload briefing', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Learns your documentation voice', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Living treatment plan tracking', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Proactive deterioration alerts', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Drafted outreach workflows', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Assessment delivery through secure links', miwa: true, upheal: false, sp: false, tn: false },
  { feature: 'Pre-licensed pricing', miwa: '$39/mo', upheal: false, sp: false, tn: false },
  { feature: 'Voice-first mobile app', miwa: true, upheal: true, sp: true, tn: true },
  { feature: 'Client portal', miwa: true, upheal: true, sp: true, tn: true },
  { feature: 'Insurance billing', miwa: false, upheal: false, sp: true, tn: true },
  { feature: 'Telehealth scheduling support', miwa: true, upheal: true, sp: true, tn: '$15/mo' },
]

function Check() {
  return (
    <svg className="w-5 h-5 text-emerald-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function X() {
  return (
    <svg className="w-5 h-5 text-gray-300 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function Cell({ val }) {
  if (val === true) return <Check />
  if (val === false) return <X />
  return <span className="text-gray-600 text-base">{val}</span>
}

export default function Pricing() {
  const [annual, setAnnual] = useState(false)

  return (
    <PublicPageShell>

      <PublicNav />

      {/* Header */}
      <div className="text-center pt-32 pb-10 px-6">
        <p className="text-base font-bold uppercase tracking-widest mb-4" style={{ color: '#2dd4bf' }}>Pricing</p>
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-5">
          Simple pricing.<br />
          <span style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            No surprises.
          </span>
        </h1>
        <p className="text-gray-600 text-lg max-w-xl mx-auto mb-10">
          Start free. Upgrade when Miwa saves you more than it costs. Which happens fast.
        </p>

        {/* Pricing is per credential type, not a feature tier — no toggle needed */}
      </div>

      {/* Plan cards */}
      <div className="max-w-[1400px] mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map(plan => {
            const price = plan.monthlyPrice
            return (
              <div key={plan.id}
                className={`rounded-2xl p-7 flex flex-col relative bg-white ${plan.highlight ? 'ring-2' : ''}`}
                style={{
                  border: '1px solid rgba(0,0,0,0.08)',
                  boxShadow: plan.highlight ? '0 8px 40px rgba(96,71,238,0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
                  ...(plan.highlight ? { ringColor: '#6047EE' } : {}),
                }}>
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-sm font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}>
                    {plan.badge}
                  </div>
                )}

                <h2 className="text-xl font-bold mb-1 text-gray-900">{plan.name}</h2>
                <p className="text-base mb-5 leading-snug text-gray-500">{plan.desc}</p>

                <div className="mb-2">
                  {price === 0 ? (
                    <div className="text-4xl font-extrabold text-gray-900">Free</div>
                  ) : (
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-gray-900">${price}</span>
                      <span className="text-base mb-1.5 text-gray-400">/mo</span>
                    </div>
                  )}
                  {plan.perSeat && (
                    <p className="text-sm mt-0.5 text-indigo-600 font-medium">
                      Min. 3 clinicians included · +$39/mo each after
                    </p>
                  )}
                  {false && (
                    <p className="text-sm mt-0.5 text-emerald-600 font-medium">
                      Placeholder
                    </p>
                  )}
                </div>

                <Link to={plan.ctaHref}
                  className="block text-center py-3 rounded-xl text-base font-bold transition-all mt-2 mb-6 text-white hover:opacity-90"
                  style={{ background: plan.highlight ? 'linear-gradient(135deg, #6047EE, #2dd4bf)' : '#111' }}>
                  {plan.cta}
                </Link>

                <div className="flex-1">
                  {plan.includesFrom && (
                    <div className="flex items-center gap-1.5 mb-3 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100">
                      <svg className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm font-semibold text-indigo-700">Everything in {plan.includesFrom}, plus:</span>
                    </div>
                  )}
                  <ul className="space-y-2.5">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-base text-gray-700">
                        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                    {plan.notIncluded.map((f, i) => (
                      <li key={`not-${i}`} className="flex items-start gap-2 text-base text-gray-300">
                        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          })}
        </div>

        {/* Enterprise CTA */}
        <div className="mt-5 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-900">
          <div>
            <h3 className="font-bold text-white">Enterprise / Health System</h3>
            <p className="text-white/60 text-base mt-0.5">Custom contracts, EHR integration, SSO, volume pricing, BAA.</p>
          </div>
          <a href="mailto:hello@miwa.care"
            className="flex-shrink-0 px-6 py-3 rounded-xl text-base font-semibold text-white transition-all hover:opacity-90"
            style={{ border: '1px solid rgba(255,255,255,0.2)' }}>
            Contact sales
          </a>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-400 text-base">
            14-day free trial on paid plans. Cancel anytime. No questions asked.
          </p>
        </div>
      </div>

      {/* Competitor comparison table */}
      <div className="max-w-[1400px] mx-auto px-6 pb-24">
        <div className="text-center mb-10">
          <p className="text-base font-bold uppercase tracking-widest mb-3" style={{ color: '#2dd4bf' }}>How we compare</p>
          <h2 className="text-3xl font-bold text-gray-900">Miwa vs. the competition</h2>
          <p className="text-gray-500 text-base mt-2">Prices current as of April 2026. Competitors: Upheal, SimplePractice, TherapyNotes.</p>
        </div>

        <div className="rounded-2xl overflow-hidden bg-white" style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="grid grid-cols-5 text-center text-sm font-bold uppercase tracking-wide text-gray-500 px-4 py-3 bg-gray-50"
            style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div className="text-left col-span-1">Feature</div>
            <div style={{ color: '#6047EE' }}>Miwa</div>
            <div>Upheal</div>
            <div>SimplePractice</div>
            <div>TherapyNotes</div>
          </div>

          {COMPETITORS.map((row, i) => (
            <div key={i}
              className="grid grid-cols-5 text-center items-center px-4 py-3"
              style={{
                background: i % 2 === 0 ? '#fafafe' : '#fff',
                borderBottom: i < COMPETITORS.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
              }}>
              <div className="text-left text-base text-gray-700 font-medium col-span-1">{row.feature}</div>
              <div className="font-semibold" style={{ color: '#6047EE' }}><Cell val={row.miwa} /></div>
              <div><Cell val={row.upheal} /></div>
              <div><Cell val={row.sp} /></div>
              <div><Cell val={row.tn} /></div>
            </div>
          ))}
        </div>

        <p className="text-center text-gray-400 text-sm mt-4">
          Competitor pricing and feature availability can change. Verify current plan details before making a purchasing decision.
        </p>
        <p className="text-center text-gray-400 text-sm mt-2">
          Miwa is purpose-built for therapists' actual workflows: pre-session briefs, risk monitoring, letter generation, morning caseload briefings, and learned documentation voice in one workspace.
        </p>
      </div>

      {/* Bottom CTA */}
      <div className="text-center pb-24 px-6 pt-16"
        style={{ background: 'linear-gradient(160deg, rgba(96,71,238,0.05) 0%, rgba(45,212,191,0.04) 100%)' }}>
        <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Ready to reclaim your time?</h2>
        <p className="text-gray-600 text-lg mb-8 max-w-md mx-auto">
          The average clinician saves 6–8 hours/week with Miwa. At your billing rate, that's your subscription cost back on day one.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/register" className="px-10 py-4 rounded-xl text-lg font-bold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}>
            Start free, no credit card
          </Link>
          <Link to="/for-trainees"
            className="px-10 py-4 rounded-xl text-lg font-medium text-gray-700 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.15)' }}>
            I'm pre-licensed →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
