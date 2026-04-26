'use strict';

const DEFAULT_ADULT_RETENTION_YEARS = 7;
const DEFAULT_MINOR_RETAIN_UNTIL_AGE = 25;

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addYears(date, years) {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + Number(years || 0));
  return next;
}

function ageAt(dateOfBirth, asOfDate) {
  const dob = parseDateOnly(dateOfBirth);
  const asOf = parseDateOnly(asOfDate) || new Date();
  if (!dob) return null;
  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = asOf.getUTCMonth() < dob.getUTCMonth()
    || (asOf.getUTCMonth() === dob.getUTCMonth() && asOf.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function calculateRetention({ therapyEndedAt, dateOfBirth, age }) {
  const ended = parseDateOnly(therapyEndedAt) || new Date();
  const adultRetention = addYears(ended, DEFAULT_ADULT_RETENTION_YEARS);
  const dob = parseDateOnly(dateOfBirth);

  if (dob) {
    const ageOnEndDate = ageAt(dateOfBirth, toDateOnly(ended));
    if (ageOnEndDate !== null && ageOnEndDate < 18) {
      return {
        retentionUntil: toDateOnly(addYears(dob, DEFAULT_MINOR_RETAIN_UNTIL_AGE)),
        retentionBasis: 'minor_until_age_25',
      };
    }
    return {
      retentionUntil: toDateOnly(adultRetention),
      retentionBasis: 'adult_7_years_after_termination',
    };
  }

  const numericAge = Number(age);
  if (Number.isFinite(numericAge) && numericAge < 18) {
    const yearsUntil18 = Math.max(0, 18 - numericAge);
    return {
      retentionUntil: toDateOnly(addYears(ended, yearsUntil18 + DEFAULT_ADULT_RETENTION_YEARS)),
      retentionBasis: 'minor_estimated_from_age_until_25',
    };
  }

  return {
    retentionUntil: toDateOnly(adultRetention),
    retentionBasis: 'adult_7_years_after_termination',
  };
}

function isRetentionExpired(patient, asOf = new Date()) {
  if (!patient || Number(patient.legal_hold || 0)) return false;
  const until = parseDateOnly(patient.retention_until);
  if (!until) return false;
  const today = parseDateOnly(toDateOnly(asOf));
  return until.getTime() <= today.getTime();
}

module.exports = {
  DEFAULT_ADULT_RETENTION_YEARS,
  DEFAULT_MINOR_RETAIN_UNTIL_AGE,
  calculateRetention,
  isRetentionExpired,
};
