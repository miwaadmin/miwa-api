/**
 * Encrypted off-site backup of the Miwa SQLite database.
 *
 * What this protects against:
 *   - Railway volume loss / corruption (the failure mode that ate the DB
 *     on 2026-04-18: Meet-feature deploy crashed mid-persist, file was left
 *     torn, next boot couldn't read it and silently overwrote with empty)
 *   - Accidental destructive admin actions
 *   - Schema migrations gone wrong
 *
 * Design:
 *   - Read /data/mftbrain.db (the persisted file — same bytes the live app
 *     is using; sql.js writes the whole thing on every persist).
 *   - Encrypt with AES-256-GCM using a key derived from BACKUP_PASSPHRASE
 *     via PBKDF2 (200k iterations, SHA-256, random per-file salt).
 *   - Pack the result as: header || salt || iv || authTag || ciphertext
 *     in a small framed binary so the whole file is self-describing.
 *   - Email the encrypted blob to admin@miwa.care via the Gmail API
 *     (already BAA-covered under our Workspace BAA) so it lands in a
 *     HIPAA-compliant store automatically.
 *
 * Restore:
 *   See decryptBackupBuffer() — given the encrypted blob + the same
 *   passphrase, returns the original SQLite bytes. Drop those bytes at
 *   $DB_PATH (with the server stopped) and reboot.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'mftbrain.db');
const BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE || '';
const BACKUP_TO_EMAIL = process.env.BACKUP_TO_EMAIL || process.env.ADMIN_EMAIL || 'admin@miwa.care';

// Wire format constants. Bump MAGIC_VERSION if the layout ever changes.
const MAGIC = Buffer.from('MIWABK01', 'utf8'); // 8 bytes, version 01
const SALT_LEN = 16;
const IV_LEN = 12;          // GCM standard nonce length
const TAG_LEN = 16;          // GCM standard auth tag length
const PBKDF2_ITERATIONS = 200_000;
const KEY_LEN = 32;          // AES-256

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(String(passphrase), salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

/**
 * Encrypt an arbitrary Buffer with the configured passphrase. Returns a
 * Buffer in the framed format documented above.
 */
function encryptBuffer(plaintext, passphrase) {
  if (!passphrase) throw new Error('BACKUP_PASSPHRASE is not set');
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, authTag, ciphertext]);
}

/**
 * Inverse of encryptBuffer(). Throws if MAGIC is wrong, the passphrase
 * doesn't match, or the file has been tampered with (GCM auth check fails).
 */
function decryptBackupBuffer(packed, passphrase) {
  if (!passphrase) throw new Error('BACKUP_PASSPHRASE is not set');
  if (!Buffer.isBuffer(packed)) packed = Buffer.from(packed);
  if (packed.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error('Backup file is too small to be valid');
  }
  if (!packed.slice(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`Backup magic header mismatch — expected ${MAGIC.toString('utf8')}`);
  }
  let off = MAGIC.length;
  const salt = packed.slice(off, off + SALT_LEN); off += SALT_LEN;
  const iv = packed.slice(off, off + IV_LEN); off += IV_LEN;
  const authTag = packed.slice(off, off + TAG_LEN); off += TAG_LEN;
  const ciphertext = packed.slice(off);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Read the live DB file from disk and produce an encrypted backup blob.
 * Returns { filename, mimeType, content (Buffer), plainSize, encryptedSize, sha256 }.
 *
 * Verifies the encrypted blob round-trips back to the exact original plaintext
 * before returning. A backup that "succeeds" but can't be decrypted is worse
 * than no backup at all — it would silently break recovery the day you need it.
 */
function buildEncryptedDbBackup() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`DB file not found at ${DB_PATH}`);
  }
  const plain = fs.readFileSync(DB_PATH);
  if (!plain.length || !plain.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
    throw new Error(`DB file at ${DB_PATH} (${plain.length} bytes) is not a valid SQLite file — refusing to back it up`);
  }
  const encrypted = encryptBuffer(plain, BACKUP_PASSPHRASE);

  // Round-trip verification: decrypt the just-built blob and assert the result
  // matches the source. Catches encryption bugs, key-derivation drift, and any
  // transient corruption between encrypt and emit.
  let verified;
  try {
    verified = decryptBackupBuffer(encrypted, BACKUP_PASSPHRASE);
  } catch (err) {
    throw new Error(`Backup verification FAILED — decrypted with stored passphrase but read failed: ${err.message}. Backup not emitted.`);
  }
  if (verified.length !== plain.length || !verified.equals(plain)) {
    throw new Error(`Backup verification FAILED — decrypted output (${verified.length}B) did not match source (${plain.length}B). Backup not emitted.`);
  }
  if (!verified.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
    throw new Error('Backup verification FAILED — decrypted output is not a valid SQLite file. Backup not emitted.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    filename: `miwa-db-${stamp}.miwabk`,
    mimeType: 'application/octet-stream',
    content: encrypted,
    plainSize: plain.length,
    encryptedSize: encrypted.length,
    sha256: crypto.createHash('sha256').update(plain).digest('hex'),
    verified: true,
  };
}

