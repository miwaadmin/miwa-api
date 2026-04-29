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
            a.practicum_bucket_override,
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

  // Sum appointment hours into leaf buckets. The therapist can override the
  // automatic categorization on a per-appointment basis (e.g. fix when an
  // "Individual" was actually with a minor) — we honor that override here.
  const apptByBucket = {};
  for (const a of apptRows) {
    const bucketId = a.practicum_bucket_override || mapAppointmentToBucket(a, { age: a.age, age_range: a.age_range });
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

// Every leaf bucket — used by the per-appointment override picker so the
// therapist can recategorize a session into any practicum bucket (auto OR
// manual; e.g. an "Individual" session that was actually a supervision
// observation hour).
function listLeafBuckets(programId = 'csun_mft') {
  const program = PROGRAMS[programId];
  if (!program) return [];
  return program.buckets
    .filter(b => b.kind !== 'rollup')
    .map(b => ({ id: b.id, label: b.label, parent: b.parent, source: b.source || null }));
}

/**
 * Build a per-bucket per-day grid of hours for the given local-date range
 * (inclusive). Returns the data the Track grid view needs to render the
 * Tevera-style spreadsheet (categories × days).
 *
 * Returned shape:
 * {
 *   program, programLabel,
 *   buckets: [...],  // same bucket nodes computeHourTotals returns
 *   days: ['YYYY-MM-DD', ...],
 *   grid: { [bucketId]: { [date]: hours } }  // only buckets with non-zero days
 * }
 *
 * Direct-service buckets pull from completed appointments scheduled in the
 * range; manual buckets pull from practice_hours.date. Boundary semantics:
 * the date is the local calendar date the appointment started on (in the
 * therapist's preferred timezone), matching how the existing Schedule
 * computes day grouping.
 */
async function computeHourGrid(db, therapistId, fromDate, toDate, programId = 'csun_mft', tz = 'America/Los_Angeles') {
  const program = PROGRAMS[programId];
  if (!program) throw new Error(`Unknown hour program: ${programId}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('fromDate and toDate must be YYYY-MM-DD');
  }

  // Build the inclusive list of days.
  const days = [];
  {
    const [fy, fm, fd] = fromDate.split('-').map(Number);
    const [ty, tm, td] = toDate.split('-').map(Number);
    const cur = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    while (cur <= end) {
      days.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`);
      cur.setDate(cur.getDate() + 1);
    }
  }
  if (days.length > 90) throw new Error('Range too large (max 90 days)');

  // Pull completed appointments overlapping this date range. We compare
  // scheduled_start as a string — ISO 8601 sorts chronologically — and pad
  // the from/to with day boundaries so timezone offsets don't drop edge
  // appointments.
  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso   = `${toDate}T23:59:59.999Z`;
  const apptRows = await db.all(
    `SELECT a.id, a.appointment_type, a.duration_minutes, a.scheduled_start,
            a.practicum_bucket_override,
            p.age, p.age_range
     FROM appointments a
     LEFT JOIN patients p ON p.id = a.patient_id
     WHERE a.therapist_id = ?
       AND a.status = 'completed'
       AND a.duration_minutes IS NOT NULL
       AND a.duration_minutes > 0
       AND a.scheduled_start IS NOT NULL
       AND a.scheduled_start BETWEEN ? AND ?`,
    therapistId, fromIso, toIso,
  );

  const manualRows = await db.all(
    'SELECT bucket_id, date, hours FROM practice_hours WHERE therapist_id = ? AND date BETWEEN ? AND ?',
    therapistId, fromDate, toDate,
  );

  // Local-date keying. Use Intl with the therapist's tz to compute the
  // calendar date — this matches what Schedule.jsx does and avoids the
  // "appointment shows on the wrong day for users east of UTC" class of
  // bugs.
  const localDate = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA', { timeZone: tz });
  };

  const grid = {};
  const addToCell = (bucketId, date, hours) => {
    if (!bucketId || !date) return;
    if (!grid[bucketId]) grid[bucketId] = {};
    grid[bucketId][date] = round2((grid[bucketId][date] || 0) + hours);
  };

  for (const a of apptRows) {
    const bucketId = a.practicum_bucket_override || mapAppointmentToBucket(a, { age: a.age, age_range: a.age_range });
    if (!bucketId) continue;
    const date = localDate(a.scheduled_start);
    if (!date) continue;
    addToCell(bucketId, date, (Number(a.duration_minutes) || 0) / 60);
  }
  for (const r of manualRows) {
    addToCell(r.bucket_id, r.date, Number(r.hours) || 0);
  }

  // Reuse computeHourTotals to get the bucket metadata + program totals.
  // It does its own DB queries; the duplication is fine for now and keeps
  // grid-only callers from re-implementing the rollup logic.
  const totals = await computeHourTotals(db, therapistId, programId);

  return {
    program: program.id,
    programLabel: program.label,
    buckets: totals.buckets,
    days,
    grid,
  };
}

module.exports = {
  PROGRAMS,
  CSUN_MFT_BUCKETS,
  computeHourTotals,
  computeHourGrid,
  mapAppointmentToBucket,
  isManualEntryBucket,
  listManualEntryBuckets,
  listLeafBuckets,
};
