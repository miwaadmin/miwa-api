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
  ['plain', 'Plain / normal'],
  ['supportive', 'Supportive'],
  ['close', 'Close'],
  ['very_close', 'Best friends / very close'],
  ['harmony', 'Harmony'],
  ['friendship', 'Friendship'],
  ['love', 'Love'],
  ['in_love', 'In love'],
  ['spiritual', 'Emotional / spiritual connection'],
  ['indifferent', 'Indifferent / apathetic'],
  ['distant', 'Distant'],
  ['poor', 'Poor'],
  ['conflict', 'Conflict'],
  ['discord', 'Discord'],
  ['distrust', 'Distrust'],
  ['hostile', 'Hostile'],
  ['hate', 'Hate'],
  ['controlling', 'Controlling'],
  ['manipulative', 'Manipulative'],
  ['jealous', 'Jealous'],
  ['cutoff', 'Cutoff'],
  ['cutoff_repaired', 'Cutoff repaired'],
  ['fused', 'Fused'],
  ['close_hostile', 'Close-hostile'],
  ['distant_hostile', 'Distant-hostile'],
  ['fused_hostile', 'Fused-hostile'],
  ['abusive', 'Abusive'],
  ['physical_abuse', 'Physical abuse'],
  ['emotional_abuse', 'Emotional abuse'],
  ['sexual_abuse', 'Sexual abuse'],
  ['neglect', 'Neglect'],
  ['violence', 'Violence'],
  ['distant_violence', 'Distant-violence'],
  ['close_violence', 'Close-violence'],
  ['fused_violence', 'Fused-violence'],
  ['focused_on', 'Focused on'],
  ['focused_negative', 'Focused on negatively'],
  ['never_met', 'Never met'],
  ['fan', 'Fan / admirer'],
  ['limerence', 'Limerence'],
]

