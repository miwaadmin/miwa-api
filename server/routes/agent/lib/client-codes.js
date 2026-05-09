async function generateClientId(db, therapistId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id, attempts = 0;
  do {
    id = 'C';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    const existing = await db.get('SELECT id FROM patients WHERE client_id = ? AND therapist_id = ?', id, therapistId);
    if (!existing) break;
    attempts++;
  } while (attempts < 10);
  return id;
}

function extractClientCodeFromText(text) {
  const value = String(text || '').trim();
  const patterns = [
    /\bclient\s*[:#-]?\s*([a-z0-9][a-z0-9\s-]{1,30})\b/i,
    /\bpatient\s*[:#-]?\s*([a-z0-9][a-z0-9\s-]{1,30})\b/i,
    /\b([A-Z]{1,3}\s*\d{2,6})\b/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s+/g, ' ');
    if (match?.[0] && /^\d{2,6}$/.test(match[0])) return match[0].trim();
  }
  return '';
}

module.exports = { generateClientId, extractClientCodeFromText };
