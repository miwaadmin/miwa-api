/**
 * Client-side mirror of the bucket structure defined in
 * server/services/practiceHours.js. Keeping a copy here means the Hours
 * page renders the full layout even when the API hasn't responded yet
 * (or has errored out), and the manual-entry dropdown is never empty.
 *
 * If this drifts from the server definitions, the SERVER is authoritative
 * — totals + percent calculations come from /api/hours and overlay onto
 * this skeleton. The client structure only controls layout and the
 * dropdown options.
 */

export const CSUN_MFT_BUCKETS = [
  { id: 'total', label: 'Total Hours', minHours: 600, kind: 'rollup', parent: null },

  { id: 'direct_service',           label: 'Direct Service Hours',     minHours: 500, kind: 'rollup', parent: 'total' },
  { id: 'individual_adult',         label: 'Individual Adult Client',  parent: 'direct_service', source: 'appointment' },
  { id: 'individual_child',         label: 'Individual Child Client',  parent: 'direct_service', source: 'appointment' },
  { id: 'process_group_individuals', label: 'Process Group with Individuals', parent: 'direct_service', source: 'both' },

  { id: 'relational',               label: 'Relational Hours',         minHours: 100, kind: 'rollup', parent: 'total' },
  { id: 'couples_therapy',          label: 'Couples Therapy',          parent: 'relational', source: 'appointment' },
  { id: 'family_therapy',           label: 'Family Therapy',           parent: 'relational', source: 'appointment' },
  { id: 'process_group_couples_families', label: 'Process Group with Couples/Families', parent: 'relational', source: 'manual' },

  { id: 'advocacy_interactive',     label: 'Interactive Client-Centered Advocacy', maxHours: 100, kind: 'rollup', parent: 'total' },
  { id: 'advocacy_live_telephonic', label: 'Live or telephonic client-centered advocacy', parent: 'advocacy_interactive', source: 'manual' },

  { id: 'supervision',              label: 'Supervision',              minHours: 100, kind: 'rollup', parent: 'total' },
  { id: 'sup_case_report',          label: 'Case Report Supervision',  parent: 'supervision', source: 'manual' },
  { id: 'sup_field_individual',     label: 'At Field Site: Individual/Triadic Supervision (one-on-one)', parent: 'supervision', source: 'manual' },
  { id: 'sup_field_group',          label: 'At Field Site: Group (group of 8 or less)', parent: 'supervision', source: 'manual' },
  { id: 'sup_csun_class_group',     label: 'CSUN Fieldwork Class: Group', parent: 'supervision', source: 'manual' },

  { id: 'live_supervision',         label: 'Live Supervision',         minHours: 50,  kind: 'rollup', parent: 'total' },
  { id: 'live_sup_field_individual', label: 'At Field Site: Individual/Triadic Supervision (w/ video or observation)', parent: 'live_supervision', source: 'manual' },
  { id: 'live_sup_field_group',     label: 'At Field Site: Group (video or live session)', parent: 'live_supervision', source: 'manual' },
  { id: 'live_sup_csun_class_group', label: 'CSUN Fieldwork Class: Group', parent: 'live_supervision', source: 'manual' },

  { id: 'other',                    label: 'Other Hours',              kind: 'rollup', parent: 'total' },
  { id: 'other_progress_notes',     label: 'Progress Notes, Report Writing, Psychological Testing', parent: 'other', source: 'manual' },
  { id: 'other_trainings',          label: 'Clinical trainings, workshops, and conferences', parent: 'other', source: 'manual' },
  { id: 'other_advocacy_research',  label: 'Non-interactive Client-centered advocacy (researching resources)', parent: 'other', source: 'manual' },
]