// Each color is unique across the whole list. Recovery is two markers
// instead of five overlapping ones — to express "recovery from one, active
// in the other," select the recovery marker plus the active marker.
const CLINICAL_MARKERS = [
  { value: 'identified-client', label: 'Identified client', group: 'Role', color: '#f59e0b', fill: '#fef3c7' },
  { value: 'protective', label: 'Protective / support', group: 'Strengths', color: '#14b8a6', fill: '#ccfbf1' },

  { value: 'current-risk', label: 'Current risk / safety concern', group: 'Risk & trauma', color: '#ef4444', fill: '#fee2e2' },
  { value: 'risk', label: 'Risk pattern (historical)', group: 'Risk & trauma', color: '#f43f5e', fill: '#ffe4e6' },
  { value: 'ipv', label: 'IPV / coercive control', group: 'Risk & trauma', color: '#7f1d1d', fill: '#fecaca' },
  { value: 'trauma', label: 'Trauma history', group: 'Risk & trauma', color: '#be185d', fill: '#fce7f3' },

  { value: 'substance-use', label: 'Active drug / substance use', group: 'Substance & addictions', color: '#f97316', fill: '#ffedd5' },
  { value: 'alcohol-use', label: 'Active alcohol use', group: 'Substance & addictions', color: '#b45309', fill: '#fef3c7' },
  { value: 'suspected-substance', label: 'Suspected substance / alcohol use', group: 'Substance & addictions', color: '#fdba74', fill: '#ffedd5' },
  { value: 'gambling', label: 'Gambling addiction', group: 'Substance & addictions', color: '#eab308', fill: '#fef9c3' },
  { value: 'recovery-substance', label: 'Recovery from substance use', group: 'Substance & addictions', color: '#84cc16', fill: '#ecfccb' },

  { value: 'mental-health', label: 'Mental health condition (other)', group: 'Mental health', color: '#1d4ed8', fill: '#dbeafe' },
  { value: 'depression', label: 'Depression', group: 'Mental health', color: '#6d28d9', fill: '#ede9fe' },
  { value: 'anxiety', label: 'Anxiety', group: 'Mental health', color: '#06b6d4', fill: '#cffafe' },

  { value: 'autism', label: 'Autism', group: 'Neurodevelopmental', color: '#8b5cf6', fill: '#ede9fe' },
  { value: 'neurodevelopmental', label: 'Other neurodevelopmental', group: 'Neurodevelopmental', color: '#a855f7', fill: '#f3e8ff' },

  { value: 'physical-illness', label: 'Serious physical illness', group: 'Medical', color: '#2563eb', fill: '#dbeafe' },
  { value: 'serious-illness-substance', label: 'Serious illness with substance use', group: 'Medical', color: '#4338ca', fill: '#e0e7ff' },
  { value: 'recovery-illness', label: 'Recovery / remission from illness', group: 'Medical', color: '#4ade80', fill: '#dcfce7' },
  { value: 'chronic-illness', label: 'Chronic illness', group: 'Medical', color: '#15803d', fill: '#bbf7d0' },
  { value: 'medical', label: 'Other medical condition', group: 'Medical', color: '#16a34a', fill: '#dcfce7' },
  { value: 'cancer', label: 'Cancer', group: 'Medical', color: '#475569', fill: '#e2e8f0' },
  { value: 'heart-disease', label: 'Heart disease', group: 'Medical', color: '#dc2626', fill: '#fee2e2' },
  { value: 'hypertension', label: 'High blood pressure', group: 'Medical', color: '#991b1b', fill: '#fecaca' },
  { value: 'hiv-aids', label: 'HIV / AIDS', group: 'Medical', color: '#e11d48', fill: '#ffe4e6' },
  { value: 'std', label: 'Sexually transmitted infection', group: 'Medical', color: '#db2777', fill: '#fce7f3' },
  { value: 'hepatitis', label: 'Hepatitis', group: 'Medical', color: '#facc15', fill: '#fef9c3' },
  { value: 'diabetes', label: 'Diabetes', group: 'Medical', color: '#0ea5e9', fill: '#e0f2fe' },
  { value: 'arthritis', label: 'Arthritis', group: 'Medical', color: '#94a3b8', fill: '#f1f5f9' },
  { value: 'alzheimers', label: "Alzheimer's / dementia", group: 'Medical', color: '#57534e', fill: '#e7e5e4' },
  { value: 'obesity', label: 'Obesity', group: 'Medical', color: '#65a30d', fill: '#ecfccb' },

  { value: 'adopted-child', label: 'Adopted', group: 'Family context', color: '#0f766e', fill: '#ccfbf1' },
  { value: 'foster-child', label: 'Foster placement', group: 'Family context', color: '#0369a1', fill: '#e0f2fe' },
  { value: 'pregnancy', label: 'Pregnancy', group: 'Family context', color: '#ec4899', fill: '#fce7f3' },
  { value: 'miscarriage', label: 'Miscarriage', group: 'Family context', color: '#a1a1aa', fill: '#f4f4f5' },
  { value: 'abortion', label: 'Abortion', group: 'Family context', color: '#52525b', fill: '#e4e4e7' },

  { value: 'grief-loss', label: 'Grief / loss', group: 'Context', color: '#334155', fill: '#e2e8f0' },
  { value: 'legal-system', label: 'Legal / system involvement', group: 'Context', color: '#c026d3', fill: '#fae8ff' },
  { value: 'sample', label: 'Sample / training', group: 'Context', color: '#d4d4d8', fill: '#fafafa' },
]

const TAG_OPTIONS = CLINICAL_MARKERS.map((marker) => [marker.value, marker.label])
const MARKER_BY_VALUE = Object.fromEntries(CLINICAL_MARKERS.map((marker) => [marker.value, marker]))
const TAG_GROUPS = CLINICAL_MARKERS.reduce((acc, marker) => {
  acc[marker.group] = [...(acc[marker.group] || []), marker]
  return acc
}, {})

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

