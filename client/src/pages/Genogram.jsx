import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const EMPTY_MAP = { version: 1, people: [], relationships: [], annotations: [], events: [], viewport: { x: 0, y: 0, scale: 1 } }

const GENDER_OPTIONS = [
  ['female', 'Female'],
  ['male', 'Male'],
  ['nonbinary', 'Non-binary'],
  ['unknown', 'Unknown'],
]

const ROLE_OPTIONS = ['client', 'mother', 'father', 'parent', 'partner', 'former partner', 'sibling', 'child', 'grandparent', 'other']

const RELATIONSHIP_TYPES = [
  ['parent_child', 'Parent / child'],
  ['partner', 'Partner'],
  ['former_partner', 'Former partner'],
  ['sibling', 'Sibling'],
  ['emotional', 'Emotional'],
]

const QUALITY_OPTIONS = [
  ['unknown', 'Unknown'],
  ['supportive', 'Supportive'],
  ['close', 'Close'],
  ['distant', 'Distant'],
  ['conflict', 'Conflict'],
  ['cutoff', 'Cutoff'],
  ['fused', 'Fused'],
  ['abusive', 'Abusive'],
]

const TAG_OPTIONS = [
  ['identified-client', 'Identified client'],
  ['substance-use', 'Substance use'],
  ['mental-health', 'Mental health'],
  ['medical', 'Medical'],
  ['trauma', 'Trauma'],
  ['protective', 'Protective'],
  ['risk', 'Risk'],
  ['sample', 'Sample'],
]

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeMap(map) {
  return {
    ...EMPTY_MAP,
    ...(map || {}),
    people: Array.isArray(map?.people) ? map.people : [],
    relationships: Array.isArray(map?.relationships) ? map.relationships : [],
    annotations: Array.isArray(map?.annotations) ? map.annotations : [],
    events: Array.isArray(map?.events) ? map.events : [],
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function relationshipStroke(relationship) {
  const color = {
    supportive: '#059669',
    close: '#0f766e',
    distant: '#64748b',
    conflict: '#dc2626',
    cutoff: '#7f1d1d',
    fused: '#7c3aed',
    abusive: '#b91c1c',
    unknown: '#334155',
  }[relationship.quality || 'unknown']
  const dash = {
    distant: '7 7',
    conflict: '6 4',
    cutoff: '3 8',
    former_partner: '9 5',
  }[relationship.quality] || (relationship.type === 'former_partner' ? '9 5' : '')
  return { color, dash }
}

function PersonSymbol({ person, selected, onPointerDown, onClick }) {
  const isMale = person.gender === 'male'
  const isFemale = person.gender === 'female'
  const isClient = (person.tags || []).includes('identified-client')
  const x = Number(person.x) || 0
  const y = Number(person.y) || 0
  const fill = isClient ? '#fef3c7' : '#ffffff'
  const stroke = selected ? '#6047ee' : isClient ? '#d97706' : '#1f2937'

  return (
    <g transform={`translate(${x} ${y})`} className="cursor-grab active:cursor-grabbing" onPointerDown={onPointerDown} onClick={onClick}>
      {isMale ? (
        <rect x="-22" y="-22" width="44" height="44" rx="3" fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 2} />
      ) : isFemale ? (
        <circle cx="0" cy="0" r="23" fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 2} />
      ) : (
        <path d="M0 -27 L27 0 L0 27 L-27 0 Z" fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 2} />
      )}
      {person.deceased && (
        <path d="M-25 -25 L25 25 M25 -25 L-25 25" stroke="#b91c1c" strokeWidth="3" strokeLinecap="round" />
      )}
      {selected && <rect x="-32" y="-32" width="64" height="64" rx="6" fill="none" stroke="#6047ee" strokeDasharray="4 4" />}
      <text x="0" y="45" textAnchor="middle" className="fill-gray-900 text-[13px] font-semibold">
        {person.name || 'Unnamed'}
      </text>
      {(person.age || person.birthYear) && (
        <text x="0" y="61" textAnchor="middle" className="fill-gray-500 text-[11px]">
          {[person.age, person.birthYear].filter(Boolean).join(' | ')}
        </text>
      )}
    </g>
  )
}

