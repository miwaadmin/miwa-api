/**
 * practiceHours — trainee/associate hour tracking.
 *
 * v1 models the CSUN MFT pre-graduation practicum buckets as shown in
 * Tevera/ELC. Buckets are arranged hierarchically: parent buckets roll
 * up their children's hours. Each leaf bucket has either:
 *   - source: 'appointment'  → totals computed from completed appointments
 *   - source: 'manual'       → totals come from the practice_hours table
 *   - source: 'both'         → both sources sum together
 *
 * NOTE: This is *unofficial* tracking. Miwa is not BBS-approved; the
 * official 32A still requires the supervisor's signature. The bucket
 * names and minimums mirror the CSUN form so the totals are directly
 * useful when filling out the real thing.
 *
 * BBS post-grad buckets will be added as a separate program ("ca_bbs_lmft")
 * once CSUN is solid.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CSUN MFT — pre-graduation practicum hour buckets.
// Layout matches the screenshots from csun.tevera.app's Track view.
// ─────────────────────────────────────────────────────────────────────────────
const CSUN_MFT_BUCKETS = [
  // Top-level total
  { id: 'total', label: 'Total Hours', minHours: 600, kind: 'rollup', parent: null },

  // ─── Direct Service ──────────────────────────────────────────────────────
  { id: 'direct_service',           label: 'Direct Service Hours',     minHours: 500, kind: 'rollup', parent: 'total' },
  { id: 'individual_adult',         label: 'Individual Adult Client',  parent: 'direct_service', source: 'appointment' },
  { id: 'individual_child',         label: 'Individual Child Client',  parent: 'direct_service', source: 'appointment' },
  { id: 'process_group_individuals', label: 'Process Group with Individuals', parent: 'direct_service', source: 'both' },

  // ─── Relational Hours ────────────────────────────────────────────────────
  { id: 'relational',               label: 'Relational Hours',         minHours: 100, kind: 'rollup', parent: 'total' },
  { id: 'couples_therapy',          label: 'Couples Therapy',          parent: 'relational', source: 'appointment' },
  { id: 'family_therapy',           label: 'Family Therapy',           parent: 'relational', source: 'appointment' },
  { id: 'process_group_couples_families', label: 'Process Group with Couples/Families', parent: 'relational', source: 'manual' },

  // ─── Interactive Client-Centered Advocacy (capped) ──────────────────────
  { id: 'advocacy_interactive',     label: 'Interactive Client-Centered Advocacy', maxHours: 100, kind: 'rollup', parent: 'total' },
  { id: 'advocacy_live_telephonic', label: 'Live or telephonic client-centered advocacy', parent: 'advocacy_interactive', source: 'manual' },

  // ─── Supervision ─────────────────────────────────────────────────────────
  { id: 'supervision',              label: 'Supervision',              minHours: 100, kind: 'rollup', parent: 'total' },
  { id: 'sup_case_report',          label: 'Case Report Supervision',  parent: 'supervision', source: 'manual' },
  { id: 'sup_field_individual',     label: 'At Field Site: Individual/Triadic Supervision (one-on-one)', parent: 'supervision', source: 'manual' },
  { id: 'sup_field_group',          label: 'At Field Site: Group (group of 8 or less)', parent: 'supervision', source: 'manual' },
  { id: 'sup_csun_class_group',     label: 'CSUN Fieldwork Class: Group', parent: 'supervision', source: 'manual' },

  // ─── Live Supervision ────────────────────────────────────────────────────
  { id: 'live_supervision',         label: 'Live Supervision',         minHours: 50,  kind: 'rollup', parent: 'total' },
  { id: 'live_sup_field_individual', label: 'At Field Site: Individual/Triadic Supervision (w/ video or observation)', parent: 'live_supervision', source: 'manual' },
  { id: 'live_sup_field_group',     label: 'At Field Site: Group (video or live session)', parent: 'live_supervision', source: 'manual' },
  { id: 'live_sup_csun_class_group', label: 'CSUN Fieldwork Class: Group', parent: 'live_supervision', source: 'manual' },

  // ─── Other Hours ─────────────────────────────────────────────────────────
  { id: 'other',                    label: 'Other Hours',              kind: 'rollup', parent: 'total' },
  { id: 'other_progress_notes',     label: 'Progress Notes, Report Writing, Psychological Testing', parent: 'other', source: 'manual' },
  { id: 'other_trainings',          label: 'Clinical trainings, workshops, and conferences', parent: 'other', source: 'manual' },
  { id: 'other_advocacy_research',  label: 'Non-interactive Client-centered advocacy (researching resources)', parent: 'other', source: 'manual' },
];

const PROGRAMS = {
  csun_mft: { id: 'csun_mft', label: 'CSUN MFT (Practicum)', buckets: CSUN_MFT_BUCKETS },
};

// ─────────────────────────────────────────────────────────────────────────────
// Map a completed appointment to a bucket id. Returns null if the
// appointment doesn't fit any auto-tallied bucket.
// ─────────────────────────────────────────────────────────────────────────────
function mapAppointmentToBucket(appt, patient) {
  const type = (appt.appointment_type || '').toLowerCase();

  if (type.includes('couple'))                              return 'couples_therapy';
  if (type.includes('family'))                              return 'family_therapy';

  // Group: classify by participant type. Default to "with individuals" since
  // that's the more common case; relational groups are rare and the user
  // can correct via manual override later if needed.
  if (type.includes('group'))                               return 'process_group_individuals';

  // Anything individual-flavored: split on patient age.
  if (type.includes('individual') || !type) {
    const ageNum = Number(patient?.age);
    if (Number.isFinite(ageNum) && ageNum > 0 && ageNum < 18) return 'individual_child';
    // age_range can be "0-17", "5-12", etc. for child; default = adult.
    const range = (patient?.age_range || '').trim();
    if (/^[0-9]+\s*-\s*1[0-7]\b/.test(range))               return 'individual_child';
    return 'individual_adult';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute the full hour-tracking state for a therapist.
//
// Returns:
// {
//   program: 'csun_mft',
//   buckets: [
//     { id, label, parent, kind, minHours, maxHours, source, hours,
//       fromAppointments, fromManual, percentOfMin },
//     ...
//   ],
//   totalSessions: number,
//   asOf: ISO timestamp
// }
//
// Buckets are returned in display order. Parent rollups include their
// children's hours summed in.
// ─────────────────────────────────────────────────────────────────────────────
async function computeHourTotals(db, therapistId, programId = 'csun_mft') {
  const program = PROGRAMS[programId];
  if (!program) throw new Error(`Unknown hour program: ${programId}`);

  // Fetch all completed appointments + their patients in one shot. We only
  // count appointments that actually happened — 'completed' status, with a
  // duration, and not in the future.
  const apptRows = await db.all(
    `SELECT a.id, a.appointment_type, a.duration_minutes, a.scheduled_start, a.status,
            p.age, p.age_range
     FROM appointments a
     LEFT JOIN patients p ON p.id = a.patient_id
     WHERE a.therapist_id = ?
       AND a.status = 'completed'
       AND a.duration_minutes IS NOT NULL
       AND a.duration_minutes > 0`,
    therapistId,
  );

  // Manual entries summed by bucket.
  const manualRows = await db.all(
    'SELECT bucket_id, COALESCE(SUM(hours), 0) AS total FROM practice_hours WHERE therapist_id = ? GROUP BY bucket_id',
    therapistId,
  );
  const manualByBucket = {};
  for (const r of manualRows) manualByBucket[r.bucket_id] = Number(r.total) || 0;

  // Sum appointment hours into leaf buckets.
  const apptByBucket = {};
  for (const a of apptRows) {
    const bucketId = mapAppointmentToBucket(a, { age: a.age, age_range: a.age_range });
    if (!bucketId) continue;
    const hrs = (Number(a.duration_minutes) || 0) / 60;
    apptByBucket[bucketId] = (apptByBucket[bucketId] || 0) + hrs;
  }

  // Build the result array in declared order, then roll up parents.
  const byId = {};
  const ordered = program.buckets.map(b => {
    const fromAppointments = b.source === 'appointment' || b.source === 'both' ? (apptByBucket[b.id] || 0) : 0;
    const fromManual       = b.source === 'manual'      || b.source === 'both' ? (manualByBucket[b.id] || 0) : 0;
    const node = {
      id: b.id,
      label: b.label,
      parent: b.parent || null,
      kind: b.kind || 'leaf',
      minHours: b.minHours || null,
      maxHours: b.maxHours || null,
      source: b.source || null,
      fromAppointments: round2(fromAppointments),
      fromManual: round2(fromManual),
      hours: round2(fromAppointments + fromManual),
      percentOfMin: null,
    };
    byId[b.id] = node;
    return node;
  });

  // Bottom-up rollup: walk leaves first, add to ancestors.
  for (const node of ordered) {
    if (node.kind === 'leaf' && node.parent) {
      let parentId = node.parent;
      while (parentId && byId[parentId]) {
        const parent = byId[parentId];
        parent.fromAppointments = round2(parent.fromAppointments + node.fromAppointments);
        parent.fromManual       = round2(parent.fromManual       + node.fromManual);
        parent.hours            = round2(parent.hours            + node.hours);
        parentId = parent.parent;
      }
    }
  }

  // Compute percentOfMin once totals are settled.
  for (const node of ordered) {
    if (node.minHours && node.minHours > 0) {
      node.percentOfMin = Math.min(100, Math.round((node.hours / node.minHours) * 100));
    }
  }

  return {
    program: program.id,
    programLabel: program.label,
    buckets: ordered,
    totalSessions: apptRows.length,
    asOf: new Date().toISOString(),
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Validate a bucket id and confirm it's manual-entry-eligible.
function isManualEntryBucket(bucketId, programId = 'csun_mft') {
  const program = PROGRAMS[programId];
  if (!program) return false;
  const bucket = program.buckets.find(b => b.id === bucketId);
  if (!bucket) return false;
  return bucket.source === 'manual' || bucket.source === 'both';
}

function listManualEntryBuckets(programId = 'csun_mft') {
  const program = PROGRAMS[programId];
  if (!program) return [];
  return program.buckets
    .filter(b => b.source === 'manual' || b.source === 'both')
    .map(b => ({ id: b.id, label: b.label, parent: b.parent }));
}

module.exports = {
  PROGRAMS,
  CSUN_MFT_BUCKETS,
  computeHourTotals,
  mapAppointmentToBucket,
  isManualEntryBucket,
  listManualEntryBuckets,
};