// Every quality has its own hex (no two qualities share an exact color).
// Dash patterns add a second visual axis so closely related qualities
// (e.g. hostile vs hate) are also distinguishable at a glance.
const RELATIONSHIP_STROKE = {
  // Positive / warm — greens & teals
  plain:           { color: '#111827', dash: '' },
  supportive:      { color: '#10b981', dash: '' },
  close:           { color: '#059669', dash: '' },
  very_close:      { color: '#047857', dash: '' },
  harmony:         { color: '#22c55e', dash: '' },
  friendship:      { color: '#4ade80', dash: '' },
  fan:             { color: '#14b8a6', dash: '' },
  cutoff_repaired: { color: '#16a34a', dash: '10 4 2 4' },

  // Romantic / intimate — reds & pinks
  love:            { color: '#e11d48', dash: '' },
  in_love:         { color: '#be123c', dash: '' },
  limerence:       { color: '#fb7185', dash: '' },

  // Spiritual / enmeshment — purples
  spiritual:       { color: '#7c3aed', dash: '' },
  fused:           { color: '#9333ea', dash: '' },

  // Attention — blue / amber
  focused_on:      { color: '#2563eb', dash: '' },
  focused_negative:{ color: '#d97706', dash: '4 3' },

  // Cool / distant — grays
  indifferent:     { color: '#cbd5e1', dash: '2 6' },
  distant:         { color: '#94a3b8', dash: '7 4' },
  poor:            { color: '#64748b', dash: '5 5' },
  never_met:       { color: '#e2e8f0', dash: '2 8' },
  cutoff:          { color: '#1e293b', dash: '3 8' },

  // Conflict — bright reds (dashed)
  conflict:        { color: '#dc2626', dash: '6 4' },
  discord:         { color: '#f87171', dash: '4 4' },

  // Distrust / manipulation — ambers & oranges
  distrust:        { color: '#92400e', dash: '12 5' },
  jealous:         { color: '#a16207', dash: '12 4 2 4' },
  controlling:     { color: '#ea580c', dash: '3 3' },
  manipulative:    { color: '#c2410c', dash: '4 2 2 2' },

  // Hostile family — distinct deep reds + dashes
  hostile:         { color: '#b91c1c', dash: '10 3 3 3' },
  hate:            { color: '#7f1d1d', dash: '8 2 2 2' },
  close_hostile:   { color: '#f97316', dash: '2 3' },
  distant_hostile: { color: '#9f1239', dash: '8 5 2 5' },
  fused_hostile:   { color: '#6b21a8', dash: '6 2 2 2' },

  // Abuse — solid, separate hue per type
  abusive:         { color: '#9f1239', dash: '' },
  physical_abuse:  { color: '#7c2d12', dash: '' },
  emotional_abuse: { color: '#db2777', dash: '' },
  sexual_abuse:    { color: '#a21caf', dash: '' },
  neglect:         { color: '#78350f', dash: '' },

  // Violence — dark-red family, distinct hues
  violence:        { color: '#450a0a', dash: '' },
  distant_violence:{ color: '#991b1b', dash: '8 5' },
  close_violence:  { color: '#ef4444', dash: '2 2' },
  fused_violence:  { color: '#581c87', dash: '6 4' },

  unknown:         { color: '#334155', dash: '' },
}

function relationshipStroke(relationship) {
  const entry = RELATIONSHIP_STROKE[relationship.quality || 'unknown'] || RELATIONSHIP_STROKE.unknown
  // Former-partner overrides dash if the quality didn't already set one,
  // so the canonical "double-slash" partner marker still shows up.
  const dash = entry.dash || (relationship.type === 'former_partner' ? '9 5' : '')
  return { color: entry.color, dash }
}

function personX(person) {
  return Number(person?.x) || 0
}

function personY(person) {
  return Number(person?.y) || 0
}

function topEdge(person) {
  return personY(person) - (person?.gender === 'unknown' ? 27 : 23)
}

function bottomEdge(person) {
  return personY(person) + (person?.gender === 'unknown' ? 27 : 23)
}