export const CA_BBS_LMFT_BUCKETS = [
  { id: 'total', label: 'Total Hours', minHours: 3000, kind: 'rollup', parent: null },

  { id: 'direct_counseling', label: 'Direct Counseling (face-to-face)', minHours: 1750, kind: 'rollup', parent: 'total' },
  { id: 'lmft_individual',   label: 'Individual therapy (adult)',  parent: 'direct_counseling', source: 'appointment' },
  { id: 'lmft_child',        label: 'Therapy with a minor (under 18)', parent: 'direct_counseling', source: 'appointment' },
  { id: 'lmft_relational',   label: 'Couples / family therapy',    parent: 'direct_counseling', source: 'appointment', minHours: 500 },
  { id: 'lmft_group',        label: 'Group therapy',               parent: 'direct_counseling', source: 'appointment' },

  { id: 'lmft_supervision',          label: 'Supervision',                          minHours: 104, kind: 'rollup', parent: 'total' },
  { id: 'lmft_sup_individual',       label: 'Individual / Triadic supervision',    parent: 'lmft_supervision', source: 'manual', minHours: 52 },
  { id: 'lmft_sup_group',            label: 'Group supervision (≤8 supervisees)',  parent: 'lmft_supervision', source: 'manual' },

  { id: 'lmft_non_clinical',         label: 'Non-clinical experience',              maxHours: 1250, kind: 'rollup', parent: 'total' },
  { id: 'lmft_workshops',            label: 'Workshops, training, conferences',    parent: 'lmft_non_clinical', source: 'manual', maxHours: 250 },
  { id: 'lmft_advocacy',             label: 'Client-centered advocacy',            parent: 'lmft_non_clinical', source: 'manual', maxHours: 500 },
  { id: 'lmft_progress_notes',       label: 'Progress notes, reports, testing',    parent: 'lmft_non_clinical', source: 'manual' },
  { id: 'lmft_admin',                label: 'Other administrative & training',     parent: 'lmft_non_clinical', source: 'manual' },
]

export const PROGRAMS = {
  csun_mft:    { id: 'csun_mft',    label: 'CSUN MFT (Practicum)',        buckets: CSUN_MFT_BUCKETS },
  ca_bbs_lmft: { id: 'ca_bbs_lmft', label: 'CA BBS — LMFT (post-degree)', buckets: CA_BBS_LMFT_BUCKETS },
}

export function getProgramBuckets(programId = 'csun_mft') {
  return PROGRAMS[programId]?.buckets || CSUN_MFT_BUCKETS
}

// Manual-entry-eligible buckets only — leaves whose source is 'manual' or 'both'.
export function getManualBuckets(programId = 'csun_mft') {
  return getProgramBuckets(programId)
    .filter(b => b.source === 'manual' || b.source === 'both')
    .map(b => ({ id: b.id, label: b.label, parent: b.parent }))
}

// Every leaf bucket (used by the per-appointment override picker).
export function getLeafBuckets(programId = 'csun_mft') {
  return getProgramBuckets(programId)
    .filter(b => b.kind !== 'rollup')
    .map(b => ({ id: b.id, label: b.label, parent: b.parent, source: b.source || null }))
}

export function getProgramLabel(programId = 'csun_mft') {
  return PROGRAMS[programId]?.label || PROGRAMS.csun_mft.label
}

/**
 * Merge API totals (from /api/hours) onto the client bucket skeleton.
 * Each bucket node ends up with hours / fromAppointments / fromManual /
 * percentOfMin filled in; missing buckets in the API response render as
 * zeroes instead of disappearing entirely.
 */
export function mergeBucketTotals(programId, apiBuckets = []) {
  const skeleton = getProgramBuckets(programId)
  const byId = {}
  for (const b of apiBuckets) byId[b.id] = b
  return skeleton.map(b => {
    const apiNode = byId[b.id] || {}
    const hours            = Number(apiNode.hours ?? 0) || 0
    const fromAppointments = Number(apiNode.fromAppointments ?? 0) || 0
    const fromManual       = Number(apiNode.fromManual ?? 0) || 0
    const percentOfMin = b.minHours && b.minHours > 0
      ? Math.min(100, Math.round((hours / b.minHours) * 100))
      : null
    return {
      id: b.id,
      label: b.label,
      parent: b.parent || null,
      kind: b.kind || 'leaf',
      minHours: b.minHours || null,
      maxHours: b.maxHours || null,
      source: b.source || null,
      hours,
      fromAppointments,
      fromManual,
      percentOfMin,
    }
  })
}