function ToolbarButton({ active, children, onClick, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border transition-colors ${
        active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

export default function Genogram() {
  const { id } = useParams()
  const svgRef = useRef(null)
  const [patient, setPatient] = useState(null)
  const [title, setTitle] = useState('')
  const [map, setMap] = useState(EMPTY_MAP)
  const [clinicalSummary, setClinicalSummary] = useState('')
  const [versions, setVersions] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState('select')
  const [relationshipStart, setRelationshipStart] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState(null)
  const [dragging, setDragging] = useState(null)

  const selectedPerson = map.people.find((p) => p.id === selectedId) || null
  const selectedRelationship = map.relationships.find((r) => r.id === selectedId) || null

  const peopleById = useMemo(() => {
    const out = new Map()
    map.people.forEach((person) => out.set(person.id, person))
    return out
  }, [map.people])

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const [patientRes, genogramRes] = await Promise.all([
        apiFetch(`/patients/${id}`).then((r) => r.json()),
        apiFetch(`/patients/${id}/genogram`).then((r) => r.json()),
      ])
      setPatient(patientRes)
      setTitle(genogramRes.title || `${patientRes.display_name || patientRes.client_id} family map`)
      setClinicalSummary(genogramRes.clinical_summary || '')
      setMap(normalizeMap(genogramRes.map))
      setVersions(genogramRes.versions || [])
      setDraft(genogramRes.ai_draft || null)
    } catch {
      setMessage('Unable to load the family map.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function updatePerson(personId, patch) {
    setMap((current) => ({
      ...current,
      people: current.people.map((person) => person.id === personId ? { ...person, ...patch } : person),
    }))
  }

  function updateRelationship(relationshipId, patch) {
    setMap((current) => ({
      ...current,
      relationships: current.relationships.map((rel) => rel.id === relationshipId ? { ...rel, ...patch } : rel),
    }))
  }

  function addPerson(role = 'other') {
    const next = {
      id: uid('person'),
      name: '',
      role,
      gender: 'unknown',
      age: '',
      birthYear: '',
      x: 420 + (map.people.length % 4) * 95,
      y: 260 + Math.floor(map.people.length / 4) * 105,
      tags: role === 'client' ? ['identified-client'] : [],
      notes: '',
    }
    setMap((current) => ({ ...current, people: [...current.people, next] }))
    setSelectedId(next.id)
    setMode('select')
  }

  function addAnnotation() {
    const next = { id: uid('annotation'), text: 'Clinical note', x: 180, y: 160 }
    setMap((current) => ({ ...current, annotations: [...current.annotations, next] }))
  }

  function removeSelected() {
    if (!selectedId) return
    setMap((current) => ({
      ...current,
      people: current.people.filter((person) => person.id !== selectedId),
      relationships: current.relationships.filter((rel) => rel.id !== selectedId && rel.from !== selectedId && rel.to !== selectedId),
      annotations: current.annotations.filter((annotation) => annotation.id !== selectedId),
    }))
    setSelectedId(null)
    setRelationshipStart(null)
  }

  function pointFromEvent(event) {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse())
    return { x: transformed.x, y: transformed.y }
  }

  function handlePersonClick(person, event) {
    event.stopPropagation()
    if (mode === 'relationship') {
      if (!relationshipStart) {
        setRelationshipStart(person.id)
        setSelectedId(person.id)
        return
      }
      if (relationshipStart !== person.id) {
        const next = {
          id: uid('relationship'),
          from: relationshipStart,
          to: person.id,
          type: 'emotional',
          quality: 'unknown',
          label: '',
          notes: '',
        }
        setMap((current) => ({ ...current, relationships: [...current.relationships, next] }))
        setSelectedId(next.id)
        setRelationshipStart(null)
        setMode('select')
      }
      return
    }
    setSelectedId(person.id)
  }

  function handlePointerDown(person, event) {
    if (mode !== 'select') return
    event.stopPropagation()
    const point = pointFromEvent(event)
    setDragging({ id: person.id, dx: point.x - person.x, dy: point.y - person.y })
    setSelectedId(person.id)
  }

  function handlePointerMove(event) {
    if (!dragging) return
    const point = pointFromEvent(event)
    updatePerson(dragging.id, { x: Math.round(point.x - dragging.dx), y: Math.round(point.y - dragging.dy) })
  }

  async function save(changeNote = 'Saved family map') {
    setSaving(true)
    setMessage('')
    try {
      const res = await apiFetch(`/patients/${id}/genogram`, {
        method: 'PUT',
        body: JSON.stringify({ title, map, clinical_summary: clinicalSummary, change_note: changeNote }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Save failed')
      setMessage('Family map saved.')
      load()
    } catch (err) {
      setMessage(err.message || 'Unable to save the family map.')
    } finally {
      setSaving(false)
    }
  }

  async function generateDraft() {
    setDrafting(true)
    setMessage('')
    try {
      const res = await apiFetch(`/patients/${id}/genogram/draft`, { method: 'POST', body: JSON.stringify({}) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || body.error || 'Draft failed')
      setDraft(body.draft)
      setMessage('Miwa drafted a reviewable family map from chart data.')
    } catch (err) {
      setMessage(err.message || 'Unable to generate a draft.')
    } finally {
      setDrafting(false)
    }
  }

  function acceptDraft() {
    if (!draft?.map) return
    setMap(normalizeMap(draft.map))
    setClinicalSummary(draft.clinicalSummary || clinicalSummary)
    setDraft(null)
    setMessage('Draft applied. Review details, then save.')
  }

  function exportSvg() {
    const svg = svgRef.current
    if (!svg) return
    const source = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title || 'miwa-family-map'}.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportPng() {
    const svg = svgRef.current
    if (!svg) return
    const source = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 760
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = `${title || 'miwa-family-map'}.png`
      link.click()
    }
    img.src = url
  }

  async function exportPdf() {
    const svg = svgRef.current
    if (!svg) return
    const html2pdf = (await import('html2pdf.js')).default
    const source = new XMLSerializer().serializeToString(svg)
    const wrapper = document.createElement('div')
    wrapper.style.width = '1200px'
    wrapper.style.padding = '24px'
    wrapper.style.background = '#ffffff'
    const safeTitle = escapeHtml(title || 'Miwa family map')
    const safePatient = escapeHtml(patient?.display_name || patient?.client_id || '')
    const safeSummary = escapeHtml(clinicalSummary)
    wrapper.innerHTML = `
      <div style="font-family: Inter, Arial, sans-serif; margin-bottom: 14px;">
        <div style="font-size: 22px; font-weight: 700; color: #111827;">${safeTitle}</div>
        <div style="font-size: 12px; color: #6b7280;">${safePatient}</div>
      </div>
      ${source}
      ${clinicalSummary ? `<div style="font-family: Inter, Arial, sans-serif; margin-top: 16px; font-size: 13px; line-height: 1.55; color: #374151;"><strong>Clinical summary:</strong> ${safeSummary}</div>` : ''}
    `
    await html2pdf()
      .set({ margin: 0.25, filename: `${title || 'miwa-family-map'}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' } })
      .from(wrapper)
      .save()
  }

  const tagToggle = (tag) => {
    if (!selectedPerson) return
    const tags = new Set(selectedPerson.tags || [])
    if (tags.has(tag)) tags.delete(tag)
    else tags.add(tag)
    updatePerson(selectedPerson.id, { tags: [...tags] })
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="card p-8 text-center text-gray-500">Loading family map...</div>
      </div>
    )
  }

  return (
    <div className="patient-detail-page p-6 max-w-7xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/patients" className="hover:text-brand-600">Patients</Link>
        <span>/</span>
        <Link to={`/patients/${id}`} className="hover:text-brand-600">{patient?.display_name || patient?.client_id || 'Client'}</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Family Map</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] font-bold text-brand-600 uppercase tracking-[0.18em]">Miwa Apps</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Family Map</h1>
          <p className="text-sm text-gray-500 mt-1">Clinical genogram workspace for structure, emotional patterns, notes, and exports.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-xs" onClick={exportSvg}>Export SVG</button>
          <button className="btn-secondary text-xs" onClick={exportPng}>Export PNG</button>
          <button className="btn-secondary text-xs" onClick={exportPdf}>Export PDF</button>
          <button className="btn-secondary text-xs" onClick={generateDraft} disabled={drafting}>
            {drafting ? 'Drafting...' : 'Draft from chart'}
          </button>
          <button className="btn-primary text-xs" onClick={() => save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save map'}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
          {message}
        </div>
      )}

      {draft && (
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <p className="text-sm font-bold text-teal-900">Reviewable Miwa draft ready</p>
            <p className="text-xs text-teal-800 mt-1">{draft.clinicalSummary || 'Miwa found enough chart context to draft a starter map.'}</p>
            {!!draft.insights?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.insights.slice(0, 4).map((insight) => (
                  <span key={insight} className="rounded-full bg-white/80 border border-teal-100 px-2 py-1 text-[11px] text-teal-800">{insight}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => setDraft(null)}>Dismiss</button>
            <button className="btn-primary text-xs" onClick={acceptDraft}>Apply draft</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">
        <section className="space-y-4">
          <div className="card p-4">
            <label className="label text-xs">Map title</label>
            <input className="input py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="card p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Tools</p>
            <div className="grid grid-cols-5 gap-2">
              <ToolbarButton active={mode === 'select'} onClick={() => setMode('select')} title="Select and move">
                <span className="text-sm font-bold">↖</span>
              </ToolbarButton>
              <ToolbarButton active={mode === 'relationship'} onClick={() => setMode('relationship')} title="Connect two people">
                <span className="text-sm font-bold">⟷</span>
              </ToolbarButton>
              <ToolbarButton onClick={() => addPerson('client')} title="Add identified client">
                <span className="text-sm font-bold">□</span>
              </ToolbarButton>
              <ToolbarButton onClick={() => addPerson('other')} title="Add person">
                <span className="text-sm font-bold">○</span>
              </ToolbarButton>
              <ToolbarButton onClick={addAnnotation} title="Add note">
                <span className="text-sm font-bold">T</span>
              </ToolbarButton>
            </div>
            {mode === 'relationship' && (
              <p className="mt-3 text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                {relationshipStart ? 'Select the second person to connect.' : 'Select the first person to connect.'}
              </p>
            )}
          </div>

          <div className="card p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Legend</p>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex items-center gap-2"><span className="w-5 h-5 border-2 border-gray-800 inline-block" /> Male</div>
              <div className="flex items-center gap-2"><span className="w-5 h-5 border-2 border-gray-800 rounded-full inline-block" /> Female</div>
              <div className="flex items-center gap-2"><span className="w-5 h-5 border-2 border-gray-800 rotate-45 inline-block" /> Unknown / other</div>
              <div className="flex items-center gap-2"><span className="w-8 h-0.5 bg-red-600 inline-block" /> Conflict / risk pattern</div>
              <div className="flex items-center gap-2"><span className="w-8 h-0.5 bg-emerald-600 inline-block" /> Supportive / close</div>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Version history</p>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {versions.length === 0 ? (
                <p className="text-xs text-gray-400">Save the map to create the first snapshot.</p>
              ) : versions.map((version) => (
                <div key={version.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-xs font-semibold text-gray-800">{version.change_note || 'Saved map'}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{new Date(version.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card overflow-hidden min-h-[760px]">
          <div className="h-12 px-4 border-b border-gray-100 flex items-center justify-between bg-white">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{map.people.length} people</span>
              <span>•</span>
              <span>{map.relationships.length} relationships</span>
            </div>
            <button className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-40" disabled={!selectedId} onClick={removeSelected}>
              Delete selected
            </button>
          </div>
          <svg
            ref={svgRef}
            viewBox="0 0 1200 760"
            className="w-full h-[760px] bg-white"
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
            onClick={() => {
              setSelectedId(null)
              if (mode === 'relationship') setRelationshipStart(null)
            }}
          >
            <defs>
              <pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse">
                <path d="M 38 0 L 0 0 0 38" fill="none" stroke="#e5e7eb" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="1200" height="760" fill="url(#grid)" />

            {map.relationships.map((relationship) => {
              const from = peopleById.get(relationship.from)
              const to = peopleById.get(relationship.to)
              if (!from || !to) return null
              const stroke = relationshipStroke(relationship)
              const midX = (Number(from.x) + Number(to.x)) / 2
              const midY = (Number(from.y) + Number(to.y)) / 2
              return (
                <g key={relationship.id} onClick={(event) => { event.stopPropagation(); setSelectedId(relationship.id) }} className="cursor-pointer">
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={stroke.color}
                    strokeWidth={selectedId === relationship.id ? 5 : 3}
                    strokeDasharray={stroke.dash}
                    strokeLinecap="round"
                  />
                  {relationship.type === 'cutoff' || relationship.quality === 'cutoff' ? (
                    <path d={`M ${midX - 12} ${midY - 12} L ${midX + 12} ${midY + 12} M ${midX + 12} ${midY - 12} L ${midX - 12} ${midY + 12}`} stroke="#7f1d1d" strokeWidth="3" />
                  ) : null}
                  {(relationship.label || relationship.quality !== 'unknown') && (
                    <text x={midX} y={midY - 8} textAnchor="middle" className="fill-gray-700 text-[12px] font-semibold">
                      {relationship.label || relationship.quality}
                    </text>
                  )}
                </g>
              )
            })}

            {map.annotations.map((annotation) => (
              <g key={annotation.id} transform={`translate(${annotation.x} ${annotation.y})`} onClick={(event) => { event.stopPropagation(); setSelectedId(annotation.id) }}>
                <rect x="-90" y="-26" width="180" height="52" rx="4" fill="#fef9c3" stroke={selectedId === annotation.id ? '#6047ee' : '#eab308'} strokeWidth="2" />
                <text x="0" y="4" textAnchor="middle" className="fill-gray-800 text-[13px]">{annotation.text}</text>
              </g>
            ))}

            {map.people.map((person) => (
              <PersonSymbol
                key={person.id}
                person={person}
                selected={selectedId === person.id || relationshipStart === person.id}
                onPointerDown={(event) => handlePointerDown(person, event)}
                onClick={(event) => handlePersonClick(person, event)}
              />
            ))}
          </svg>
        </section>

        <aside className="space-y-4">
          <div className="card p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Inspector</p>
            {selectedPerson ? (
              <div className="space-y-3">
                <div>
                  <label className="label text-xs">Name</label>
                  <input className="input py-2 text-sm" value={selectedPerson.name || ''} onChange={(e) => updatePerson(selectedPerson.id, { name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs">Role</label>
                    <select className="input py-2 text-sm" value={selectedPerson.role || 'other'} onChange={(e) => updatePerson(selectedPerson.id, { role: e.target.value })}>
                      {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Gender marker</label>
                    <select className="input py-2 text-sm" value={selectedPerson.gender || 'unknown'} onChange={(e) => updatePerson(selectedPerson.id, { gender: e.target.value })}>
                      {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input py-2 text-sm" placeholder="Age" value={selectedPerson.age || ''} onChange={(e) => updatePerson(selectedPerson.id, { age: e.target.value })} />
                  <input className="input py-2 text-sm" placeholder="Birth year" value={selectedPerson.birthYear || ''} onChange={(e) => updatePerson(selectedPerson.id, { birthYear: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                  <input type="checkbox" checked={!!selectedPerson.deceased} onChange={(e) => updatePerson(selectedPerson.id, { deceased: e.target.checked })} />
                  Deceased
                </label>
                <div>
                  <p className="label text-xs">Clinical tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_OPTIONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => tagToggle(value)}
                        className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
                          (selectedPerson.tags || []).includes(value)
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-gray-600 border-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label text-xs">Notes</label>
                  <textarea className="textarea min-h-[90px] text-sm" value={selectedPerson.notes || ''} onChange={(e) => updatePerson(selectedPerson.id, { notes: e.target.value })} />
                </div>
              </div>
            ) : selectedRelationship ? (
              <div className="space-y-3">
                <div>
                  <label className="label text-xs">Relationship</label>
                  <select className="input py-2 text-sm" value={selectedRelationship.type || 'emotional'} onChange={(e) => updateRelationship(selectedRelationship.id, { type: e.target.value })}>
                    {RELATIONSHIP_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Quality</label>
                  <select className="input py-2 text-sm" value={selectedRelationship.quality || 'unknown'} onChange={(e) => updateRelationship(selectedRelationship.id, { quality: e.target.value })}>
                    {QUALITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <input className="input py-2 text-sm" placeholder="Label" value={selectedRelationship.label || ''} onChange={(e) => updateRelationship(selectedRelationship.id, { label: e.target.value })} />
                <textarea className="textarea min-h-[90px] text-sm" placeholder="Relationship notes" value={selectedRelationship.notes || ''} onChange={(e) => updateRelationship(selectedRelationship.id, { notes: e.target.value })} />
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select a person or relationship to edit details. Use the connect tool to add emotional or family lines.</p>
            )}
          </div>

          <div className="card p-4">
            <label className="label text-xs">Clinical summary</label>
            <textarea
              className="textarea min-h-[150px] text-sm"
              value={clinicalSummary}
              onChange={(e) => setClinicalSummary(e.target.value)}
              placeholder="Summarize intergenerational themes, supports, cutoffs, risk patterns, and hypotheses here."
            />
          </div>

          <div className="card p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Life events</p>
            <div className="space-y-2">
              {map.events.map((event) => (
                <div key={event.id} className="grid grid-cols-[64px_1fr] gap-2">
                  <input className="input py-2 text-xs" placeholder="Year" value={event.year || ''} onChange={(e) => setMap((current) => ({ ...current, events: current.events.map((item) => item.id === event.id ? { ...item, year: e.target.value } : item) }))} />
                  <input className="input py-2 text-xs" placeholder="Event" value={event.label || ''} onChange={(e) => setMap((current) => ({ ...current, events: current.events.map((item) => item.id === event.id ? { ...item, label: e.target.value } : item) }))} />
                </div>
              ))}
              <button
                type="button"
                className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                onClick={() => setMap((current) => ({ ...current, events: [...current.events, { id: uid('event'), year: '', label: '', notes: '' }] }))}
              >
                Add event
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