function buildFamilyLayout(relationships, peopleById) {
  const parentChild = relationships.filter((rel) => rel.type === 'parent_child')
  const parentChildIds = new Set()
  const renderedIds = new Set()
  const childToParents = new Map()
  const parentChildByPair = new Map()

  parentChild.forEach((rel) => {
    if (!peopleById.has(rel.from) || !peopleById.has(rel.to)) return
    const parents = childToParents.get(rel.to) || new Set()
    parents.add(rel.from)
    childToParents.set(rel.to, parents)
    parentChildByPair.set(`${rel.from}:${rel.to}`, rel)
    parentChildIds.add(rel.id)
  })

  const branches = relationships
    .filter((rel) => rel.type === 'partner' || rel.type === 'former_partner')
    .map((partnerRel) => {
      const parentA = peopleById.get(partnerRel.from)
      const parentB = peopleById.get(partnerRel.to)
      if (!parentA || !parentB) return null

      const children = []
      childToParents.forEach((parents, childId) => {
        if (parents.has(partnerRel.from) && parents.has(partnerRel.to)) {
          const child = peopleById.get(childId)
          if (child) children.push(child)
        }
      })
      children.sort((a, b) => personX(a) - personX(b))

      renderedIds.add(partnerRel.id)
      children.forEach((child) => {
        const first = parentChildByPair.get(`${partnerRel.from}:${child.id}`)
        const second = parentChildByPair.get(`${partnerRel.to}:${child.id}`)
        if (first) renderedIds.add(first.id)
        if (second) renderedIds.add(second.id)
      })

      return { partnerRel, parentA, parentB, children }
    })
    .filter(Boolean)

  const looseParentChild = parentChild.filter((rel) => !renderedIds.has(rel.id))
  const sibling = relationships.filter((rel) => rel.type === 'sibling')
  sibling.forEach((rel) => renderedIds.add(rel.id))

  return { branches, looseParentChild, sibling, renderedIds, parentChildIds }
}

function annotationWidth(annotation) {
  return Math.max(220, Math.min(460, Number(annotation?.width) || 320))
}

function wrapAnnotationText(text, width) {
  const maxChars = Math.max(18, Math.floor((width - 28) / 7.2))
  const words = String(text || 'Clinical note').split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''

  words.forEach((word) => {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ''
      }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      return
    }

    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  })

  if (current) lines.push(current)
  return lines.length ? lines : ['Clinical note']
}

function annotationHeight(annotation) {
  const lines = wrapAnnotationText(annotation?.text, annotationWidth(annotation))
  return Math.max(64, lines.length * 18 + 28)
}

