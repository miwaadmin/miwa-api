/**
 * Format a date/datetime string to the user's timezone
 * @param {string|Date} dateStr - ISO datetime string or Date object
 * @param {string} timezone - IANA timezone (e.g., 'America/Los_Angeles')
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string in user's timezone
 */
export function formatDateInTimezone(dateStr, timezone = 'America/Los_Angeles', options = {}) {
  if (!dateStr) return '—'
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
    if (isNaN(date.getTime())) return '—'

    return date.toLocaleDateString('en-US', {
      timeZone: timezone,
      ...options,
    })
  } catch {
    return '—'
  }
}

/**
 * Format datetime with time
 * @param {string|Date} dateStr - ISO datetime string or Date object
 * @param {string} timezone - IANA timezone
 * @returns {string} Formatted datetime (e.g., "Apr 12, 2026, 3:45 PM PDT")
 */
export function formatDateTimeInTimezone(dateStr, timezone = 'America/Los_Angeles') {
  return formatDateInTimezone(dateStr, timezone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

/**
 * Format date only (e.g., "Apr 12, 2026")
 * @param {string|Date} dateStr - ISO datetime string or Date object
 * @param {string} timezone - IANA timezone
 * @returns {string} Formatted date
 */
export function formatDateOnlyInTimezone(dateStr, timezone = 'America/Los_Angeles') {
  return formatDateInTimezone(dateStr, timezone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format time only (e.g., "3:45 PM")
 * @param {string|Date} dateStr - ISO datetime string or Date object
 * @param {string} timezone - IANA timezone
 * @returns {string} Formatted time
 */
export function formatTimeOnlyInTimezone(dateStr, timezone = 'America/Los_Angeles') {
  return formatDateInTimezone(dateStr, timezone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Get current date in user's timezone as YYYY-MM-DD
 * @param {string} timezone - IANA timezone
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayInTimezone(timezone = 'America/Los_Angeles') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

/**
 * Common timezones for selector
 */
export const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (EST/EDT)' },
  { value: 'America/Chicago', label: 'Central (CST/CDT)' },
  { value: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKST/AKDT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'America/Toronto', label: 'Eastern Canada (EST/EDT)' },
  { value: 'America/Vancouver', label: 'Pacific Canada (PST/PDT)' },
  { value: 'UTC', label: 'UTC / GMT' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET/CEST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT/AEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
].sort((a, b) => a.label.localeCompare(b.label))
