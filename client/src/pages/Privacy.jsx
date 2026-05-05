import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

const PURPLE = '#6047EE'
const TEAL = '#2dd4bf'

function Section({ title, children, id }) {
  return (
    <section id={id} className="mb-11">
      <h2 className="mb-4 text-2xl font-bold text-zinc-900">{title}</h2>
      <div className="space-y-4 text-base leading-relaxed text-zinc-700">{children}</div>
    </section>
  )
}

function SubHeading({ children }) {
  return <h3 className="mb-2 mt-6 text-lg font-semibold text-zinc-900">{children}</h3>
}

function Bullet({ children }) {
  return (
    <li className="flex gap-3 text-zinc-700">
      <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: TEAL }} />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

function EmailLink({ children = 'privacy@miwa.care' }) {
  return (
    <a href="mailto:privacy@miwa.care" className="font-semibold" style={{ color: PURPLE }}>
      {children}
    </a>
  )
}

export default function Privacy() {
  return (
    <PublicPageShell>
      <PublicNav />

      <header className="px-6 pb-12 pt-32" style={{ background: '#fafafa', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="mx-auto max-w-3xl">
          <p className="mb-3 text-sm font-bold uppercase tracking-widest" style={{ color: PURPLE }}>Privacy policy</p>
          <h1 className="mb-4 text-4xl font-black tracking-tight text-zinc-900 md:text-5xl">
            How Miwa handles your data
          </h1>
          <p className="text-lg leading-relaxed text-zinc-600">
            Miwa is built for therapists and the sensitive information that comes with clinical work. This policy explains what we collect, how we use it, who we share it with, and how to contact us.
          </p>
          <p className="mt-6 text-base text-zinc-500">
            <span className="font-semibold">Effective date:</span> May 5, 2026
            <span className="px-2">|</span>
            <span className="font-semibold">Last updated:</span> May 5, 2026
          </p>
        </div>
      </header>

      <main className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <Section title="1. Who we are" id="who">
            <p>
              Miwa is operated by Miwa Care LLC. We provide clinical documentation, assessment, scheduling, and workflow tools for mental health professionals.
            </p>
            <p>
              Privacy questions can be sent to <EmailLink />.
            </p>
          </Section>

          <Section title="2. Who this policy covers" id="scope">
            <p>
              This policy covers therapists who create a Miwa account and clients whose information is entered into Miwa by their therapist.
            </p>
            <p>
              Therapists are Miwa's direct customers. When a therapist uses Miwa for client care, that therapist or their practice remains responsible for the clinical relationship and the medical record. For covered clinical workflows, Miwa acts as a HIPAA Business Associate under the applicable Business Associate Agreement.
            </p>
          </Section>

          <Section title="3. Information we collect" id="collect">
            <SubHeading>Therapist account information</SubHeading>
            <ul className="space-y-2">
              <Bullet>Name, email address, login credentials, practice information, license details, phone number, time zone, and account settings.</Bullet>
              <Bullet>Billing status and subscription information. Payment card numbers are handled by our payment processor and are not stored by Miwa.</Bullet>
              <Bullet>Device, browser, usage, and error information needed to keep the service secure and reliable.</Bullet>
            </ul>

            <SubHeading>Client information entered by therapists</SubHeading>
            <ul className="space-y-2">
              <Bullet>Client names, contact details, dates of birth, appointment history, and other identifiers entered by the therapist.</Bullet>
              <Bullet>Session notes, treatment plans, diagnoses, assessments, scores, and related clinical documentation.</Bullet>
              <Bullet>Client responses submitted through secure assessment links created by the therapist.</Bullet>
            </ul>

            <SubHeading>Audio and mobile app data</SubHeading>
            <ul className="space-y-2">
              <Bullet>If a therapist uses recording or transcription features, audio may be processed to create clinical documentation.</Bullet>
              <Bullet>The mobile app may use microphone access only when the therapist turns on a recording feature.</Bullet>
              <Bullet>The app does not access contacts, photos, SMS history, or location for clinical documentation.</Bullet>
            </ul>
          </Section>

          <Section title="4. How we use information" id="use">
            <ul className="space-y-2">
              <Bullet>To provide Miwa's clinical documentation, assessment, scheduling, and workflow features.</Bullet>
              <Bullet>To generate AI-assisted drafts and summaries for therapist review.</Bullet>
              <Bullet>To manage accounts, billing, support, and product communication.</Bullet>
              <Bullet>To protect Miwa from abuse, security incidents, and unauthorized access.</Bullet>
              <Bullet>To meet legal, compliance, accounting, and operational obligations.</Bullet>
            </ul>
            <p>
              Miwa does not sell client data, therapist data, notes, transcripts, assessment results, or clinical datasets. Miwa also does not use protected health information to train AI models.
            </p>
          </Section>

          <Section title="5. AI-assisted features" id="ai">
            <p>
              Miwa uses AI to help therapists draft, organize, summarize, and review clinical material. AI output is a draft for professional review. It does not replace the therapist's judgment, documentation duties, supervision requirements, or client consent obligations.
            </p>
            <p>
              Clinical data is handled through approved service paths for covered workflows. Miwa is designed to send only the information needed for the requested task.
            </p>
          </Section>

          <Section title="6. How we share information" id="share">
            <p>
              We share information only when needed to run Miwa, support users, protect the service, comply with the law, or complete a business transaction under appropriate protections.
            </p>
            <SubHeading>Service providers</SubHeading>
            <p>
              Miwa works with service providers for hosting, storage, AI processing, email, payments, security, analytics, support, and other operations. When a provider may handle protected health information for a covered workflow, we require appropriate contractual protections before that use.
            </p>
            <SubHeading>Legal and safety reasons</SubHeading>
            <p>
              We may disclose information when required by valid legal process, to protect against fraud or abuse, or to help prevent serious and imminent harm, consistent with applicable law.
            </p>
            <SubHeading>Business transfers</SubHeading>
            <p>
              If Miwa is involved in a merger, acquisition, financing, or sale of assets, information may transfer as part of that transaction. Protected health information would remain subject to required safeguards and notice obligations.
            </p>
          </Section>

          <Section title="7. HIPAA and clinical records" id="hipaa">
            <p>
              When Miwa processes protected health information for a covered therapist or practice, Miwa acts as a Business Associate. We use that information to provide the service requested by the therapist and to meet obligations in the applicable Business Associate Agreement.
            </p>
            <p>
              Clients who want to access, amend, or receive an accounting of disclosures for their clinical record should contact their therapist directly. The therapist or practice is the Covered Entity and has the primary relationship with the client.
            </p>
          </Section>

          <Section title="8. Security" id="security">
            <p>
              Miwa uses administrative, technical, and organizational safeguards intended to protect sensitive clinical information. These include encryption, access controls, secure authentication, operational logging, restricted production access, and secure patient links.
            </p>
            <p>
              No internet service can promise perfect security. If you believe you found a vulnerability, email <a href="mailto:security@miwa.care" className="font-semibold" style={{ color: PURPLE }}>security@miwa.care</a>.
            </p>
          </Section>

          <Section title="9. Retention" id="retention">
            <p>
              Miwa keeps information only as long as needed for the service, legal obligations, account administration, security, backup, or clinical recordkeeping.
            </p>
            <ul className="space-y-2">
              <Bullet>Therapist account data is kept while the account is active and for a limited period after deletion for recovery, billing, legal, and security needs.</Bullet>
              <Bullet>Clinical records are retained according to the therapist's recordkeeping obligations and the settings or instructions available in Miwa.</Bullet>
              <Bullet>Operational logs and backups are retained under Miwa's security and retention practices.</Bullet>
              <Bullet>Audio is retained only as needed for transcription, troubleshooting, or therapist-requested storage.</Bullet>
            </ul>
          </Section>

          <Section title="10. Your choices and rights" id="rights">
            <SubHeading>Therapists</SubHeading>
            <p>
              Therapists can request access, correction, export, or deletion of account information by contacting <EmailLink />. Some information may need to be retained for legal, billing, security, or clinical recordkeeping reasons.
            </p>
            <SubHeading>Clients</SubHeading>
            <p>
              Clients should contact their therapist to exercise HIPAA rights connected to their clinical record. Miwa will assist the therapist as required.
            </p>
            <SubHeading>California residents</SubHeading>
            <p>
              California residents may have rights to know, access, correct, delete, or limit certain personal information. Some clinical information regulated by HIPAA may be exempt from California consumer privacy law. To make a request, email <EmailLink /> from the address connected to your account or care relationship.
            </p>
          </Section>

          <Section title="11. Children" id="children">
            <p>
              Miwa is not directed to children under 13, and children do not create Miwa accounts. Therapists may document care involving minors when clinically appropriate and legally permitted.
            </p>
          </Section>

          <Section title="12. International use" id="international">
            <p>
              Miwa is built for use by clinicians in the United States. If you use Miwa from outside the United States, your information may be processed in the United States.
            </p>
          </Section>

          <Section title="13. Changes to this policy" id="changes">
            <p>
              We may update this policy when Miwa changes, when our legal obligations change, or when our privacy practices need to be clarified. If a change is material, we will provide notice by email or inside the product before the change takes effect.
            </p>
          </Section>

          <Section title="14. Contact" id="contact">
            <div className="mt-4 rounded-xl p-5" style={{ background: '#f8fafc', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p className="font-semibold text-zinc-900">Miwa Care LLC</p>
              <p className="mt-1 text-zinc-700">Los Angeles, California, United States</p>
              <p className="mt-1 text-zinc-700">Privacy: <EmailLink /></p>
              <p className="text-zinc-700">Security: <a href="mailto:security@miwa.care" className="font-semibold" style={{ color: PURPLE }}>security@miwa.care</a></p>
            </div>
            <p className="mt-6 text-base text-zinc-500">
              If you believe your HIPAA rights have been violated, you may also file a complaint with the U.S. Department of Health and Human Services, Office for Civil Rights at{' '}
              <a href="https://www.hhs.gov/hipaa/filing-a-complaint" className="font-semibold" style={{ color: PURPLE }} target="_blank" rel="noopener noreferrer">hhs.gov/hipaa/filing-a-complaint</a>.
            </p>
          </Section>
        </div>
      </main>

      <PublicFooter />
    </PublicPageShell>
  )
}
