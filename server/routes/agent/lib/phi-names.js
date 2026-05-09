// ── PHI name substitution ─────────────────────────────────────────────────────
// Prevents display names from crossing the AI API boundary.
// Names are replaced with [CLIENT_ID] tokens before sending to Azure AI,
// and restored in the response before displaying to the clinician.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNameMap(patients) {
  // Longest names first to prevent partial matches (e.g. "Sarah M" before "Sarah")
  return patients
    .filter(p => p.display_name && p.display_name.trim())
    .sort((a, b) => b.display_name.length - a.display_name.length);
}

function scrubNamesFromMessage(text, nameMap) {
  let result = text;

  // Pass 1: full display_names (longest first prevents partial clobbering)
  for (const p of nameMap) {
    const re = new RegExp(`\\b${escapeRegex(p.display_name.trim())}\\b`, 'gi');
    result = result.replace(re, `[${p.client_id}]`);
  }

  // Pass 2: first names — only when the first name is unique across the caseload
  // (ambiguous first names trigger the disambiguation dialog instead)
  const byFirstName = {};
  for (const p of nameMap) {
    const first = p.display_name.trim().split(/\s+/)[0].toLowerCase();
    if (!byFirstName[first]) byFirstName[first] = [];
    byFirstName[first].push(p);
  }
  for (const [first, patients] of Object.entries(byFirstName)) {
    if (patients.length !== 1) continue; // ambiguous — skip, let disambiguation handle it
    const p = patients[0];
    // Don't re-scrub if already inside a [CODE] token
    const re = new RegExp(`(?<!\\[)\\b${escapeRegex(first)}\\b(?![A-Z0-9\\-]*\\])`, 'gi');
    result = result.replace(re, `[${p.client_id}]`);
  }

  return result;
}

function restoreNamesInResponse(text, nameMap) {
  let result = text;
  for (const p of nameMap) {
    const re = new RegExp(`\\[${escapeRegex(p.client_id)}\\]`, 'gi');
    result = result.replace(re, p.display_name);
  }
  return result;
}

/**
 * Detect if the message contains a display name that maps to multiple patients.
 * Returns the first ambiguous hit, or null if everything is unambiguous.
 * Must run on the RAW (un-scrubbed) message so names are still present.
 */
function detectAmbiguousNames(rawMessage, allPatients) {
  const withNames = allPatients.filter(p => p.display_name?.trim());

  // Group by full display_name (exact duplicates)
  const byFullName = {};
  for (const p of withNames) {
    const key = p.display_name.trim().toLowerCase();
    if (!byFullName[key]) byFullName[key] = [];
    byFullName[key].push(p);
  }

  // Group by first name (e.g. two patients both named "Ryan ...")
  const byFirstName = {};
  for (const p of withNames) {
    const first = p.display_name.trim().split(/\s+/)[0].toLowerCase();
    if (!byFirstName[first]) byFirstName[first] = [];
    byFirstName[first].push(p);
  }

  // Merge: anything ambiguous by full name OR first name
  const ambiguous = new Map();
  for (const [key, patients] of Object.entries(byFullName)) {
    if (patients.length >= 2) ambiguous.set(key, { label: patients[0].display_name, patients });
  }
  for (const [first, patients] of Object.entries(byFirstName)) {
    if (patients.length >= 2 && !ambiguous.has(first)) {
      ambiguous.set(first, { label: first, patients });
    }
  }

  // Find the longest ambiguous token that appears in the raw message
  const candidates = [...ambiguous.entries()].sort(([a], [b]) => b.length - a.length);
  for (const [key, { label, patients }] of candidates) {
    const re = new RegExp(`\\b${escapeRegex(key)}\\b`, 'i');
    if (re.test(rawMessage)) {
      return {
        name: label,
        matches: patients.map(p => ({
          id: p.id,
          clientId: p.client_id,
          displayName: p.display_name,
          clientType: p.client_type || 'individual',
        })),
      };
    }
  }
  return null;
}

module.exports = {
  escapeRegex,
  buildNameMap,
  scrubNamesFromMessage,
  restoreNamesInResponse,
  detectAmbiguousNames,
};
