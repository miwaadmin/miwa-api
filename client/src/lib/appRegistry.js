export const APP_REGISTRY = [
  {
    id: 'genogram',
    name: 'Genogram',
    category: 'Clinical',
    eyebrow: 'Family systems',
    description: 'Build a clinical family map with structure, emotional relationship lines, notes, life events, and chart-linked exports.',
    icon: 'network',
    status: 'Available',
    clientLinked: true,
    supportedContext: ['client'],
    features: ['Saved to client profile', 'AI draft from chart', 'PDF / PNG / SVG export'],
    route: ({ patientId }) => `/patients/${patientId}/genogram`,
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Strong fit for case formulation, supervision summaries, and treatment planning.'
        : 'Useful when family structure, relational patterns, or collateral context matter.'
    ),
  },
  {
    id: 'treatment-plan',
    name: 'Treatment Plan',
    category: 'Clinical',
    eyebrow: 'Care planning',
    description: 'Organize goals, objectives, interventions, and review points from the client chart.',
    icon: 'plan',
    status: 'In chart',
    clientLinked: true,
    supportedContext: ['client'],
    features: ['Client-linked', 'Review-ready', 'Outcome-aware'],
    route: ({ patientId }) => `/patients/${patientId}`,
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Use before supervision, reviews, and treatment-plan updates.'
        : 'Use when care goals need a structured refresh.'
    ),
  },
  {
    id: 'note-check',
    name: 'Note Check',
    category: 'Notes',
    eyebrow: 'Documentation quality',
    description: 'Review unsigned notes for completeness, medical necessity, risk language, and next-step clarity.',
    icon: 'note',
    status: 'Available',
    clientLinked: false,
    supportedContext: ['workspace'],
    features: ['Unsigned-note workflow', 'Risk language support', 'Documentation confidence'],
    route: () => '/workspace',
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Helpful for building licensed-level documentation confidence.'
        : 'Helpful when notes need a final quality pass.'
    ),
  },
  {
    id: 'safety-plan',
    name: 'Safety Plan',
    category: 'Clinical',
    eyebrow: 'Risk support',
    description: 'Prepare clear risk/safety language and client-centered next steps for higher-acuity work.',
    icon: 'safety',
    status: 'Consult',
    clientLinked: false,
    supportedContext: ['consult'],
    features: ['Risk wording', 'Escalation prompts', 'Supervision-ready questions'],
    route: () => '/consult',
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Use when you want a crisp supervisor question and documentation trail.'
        : 'Use when risk review needs structure.'
    ),
  },
  {
    id: 'case-summary',
    name: 'Case Summary',
    category: 'Reports',
    eyebrow: 'Clinical summary',
    description: 'Turn chart history into a concise case picture for supervision, records, or care coordination.',
    icon: 'summary',
    status: 'Consult',
    clientLinked: true,
    supportedContext: ['client', 'consult'],
    features: ['Chart-informed', 'Shareable draft', 'Review-first'],
    route: ({ patientId }) => patientId ? `/patients/${patientId}` : '/consult',
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Recommended for supervision prep and readiness documentation.'
        : 'Recommended before care coordination or report writing.'
    ),
  },
  {
    id: 'hours-audit',
    name: 'Hours Audit',
    category: 'Hours',
    eyebrow: 'Licensure tracking',
    description: 'Review licensure-hour categories, weekly progress, and export readiness.',
    icon: 'hours',
    status: 'Available',
    clientLinked: false,
    supportedContext: ['hours'],
    features: ['Category progress', 'Weekly goal', 'Export shortcut'],
    route: () => '/hours',
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Recommended weekly while you are accruing hours toward licensure.'
        : 'Useful for pre-licensed clinicians tracking hours.'
    ),
  },
  {
    id: 'portal-readiness',
    name: 'Portal Readiness',
    category: 'Portal',
    eyebrow: 'Client portal',
    description: 'Check invite status, messaging readiness, appointment requests, assessments, and homework activity.',
    icon: 'portal',
    status: 'Available',
    clientLinked: false,
    supportedContext: ['portal'],
    features: ['Invite codes', 'Secure messages', 'Assessment activity'],
    route: () => '/portal',
    recommendedWhen: ({ credentialType }) => (
      credentialType === 'associate'
        ? 'Recommended as you build independent portal workflows under supervision.'
        : 'Recommended when portal adoption needs attention.'
    ),
  },
]

export function appLaunchPath(app, context = {}) {
  if (typeof app?.route === 'function') return app.route(context)
  return app?.route || '/apps'
}

export function recommendedAppsFor({ credentialType, limit = 4 } = {}) {
  const priority = credentialType === 'associate'
    ? ['note-check', 'genogram', 'safety-plan', 'hours-audit', 'portal-readiness', 'case-summary']
    : ['genogram', 'treatment-plan', 'note-check', 'safety-plan']
  const ordered = priority
    .map(id => APP_REGISTRY.find(app => app.id === id))
    .filter(Boolean)
  return ordered.slice(0, limit)
}
