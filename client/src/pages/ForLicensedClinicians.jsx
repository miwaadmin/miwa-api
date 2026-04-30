import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'
const GRAD = `linear-gradient(135deg, ${PURPLE} 0%, ${TEAL} 100%)`
const GRAD_TEXT = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

/* Continuity-brief mockup — the signature feature for licensed clinicians */
function ContinuityBriefMockup() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: '#111113', border: '1px solid rgba(0,0,0,0.15)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#161618', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400/70" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/70" />
          <div className="w-2 h-2 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-white/25 ml-2">miwa.care · 3:00 PM session with Maria</span>
      </div>
      <div className="p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
            style={{ background: 'rgba(96,71,238,0.15)', color: '#a99dff' }}>
            ✦ Pre-session brief — ready
          </span>
          <span className="text-[10px] text-white/30">generated 30 min ago</span>
        </div>
        <p className="text-[13px] text-white/85 leading-relaxed">
          Today's session with Maria. Last session you focused on her mom's diagnosis — homework was the thought record, and you flagged shame as the next theme to explore.
        </p>
        <p className="text-[13px] text-white/85 leading-relaxed">
          Her mid-week check-in mood was 2/5; she mentioned not sleeping. Two threads worth picking up: (1) the unfinished narrative about her sister, (2) the avoidance of the homework.
        </p>
        <p className="text-[13px] text-amber-300/90 leading-relaxed">
          ⚠ PHQ-9 trending up (12 → 16). Consider a re-screen.
        </p>
        <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <MiwaLogo size={12} />
          <p className="text-[10px] text-white/40">Synthesized from last note · check-ins · PHQ-9 trend</p>
        </div>
      </div>
    </div>
  )
}

