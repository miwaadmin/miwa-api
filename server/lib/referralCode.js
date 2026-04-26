const crypto = require('crypto');

// Characters that are unambiguous — no O/0, I/1 confusion
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSegment(len) {
  let result = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    result += CHARS[bytes[i] % CHARS.length];
  }
  return result;
}

function generate() {
  return `MIWA-${randomSegment(4)}-${randomSegment(4)}`;
}

module.exports = { generate };
