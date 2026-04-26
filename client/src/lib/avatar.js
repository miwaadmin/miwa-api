export function therapistInitials(therapist) {
  const name = therapist?.full_name?.trim()
  if (name) {
    return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
  }
  return therapist?.email?.slice(0, 2).toUpperCase() || '??'
}

/**
 * Two-letter initials for a patient: first letter of first name +
 * first letter of last name. Falls back gracefully.
 *
 *   "Sofia Martinez" → "SM"
 *   "Ryan Brown"     → "RB"
 *   "Emily A"        → "EA"
 *   "Robert"         → "R"
 *   ""  + "Client-098914" → "CL"  (first 2 chars of client_id)
 *
 * Accepts either a patient-like object ({display_name, client_id}) or
 * a raw name string for flexibility.
 */
export function patientInitials(patientOrName, clientId) {
  const name = typeof patientOrName === 'string'
    ? patientOrName
    : patientOrName?.display_name
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return parts[0][0].toUpperCase()
  }
  // Fallback to client_id (first 2 alphanumeric chars)
  const cid = (typeof patientOrName === 'object' ? patientOrName?.client_id : clientId) || ''
  const clean = cid.replace(/[^A-Za-z0-9]/g, '')
  if (clean.length >= 2) return clean.slice(0, 2).toUpperCase()
  if (clean.length === 1) return clean.toUpperCase()
  return '??'
}
