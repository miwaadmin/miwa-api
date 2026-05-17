const APP_HELP_KB = [
  { id: 'getting-started', title: 'Getting Started', content: [
    { heading: 'Your First 5 Minutes with Miwa', body: 'Step 1: Create your account at miwa.care/register. Step 2: Go to Patients and click "+ New Patient" to add a client. Step 3: Click into your client, then "New Session" to start a note. Choose SOAP, BIRP, or DAP. You can type bullet-point notes or dictate a recap using the mic button. Step 4: Review the AI-generated note with diagnosis codes, edit if needed, and click "Sign & Lock". Step 5: Share an assessment (PHQ-9, GAD-7, or PCL-5) through a secure link from the client profile. SMS requires explicit consent and is handled as a HIPAA-compliant, minimum-necessary workflow.' },
  ]},
  { id: 'voice-notes', title: 'Voice Notes & Dictation', content: [
    { heading: 'Voice Dictation', body: 'Click the mic icon on any session note page. Speak naturally — describe the session as you would to a colleague. Miwa transcribes your audio and generates SOAP, BIRP, DAP, and GIRP notes simultaneously. Tips: speak in complete thoughts, include the client mood, what you worked on, their response, and your plan. Sessions under 5 minutes work best.' },
    { heading: 'Multi-Format Output', body: 'Every dictation produces all four note formats at once (SOAP, BIRP, DAP, GIRP). Switch between formats using the tabs. Your practice or supervisor may require a specific format — Miwa generates all of them so you never have to re-dictate.' },
  ]},
  { id: 'assessments', title: 'Assessments', content: [
    { heading: 'Supported Assessments', body: 'Miwa supports PHQ-9 (depression, 0-27), GAD-7 (anxiety, 0-21), and PCL-5 (PTSD, 0-80). All scored automatically with severity levels based on published clinical cutoffs.' },
    { heading: 'Assessment Delivery', body: 'Assessments are delivered through secure links. Open a client profile, click "Send Assessment", select type, generate the link, and share it through your approved communication workflow. The client completes the form on mobile and scores appear instantly in their chart. SMS requires explicit consent and is handled as a HIPAA-compliant, minimum-necessary workflow.' },
    { heading: 'Outcome Tracking', body: 'Visit the Outcomes page to see score trends across your caseload. Each client shows a timeline with score values, severity changes, improvement/deterioration flags, and time since last assessment.' },
  ]},
  { id: 'copilot', title: 'Miwa Copilot Chat', content: [
    { heading: 'What Miwa Can Do', body: 'Miwa is an agentic copilot that takes action. Schedule appointments ("Book AX-7812 for Tuesday at 2pm"), send assessments ("Send PHQ-9 to all anxiety clients"), generate reports, review caseloads ("Who is deteriorating?"), search clinical resources, check billing status, and answer "how do I..." questions about the app.' },
    { heading: 'Caseload Context', body: 'Every conversation starts with your full caseload loaded. Miwa knows all your active clients, their IDs, latest assessment scores, session dates, risk flags, and treatment history. Ask natural questions like "How is Sarah doing?" and Miwa pulls the right data.' },
  ]},
  { id: 'scheduling', title: 'Scheduling', content: [
    { heading: 'Calendar', body: 'The Schedule page shows a full 24-hour week or month view. Click any time slot to create an appointment. Switch between Week and Month views. Today is highlighted. The mini calendar in the sidebar syncs with the main calendar.' },
    { heading: 'Telehealth', body: 'Add your telehealth URL in Settings (Zoom, Doxy.me, Google Meet). Miwa stores the link for appointment workflows and shows a "Start Session" button on your calendar. Share links through your approved client communication workflow until SMS is enabled.' },
  ]},
  { id: 'reports', title: 'Reports', content: [
    { heading: 'Report Types', body: 'Ask Miwa to generate: Court/legal progress reports (formatted for attorneys, judges), Insurance summaries (for utilization review), Supervision reports (case presentations, trainee documentation). All reports pull from actual session data and assessment scores.' },
    { heading: 'How to Generate', body: 'In the Copilot chat, say: "Write a court progress report for AX-7812 covering January through March" or "Generate an insurance summary for BK-3290". Miwa generates the report as a downloadable PDF.' },
  ]},
  { id: 'resources', title: 'Clinical Resources', content: [
    { heading: 'Resource Library', body: 'The Resources page (sidebar) has 72 curated clinical resources across 8 categories: Assessment Guides, Clinical Protocols, Crisis & Safety, Suicide Prevention, Resource Directories, Victim Services, Housing & Shelter, and Trauma Education. All link to official sources. You can bookmark favorites.' },
  ]},
  { id: 'settings', title: 'Settings', content: [
    { heading: 'Profile', body: 'Update your name, email, credential type, and license number. Your clinician role (Trainee/Associate/Licensed) controls how Miwa communicates — trainees get more Socratic guidance, licensed clinicians get direct peer-level communication.' },
    { heading: 'Themes', body: 'Three themes available: Default (light purple gradient), Dark (navy/slate), and Pink (warm pink). Change in Settings > Appearance.' },
  ]},
  { id: 'billing', title: 'Billing & Subscription', content: [
    { heading: 'Plans', body: 'Free 14-day trial with full access. After trial: Trainee plan ($39/mo), Solo plan ($79/mo), Practice plan ($149/mo). Cancel anytime from Settings > Billing. Data remains accessible for 30 days after cancellation.' },
  ]},
  { id: 'faq', title: 'FAQ', content: [
    { heading: 'Common Questions', body: 'HIPAA: Miwa is HIPAA compliant, with BAA-backed infrastructure, encrypted transport, HttpOnly cookies, and no clinical data used to train AI models. Covered entities can complete their own BAA, policy, and configuration review. Mobile: Miwa is a PWA that works on iOS and Android — add to home screen. Miwa is a clinical copilot, not an EHR replacement.' },
  ]},
];

module.exports = { APP_HELP_KB };