function PersonSymbol({ person, selected, onPointerDown, onClick }) {
  const isMale = person.gender === 'male'
  const isFemale = person.gender === 'female'
  const isClient = (person.tags || []).includes('identified-client')
  const x = Number(person.x) || 0
  const y = Number(person.y) || 0
  const markers = (person.tags || []).map((tag) => MARKER_BY_VALUE[tag]).filter(Boolean)
  const primaryMarker = markers.find((marker) => marker.value !== 'identified-client') || markers[0]
  const fill = primaryMarker?.fill || (isClient ? '#fef3c7' : '#ffffff')
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
      {markers.length > 0 && (
        <g transform="translate(-24 -38)">
          {markers.slice(0, 5).map((marker, index) => (
            <rect key={marker.value} x={index * 11} y="0" width="8" height="8" rx="1.5" fill={marker.color} stroke="#ffffff" strokeWidth="1" />
          ))}
        </g>
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
  const selectedAnnotation = map.annotations.find((annotation) => annotation.id === selectedId) || null

  const peopleById = useMemo(() => {
    const out = new Map()
    map.people.forEach((person) => out.set(person.id, person))
    return out
  }, [map.people])
  const familyLayout = useMemo(() => buildFamilyLayout(map.relationships, peopleById), [map.relationships, peopleById])

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

  function updateAnnotation(annotationId, patch) {
    setMap((current) => ({
      ...current,
      annotations: current.annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, ...patch } : annotation),
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

  function addFamilyUnit() {
    const baseX = 430 + (map.people.length % 2) * 260
    const baseY = 175 + Math.floor(map.people.length / 6) * 230
    const parentA = {
      id: uid('person'),
      name: '',
      role: 'parent',
      gender: 'male',
      age: '',
      birthYear: '',
      x: baseX - 95,
      y: baseY,
      tags: [],
      notes: '',
    }
    const parentB = {
      id: uid('person'),
      name: '',
      role: 'parent',
      gender: 'female',
      age: '',
      birthYear: '',
      x: baseX + 95,
      y: baseY,
      tags: [],
      notes: '',
    }
    const child = {
      id: uid('person'),
      name: '',
      role: 'child',
      gender: 'unknown',
      age: '',
      birthYear: '',
      x: baseX,
      y: baseY + 155,
      tags: [],
      notes: '',
    }
    const relationships = [
      { id: uid('relationship'), from: parentA.id, to: parentB.id, type: 'partner', quality: 'plain', label: '', notes: '' },
      { id: uid('relationship'), from: parentA.id, to: child.id, type: 'parent_child', quality: 'plain', label: '', notes: '' },
      { id: uid('relationship'), from: parentB.id, to: child.id, type: 'parent_child', quality: 'plain', label: '', notes: '' },
    ]
    setMap((current) => ({
      ...current,
      people: [...current.people, parentA, parentB, child],
      relationships: [...current.relationships, ...relationships],
    }))
    setSelectedId(child.id)
    setMode('select')
  }

  function addParentsForSelected() {
    if (!selectedPerson) return
    const x = personX(selectedPerson)
    const y = personY(selectedPerson)
    const parentA = {
      id: uid('person'),
      name: '',
      role: 'parent',
      gender: 'male',
      age: '',
      birthYear: '',
      x: x - 95,
      y: y - 155,
      tags: [],
      notes: '',
    }
    const parentB = {
      id: uid('person'),
      name: '',
      role: 'parent',
      gender: 'female',
      age: '',
      birthYear: '',
      x: x + 95,
      y: y - 155,
      tags: [],
      notes: '',
    }
    const relationships = [
      { id: uid('relationship'), from: parentA.id, to: parentB.id, type: 'partner', quality: 'plain', label: '', notes: '' },
      { id: uid('relationship'), from: parentA.id, to: selectedPerson.id, type: 'parent_child', quality: 'plain', label: '', notes: '' },
      { id: uid('relationship'), from: parentB.id, to: selectedPerson.id, type: 'parent_child', quality: 'plain', label: '', notes: '' },
    ]
    setMap((current) => ({
      ...current,
      people: [...current.people, parentA, parentB],
      relationships: [...current.relationships, ...relationships],
    }))
    setSelectedId(parentA.id)
  }

  function addChildForSelected() {
    if (!selectedPerson) return
    const child = {
      id: uid('person'),
      name: '',
      role: 'child',
      gender: 'unknown',
      age: '',
      birthYear: '',
      x: personX(selectedPerson),
      y: personY(selectedPerson) + 155,
      tags: [],
      notes: '',
    }
    const relationship = { id: uid('relationship'), from: selectedPerson.id, to: child.id, type: 'parent_child', quality: 'plain', label: '', notes: '' }
    setMap((current) => ({
      ...current,
      people: [...current.people, child],
      relationships: [...current.relationships, relationship],
    }))
    setSelectedId(child.id)
  }

  function addChildToSelectedCouple() {
    if (!selectedRelationship || !['partner', 'former_partner'].includes(selectedRelationship.type)) return
    const parentA = peopleById.get(selectedRelationship.from)
    const parentB = peopleById.get(selectedRelationship.to)
    if (!parentA || !parentB) return
    const existingChildren = familyLayout.branches.find((branch) => branch.partnerRel.id === selectedRelationship.id)?.children || []
    const child = {
      id: uid('person'),
      name: '',
      role: 'child',
      gender: 'unknown',
      age: '',
      birthYear: '',
      x: (personX(parentA) + personX(parentB)) / 2 + existingChildren.length * 70,
      y: Math.max(personY(parentA), personY(parentB)) + 155,
      tags: [],
      notes: '',
    }
    const relationships = [
      { id: uid('relationship'), from: parentA.id, to: child.id, type: 'parent_child', quality: 'plain', label: '', notes: '' },
      { id: uid('relationship'), from: parentB.id, to: child.id, type: 'parent_child', quality: 'plain', label: '', notes: '' },
    ]
    setMap((current) => ({
      ...current,
      people: [...current.people, child],
      relationships: [...current.relationships, ...relationships],
    }))
    setSelectedId(child.id)
  }

  function addAnnotation() {
    const next = { id: uid('annotation'), text: 'Clinical note', x: 260, y: 170, width: 320 }
    setMap((current) => ({ ...current, annotations: [...current.annotations, next] }))
    setSelectedId(next.id)
    setMode('select')
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
    setDragging({ type: 'person', id: person.id, dx: point.x - person.x, dy: point.y - person.y })
    setSelectedId(person.id)
  }

  function handleAnnotationPointerDown(annotation, event) {
    if (mode !== 'select') return
    event.stopPropagation()
    const point = pointFromEvent(event)
    setDragging({ type: 'annotation', id: annotation.id, dx: point.x - (Number(annotation.x) || 0), dy: point.y - (Number(annotation.y) || 0) })
    setSelectedId(annotation.id)
  }

  function handlePointerMove(event) {
    if (!dragging) return
    const point = pointFromEvent(event)
    const patch = { x: Math.round(point.x - dragging.dx), y: Math.round(point.y - dragging.dy) }
    if (dragging.type === 'annotation') updateAnnotation(dragging.id, patch)
    else updatePerson(dragging.id, patch)
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
          <button
            className="btn-secondary text-xs"
            onClick={generateDraft}
            disabled={drafting}
            title="Uses this client's profile fields, family/social history, and recent session notes to create a therapist-reviewable starter map."
          >
            {drafting ? 'Drafting...' : 'Draft from chart notes'}
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
                <span className="text-sm font-bold">S</span>
              </ToolbarButton>
              <ToolbarButton active={mode === 'relationship'} onClick={() => setMode('relationship')} title="Connect two people">
                <span className="text-sm font-bold">L</span>
              </ToolbarButton>
              <ToolbarButton onClick={() => addPerson('client')} title="Add identified client">
                <span className="text-sm font-bold">IC</span>
              </ToolbarButton>
              <ToolbarButton onClick={() => addPerson('other')} title="Add person">
                <span className="text-sm font-bold">P</span>
              </ToolbarButton>
              <ToolbarButton onClick={addFamilyUnit} title="Add parent couple with child">
                <span className="text-[11px] font-bold">FAM</span>
              </ToolbarButton>
              <ToolbarButton onClick={addParentsForSelected} title="Add two parents above selected person">
                <span className="text-[11px] font-bold">PAR</span>
              </ToolbarButton>
              <ToolbarButton onClick={addChildForSelected} title="Add child below selected person">
                <span className="text-[11px] font-bold">CH</span>
              </ToolbarButton>
              <ToolbarButton onClick={addAnnotation} title="Add note">
                <span className="text-sm font-bold">T</span>
              </ToolbarButton>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
              Draft from chart notes reads saved chart fields and recent sessions, then creates a reviewable starter map. Review every person, marker, and relationship before saving.
            </p>
            {mode === 'relationship' && (
              <p className="mt-3 text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                {relationshipStart ? 'Select the second person to connect.' : 'Select the first person to connect.'}
              </p>
            )}
          </div>

          <div className="card p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Legend</p>
            <div className="space-y-4 text-xs text-gray-600">
              <div>
                <p className="mb-2 font-bold text-gray-700">Symbols</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><span className="w-5 h-5 border-2 border-gray-800 inline-block" /> Male</div>
                  <div className="flex items-center gap-2"><span className="w-5 h-5 border-2 border-gray-800 rounded-full inline-block" /> Female</div>
                  <div className="flex items-center gap-2"><span className="w-5 h-5 border-2 border-gray-800 rotate-45 inline-block" /> Unknown / other</div>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 border-2 border-gray-800 inline-block bg-red-100" />
                    Color fill = primary clinical marker
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="relative w-5 h-5 border-2 border-gray-800 inline-block">
                      <span className="absolute -top-2 left-0 w-1.5 h-1.5 bg-blue-600" />
                      <span className="absolute -top-2 left-2 w-1.5 h-1.5 bg-red-600" />
                    </span>
                    Top chips = multiple markers
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 font-bold text-gray-700">Relationship lines</p>
                <div className="grid grid-cols-1 gap-2">
                  {QUALITY_OPTIONS.filter(([value]) => value !== 'unknown').map(([value, label]) => {
                    const stroke = relationshipStroke({ quality: value })
                    return (
                      <div key={value} className="flex items-center gap-2">
                        <svg width="42" height="10" viewBox="0 0 42 10" aria-hidden="true">
                          <line x1="2" y1="5" x2="40" y2="5" stroke={stroke.color} strokeWidth="3" strokeDasharray={stroke.dash} strokeLinecap="round" />
                        </svg>
                        <span>{label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="mb-2 font-bold text-gray-700">Clinical markers</p>
                <div className="grid grid-cols-1 gap-2">
                  {CLINICAL_MARKERS.map((marker) => (
                    <div key={marker.value} className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-sm border border-white shadow-sm" style={{ background: marker.color }} />
                      <span>{marker.label}</span>
                    </div>
                  ))}
                </div>
              </div>
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
            <rect width="1200" height="760" fill="#ffffff" />
            <rect width="1200" height="760" fill="url(#grid)" />

            {familyLayout.branches.map(({ partnerRel, parentA, parentB, children }) => {
              const stroke = relationshipStroke(partnerRel)
              const parentLineY = Math.max(bottomEdge(parentA), bottomEdge(parentB)) + 24
              const childLineY = children.length > 0
                ? Math.min(...children.map((child) => topEdge(child))) - 28
                : parentLineY
              const midX = (personX(parentA) + personX(parentB)) / 2
              const childXs = children.map((child) => personX(child))
              const childMinX = childXs.length ? Math.min(...childXs) : midX
              const childMaxX = childXs.length ? Math.max(...childXs) : midX
              return (
                <g key={partnerRel.id} onClick={(event) => { event.stopPropagation(); setSelectedId(partnerRel.id) }} className="cursor-pointer">
                  <path
                    d={`M ${personX(parentA)} ${bottomEdge(parentA)} V ${parentLineY} H ${personX(parentB)} V ${bottomEdge(parentB)}`}
                    fill="none"
                    stroke={stroke.color}
                    strokeWidth={selectedId === partnerRel.id ? 5 : 3}
                    strokeDasharray={stroke.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {children.length > 0 && (
                    <>
                      <path
                        d={`M ${midX} ${parentLineY} V ${childLineY} M ${childMinX} ${childLineY} H ${childMaxX}`}
                        fill="none"
                        stroke="#111827"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {children.map((child) => (
                        <path
                          key={`${partnerRel.id}-${child.id}`}
                          d={`M ${personX(child)} ${childLineY} V ${topEdge(child)}`}
                          fill="none"
                          stroke="#111827"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      ))}
                    </>
                  )}
                  {(partnerRel.label || partnerRel.quality !== 'plain') && (
                    <text x={midX} y={parentLineY - 8} textAnchor="middle" className="fill-gray-700 text-[12px] font-semibold">
                      {partnerRel.label || partnerRel.quality}
                    </text>
                  )}
                </g>
              )
            })}

            {familyLayout.looseParentChild.map((relationship) => {
              const from = peopleById.get(relationship.from)
              const to = peopleById.get(relationship.to)
              if (!from || !to) return null
              const midY = (bottomEdge(from) + topEdge(to)) / 2
              return (
                <g key={relationship.id} onClick={(event) => { event.stopPropagation(); setSelectedId(relationship.id) }} className="cursor-pointer">
                  <path
                    d={`M ${personX(from)} ${bottomEdge(from)} V ${midY} H ${personX(to)} V ${topEdge(to)}`}
                    fill="none"
                    stroke="#111827"
                    strokeWidth={selectedId === relationship.id ? 5 : 3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {relationship.label && (
                    <text x={(personX(from) + personX(to)) / 2} y={midY - 8} textAnchor="middle" className="fill-gray-700 text-[12px] font-semibold">
                      {relationship.label}
                    </text>
                  )}
                </g>
              )
            })}

            {familyLayout.sibling.map((relationship) => {
              const from = peopleById.get(relationship.from)
              const to = peopleById.get(relationship.to)
              if (!from || !to) return null
              const y = Math.min(topEdge(from), topEdge(to)) - 24
              return (
                <g key={relationship.id} onClick={(event) => { event.stopPropagation(); setSelectedId(relationship.id) }} className="cursor-pointer">
                  <path
                    d={`M ${personX(from)} ${topEdge(from)} V ${y} H ${personX(to)} V ${topEdge(to)}`}
                    fill="none"
                    stroke="#111827"
                    strokeWidth={selectedId === relationship.id ? 5 : 3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )
            })}

            {map.relationships.map((relationship) => {
              if (familyLayout.renderedIds.has(relationship.id) || familyLayout.parentChildIds.has(relationship.id)) return null
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

            {map.annotations.map((annotation) => {
              const width = annotationWidth(annotation)
              const height = annotationHeight(annotation)
              const lines = wrapAnnotationText(annotation.text, width)
              const selected = selectedId === annotation.id
              return (
                <g
                  key={annotation.id}
                  transform={`translate(${Number(annotation.x) || 0} ${Number(annotation.y) || 0})`}
                  onPointerDown={(event) => handleAnnotationPointerDown(annotation, event)}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(annotation.id) }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <rect
                    x={-width / 2}
                    y={-height / 2}
                    width={width}
                    height={height}
                    rx="7"
                    fill="#fef9c3"
                    stroke={selected ? '#6047ee' : '#eab308'}
                    strokeWidth={selected ? 3 : 2}
                  />
                  <text x={-width / 2 + 14} y={-height / 2 + 24} className="fill-gray-800 text-[13px] font-medium">
                    {lines.map((line, index) => (
                      <tspan key={`${annotation.id}-line-${index}`} x={-width / 2 + 14} dy={index === 0 ? 0 : 18}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {selected && <rect x={-width / 2 - 6} y={-height / 2 - 6} width={width + 12} height={height + 12} rx="9" fill="none" stroke="#6047ee" strokeDasharray="4 4" />}
                </g>
              )
            })}

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
                  <div className="space-y-3">
                    {Object.entries(TAG_GROUPS).map(([group, markers]) => (
                      <div key={group}>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{group}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {markers.map((marker) => {
                            const active = (selectedPerson.tags || []).includes(marker.value)
                            return (
                              <button
                                key={marker.value}
                                type="button"
                                onClick={() => tagToggle(marker.value)}
                                className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors ${
                                  active
                                    ? 'text-white border-transparent'
                                    : 'bg-white text-gray-600 border-gray-200'
                                }`}
                                style={active ? { background: marker.color } : {}}
                              >
                                {marker.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label text-xs">Notes</label>
                  <textarea className="textarea min-h-[90px] text-sm" value={selectedPerson.notes || ''} onChange={(e) => updatePerson(selectedPerson.id, { notes: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-secondary justify-center text-xs" onClick={addParentsForSelected}>
                    Add parents
                  </button>
                  <button type="button" className="btn-secondary justify-center text-xs" onClick={addChildForSelected}>
                    Add child
                  </button>
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
                {['partner', 'former_partner'].includes(selectedRelationship.type) && (
                  <button type="button" className="btn-secondary w-full justify-center text-xs" onClick={addChildToSelectedCouple}>
                    Add child to this couple
                  </button>
                )}
              </div>
            ) : selectedAnnotation ? (
              <div className="space-y-3">
                <div>
                  <label className="label text-xs">Clinical note text</label>
                  <textarea
                    className="textarea min-h-[120px] text-sm"
                    value={selectedAnnotation.text || ''}
                    onChange={(e) => updateAnnotation(selectedAnnotation.id, { text: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label text-xs">Note box width</label>
                  <input
                    className="input py-2 text-sm"
                    type="number"
                    min="220"
                    max="460"
                    step="20"
                    value={annotationWidth(selectedAnnotation)}
                    onChange={(e) => updateAnnotation(selectedAnnotation.id, { width: Number(e.target.value) || 320 })}
                  />
                </div>
                <p className="text-xs leading-relaxed text-gray-500">
                  Drag the yellow note box on the map to reposition it. Text wraps inside the box for exports.
                </p>
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
