import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'
const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = { background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }

/* ── Shared mini mock window ──────────────────────────────────────── */
function Mock({ children, url = 'miwa.care' }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#0a0818', border: '1px solid rgba(96,71,238,0.25)' }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: '#0f0c22', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-red-400/50" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/50" />
          <div className="w-2 h-2 rounded-full bg-green-400/50" />
        </div>
        <span className="text-[8px] text-white/20 ml-1.5">{url}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

/* ── Feature showcase cards ───────────────────────────────────────── */

const SHOWCASE = [
  {
    title: 'AI Progress Notes',
    desc: 'Dictate a 3-minute session recap. Miwa generates SOAP, BIRP, and DAP notes simultaneously — ready to sign.',
    color: '#22c55e',
    mockup: (
      <Mock url="miwa.care/workspace">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] text-red-400">Recording…</span>
            <span className="text-[8px] text-red-400/40 ml-auto">0:47</span>
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[8px] font-bold uppercase" style={{ color: PURPLE }}>SOAP — Generated</span>
            {['SOAP','BIRP','DAP'].map(f => (
              <span key={f} className="text-[7px] px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}>{f}</span>
            ))}
          </div>
          {[
            { l: 'S', t: 'Client reported improved sleep and reduced avoidance.' },
            { l: 'O', t: 'Engaged, affect euthymic, eye contact maintained.' },
            { l: 'A', t: 'PTSD (F43.10) — early response to CPT protocol.' },
            { l: 'P', t: 'Continue CPT. Assign thought record. F/U 1 week.' },
          ].map(r => (
            <div key={r.l} className="flex gap-1.5">
              <span className="text-[8px] font-bold w-2.5 flex-shrink-0" style={{ color: PURPLE + '88' }}>{r.l}</span>
              <span className="text-[8px] text-white/45 leading-relaxed">{r.t}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-[8px] font-semibold text-white/60 px-1.5 py-0.5 rounded" style={{ background: 'rgba(96,71,238,0.2)' }}>90837</span>
            <span className="text-[8px] ml-auto" style={{ color: TEAL }}>✓ Ready to sign</span>
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Miwa Copilot',
    desc: 'Talk to Miwa like a colleague. It spots what your caseload needs and handles it — scheduling, assessments, reports — through plain conversation.',
    color: '#6366f1',
    mockup: (
      <Mock url="miwa.care/consult">
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <div className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: 'rgba(96,71,238,0.3)' }}>
              <MiwaLogo size={8} />
            </div>
            <div className="text-[8px] text-white/50 rounded-lg rounded-tl-sm px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
              Marcus's PHQ-9 jumped 8→14. Safety check-in recommended.
            </div>
          </div>
          <div className="flex justify-end">
            <div className="text-[8px] text-white rounded-lg rounded-tr-sm px-2 py-1.5" style={{ background: 'rgba(96,71,238,0.3)' }}>
              Create a secure check-in link today
            </div>
          </div>
          <div className="flex gap-1.5">
            <div className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: 'rgba(96,71,238,0.3)' }}>
              <MiwaLogo size={8} />
            </div>
            <div className="text-[8px] text-white/50 rounded-lg rounded-tl-sm px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
              Done ✓ Secure mood check-in link created. I also scheduled a follow-up for Thursday 2pm.
            </div>
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Outcome Tracking',
    desc: 'PHQ-9, GAD-7, PCL-5, and C-SSRS shared through secure links. Clients complete on mobile. Scores appear instantly with trend tracking. SMS is coming after BAA and consent controls are complete.',
    color: '#4dc4ff',
    mockup: (
      <Mock url="miwa.care/outcomes">
        <div className="space-y-2">
          <div className="text-[8px] font-bold text-white/30 uppercase tracking-wide">PHQ-9 Trend — Marcus T.</div>
          <div className="flex items-end gap-1 h-12">
            {[18, 16, 14, 12, 9, 7].map((v, i) => (
              <div key={i} className="flex-1 rounded-sm" style={{ height: `${(v / 20) * 100}%`, background: v > 14 ? '#ef4444' : v > 9 ? '#f59e0b' : '#22c55e', opacity: 0.7 + (i * 0.05) }} />
            ))}
          </div>
          <div className="flex justify-between text-[7px] text-white/25">
            <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-bold">↓ 11pts</span>
            <span className="text-[8px] text-white/30">Significant improvement</span>
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Pre-Session Briefs',
    desc: 'A 60-second narrative ready 30 min before every session: where you left off, mid-week check-ins, assessment shifts, and two threads worth picking up.',
    color: '#8b5cf6',
    mockup: (
      <Mock url="miwa.care/brief">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[7px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400">✦ Brief ready</span>
            <span className="text-[8px] text-white/25">3:00 PM — Maria R.</span>
          </div>
          <p className="text-[8px] text-white/65 leading-relaxed">
            Today's session with Maria. Last session you focused on her mom's diagnosis. Her mid-week check-in mood was 2/5; she mentioned not sleeping.
          </p>
          <p className="text-[8px] text-white/55 leading-relaxed">
            Two threads worth picking up: (1) the unfinished narrative about her sister, (2) the avoidance of the homework.
          </p>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[7px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold">⚠ PHQ-9 12→16 — consider re-screen</span>
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Active Risk Monitor',
    desc: 'As you type session notes, Miwa watches for risk language (SI, HI, self-harm, abuse) and nudges you toward the right screening tool if it\'s not already on file.',
    color: '#f59e0b',
    mockup: (
      <Mock url="miwa.care/session-note">
        <div className="space-y-2">
          <p className="text-[7px] font-bold text-white/40 uppercase">Subjective</p>
          <p className="text-[8px] text-white/55 leading-relaxed">
            Client reports increased hopelessness. States she's been feeling like a burden. Endorses passive thoughts about not wanting to wake up…
          </p>
          <div className="rounded-md p-2 flex items-start gap-1.5" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <span className="text-amber-400 text-[9px]">⚠</span>
            <div>
              <p className="text-[7px] font-bold text-amber-300 uppercase tracking-wider">Suicidal ideation language</p>
              <p className="text-[7px] text-amber-100/80 leading-relaxed">No C-SSRS in last 2 weeks — consider administering before signing.</p>
            </div>
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Letter Generator',
    desc: 'ESA letters, school 504 support, insurance pre-auth, attorney summaries, return-to-work — drafted from the chart in your voice. Review, edit, sign.',
    color: '#ec4899',
    mockup: (
      <Mock url="miwa.care/letters">
        <div className="space-y-1.5">
          <p className="text-[7px] font-bold uppercase tracking-wide text-pink-400">Generate letter</p>
          {[
            { label: 'ESA Letter (Housing / Travel)', ready: true },
            { label: 'School 504 Accommodation', ready: true },
            { label: 'Insurance Pre-Authorization', ready: false },
            { label: 'Attorney Summary (ROI required)', ready: false },
            { label: 'Return-to-Work / Fitness for Duty', ready: false },
          ].map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded"
              style={{ background: t.ready ? 'rgba(236,72,153,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${t.ready ? 'rgba(236,72,153,0.25)' : 'rgba(255,255,255,0.06)'}` }}>
              <span className="text-[7px] text-white/60 font-medium flex-1">{t.label}</span>
              {t.ready && <span className="text-[7px] px-1 py-0.5 rounded bg-pink-500/25 text-pink-300 font-bold">Draft →</span>}
            </div>
          ))}
        </div>
      </Mock>
    ),
  },
  {
    title: 'Morning Briefing',
    desc: 'A dashboard briefing for the start of the day: who needs attention, who\'s improving, who\'s overdue, and what to prep first.',
    color: '#14b8a6',
    mockup: (
      <Mock url="admin@miwa.care inbox">
        <div className="space-y-1.5">
          <p className="text-[7px] font-bold uppercase tracking-wide text-teal-400">☀ Your day — Friday</p>
          <p className="text-[7px] text-white/55 leading-relaxed">Quick read on your 12 clients overnight:</p>
          <div className="space-y-1">
            {[
              { color: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', text: '⚠ Maria — PHQ-9 jumped (12→16). Re-screen before session.' },
              { color: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)', text: '↓ Marcus — completed homework early. Worth acknowledging.' },
              { color: 'rgba(96,71,238,0.15)', border: 'rgba(96,71,238,0.3)', text: '✦ New referral — intake packet not yet sent.' },
              { color: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: '· 8 stable clients on autopilot.' },
            ].map((row, i) => (
              <p key={i} className="text-[7px] text-white/55 px-1.5 py-1 rounded" style={{ background: row.color, border: `1px solid ${row.border}` }}>
                {row.text}
              </p>
            ))}
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Treatment Plan Agent',
    desc: 'Living treatment plans that update as sessions progress. Goals, objectives, and interventions stay current automatically.',
    color: '#10b981',
    mockup: (
      <Mock url="miwa.care/treatment-plan">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[7px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Treatment Plan</span>
            <span className="text-[8px] text-white/25">Marcus T.</span>
          </div>
          {[
            { goal: 'Reduce depressive symptoms', status: 'In progress', score: 'PHQ-9: 14 → target 5', color: '#f59e0b' },
            { goal: 'Decrease avoidance behaviors', status: 'Improving', score: '3 of 5 objectives met', color: '#22c55e' },
            { goal: 'Improve sleep hygiene', status: 'Met', score: 'ISI: 4 (subclinical)', color: '#22c55e' },
          ].map((g, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${g.color}` }}>
              <div className="flex-1">
                <span className="text-[8px] text-white/70 font-semibold block">{g.goal}</span>
                <span className="text-[7px] text-white/30">{g.score}</span>
              </div>
              <span className="text-[7px] px-1 py-0.5 rounded" style={{ background: g.color + '20', color: g.color }}>{g.status}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[7px] text-white/20">Auto-updated from session notes</span>
          </div>
        </div>
      </Mock>
    ),
  },
  {
    title: 'Reports',
    desc: 'Generate court reports, insurance summaries, and supervision documentation from session data in seconds.',
    color: '#f472b6',
    mockup: (
      <Mock url="miwa.care/consult">
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <div className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: 'rgba(96,71,238,0.3)' }}>
              <MiwaLogo size={8} />
            </div>
            <div className="text-[8px] text-white/50 rounded-lg rounded-tl-sm px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
              Here's the court progress report for Jordan M. covering Jan–Mar 2026:
            </div>
          </div>
          <div className="rounded-md px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[8px] font-bold text-white/60 mb-0.5">Progress Report — Jordan M.</p>
            <p className="text-[7px] text-white/35">Treatment period: Jan 6 – Mar 28, 2026</p>
            <p className="text-[7px] text-white/35">Sessions attended: 12 of 12 scheduled</p>
            <p className="text-[7px] text-white/35">PHQ-9: 18 → 9 (significant improvement)</p>
          </div>
          <div className="flex gap-1.5">
            <span className="text-[7px] px-1.5 py-0.5 rounded-md text-white font-bold" style={{ background: GRAD }}>Export PDF</span>
            <span className="text-[7px] px-1.5 py-0.5 rounded-md text-white/50" style={{ border: '1px solid rgba(255,255,255,0.15)' }}>Copy</span>
          </div>
        </div>
      </Mock>
    ),
  },
]

/* ── Detailed feature list ────────────────────────────────────────── */

const FEATURES = [
  { category: 'Miwa Copilot', color: '#6366f1', items: [
    { title: 'Plain-language interface', desc: 'Talk to Miwa like a colleague. It understands clinical language, reads context, and handles multi-step work — not just answers.' },
    { title: 'Multi-step task execution', desc: 'Miwa plans and executes complex workflows: client onboarding, case closure, court prep — all through conversation.' },
    { title: 'Full caseload context', desc: 'Every Miwa session starts with your entire caseload: scores, trends, risk flags, and treatment progress.' },
    { title: 'Learns your voice', desc: 'Every time you edit an AI draft, Miwa learns your style. After ~10 sessions, the first draft already sounds like you wrote it.' },
  ]},
  { category: 'Active Risk Monitor', color: '#f59e0b', items: [
    { title: 'Real-time language scanning', desc: 'Miwa watches your session notes for SI, HI, self-harm, and abuse disclosure language as you type — non-blocking, never in your way.' },
    { title: 'Screener-coverage check', desc: 'If the risk matches a screener (C-SSRS, Tarasoff) you haven\'t administered recently, Miwa nudges you to consider one.' },
    { title: 'Knows denial from disclosure', desc: 'It can tell "client denied SI" from "client endorses passive SI" — no nagging on routine clearance language.' },
    { title: 'Liability-aware documentation', desc: 'Helps ensure the right screen is on file when risk content appears in a signed note. Your clinical judgment still leads.' },
  ]},
  { category: 'Letter & Form Generator', color: '#ec4899', items: [
    { title: 'Five clinical templates', desc: 'ESA letters, school 504 support, insurance pre-authorization, attorney summaries, return-to-work / fitness-for-duty.' },
    { title: 'Drafted from the chart', desc: 'Miwa pulls diagnosis, treatment course, assessment scores, and functional observations. You pick the template; Miwa writes the first draft.' },
    { title: 'In your clinical voice', desc: 'Uses your letterhead, credentials, and (once learned) your writing style. Never invents facts that aren\'t in the chart.' },
    { title: 'Review, edit, finalize', desc: 'Every letter is a draft. You edit inline, save, finalize, copy, or download — sign before sending.' },
  ]},
  { category: 'Morning Briefing', color: '#14b8a6', items: [
    { title: 'Morning dashboard brief', desc: 'The single thing every clinician opens to start the day: caseload pulse, prep priorities, and recent changes.' },
    { title: 'Per-client status', desc: 'Every active client labeled: stable, improving, needs attention, overdue, or new referral — sorted by clinical urgency, not schedule order.' },
    { title: 'Suggested prep order', desc: 'Miwa recommends which client to prep first if you only have 20 minutes before your first session.' },
    { title: 'Overnight assessment completions', desc: 'Any scores that came in overnight are surfaced with trend context — improving or concerning.' },
  ]},
  { category: 'Pre-Session Briefs', color: '#8b5cf6', items: [
    { title: 'Auto-generated before appointments', desc: 'Miwa prepares a clinical brief 30 minutes before each session — last session summary, score trends, and open goals.' },
    { title: 'Treatment continuity', desc: 'Never start a session cold. See what was discussed, what homework was assigned, and what to follow up on.' },
    { title: 'Risk and alert summary', desc: 'Any deterioration flags, overdue assessments, or safety concerns are highlighted at the top of the brief.' },
    { title: 'Goal tracking context', desc: 'Active treatment plan goals and progress are surfaced so you can check in on what matters.' },
  ]},
  { category: 'Clinical Documentation', color: '#22c55e', items: [
    { title: 'Voice dictation → notes', desc: 'Record a 3-minute session recap. Receive a formatted SOAP, BIRP, or DAP note in seconds.' },
    { title: 'Note enrichment', desc: 'ICD-10 code suggestions, risk flags, and continuity threading added automatically to every note.' },
    { title: 'Multi-format output', desc: 'SOAP, BIRP, and DAP generated simultaneously from a single dictation. Switch formats instantly.' },
    { title: 'Session attendance tracking', desc: 'Check-in, late arrival, no-show, and cancellation tracking for every session.' },
  ]},
  { category: 'Treatment Plan Agent', color: '#10b981', items: [
    { title: 'Living treatment plans', desc: 'Treatment plans that update automatically as sessions progress — goals, objectives, and interventions stay current.' },
    { title: 'Auto-progress tracking', desc: 'Miwa tracks goal progress across sessions and flags when objectives are met or stalled.' },
    { title: 'Measurable outcomes', desc: 'Assessment scores are linked directly to treatment goals, so progress is data-driven.' },
    { title: 'Plan generation', desc: 'Generate treatment plans from intake data, or let Miwa evolve them from session notes over time.' },
  ]},
  { category: 'Proactive Alerts & Outreach', color: '#f59e0b', items: [
    { title: 'Deterioration detection', desc: 'Miwa monitors score trajectories and alerts you when a client is worsening — before the next session.' },
    { title: 'Risk review flags', desc: 'Safety concerns from session notes and assessment scores are surfaced proactively for clinical review.' },
    { title: 'Drafted outreach workflows', desc: 'Miwa can help prepare appointment reminders, missed-session follow-ups, and mood check-ins. SMS sending stays disabled until BAA and consent controls are complete.' },
    { title: 'Overdue assessment alerts', desc: 'Miwa tracks assessment cadences and flags when clients are overdue for PHQ-9, GAD-7, or PCL-5.' },
  ]},
  { category: 'Assessment Delivery', color: '#4dc4ff', items: [
    { title: 'PHQ-9, GAD-7, PCL-5, C-SSRS secure links', desc: 'Share validated screening tools directly with clients. Scores appear instantly with trend tracking.' },
    { title: 'Batch assessment sender', desc: 'Send assessments to your entire caseload or filtered subsets at once. Miwa handles delivery and timing.' },
    { title: 'Trend tracking', desc: 'Score history charts show trajectory: improving, stable, or deteriorating — at a glance.' },
    { title: 'Automated cadences', desc: 'Set recurring assessment schedules per client. Miwa handles delivery, reminders, and follow-up.' },
  ]},
  { category: 'Practice Intelligence & Reports', color: '#f472b6', items: [
    { title: 'Cross-client pattern discovery', desc: 'Miwa identifies patterns across your caseload: common stressors, treatment response trends, and cohort insights.' },
    { title: 'Court & legal reports', desc: 'Professional progress reports formatted for court, attorneys, or probation officers — generated in seconds.' },
    { title: 'Supervision reports', desc: 'Structured supervision notes, case conceptualizations, and training documentation.' },
    { title: 'Research briefs', desc: 'Weekly peer-reviewed research synthesis tailored to your caseload specialties.' },
  ]},
]


/* ── Page ─────────────────────────────────────────────────────────── */

export default function FeaturesPage() {
  const [hoveredShowcase, setHoveredShowcase] = useState(null)

  return (
    <PublicPageShell>
      <PublicNav />

      {/* Hero — centered to match Pricing / Home */}
      <div className="text-center pt-32 pb-14 px-6">
        <p className="text-base font-bold uppercase tracking-widest mb-4" style={{ color: PURPLE }}>Features</p>
        <h1 className="text-4xl lg:text-5xl font-extrabold text-gray-900 mb-5" style={{ textWrap: 'balance' }}>
          Everything your practice needs.{' '}
          <span style={GRAD_TEXT}>Nothing it doesn't.</span>
        </h1>
        <p className="text-gray-700 text-lg max-w-2xl mx-auto">
          An AI assistant built specifically for therapists: pre-session briefs, safety flags, letter drafting, morning caseload briefings, and living treatment plans in one clinical workspace.
        </p>
      </div>

      {/* ── Interactive showcase grid (Upheal-style) ────────────────── */}
      <div className="max-w-[1400px] mx-auto px-8 lg:px-12 pb-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SHOWCASE.map((item, i) => (
            <div
              key={i}
              className="rounded-2xl overflow-hidden bg-white transition-all duration-300 group"
              style={{
                border: hoveredShowcase === i ? `1px solid ${item.color}40` : '1px solid rgba(0,0,0,0.08)',
                boxShadow: hoveredShowcase === i ? `0 8px 30px ${item.color}15` : '0 1px 3px rgba(0,0,0,0.06)',
              }}
              onMouseEnter={() => setHoveredShowcase(i)}
              onMouseLeave={() => setHoveredShowcase(null)}
            >
              {/* Mockup area */}
              <div className="p-4 pb-3">
                {item.mockup}
              </div>
              {/* Text */}
              <div className="px-5 pb-5 pt-2">
                <h3 className="text-lg font-bold text-gray-900 mb-1.5">{item.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Detailed feature list ───────────────────────────────────── */}
      <div className="py-16 px-8 lg:px-12" style={{ background: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-[1400px] mx-auto">
          <p className="text-base font-bold uppercase tracking-widest mb-3" style={{ color: TEAL }}>Full Feature List</p>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-12">
            Every tool,{' '}
            <span style={GRAD_TEXT}>in detail</span>
          </h2>

          <div className="space-y-16">
            {FEATURES.map((cat, ci) => (
              <div key={ci}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1.5 h-7 rounded-full" style={{ background: cat.color }} />
                  <h3 className="text-xl font-bold text-gray-900">{cat.category}</h3>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {cat.items.map((item, ii) => (
                    <div key={ii} className="rounded-xl p-5 bg-white"
                      style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
                      <div className="w-2 h-2 rounded-full mb-3" style={{ background: cat.color }} />
                      <h4 className="font-bold text-gray-900 mb-1.5 text-base">{item.title}</h4>
                      <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="px-8 lg:px-12 py-20" style={{ background: 'linear-gradient(160deg, rgba(96,71,238,0.04) 0%, rgba(45,212,191,0.03) 100%)', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-[1400px] mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">
            Ready to try Miwa?
          </h2>
          <p className="text-gray-600 text-lg mb-8">Start free. No credit card required.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="px-10 py-4 rounded-xl text-lg font-bold text-white hover:opacity-90 transition-all" style={{ background: GRAD }}>Start free</Link>
            <Link to="/pricing" className="px-10 py-4 rounded-xl text-lg font-medium text-gray-700 hover:text-gray-900 transition-all"
              style={{ border: '1px solid rgba(0,0,0,0.15)' }}>See pricing →</Link>
          </div>
        </div>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