/* Risk monitor inline nudge mockup */
function RiskMonitorMockup() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: '#0a0818', border: '1px solid rgba(0,0,0,0.15)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#0f0c22', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400/70" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/70" />
          <div className="w-2 h-2 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-white/25 ml-2">miwa.care · session note — in progress</span>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Subjective</p>
        <p className="text-[12px] text-white/75 leading-relaxed">
          Client reports increased hopelessness this week. States she's been feeling like a burden to her family. Endorses passive thoughts about not wanting to wake up…
        </p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 p-3 flex items-start gap-2.5">
          <span className="text-amber-400 text-sm">⚠</span>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-amber-300 uppercase tracking-wider mb-1">Suicidal ideation language</p>
            <p className="text-[11px] text-amber-100/85 leading-relaxed">
              SI language detected. No C-SSRS in the last 2 weeks — consider administering before signing.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ForLicensedClinicians() {
  return (
    <PublicPageShell>
      <PublicNav />

      {/* Hero — centered text + big mockup below (Notion/Figma style) */}
      <div className="text-center pt-32 pb-12 px-6 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6 leading-[1.05] tracking-tight">
          The assistant you'd hire{' '}
          <span style={GRAD_TEXT}>if you could afford one.</span>
        </h1>
        <p className="text-gray-700 text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
          Miwa is an AI assistant built specifically for licensed clinicians. It prepares your sessions, flags safety concerns as you type, drafts letters, and learns to sound like you — so you can see more clients without running on empty.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap mb-3">
          <Link to="/register"
            className="inline-flex px-8 py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
            style={{ background: '#111113' }}>
            Start free — no credit card
          </Link>
          <Link to="/features"
            className="inline-flex px-6 py-3.5 rounded-xl text-base font-medium text-gray-700 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            See every feature →
          </Link>
        </div>
        <p className="text-gray-400 text-sm">14-day free trial. $129/mo after. Cancel any time.</p>
      </div>

      {/* BIG hero mockup — the signature continuity brief in full */}
      <div className="max-w-[1200px] mx-auto px-6 pb-24">
        <div className="rounded-3xl overflow-hidden shadow-2xl" style={{
          background: 'linear-gradient(180deg, rgba(96,71,238,0.03), rgba(45,212,191,0.03))',
          border: '1px solid rgba(96,71,238,0.12)',
          padding: '32px',
        }}>
          <ContinuityBriefMockup />
          <p className="text-center text-gray-500 text-sm mt-6 italic">
            A real pre-session brief — synthesized from your last note, their check-ins, and their assessment trends. Ready 30 minutes before every appointment.
          </p>
        </div>
      </div>

      {/* Section: continuity (copy-only, mockup already shown above) */}
      <div className="max-w-[900px] mx-auto px-6 py-16 text-center"
        style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-5">
          Never walk into a session cold.
        </h2>
        <p className="text-gray-700 text-lg leading-relaxed mb-4">
          Most platforms summarize the last note. Miwa synthesizes everything that's happened since — the note, the mid-week check-ins, the assessment shifts, the treatment plan goals — into a short narrative you can read in the hallway.
        </p>
        <p className="text-gray-500 text-base leading-relaxed">
          It's the demo that makes clinicians say "this is different."
        </p>
      </div>

      {/* Section: Active risk monitor — big mockup + copy */}
      <div className="py-20 px-6" style={{ borderTop: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
        <div className="max-w-[900px] mx-auto text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-5">
            A second pair of eyes on your notes.
          </h2>
          <p className="text-gray-700 text-lg leading-relaxed">
            Miwa watches your language as you type. If risk content appears — SI, HI, self-harm, abuse disclosure — and the matching screener isn't already in the chart, Miwa surfaces a non-blocking nudge.
          </p>
        </div>
        <div className="max-w-[1000px] mx-auto">
          <div className="rounded-3xl overflow-hidden shadow-2xl" style={{ padding: '24px', background: 'white', border: '1px solid rgba(0,0,0,0.08)' }}>
            <RiskMonitorMockup />
          </div>
          <p className="text-center text-gray-500 text-sm mt-6 italic max-w-2xl mx-auto">
            Knows the difference between "client endorses passive SI" and "client denied SI." No nagging on routine clearance language. No liability surprises on review.
          </p>
        </div>
      </div>

      {/* Everything else grid */}
      <div className="max-w-[1400px] mx-auto px-6 py-20" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Built for how your week actually works.
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Not billing software with AI bolted on. Not an EHR pretending to help you think. An assistant for the clinical work only you can do.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              title: 'Voice → clinical notes',
              desc: 'Dictate a 3-minute recap. Miwa drafts SOAP, BIRP, DAP, and GIRP simultaneously. ICD-10 codes suggested. You review and sign.',
              color: '#6047EE',
            },
            {
              title: 'Learns your voice',
              desc: 'Every time you edit a draft, Miwa learns your style. After ~10 sessions, the first draft already sounds like you wrote it.',
              color: '#2dd4bf',
            },
            {
              title: 'Letter generator',
              desc: 'ESA letters, school accommodation support, insurance pre-auths, attorney summaries, return-to-work letters. Drafted from the chart in your voice — review and sign.',
              color: '#ec4899',
            },
            {
              title: 'Morning briefing',
              desc: 'Start the day with who needs attention, who\'s improving, and who\'s overdue for a check-in. Sorted by clinical urgency on the dashboard.',
              color: '#f59e0b',
            },
            {
              title: 'Assessment delivery',
              desc: 'Share PHQ-9, GAD-7, PCL-5, C-SSRS, and more through secure links. Scores appear instantly with trend tracking. SMS is coming after BAA and consent controls are complete.',
              color: '#0ea5e9',
            },
            {
              title: 'Living treatment plans',
              desc: 'Treatment plans that update as sessions progress. Goals, objectives, and auto-progress tracking — without the quarterly rewrite.',
              color: '#10b981',
            },
            {
              title: 'Proactive outreach',
              desc: 'Deterioration detection, risk review flags, overdue assessment alerts. Miwa watches the caseload between sessions, not just during them.',
              color: '#8b5cf6',
            },
            {
              title: 'Telehealth + scheduling',
              desc: 'Google Meet links auto-generated on appointment create. Picture-in-picture chart view during session. No knock-screen for clients.',
              color: '#14b8a6',
            },
            {
              title: 'HIPAA-aligned infrastructure',
              desc: 'Azure-hosted production path, Azure OpenAI for PHI-capable AI workflows, and no clinical data used to train AI models.',
              color: '#64748b',
            },
          ].map((f, i) => (
            <div key={i} className="p-5 rounded-2xl bg-white transition-all hover:shadow-md"
              style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                style={{ background: `${f.color}18` }}>
                <div className="w-4 h-4 rounded-full" style={{ background: f.color }} />
              </div>
              <p className="text-gray-900 font-bold text-base mb-1.5">{f.title}</p>
              <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The philosophy */}
      <div className="py-20 px-6" style={{ background: 'rgba(0,0,0,0.02)', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-5">
            You are the clinician. Miwa is the assistant.
          </h2>
          <p className="text-gray-700 text-lg leading-relaxed mb-4">
            Every output is a draft. Every decision is yours. Miwa is built to save you the mechanical work — composing notes, tracking outcomes, drafting letters — so your clinical time is spent on the things only you can do: thinking, attuning, choosing the intervention, being present with the client in the room.
          </p>
          <p className="text-gray-500 text-base leading-relaxed">
            Miwa doesn't practice therapy. You do.
          </p>
        </div>
      </div>

      {/* Pricing anchor */}
      <div className="py-20 px-6 text-center" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: TEAL }}>Pricing</p>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">
          $129/mo for the full copilot.
        </h2>
        <p className="text-gray-600 text-base max-w-xl mx-auto mb-2">
          No verification requirements. No per-note AI charge. No add-on bundle.
        </p>
        <p className="text-gray-500 text-sm max-w-xl mx-auto mb-8">
          SimplePractice starts at $49/mo without AI ($84 with). TherapyNotes starts at $69/mo without AI ($109 with). Miwa includes every agentic feature at the licensed tier.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/register"
            className="inline-flex px-10 py-4 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
            style={{ background: '#111113' }}>
            Start 14-day free trial
          </Link>
          <Link to="/pricing"
            className="inline-flex px-8 py-4 rounded-xl text-base font-medium text-gray-600 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            Compare all plans →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
