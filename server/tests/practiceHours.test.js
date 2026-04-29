/**
 * practiceHours service — unit tests
 *
 * Locks in:
 * - mapAppointmentToBucket: every appointment_type → bucket combo for both
 *   programs, including the adult-vs-minor age split.
 * - computeHourTotals: rollup math, source pills (auto vs manual), percent
 *   calculations against minHours, manual override on individual rows.
 * - computeHourGrid: per-day cell aggregation, range validation, manual +
 *   appointment hours summing into the same cell.
 * - listLeafBuckets / listManualEntryBuckets: program filtering.
 *
 * Run with:  node --test server/tests/practiceHours.test.js
 *
 * Uses an in-memory fake DB (record-array-backed) so tests don't touch
 * SQLite or Postgres. The fake matches the shape practiceHours.js calls
 * (db.all, db.get with positional params).
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const {
  PROGRAMS,
  computeHourTotals,
  computeHourGrid,
  mapAppointmentToBucket,
  listLeafBuckets,
  listManualEntryBuckets,
  isManualEntryBucket,
} = require(path.join(__dirname, '..', 'services', 'practiceHours'));

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB — minimal SQL-shaped table store. Only supports the queries the
// service actually issues; if you add a new query in practiceHours.js you'll
// need to teach it here too.
// ─────────────────────────────────────────────────────────────────────────────
function makeFakeDb({ appointments = [], practice_hours = [], patients = [] } = {}) {
  return {
    appointments,
    practice_hours,
    patients,
    async all(sql, ...params) {
      const Q = sql.replace(/\s+/g, ' ').trim();
      // Appointments LEFT JOIN patients — used by computeHourTotals.
      if (/FROM appointments a\b.*LEFT JOIN patients p ON p.id = a.patient_id/i.test(Q)
          && !/BETWEEN/i.test(Q)) {
        const therapistId = params[0];
        return appointments
          .filter(a => a.therapist_id === therapistId
                    && a.status === 'completed'
                    && a.duration_minutes != null
                    && Number(a.duration_minutes) > 0)
          .map(a => {
            const p = patients.find(pp => pp.id === a.patient_id) || {};
            return {
              id: a.id,
              appointment_type: a.appointment_type,
              duration_minutes: a.duration_minutes,
              scheduled_start: a.scheduled_start,
              status: a.status,
              practicum_bucket_override: a.practicum_bucket_override || null,
              age: p.age,
              age_range: p.age_range,
            };
          });
      }
      // Same shape but with BETWEEN range — used by computeHourGrid.
      if (/FROM appointments a\b.*LEFT JOIN patients p ON p.id = a.patient_id/i.test(Q)
          && /BETWEEN/i.test(Q)) {
        const [therapistId, fromIso, toIso] = params;
        return appointments
          .filter(a => a.therapist_id === therapistId
                    && a.status === 'completed'
                    && a.duration_minutes != null
                    && Number(a.duration_minutes) > 0
                    && a.scheduled_start
                    && a.scheduled_start >= fromIso
                    && a.scheduled_start <= toIso)
          .map(a => {
            const p = patients.find(pp => pp.id === a.patient_id) || {};
            return {
              id: a.id,
              appointment_type: a.appointment_type,
              duration_minutes: a.duration_minutes,
              scheduled_start: a.scheduled_start,
              practicum_bucket_override: a.practicum_bucket_override || null,
              age: p.age,
              age_range: p.age_range,
            };
          });
      }
      // Manual entries grouped — used by computeHourTotals.
      if (/FROM practice_hours WHERE therapist_id = \? GROUP BY bucket_id/i.test(Q)) {
        const therapistId = params[0];
        const sums = {};
        for (const r of practice_hours) {
          if (r.therapist_id !== therapistId) continue;
          sums[r.bucket_id] = (sums[r.bucket_id] || 0) + Number(r.hours);
        }
        return Object.entries(sums).map(([bucket_id, total]) => ({ bucket_id, total }));
      }
      // Manual entries in date range — used by computeHourGrid.
      if (/FROM practice_hours WHERE therapist_id = \? AND date BETWEEN/i.test(Q)) {
        const [therapistId, fromDate, toDate] = params;
        return practice_hours
          .filter(r => r.therapist_id === therapistId && r.date >= fromDate && r.date <= toDate)
          .map(r => ({ bucket_id: r.bucket_id, date: r.date, hours: Number(r.hours) }));
      }
      throw new Error(`Unhandled fake-db query: ${Q.slice(0, 120)}…`);
    },
    async get() {
      throw new Error('fake-db .get not used by practiceHours service');
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function findBucket(state, id) {
  return state.buckets.find(b => b.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// mapAppointmentToBucket
// ─────────────────────────────────────────────────────────────────────────────
describe('mapAppointmentToBucket — CSUN MFT', () => {
  test('individual appointment with adult patient → individual_adult', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual session' }, { age: 32 });
    assert.equal(id, 'individual_adult');
  });
  test('individual appointment with minor (age) → individual_child', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual' }, { age: 14 });
    assert.equal(id, 'individual_child');
  });
  test('individual appointment with minor (age_range) → individual_child', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual' }, { age_range: '5-12' });
    assert.equal(id, 'individual_child');
  });
  test('individual appointment with unknown age → individual_adult (default)', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual' }, {});
    assert.equal(id, 'individual_adult');
  });
  test('couple session → couples_therapy', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'couple session' }, {});
    assert.equal(id, 'couples_therapy');
  });
  test('family session → family_therapy', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'family session' }, {});
    assert.equal(id, 'family_therapy');
  });
  test('group session → process_group_individuals', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'group' }, {});
    assert.equal(id, 'process_group_individuals');
  });
  test('empty appointment_type defaults to individual', () => {
    const id = mapAppointmentToBucket({ appointment_type: '' }, { age: 25 });
    assert.equal(id, 'individual_adult');
  });
  test('age_range "0-17" classifies as minor', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual' }, { age_range: '0-17' });
    assert.equal(id, 'individual_child');
  });
});

describe('mapAppointmentToBucket — CA BBS LMFT', () => {
  test('individual + adult → lmft_individual', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual' }, { age: 30 }, 'ca_bbs_lmft');
    assert.equal(id, 'lmft_individual');
  });
  test('individual + minor → lmft_child', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'individual' }, { age: 12 }, 'ca_bbs_lmft');
    assert.equal(id, 'lmft_child');
  });
  test('couple → lmft_relational', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'couple' }, {}, 'ca_bbs_lmft');
    assert.equal(id, 'lmft_relational');
  });
  test('family → lmft_relational (BBS combines couples + families)', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'family' }, {}, 'ca_bbs_lmft');
    assert.equal(id, 'lmft_relational');
  });
  test('group → lmft_group', () => {
    const id = mapAppointmentToBucket({ appointment_type: 'group' }, {}, 'ca_bbs_lmft');
    assert.equal(id, 'lmft_group');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeHourTotals
// ─────────────────────────────────────────────────────────────────────────────
describe('computeHourTotals — rollups and source attribution', () => {
  test('empty data returns zeroed buckets in declared order', async () => {
    const db = makeFakeDb();
    const state = await computeHourTotals(db, 1);
    assert.equal(state.program, 'csun_mft');
    assert.ok(state.buckets.length > 0);
    assert.equal(state.totalSessions, 0);
    for (const b of state.buckets) {
      assert.equal(b.hours, 0);
      assert.equal(b.fromAppointments, 0);
      assert.equal(b.fromManual, 0);
    }
  });

  test('one 50-min individual adult appointment → 0.83 hrs in individual_adult, rolled up', async () => {
    const db = makeFakeDb({
      appointments: [
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 50, scheduled_start: '2026-04-01T17:00:00.000Z', status: 'completed' },
      ],
      patients: [{ id: 10, age: 28 }],
    });
    const state = await computeHourTotals(db, 1);
    const adult = findBucket(state, 'individual_adult');
    const direct = findBucket(state, 'direct_service');
    const total = findBucket(state, 'total');
    assert.equal(adult.fromAppointments, 0.83);
    assert.equal(adult.fromManual, 0);
    assert.equal(adult.hours, 0.83);
    // Rollup math
    assert.equal(direct.hours, 0.83);
    assert.equal(total.hours, 0.83);
    // Percent (0.83 / 600 → ~0%)
    assert.equal(total.percentOfMin, 0);
    assert.equal(state.totalSessions, 1);
  });

  test('cancelled / scheduled appointments are excluded', async () => {
    const db = makeFakeDb({
      appointments: [
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 50, status: 'completed', scheduled_start: '2026-04-01T17:00:00.000Z' },
        { id: 2, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 50, status: 'cancelled', scheduled_start: '2026-04-02T17:00:00.000Z' },
        { id: 3, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 50, status: 'scheduled', scheduled_start: '2026-04-03T17:00:00.000Z' },
      ],
      patients: [{ id: 10, age: 28 }],
    });
    const state = await computeHourTotals(db, 1);
    assert.equal(state.totalSessions, 1);
    assert.equal(findBucket(state, 'individual_adult').hours, 0.83);
  });

  test('practicum_bucket_override redirects an appointment to a different bucket', async () => {
    // Patient has no age set — would default to adult, but override sends to child.
    const db = makeFakeDb({
      appointments: [
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 60, status: 'completed', scheduled_start: '2026-04-01T17:00:00.000Z',
          practicum_bucket_override: 'individual_child' },
      ],
      patients: [{ id: 10 }],
    });
    const state = await computeHourTotals(db, 1);
    assert.equal(findBucket(state, 'individual_adult').hours, 0);
    assert.equal(findBucket(state, 'individual_child').hours, 1);
  });

  test('override pointing at a bucket from another program is ignored', async () => {
    const db = makeFakeDb({
      appointments: [
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 60, status: 'completed', scheduled_start: '2026-04-01T17:00:00.000Z',
          practicum_bucket_override: 'lmft_individual' },  // BBS bucket; not valid in CSUN
      ],
      patients: [{ id: 10, age: 30 }],
    });
    const state = await computeHourTotals(db, 1);
    // Falls back to auto-mapping → individual_adult.
    assert.equal(findBucket(state, 'individual_adult').hours, 1);
    assert.equal(findBucket(state, 'individual_child').hours, 0);
  });

  test('manual entries sum into the right bucket and roll up', async () => {
    const db = makeFakeDb({
      practice_hours: [
        { therapist_id: 1, bucket_id: 'sup_field_individual', date: '2026-04-01', hours: 1 },
        { therapist_id: 1, bucket_id: 'sup_field_individual', date: '2026-04-08', hours: 1 },
        { therapist_id: 1, bucket_id: 'sup_csun_class_group', date: '2026-04-08', hours: 2 },
      ],
    });
    const state = await computeHourTotals(db, 1);
    assert.equal(findBucket(state, 'sup_field_individual').fromManual, 2);
    assert.equal(findBucket(state, 'sup_csun_class_group').fromManual, 2);
    assert.equal(findBucket(state, 'supervision').hours, 4);
    assert.equal(findBucket(state, 'total').hours, 4);
  });

  test('source pills: auto + manual coexist on the same bucket via "both"', async () => {
    // process_group_individuals is source: 'both' → can come from either path.
    const db = makeFakeDb({
      appointments: [
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'group', duration_minutes: 60, status: 'completed', scheduled_start: '2026-04-01T17:00:00.000Z' },
      ],
      patients: [{ id: 10, age: 30 }],
      practice_hours: [
        { therapist_id: 1, bucket_id: 'process_group_individuals', date: '2026-04-02', hours: 1.5 },
      ],
    });
    const state = await computeHourTotals(db, 1);
    const b = findBucket(state, 'process_group_individuals');
    assert.equal(b.fromAppointments, 1);
    assert.equal(b.fromManual, 1.5);
    assert.equal(b.hours, 2.5);
  });

  test('percentOfMin caps at 100 and rounds correctly', async () => {
    const db = makeFakeDb({
      practice_hours: Array.from({ length: 700 }, (_, i) => ({
        therapist_id: 1, bucket_id: 'sup_field_individual', date: '2026-04-01', hours: 1,
      })),
    });
    const state = await computeHourTotals(db, 1);
    assert.equal(findBucket(state, 'supervision').percentOfMin, 100);
    assert.equal(findBucket(state, 'total').percentOfMin, 100);
  });

  test('CA BBS LMFT program rolls up against 3000-hour minimum', async () => {
    const db = makeFakeDb({
      appointments: [
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 60, status: 'completed', scheduled_start: '2026-04-01T17:00:00.000Z' },
      ],
      patients: [{ id: 10, age: 30 }],
    });
    const state = await computeHourTotals(db, 1, 'ca_bbs_lmft');
    assert.equal(state.program, 'ca_bbs_lmft');
    assert.equal(findBucket(state, 'lmft_individual').hours, 1);
    const total = findBucket(state, 'total');
    assert.equal(total.minHours, 3000);
    assert.equal(total.hours, 1);
  });

  test('unknown program throws', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => computeHourTotals(db, 1, 'martian_lmft'), /Unknown hour program/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeHourGrid
// ─────────────────────────────────────────────────────────────────────────────
describe('computeHourGrid', () => {
  test('rejects malformed dates', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => computeHourGrid(db, 1, '2026/04/01', '2026-04-07'),
      /must be YYYY-MM-DD/);
  });

  test('rejects ranges over 90 days', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => computeHourGrid(db, 1, '2026-01-01', '2026-04-15'),
      /Range too large/);
  });

  test('builds the inclusive day list for a week', async () => {
    const db = makeFakeDb();
    const out = await computeHourGrid(db, 1, '2026-04-26', '2026-05-02');
    assert.deepEqual(out.days, [
      '2026-04-26', '2026-04-27', '2026-04-28', '2026-04-29',
      '2026-04-30', '2026-05-01', '2026-05-02',
    ]);
  });

  test('places appointments + manual entries into per-day cells', async () => {
    const db = makeFakeDb({
      appointments: [
        // 1.0 hr individual adult on 2026-04-28 (Tue) — UTC time chosen so it's
        // the same calendar day in America/Los_Angeles.
        { id: 1, therapist_id: 1, patient_id: 10, appointment_type: 'individual', duration_minutes: 60, status: 'completed', scheduled_start: '2026-04-28T18:00:00.000Z' },
      ],
      patients: [{ id: 10, age: 30 }],
      practice_hours: [
        { therapist_id: 1, bucket_id: 'sup_field_individual', date: '2026-04-29', hours: 1.0 },
      ],
    });
    const out = await computeHourGrid(db, 1, '2026-04-26', '2026-05-02');
    assert.equal(out.grid.individual_adult?.['2026-04-28'], 1);
    assert.equal(out.grid.sup_field_individual?.['2026-04-29'], 1);
    // Bucket metadata still flows through.
    const adult = out.buckets.find(b => b.id === 'individual_adult');
    assert.ok(adult, 'bucket metadata must be on the grid response');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listLeafBuckets / listManualEntryBuckets / isManualEntryBucket
// ─────────────────────────────────────────────────────────────────────────────
describe('bucket listing helpers', () => {
  test('listLeafBuckets returns no rollups', () => {
    const buckets = listLeafBuckets('csun_mft');
    assert.ok(buckets.length > 0);
    for (const b of buckets) {
      // Rollups have id 'total', 'direct_service', 'relational', etc. None
      // of those should appear in the leaf list.
      assert.notEqual(b.id, 'total');
      assert.notEqual(b.id, 'direct_service');
      assert.notEqual(b.id, 'supervision');
    }
  });

  test('listManualEntryBuckets only includes source: manual or both', () => {
    const buckets = listManualEntryBuckets('csun_mft');
    // individual_adult is appointment-only, should be absent.
    assert.equal(buckets.find(b => b.id === 'individual_adult'), undefined);
    // sup_field_individual is manual, must be present.
    assert.ok(buckets.find(b => b.id === 'sup_field_individual'));
    // process_group_individuals is "both", must be present.
    assert.ok(buckets.find(b => b.id === 'process_group_individuals'));
  });

  test('isManualEntryBucket gate', () => {
    assert.equal(isManualEntryBucket('individual_adult'), false);
    assert.equal(isManualEntryBucket('sup_field_individual'), true);
    assert.equal(isManualEntryBucket('process_group_individuals'), true);
    assert.equal(isManualEntryBucket('does_not_exist'), false);
  });

  test('PROGRAMS exposes both csun_mft and ca_bbs_lmft', () => {
    assert.ok(PROGRAMS.csun_mft);
    assert.ok(PROGRAMS.ca_bbs_lmft);
    assert.equal(PROGRAMS.csun_mft.label, 'CSUN MFT (Practicum)');
  });
});
