import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'
import { useAuth } from '../context/AuthContext'

// ── Brand tokens ───────────────────────────────────────────────────
const PURPLE  = '#6047EE'
const TEAL    = '#2dd4bf'
const GRAD    = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const NAV_LINKS = [
  { to: '/features',      label: 'Features' },
  { to: '/pricing',       label: 'Pricing' },
  { to: '/for-trainees',  label: 'For Trainees' },
  { to: '/about',         label: 'About' },
]

/* ── Shared mock window ────────────────────────────────────────────── */
function MockWindow({ url = 'miwa.care', children }) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: '#0a0818',
        border: '1px solid rgba(96,71,238,0.2)',
        boxShadow: '0 24px 80px rgba(96,71,238,0.18), 0 4px 16px rgba(0,0,0,0.12)',
      }}>
      <div className="flex items-center gap-2 px-4 py-3"
        style={{ background: '#0f0c22', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="text-xs text-white/25 px-4 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.04)' }}>{url}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

/* ── Hero Mockup ───────────────────────────────────────────────────── */
function HeroMockup() {
  return (
    <MockWindow>
      <div className="grid grid-cols-[190px_1fr_1fr]" style={{ minHeight: 320 }}>
        <div className="p-4 space-y-2" style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2 mb-5">
            <MiwaLogo size={20} /><span className="text-xs font-bold text-white/80">miwa</span>
          </div>
          {['Dashboard','Patients','Schedule','Briefs'].map(item => (
            <div key={item} className={`text-xs px-2.5 py-1.5 rounded-lg ${item==='Patients'?'text-white':'text-white/30'}`}
              style={item==='Patients'?{background:'rgba(96,71,238,0.25)'}:{}}>
              {item}
            </div>
          ))}
        </div>
        <div className="p-4 space-y-2" style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide mb-3">Caseload</p>
          {[
            {id:'Marcus T.',score:'PHQ-9: 14',color:'#f59e0b',trend:'↑'},
            {id:'Priya K.',score:'GAD-7: 8', color:'#60a5fa',trend:'→'},
            {id:'Jordan M.',score:'PCL-5: 42',color:'#ef4444',trend:'↑'},
            {id:'Elena R.',score:'PHQ-9: 4', color:TEAL,     trend:'↓'},
          ].map(p=>(
            <div key={p.id} className="flex items-center justify-between px-2.5 py-2 rounded-lg"
              style={{background:'rgba(255,255,255,0.03)'}}>
              <div>
                <span className="text-xs font-semibold text-white/80">{p.id}</span>
                <span className="text-[10px] text-white/30 ml-2">{p.score}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px]" style={{color:p.color}}>{p.trend}</span>
                <div className="w-1.5 h-1.5 rounded-full" style={{background:p.color}}/>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 flex flex-col">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide mb-3">Miwa</p>
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{background:'rgba(96,71,238,0.3)'}}>
                <MiwaLogo size={12}/>
              </div>
              <div className="text-xs text-white/55 rounded-xl rounded-tl-sm px-3 py-2 max-w-[200px]"
                style={{background:'rgba(255,255,255,0.04)'}}>
                Marcus's PHQ-9 jumped 8→14. Safety check-in recommended.
              </div>
            </div>
            <div className="flex justify-end">
              <div className="text-xs text-white rounded-xl rounded-tr-sm px-3 py-2 max-w-[160px]"
                style={{background:'rgba(96,71,238,0.3)'}}>
                Create a secure check-in link today
              </div>
            </div>
            <div className="flex gap-2">
              <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{background:'rgba(96,71,238,0.3)'}}>
                <MiwaLogo size={12}/>
              </div>
              <div className="text-xs text-white/55 rounded-xl rounded-tl-sm px-3 py-2 max-w-[200px]"
                style={{background:'rgba(255,255,255,0.04)'}}>
                Done. Secure mood check-in link created.
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

/* ── Session Note Mockup ───────────────────────────────────────────── */
function SessionNoteMockup() {
  return (
    <MockWindow url="miwa.care/sessions/new">
      <div className="p-5 space-y-4" style={{minHeight:290}}>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)'}}>
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
          <span className="text-xs text-red-400 font-medium">Recording session recap…</span>
          <span className="text-[10px] text-red-400/50 ml-auto">0:47</span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{color:PURPLE}}>SOAP — Generated</span>
            {['SOAP','BIRP','DAP'].map(fmt=>(
              <span key={fmt} className="text-[9px] px-1.5 py-0.5 rounded"
                style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>{fmt}</span>
            ))}
          </div>
          {[
            {label:'S',text:'Client reported improved sleep and reduced avoidance behaviors.'},
            {label:'O',text:'Appeared engaged, affect euthymic, maintained eye contact.'},
            {label:'A',text:'PTSD (F43.10) — early response to CPT protocol.'},
            {label:'P',text:'Continue CPT. Assign thought record. Follow up in 1 week.'},
          ].map(row=>(
            <div key={row.label} className="flex gap-2.5">
              <span className="text-[10px] font-bold w-3 mt-0.5 flex-shrink-0"
                style={{color:PURPLE+'99'}}>{row.label}</span>
              <p className="text-[11px] text-white/50 leading-relaxed">{row.text}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-2"
          style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          <span className="text-[10px] text-white/25">CPT</span>
          <span className="text-[10px] font-semibold text-white/70 px-2 py-0.5 rounded"
            style={{background:'rgba(96,71,238,0.2)'}}>90837</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px]" style={{color:TEAL}}>✓ Ready to sign</span>
            <div className="text-[10px] px-2.5 py-1 rounded-lg text-white font-medium"
              style={{background:GRAD}}>Sign & Lock</div>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

/* ── Alerts Mockup ─────────────────────────────────────────────────── */
function CaseloadMockup() {
  return (
    <MockWindow url="miwa.care/dashboard">
      <div className="p-5 space-y-3" style={{minHeight:290}}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide">Proactive Alerts</p>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{background:'rgba(96,71,238,0.2)',color:PURPLE}}>3 new</span>
        </div>
        {[
          {id:'Jordan M.',msg:'PCL-5 increased 8pts (34→42). Review stressors.',color:'#ef4444',icon:'↑',type:'DETERIORATION'},
          {id:'Elena R.',msg:'PHQ-9 improved 6pts (10→4). Significant progress.',color:TEAL,icon:'↓',type:'IMPROVEMENT'},
          {id:'Priya K.',msg:'No assessment in 35 days — overdue.',color:'#f59e0b',icon:'!',type:'OVERDUE'},
        ].map(a=>(
          <div key={a.id} className="flex gap-3 px-3 py-2.5 rounded-xl"
            style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${a.color}20`}}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5"
              style={{background:a.color+'18',color:a.color}}>{a.icon}</div>
            <div>
              <p className="text-[11px] font-semibold text-white/80">{a.id}</p>
              <p className="text-[10px] text-white/40">{a.msg}</p>
            </div>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded self-start mt-0.5"
              style={{background:a.color+'15',color:a.color}}>{a.type}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-1">
          <MiwaLogo size={12}/>
          <p className="text-[10px]" style={{color:TEAL}}>I can draft a check-in for Jordan. Want me to?</p>
        </div>
      </div>
    </MockWindow>
  )
}

/* ── Batch Mockup ──────────────────────────────────────────────────── */
function BatchMockup() {
  return (
    <MockWindow url="miwa.care/miwa">
      <div className="p-5 space-y-3" style={{minHeight:290}}>
        <div className="flex gap-2 items-start">
          <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
            style={{background:'rgba(96,71,238,0.3)'}}>
            <MiwaLogo size={12}/>
          </div>
          <div className="text-xs text-white/55 rounded-xl rounded-tl-sm px-3 py-2 max-w-[260px]"
            style={{background:'rgba(255,255,255,0.04)'}}>
            Here are your anxiety clients. Select who gets the PHQ-9:
          </div>
        </div>
        <div className="ml-7 rounded-xl overflow-hidden"
          style={{border:'1px solid rgba(96,71,238,0.2)'}}>
          {[
            {id:'Marcus T.',last:'6 weeks ago',checked:true},
            {id:'Priya K.',last:'3 weeks ago',checked:true},
            {id:'Diane L.',last:'2 weeks ago',checked:false},
            {id:'Robert S.',last:'Never sent', checked:true},
          ].map((p,i)=>(
            <div key={p.id} className="flex items-center gap-3 px-3 py-2.5"
              style={{borderBottom:i<3?'1px solid rgba(255,255,255,0.04)':undefined}}>
              <div className="w-3.5 h-3.5 rounded flex items-center justify-center"
                style={{background:p.checked?PURPLE:'rgba(255,255,255,0.08)'}}>
                {p.checked&&<svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
              </div>
              <span className="text-xs text-white/70 font-medium">{p.id}</span>
              <span className="text-[10px] text-white/25 ml-auto">Last: {p.last}</span>
            </div>
          ))}
        </div>
        <div className="ml-7 flex gap-2">
          <div className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{background:GRAD}}>Send PHQ-9 to 3 clients</div>
        </div>
      </div>
    </MockWindow>
  )
}


/* ── Hero ─────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative pt-32 pb-24 px-8 lg:px-12 overflow-hidden">
      {/* Soft purple blob top-right */}
      <div className="absolute -top-32 right-0 w-[600px] h-[600px] pointer-events-none rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.08) 0%, transparent 70%)' }} />
      {/* Soft teal blob bottom-left */}
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] pointer-events-none rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.07) 0%, transparent 70%)' }} />

      {/* Centered hero text — Notion / Figma style */}
      <div className="relative z-10 max-w-4xl mx-auto text-center mb-14">
        <h1 className="font-extrabold leading-[1.05] tracking-tight mb-6"
          style={{ fontSize: 'clamp(3rem, 6vw, 5.5rem)', textWrap: 'balance', color: '#111' }}>
          Your clinical practice,{' '}
          <span style={GRAD_TEXT}>amplified.</span>
        </h1>

        <p className="text-xl md:text-2xl text-gray-600 max-w-2xl mx-auto mb-10 leading-relaxed">
          Miwa is an AI assistant for therapists. It writes your notes, prepares every session, flags safety concerns as you type, and tells you who needs attention this morning — so the clinical work stays yours.
        </p>

        <div className="flex flex-wrap gap-4 justify-center mb-5">
          <Link to="/register"
            className="px-8 py-4 rounded-xl text-lg font-bold text-white hover:opacity-90 transition-all"
            style={{ background: GRAD }}>
            Start free
          </Link>
          <Link to="/features"
            className="px-7 py-3.5 rounded-xl text-base font-medium text-gray-600 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            See how it works →
          </Link>
        </div>
        <p className="text-sm text-gray-500">14-day free trial · No credit card required · Pre-licensed pricing for trainees</p>
      </div>

      {/* BIG product mockup — the hero visual */}
      <div className="relative z-10 max-w-[1200px] mx-auto px-4">
        <div className="rounded-3xl overflow-hidden shadow-2xl" style={{
          background: 'linear-gradient(180deg, rgba(96,71,238,0.04), rgba(45,212,191,0.04))',
          border: '1px solid rgba(96,71,238,0.12)',
          padding: 'clamp(16px, 3vw, 40px)',
        }}>
          <HeroMockup />
        </div>
      </div>

      {/* Trust bar */}
      <div className="relative z-10 max-w-[1400px] mx-auto mt-20 pt-8 px-8 lg:px-12"
        style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-gray-600">
          <span>Trusted by licensed MFTs, LCSWs &amp; LPCCs</span>
          <span>·</span>
          <span>HIPAA-aligned infrastructure</span>
          <span>·</span>
          <span>Pre-licensed pricing for interns &amp; associates</span>
        </div>
      </div>
    </section>
  )
}

/* ── Feature Row ─────────────────────────────────────────────────── */
function FeatureRow({ tag, title, gradWord, desc, items, accent, reversed, mockup, tinted }) {
  const textContent = (
    <div className={reversed ? 'lg:order-2' : ''}>
      <p className="text-base font-bold uppercase tracking-widest mb-4" style={{ color: accent }}>{tag}</p>
      <h2 className="text-3xl lg:text-4xl font-extrabold text-gray-900 mb-5 leading-tight" style={{ textWrap: 'balance' }}>
        {title}{gradWord && <> <span style={GRAD_TEXT}>{gradWord}</span></>}
      </h2>
      <p className="text-gray-700 text-lg mb-10 max-w-lg leading-relaxed">{desc}</p>
      <div className="grid sm:grid-cols-2 gap-5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
              style={{ background: accent + '20' }}>
              <svg className="w-3.5 h-3.5" style={{ color: accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold" style={{ color: '#111' }}>{item[0]}</p>
              <p className="text-gray-600 text-sm mt-0.5">{item[1]}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <section className="py-24 lg:py-32 px-8 lg:px-12"
      style={{
        borderTop: '1px solid rgba(0,0,0,0.06)',
        background: tinted ? 'linear-gradient(160deg, rgba(96,71,238,0.03) 0%, rgba(45,212,191,0.03) 100%)' : '#fff',
      }}>
      <div className="max-w-[1400px] mx-auto grid lg:grid-cols-2 gap-16 items-center">
        {textContent}
        <div className={reversed ? 'lg:order-1' : ''}>{mockup}</div>
      </div>
    </section>
  )
}


/* ── Pricing Preview ──────────────────────────────────────────────── */
function PricingPreview() {
  const tiers = [
    { name: 'Pre-Licensed', price: '$39', per: '/mo', desc: 'Trainees & associates. The full AI copilot at a trainee-friendly price.', cta: 'Start free trial', href: '/register', highlight: false },
    { name: 'Licensed Therapist', price: '$129', per: '/mo', desc: 'The full AI copilot: pre-session briefs, treatment plan tracking, risk monitoring, letter generation, and morning caseload briefings.', cta: 'Start free trial', href: '/register', highlight: true },
    { name: 'Group Practice', price: '$399', per: '/mo', desc: 'Coming soon. 3 clinicians included. +$39/mo each. Join the waitlist.', cta: 'Join waitlist', href: '/for-practices', highlight: false },
  ]
  return (
    <section className="py-24 lg:py-32 px-8 lg:px-12" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="max-w-[1400px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-12">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: TEAL }}>Pricing</p>
            <h2 className="text-3xl lg:text-4xl font-extrabold text-gray-900">
              Start free.{' '}
              <span style={GRAD_TEXT}>Scale when ready.</span>
            </h2>
          </div>
          <Link to="/pricing" className="text-sm text-gray-600 hover:text-gray-900 transition-colors font-medium">Compare all plans →</Link>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((t, i) => (
            <div key={i} className={`rounded-2xl p-7 flex flex-col ${t.highlight ? 'text-white' : 'bg-white'}`}
              style={t.highlight
                ? { background: GRAD, boxShadow: '0 8px 40px rgba(96,71,238,0.3)' }
                : { border: '1px solid rgba(0,0,0,0.08)' }}>
              <h3 className={`font-bold text-lg mb-1 ${t.highlight ? 'text-white' : 'text-gray-900'}`}>{t.name}</h3>
              <div className="flex items-end gap-1 mb-3">
                <span className={`text-3xl font-extrabold ${t.highlight ? 'text-white' : 'text-gray-900'}`}>{t.price}</span>
                <span className={`text-sm mb-1 ${t.highlight ? 'text-white/60' : 'text-gray-400'}`}>{t.per}</span>
              </div>
              <p className={`text-sm mb-6 flex-1 ${t.highlight ? 'text-white/70' : 'text-gray-500'}`}>{t.desc}</p>
              <Link to={t.href}
                className={`block text-center py-2.5 rounded-lg text-sm font-semibold transition-all ${t.highlight ? 'bg-white hover:bg-white/90' : 'hover:opacity-90 text-white'}`}
                style={t.highlight ? { color: PURPLE } : { background: GRAD }}>
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── FAQ ──────────────────────────────────────────────────────────── */
function FAQ() {
  const faqs = [
    { q: 'Is Miwa HIPAA compliant?', a: 'Miwa is built on HIPAA-aligned infrastructure with Azure hosting, Azure OpenAI for PHI-capable AI workflows, encrypted transport, HttpOnly cookie auth, and minimum-necessary prompting. Covered entities still need their own policies, BAAs, and configuration review.' },
    { q: 'Does Miwa replace my EHR?', a: 'No. Miwa is a clinical AI assistant, not a full EHR or insurance billing system. It sits alongside your workflow as your documentation, outcome tracking, scheduling, client portal, and clinical intelligence layer.' },
    { q: 'Who qualifies for Pre-Licensed pricing?', a: 'Anyone who isn\'t fully licensed yet: practicum interns, MFT trainees, and licensed associates (AMFT, ACSW, APCC). When you get your full license, you can upgrade to Licensed Therapist.' },
    { q: 'What assessments are supported?', a: 'PHQ-9, GAD-7, PCL-5, and C-SSRS can be completed through secure links, scored automatically, and tracked over time. SMS delivery is disabled until the messaging BAA and consent workflow are complete.' },
    { q: 'Can I use Miwa on mobile?', a: 'Yes. Miwa is a PWA installable on iOS and Android. Voice dictation works on mobile.' },
  ]
  return (
    <section className="py-24 lg:py-32 px-8 lg:px-12"
      style={{ background: 'linear-gradient(160deg, rgba(96,71,238,0.04) 0%, rgba(45,212,191,0.03) 100%)', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="max-w-[1400px] mx-auto grid lg:grid-cols-[1fr_2fr] gap-16">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">FAQ</h2>
          <p className="text-gray-400 text-sm">Common questions about Miwa.</p>
        </div>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <details key={i} className="group rounded-xl p-5 cursor-pointer bg-white"
              style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
              <summary className="font-semibold text-gray-900 text-sm list-none flex items-center justify-between">
                {f.q}
                <svg className="w-4 h-4 text-gray-300 group-open:rotate-180 transition-transform flex-shrink-0 ml-4"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <p className="text-gray-500 text-sm leading-relaxed mt-3">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Final CTA ────────────────────────────────────────────────────── */
function FinalCTA() {
  return (
    <section className="relative py-32 px-8 lg:px-12 text-center overflow-hidden"
      style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      {/* Large gradient background patch */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg, rgba(96,71,238,0.07) 0%, rgba(45,212,191,0.06) 100%)' }} />
      <div className="relative z-10 max-w-2xl mx-auto">
        <h2 className="text-4xl lg:text-5xl font-extrabold text-gray-900 mb-6 leading-tight" style={{ textWrap: 'balance' }}>
          Give your practice{' '}
          <span style={GRAD_TEXT}>an edge</span>
        </h2>
        <p className="text-gray-600 text-xl mb-10">
          Join therapists who spend less time on paperwork and more time with their clients.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link to="/register"
            className="px-10 py-4 rounded-xl text-lg font-bold text-white hover:opacity-90 transition-all"
            style={{ background: GRAD }}>
            Start free
          </Link>
          <Link to="/for-trainees"
            className="px-10 py-4 rounded-xl text-lg font-medium text-gray-700 hover:text-gray-900 transition-all"
            style={{ border: '1px solid rgba(0,0,0,0.15)' }}>
            I'm pre-licensed →
          </Link>
        </div>
      </div>
    </section>
  )
}


/* ── Page ─────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <PublicPageShell>
      <PublicNav />
      <Hero />

      {/* ── Research-backed stats ─────────────────────────────────────── */}
      <section className="py-20 lg:py-24 px-8 lg:px-12"
        style={{ background: 'linear-gradient(135deg, #0d0b24 0%, #1a1456 50%, #0f3d2e 100%)' }}>
        <div className="max-w-[1400px] mx-auto">
          <p className="text-center text-base font-bold uppercase tracking-widest mb-4"
            style={{ color: TEAL }}>
            The documentation crisis
          </p>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-white text-center mb-4 leading-tight" style={{ textWrap: 'balance' }}>
            More time to think{' '}
            <span style={{ ...GRAD_TEXT, background: GRAD }}>and listen</span>
          </h2>
          <p className="text-white/50 text-center text-lg max-w-2xl mx-auto mb-16">
            Research shows therapists lose a third of their clinical time to paperwork. Miwa gives it back.
          </p>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            {[
              {
                stat: '8+',
                unit: 'hrs/week',
                desc: 'Therapists spend 8+ hours per week on documentation — nearly a full clinical day lost to paperwork.',
                cite: 'Eleos Health, 2024',
              },
              {
                stat: '77%',
                unit: 'burnout rate',
                desc: 'Of mental health clinicians meet criteria for significant mental exhaustion, with documentation as the #1 driver.',
                cite: 'Tebra Physician Burnout Survey, 2025',
              },
              {
                stat: '90%',
                unit: 'faster notes',
                desc: 'AI-assisted documentation reduces note-writing time by up to 90%, letting clinicians focus on care.',
                cite: 'Industry benchmark, 2024',
              },
            ].map((item, i) => (
              <div key={i} className="text-center p-8 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-end justify-center gap-2 mb-2">
                  <span className="text-5xl lg:text-6xl font-extrabold text-white">{item.stat}</span>
                  <span className="text-lg font-bold text-white/50 mb-2">{item.unit}</span>
                </div>
                <p className="text-white/60 text-base leading-relaxed mb-4">{item.desc}</p>
                <p className="text-white/25 text-xs italic">{item.cite}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-white/30 text-sm">
            Miwa combines voice-to-note dictation, multi-step task execution, and proactive caseload monitoring — so you can focus on the client, not the paperwork.
          </p>
        </div>
      </section>

      <FeatureRow
        tag="Documentation"
        title="Session notes in seconds,"
        gradWord="not hours"
        desc="Dictate a 3-minute recap. Miwa generates SOAP, BIRP, or DAP notes ready to sign. All three formats simultaneously."
        accent={PURPLE}
        items={[
          ['Voice dictation',      'Speak naturally, get a formatted clinical note'],
          ['Multi-format output',  'SOAP, BIRP, and DAP generated at once'],
          ['CPT code suggestions', 'Smart billing codes based on session duration'],
          ['Sign & lock',          'Digitally sign notes with one click'],
        ]}
        mockup={<SessionNoteMockup />}
      />

      <FeatureRow
        reversed
        tinted
        tag="Intelligence"
        title="Knows your caseload"
        gradWord="before you ask"
        desc="Miwa starts every conversation already knowing your patients: scores, trends, risk flags, and session history."
        accent={TEAL}
        items={[
          ['Proactive alerts',    'PHQ-9 spikes, overdue assessments, risk flags'],
          ['Outcome tracking',    'Score trajectories across your full panel'],
          ['Assessment delivery', 'PHQ-9, GAD-7, PCL-5 shared through secure links'],
          ['Research briefs',     'Weekly peer-reviewed synthesis for your specialty'],
        ]}
        mockup={<CaseloadMockup />}
      />

      <FeatureRow
        tag="Workflow"
        title="Less clicking."
        gradWord="More clinical time."
        desc="Schedule, assess, document, and generate reports through natural conversation with Miwa."
        accent="#60a5fa"
        items={[
          ['Natural conversation',      'Tell Miwa what to do in plain language'],
          ['Batch operations',          'Send assessments to your whole caseload at once'],
          ['Court & insurance reports', 'Professional documents generated in seconds'],
          ['Between-session check-ins', 'Mood check-ins through secure links with alerts'],
        ]}
        mockup={<BatchMockup />}
      />

      {/* ── What Miwa does for you ─────────────────────────────────── */}
      <section className="py-20 lg:py-24 px-8 lg:px-12"
        style={{ background: 'linear-gradient(135deg, #0d0b24 0%, #1a1456 50%, #0f3d2e 100%)' }}>
        <div className="max-w-[1400px] mx-auto">
          <p className="text-center text-base font-bold uppercase tracking-widest mb-4" style={{ color: TEAL }}>
            What Miwa does for you
          </p>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-white text-center mb-5 leading-tight" style={{ textWrap: 'balance' }}>
            Miwa spots what your caseload needs{' '}
            <span style={{ ...GRAD_TEXT, background: GRAD }}>and handles it.</span>
          </h2>
          <p className="text-white/50 text-center text-lg max-w-2xl mx-auto mb-16">
            Every output is a draft you review. Every decision stays with you. Miwa just handles the mechanical work so your clinical time goes to the clinical work.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                prompt: 'Pre-session briefs',
                action: 'Thirty minutes before every appointment, a 60-second narrative appears: where you left off, their mid-week check-ins, what shifted on their PHQ-9. Never walk in cold.',
                icon: '✦',
              },
              {
                prompt: 'Active risk monitor',
                action: 'As you type session notes, Miwa watches for SI, HI, self-harm, and abuse language — and nudges you toward C-SSRS or Tarasoff when the chart doesn\'t have one on file.',
                icon: '⚠',
              },
              {
                prompt: 'Letter & form generation',
                action: 'ESA letters, school 504 support, insurance pre-auth, attorney summaries, return-to-work — drafted from the chart in your voice. Review, edit, sign.',
                icon: '📝',
              },
              {
                prompt: 'Morning caseload briefing',
                action: 'An email every morning: who needs attention, who\'s improving, who\'s overdue for a check-in. A suggested prep order for the day. Your coffee-sip ritual.',
                icon: '☀',
              },
              {
                prompt: 'Learns your voice',
                action: 'Every time you edit a draft, Miwa learns your style. After about ten sessions, the first AI draft already sounds like you wrote it.',
                icon: '🎯',
              },
              {
                prompt: 'Voice → clinical notes',
                action: 'Dictate a 3-minute recap. Miwa drafts SOAP, BIRP, DAP, and GIRP simultaneously — ICD-10 codes suggested, risk flags caught, ready to sign.',
                icon: '🎙',
              },
              {
                prompt: 'Assessment delivery',
                action: 'Share PHQ-9, GAD-7, PCL-5, and C-SSRS links between sessions. Scores appear instantly with trend tracking. SMS is coming after BAA and consent controls are complete.',
                icon: '📤',
              },
              {
                prompt: 'Proactive caseload alerts',
                action: 'Deterioration detection, risk review flags, overdue assessment alerts — Miwa watches the caseload between sessions, not just during them.',
                icon: '📊',
              },
              {
                prompt: 'Living treatment plans',
                action: 'Treatment plans that update as sessions progress. Goals, objectives, and auto-progress tracking — without the quarterly rewrite.',
                icon: '🎯',
              },
            ].map((item, i) => (
              <div key={i} className="rounded-2xl p-6"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-2xl mb-3 block">{item.icon}</span>
                <p className="text-white font-bold text-base mb-2 leading-snug">
                  {item.prompt}
                </p>
                <p className="text-white/50 text-sm leading-relaxed">
                  {item.action}
                </p>
              </div>
            ))}
          </div>

          <p className="text-center text-white/25 text-sm mt-10">
            You are the clinician. Miwa is the assistant. Every action is logged, reviewable, and reversible.
          </p>
        </div>
      </section>

      <PricingPreview />
      <FAQ />
      <FinalCTA />
      <PublicFooter />
    </PublicPageShell>
  )
}
