import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = { background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '🚀',
    content: [
      {
        heading: 'Your First 5 Minutes with Miwa',
        body: `Miwa is an AI copilot for therapists. Here's how to get clinical value in under 5 minutes:

**Step 1: Create your account**
Visit miwa.care/register and select your credential type (Trainee, Associate, or Licensed). Your 14-day free trial starts immediately.

**Step 2: Add your first client**
Go to Patients → click "+ New Patient". Enter a client ID (e.g., CLT-001), optional display name, demographics, and presenting concerns. This context helps Miwa tailor its clinical support.

**Step 3: Start a session note**
Click into your client → "New Session". Choose your note format (SOAP, BIRP, or DAP). You can either:
- **Type** bullet-point session notes and Miwa will expand them into polished clinical language
- **Dictate** a 3-minute recap using the microphone button — Miwa generates all three note formats simultaneously

**Step 4: Review and sign**
Miwa generates the note with AI-suggested diagnosis codes and a CPT code. Review, edit if needed, and click "Sign & Lock."

**Step 5: Share an assessment**
From the client's profile, click "Send Assessment" -> choose PHQ-9, GAD-7, or PCL-5 -> generate a secure link. The client completes it on mobile and scores appear instantly in their chart. SMS delivery is disabled until Miwa completes the messaging BAA and consent workflow.`,
      },
    ],
  },
  {
    id: 'voice-notes',
    title: 'Voice Notes',
    icon: '🎙️',
    content: [
      {
        heading: 'Voice Dictation',
        body: `Miwa supports voice dictation for session notes. Instead of typing, click the microphone icon on any session note page.

**How it works:**
1. Click the mic icon (or press the keyboard shortcut)
2. Speak naturally — describe the session as you would to a colleague
3. Miwa transcribes your audio in real-time
4. When you stop, Miwa generates SOAP, BIRP, and DAP notes simultaneously
5. Review, edit, and sign

**Tips for best results:**
- Speak in complete thoughts, not one word at a time
- Include the client's mood, what you worked on, their response, and your plan
- You don't need to structure it — Miwa handles the formatting
- Sessions under 5 minutes work best for dictation accuracy
- Avoid background noise when possible`,
      },
      {
        heading: 'Multi-Format Output',
        body: `Every dictation produces three note formats at once:

- **SOAP** — Subjective, Objective, Assessment, Plan
- **BIRP** — Behavior, Intervention, Response, Plan
- **DAP** — Data, Assessment, Plan

Switch between formats instantly using the tabs at the top of the note. Each format uses the same clinical content but structures it according to the format's conventions. Your practice or supervisor may require a specific format — Miwa generates all three so you never have to re-dictate.`,
      },
    ],
  },
  {
    id: 'assessments',
    title: 'Assessments',
    icon: '📊',
    content: [
      {
        heading: 'Supported Assessments',
        body: `Miwa supports three validated screening instruments:

- **PHQ-9** — Patient Health Questionnaire (depression severity, 0–27)
- **GAD-7** — Generalized Anxiety Disorder scale (anxiety severity, 0–21)
- **PCL-5** — PTSD Checklist (trauma symptom severity, 0–80)

All instruments are scored automatically using official scoring algorithms. Severity levels (minimal, mild, moderate, moderately severe, severe) are assigned based on published clinical cutoffs.`,
      },
      {
        heading: 'Assessment Delivery',
        body: `Assessments are delivered through secure links. The client receives a link to a mobile-friendly form, completes it on their phone, and scores appear in their chart immediately.

**To send an assessment:**
1. Open a client's profile
2. Click "Send Assessment"
3. Select the assessment type (PHQ-9, GAD-7, or PCL-5)
4. Generate the secure link
5. Share it with the client through your approved communication workflow

Assessment links expire after 30 days. No app download is required for the client. SMS delivery is planned but remains disabled until the messaging vendor BAA, consent attestation, and operational controls are complete.`,
      },
      {
        heading: 'Outcome Tracking',
        body: `Visit the Outcomes page to see score trends across your entire caseload. Each client's assessment history is displayed as a timeline showing:

- Score values over time
- Severity level changes
- Improvement or deterioration flags
- Time since last assessment

Use this data in supervision, treatment planning, and when writing progress reports. Miwa can reference these trends in the copilot chat.`,
      },
    ],
  },
  {
    id: 'copilot',
    title: 'Miwa Copilot',
    icon: '🤖',
    content: [
      {
        heading: 'What Miwa Can Do',
        body: `Miwa is an agentic copilot — it doesn't just answer questions, it takes action. You can ask Miwa to:

- **Schedule appointments** — "Book AX-7812 for next Tuesday at 2pm"
- **Send assessments** — "Send PHQ-9 to all my anxiety clients"
- **Generate reports** — "Write a court progress report for CM-1055 covering January through March"
- **Answer clinical questions** — "What's the evidence for EMDR with complex trauma?"
- **Review caseloads** — "Who on my caseload is deteriorating?"
- **Draft documentation** — "Prepare a case presentation for supervision on BK-3290"

Miwa has full context on your caseload — assessment scores, session notes, risk flags, and treatment history. You don't need to repeat information it already knows.`,
      },
      {
        heading: 'Caseload Context',
        body: `Every conversation with Miwa starts with your full caseload loaded into context. Miwa knows:

- All your active clients and their IDs
- Latest assessment scores and trends
- Session dates and note content
- Risk flags and alerts
- Treatment modalities and diagnoses

This means you can ask natural questions like "How is Sarah doing?" and Miwa will pull up the right client, their recent scores, and any concerns — without you having to look anything up first.`,
      },
    ],
  },
  {
    id: 'scheduling',
    title: 'Scheduling',
    icon: '📅',
    content: [
      {
        heading: 'Visual Calendar',
        body: `The Schedule page shows a full week or month view of your appointments. You can:

- Click any time slot to create a new appointment
- Drag to adjust appointment times
- Switch between Week and Month views
- See appointment counts per day
- View today's appointments highlighted

Appointments show the client ID, time, and session type (telehealth or in-person).`,
      },
      {
        heading: 'Telehealth Integration',
        body: `If you've added a telehealth URL in Settings (Zoom, Doxy.me, Google Meet, etc.), Miwa will:

1. Store the link for appointment workflows
2. Show a "Start Session" button on scheduled appointments
3. Let you share the link through your approved client communication workflow

Set up your telehealth link: Settings → Telehealth URL → paste your video platform link → Save.`,
      },
    ],
  },
  {
    id: 'research',
    title: 'Research Briefs',
    icon: '📚',
    content: [
      {
        heading: 'How Research Briefs Work',
        body: `Miwa generates weekly research briefs tailored to your caseload. Sources include:

- **PubMed** — peer-reviewed clinical journals
- **OpenAlex** — 200M+ open-access academic works
- **Brave Search** — recent clinical news and guidelines (if configured)

Miwa analyzes your caseload's presenting concerns (anxiety, depression, trauma, etc.) and searches for the most relevant recent research. The AI synthesizes findings into a readable brief with clinical takeaways.

Research briefs are generated automatically every Monday. You can also generate one manually from the Briefs page.`,
      },
      {
        heading: 'Mental Health News',
        body: `The News tab on the Briefs page shows the latest mental health news from trusted sources. Each article includes a full AI-generated summary written for a clinician audience — not just a headline.

News refreshes automatically every 6 hours. You can also refresh manually. Articles are sourced from psychiatry.org, apa.org, NIMH, NAMI, and major clinical news outlets.`,
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    icon: '📋',
    content: [
      {
        heading: 'Available Report Types',
        body: `Ask Miwa to generate any of these report types through the Consult chat:

- **Court / legal progress reports** — Formatted for attorneys, probation officers, or judges. Includes attendance, assessment trends, clinical progress, and treatment recommendations.
- **Insurance summaries** — Clinical summaries formatted for managed care authorization or utilization review.
- **Supervision reports** — Case presentations, supervisee progress notes, and training documentation.

All reports pull from the client's actual session data, assessment scores, and clinical trajectory. Miwa cites specific data points rather than generating generic language.`,
      },
      {
        heading: 'How to Generate a Report',
        body: `In the Consult chat, simply ask:

- "Write a court progress report for AX-7812 covering January through March"
- "Generate an insurance summary for BK-3290"
- "Prepare a supervision case presentation for CM-1055"

Miwa will pull the relevant data, generate the report, and give you options to copy or export it.`,
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: '⚙️',
    content: [
      {
        heading: 'Profile',
        body: `Your profile includes your name, email, credential type, and license number. Miwa uses your name in greetings and your credential type to tailor its interaction style.

**Clinician Role** controls how Miwa communicates with you:
- **Trainee** — Socratic questioning, more explanations, supervision-oriented
- **Associate** — Balanced, collaborative approach
- **Licensed** — Direct, concise, peer-level communication`,
      },
      {
        heading: 'Telehealth URL',
        body: `Paste your video platform link (Zoom, Doxy.me, Google Meet, etc.). When appointments are scheduled, Miwa:
- Stores the link for appointment workflows
- Shows a "Start Session" button on your calendar

The same link is used for all telehealth sessions. If you use different links per client, you can update it before each session.`,
      },
      {
        heading: 'Themes',
        body: `Miwa supports three visual themes:
- **Default** — Light purple gradient with brand colors
- **Dark** — Dark navy/slate theme for low-light environments
- **Pink** — Warm pink theme

Change your theme in Settings → Appearance.`,
      },
    ],
  },
  {
    id: 'faq',
    title: 'FAQ',
    icon: '❓',
    content: [
      {
        heading: 'Frequently Asked Questions',
        body: `**Is Miwa HIPAA compliant?**
Miwa is built on HIPAA-aligned infrastructure: Azure hosting, Azure OpenAI for PHI-capable AI workflows, encrypted transport, HttpOnly cookie authentication, and no clinical data used to train AI models. Covered entities still need their own policies, BAAs, and configuration review.

**Does Miwa replace my EHR?**
Miwa is a clinical copilot, not an EHR. It sits alongside your existing workflow. Many clinicians use it as their primary documentation tool and export notes to their EHR.

**What AI models does Miwa use?**
Miwa uses an approved Azure OpenAI production path for clinical reasoning, note generation, consultation, and structured extraction tasks. All AI output is for clinical support only and must be reviewed.

**Can I use Miwa on mobile?**
Yes. Miwa is a progressive web app (PWA) that works on iOS and Android. You can add it to your home screen for an app-like experience. Voice dictation works on mobile.

**How do I cancel?**
You can cancel anytime from Settings → Billing. Your data remains accessible for 30 days after cancellation.

**Who qualifies for Pre-Licensed pricing?**
Anyone who isn't fully licensed: practicum interns, MFT trainees, and licensed associates (AMFT, ACSW, APCC). Full access at $39/mo.`,
      },
    ],
  },
]


export default function Docs() {
  const [activeSection, setActiveSection] = useState('getting-started')
  const section = SECTIONS.find(s => s.id === activeSection)

  return (
    <PublicPageShell>
      <PublicNav />

      <div className="max-w-[1400px] mx-auto px-8 lg:px-12 py-10">
        {/* Header */}
        <div className="mb-10">
          <p className="text-base font-bold uppercase tracking-widest mb-3" style={{ color: '#6047EE' }}>Documentation</p>
          <h1 className="text-3xl lg:text-4xl font-extrabold text-gray-900 mb-3">
            Miwa Docs
          </h1>
          <p className="text-gray-600 text-lg">Everything you need to get the most out of Miwa.</p>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24 space-y-1">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5 ${
                    activeSection === s.id
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className="text-base">{s.icon}</span>
                  {s.title}
                </button>
              ))}
            </div>
          </aside>

          {/* Mobile tab bar */}
          <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-4 -mx-8 px-8 mb-4 w-screen">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                  activeSection === s.id
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span>{s.icon}</span>
                {s.title}
              </button>
            ))}
          </div>

          {/* Content */}
          <main className="flex-1 min-w-0">
            {section && (
              <div key={section.id}>
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">{section.icon}</span>
                  <h2 className="text-2xl font-bold text-gray-900">{section.title}</h2>
                </div>

                <div className="space-y-8">
                  {section.content.map((block, i) => (
                    <div key={i} className="rounded-2xl bg-white p-6 lg:p-8" style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
                      <h3 className="text-lg font-bold text-gray-900 mb-4">{block.heading}</h3>
                      <div className="text-gray-700 text-base leading-relaxed whitespace-pre-wrap">
                        {block.body.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                          if (part.startsWith('**') && part.endsWith('**')) {
                            return <strong key={j} className="text-gray-900">{part.slice(2, -2)}</strong>
                          }
                          return <span key={j}>{part}</span>
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
