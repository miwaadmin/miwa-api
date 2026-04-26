import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import { useAuth } from '../context/AuthContext'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const categories = [
  {
    label: 'Progress Notes',
    color: '#5746ed',
    templates: [
      {
        name: 'SOAP Note',
        desc: 'Subjective, Objective, Assessment, Plan. Standard format across most outpatient settings.',
        fields: ['Subjective', 'Objective', 'Assessment', 'Plan'],
        useCase: 'Outpatient therapy, community mental health',
      },
      {
        name: 'BIRP Note',
        desc: 'Behavior, Intervention, Response, Plan. Common in community and agency settings.',
        fields: ['Behavior', 'Intervention', 'Response', 'Plan'],
        useCase: 'Community mental health, substance use',
      },
      {
        name: 'DAP Note',
        desc: 'Data, Assessment, Plan. Streamlined format favored in private practice.',
        fields: ['Data', 'Assessment', 'Plan'],
        useCase: 'Private practice, solo therapists',
      },
      {
        name: 'GIRP Note',
        desc: 'Goals, Intervention, Response, Plan. Goal-anchored format for treatment-focused documentation.',
        fields: ['Goals', 'Intervention', 'Response', 'Plan'],
        useCase: 'Treatment plan-anchored settings',
      },
    ],
  },
  {
    label: 'Assessment & Conceptualization',
    color: '#0891b2',
    templates: [
      {
        name: 'Biopsychosocial Assessment',
        desc: 'Comprehensive intake assessment covering biological, psychological, and social domains.',
        fields: ['Presenting concern', 'History', 'Biological factors', 'Psychological factors', 'Social factors', 'Diagnostic impressions'],
        useCase: 'Intake sessions, new clients',
      },
      {
        name: 'Case Conceptualization',
        desc: 'Structured framework for organizing your clinical understanding of the client.',
        fields: ['Presenting problem', 'Predisposing factors', 'Precipitating factors', 'Perpetuating factors', 'Protective factors', 'Treatment implications'],
        useCase: 'Supervision, treatment planning',
      },
      {
        name: 'Diagnostic Impressions',
        desc: 'Document diagnostic impressions with supporting criteria. Review-first.',
        fields: ['Presenting symptoms', 'Duration and severity', 'Rule-outs', 'Working diagnosis', 'Clinical rationale'],
        useCase: 'Post-intake, ongoing assessment',
      },
    ],
  },
  {
    label: 'Supervision Prep',
    color: '#7c3aed',
    templates: [
      {
        name: 'Supervision Agenda',
        desc: 'Structured prep for individual supervision. Helps you walk in with clear questions.',
        fields: ['Cases to discuss', 'Clinical questions', 'Countertransference', 'Training goals', 'Urgent items'],
        useCase: 'Pre-supervision prep',
      },
      {
        name: 'Case Consultation Summary',
        desc: 'Brief case summary formatted for group or peer consultation.',
        fields: ['Client overview', 'Key clinical themes', 'Consultation question', 'What I have tried'],
        useCase: 'Group consultation, peer review',
      },
      {
        name: 'Reflective Practice Note',
        desc: 'Structured space for processing your own reactions, growth edges, and clinical questions.',
        fields: ['Session reflection', 'Countertransference observations', 'What I noticed', 'Growth edge', 'Next steps'],
        useCase: 'Personal development, supervision journals',
      },
    ],
  },
  {
    label: 'Treatment Planning',
    color: '#059669',
    templates: [
      {
        name: 'Treatment Plan',
        desc: 'Goal-based treatment plan with measurable objectives and interventions.',
        fields: ['Diagnosis', 'Long-term goals', 'Short-term objectives', 'Interventions', 'Review date'],
        useCase: 'Managed care, agency requirements',
      },
      {
        name: 'Safety Plan',
        desc: 'Safety planning structure for clinician reference and documentation.',
        fields: ['Warning signs', 'Internal coping strategies', 'Social supports', 'Crisis contacts', 'Means restriction'],
        useCase: 'Clients with SI/HI risk factors',
      },
    ],
  },
]

export default function Templates() {
  const { therapist } = useAuth()

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      <PublicNav />

      {/* Header */}
      <section className="max-w-3xl mx-auto px-5 pt-32 pb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 tracking-tight">
          Note templates built for real clinical work
        </h1>
        <p className="text-lg text-gray-500 leading-relaxed max-w-2xl mx-auto">
          Miwa includes templates for the formats clinicians actually use. All review-first.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-full px-4 py-2 border border-gray-100">
          <svg className="w-4 h-4 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          HIPAA-conscious workflows. AI output is for clinical support only.
        </div>
      </section>

      {/* Template categories */}
      <section className="max-w-6xl mx-auto px-5 pb-24 space-y-16">
        {categories.map(({ label, color, templates }) => (
          <div key={label}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-1 h-6 rounded-full" style={{ background: color }} />
              <h2 className="text-lg font-bold text-gray-900">{label}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {templates.map(({ name, desc, fields, useCase }) => (
                <div
                  key={name}
                  className="rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-shadow flex flex-col gap-4"
                >
                  <div>
                    <div
                      className="inline-block text-xs font-bold px-2.5 py-1 rounded-full mb-3"
                      style={{ background: `${color}15`, color }}
                    >
                      {name}
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sections</p>
                    <div className="flex flex-wrap gap-1.5">
                      {fields.map(f => (
                        <span key={f} className="text-xs bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded-md">{f}</span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-auto pt-2 border-t border-gray-50">
                    <p className="text-xs text-gray-400">
                      <span className="font-medium text-gray-500">Common use:</span> {useCase}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section
        className="py-20 text-center"
        style={{ background: 'linear-gradient(160deg, #1a1456 0%, #221a6e 60%, #0d5c52 100%)' }}
      >
        <div className="max-w-xl mx-auto px-5">
          <h2 className="text-3xl font-bold text-white mb-4">Use these templates inside Miwa</h2>
          <p className="text-white/60 mb-8 leading-relaxed text-sm">
            All templates are available in the Documentation Workspace. Paste your session notes and Miwa will format them for you.
          </p>
          <Link
            to={therapist ? '/dashboard' : '/register'}
            className="inline-flex px-8 py-3.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 shadow-lg"
            style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
          >
            {therapist ? 'Open Miwa' : 'Get started free'}
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}