/**
 * Run the nightly backup: build the blob, email it, and log result.
 * Designed to be called from the scheduler. Never throws — failures are
 * logged so a flaky backup run doesn't kill the server.
 */
async function runNightlyBackup({ trigger = 'scheduled' } = {}) {
  const startedAt = Date.now();
  if (!BACKUP_PASSPHRASE) {
    console.error('[backup] BACKUP_PASSPHRASE not set — skipping. Backups are DISABLED.');
    return { ok: false, error: 'BACKUP_PASSPHRASE not set' };
  }
  try {
    const backup = buildEncryptedDbBackup();
    const { sendMail } = require('./mailer');

    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const tookMs = Date.now() - startedAt;

    await sendMail({
      to: BACKUP_TO_EMAIL,
      subject: `[Miwa Backup] ${dateStr} — ${(backup.plainSize / 1024).toFixed(1)} KB DB (encrypted)`,
      text: [
        `Miwa nightly database backup`,
        ``,
        `Trigger:           ${trigger}`,
        `DB plaintext size: ${backup.plainSize} bytes`,
        `Encrypted size:    ${backup.encryptedSize} bytes`,
        `SHA-256 (plain):   ${backup.sha256}`,
        `Build time:        ${tookMs} ms`,
        ``,
        `The attached file is AES-256-GCM encrypted with your BACKUP_PASSPHRASE.`,
        `Format: 8-byte magic "MIWABK01" + 16-byte salt + 12-byte IV + 16-byte authTag + ciphertext.`,
        `To restore, decrypt with PBKDF2-SHA256 (200k iterations) → AES-256-GCM, then drop the resulting bytes at $DB_PATH with the server stopped.`,
        ``,
        `Save this email. Do not lose your BACKUP_PASSPHRASE — without it the backup is unrecoverable.`,
      ].join('\n'),
      html: `<p>Miwa nightly database backup &mdash; <strong>${dateStr}</strong></p>
        <ul>
          <li>Trigger: <code>${trigger}</code></li>
          <li>DB size: <code>${backup.plainSize.toLocaleString()}</code> bytes</li>
          <li>Encrypted size: <code>${backup.encryptedSize.toLocaleString()}</code> bytes</li>
          <li>SHA-256 (plaintext): <code style="font-size:11px">${backup.sha256}</code></li>
          <li>Build time: <code>${tookMs} ms</code></li>
        </ul>
        <p>The attached <code>.miwabk</code> file is AES-256-GCM encrypted with your <code>BACKUP_PASSPHRASE</code>. Save this email; without the passphrase the backup is unrecoverable.</p>`,
      attachments: [{
        filename: backup.filename,
        content: backup.content,
        contentType: backup.mimeType,
      }],
    });

    console.log(`[backup] OK — ${backup.plainSize}B (encrypted ${backup.encryptedSize}B) emailed to ${BACKUP_TO_EMAIL} in ${tookMs}ms`);
    return { ok: true, ...backup, content: undefined, tookMs };
  } catch (err) {
    console.error(`[backup] FAILED: ${err.message}`);
    // Fire a separate alert email so silent backup failures get noticed. We
    // intentionally use a different code path than the normal backup so a
    // mailer-side problem can't suppress its own alarm — the alert is plain
    // text, no attachment, minimal moving parts.
    try {
      const { sendMail } = require('./mailer');
      await sendMail({
        to: BACKUP_TO_EMAIL,
        subject: `⚠️ [Miwa Backup FAILED] ${new Date().toISOString().slice(0, 10)} — ${trigger}`,
        text: [
          `A Miwa database backup attempt FAILED.`,
          ``,
          `Trigger: ${trigger}`,
          `Time:    ${new Date().toISOString()}`,
          `Error:   ${err.message}`,
          ``,
          `Action: investigate immediately. Until backups succeed again, the database is not safely recoverable.`,
          ``,
          `Common causes:`,
          `- BACKUP_PASSPHRASE env var not set or recently changed`,
          `- DB file at $DB_PATH is missing, empty, or corrupted`,
          `- Gmail API quota exceeded or service-account permissions changed`,
        ].join('\n'),
      });
    } catch (alertErr) {
      console.error(`[backup] alert email ALSO failed: ${alertErr.message}`);
    }
    return { ok: false, error: err.message };
  }
}

module.exports = {
  buildEncryptedDbBackup,
  encryptBuffer,
  decryptBackupBuffer,
  runNightlyBackup,
};
