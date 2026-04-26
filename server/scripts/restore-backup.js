#!/usr/bin/env node
/**
 * Restore an encrypted Miwa DB backup (.miwabk file) back to a plaintext
 * mftbrain.db.
 *
 * Usage:
 *   BACKUP_PASSPHRASE='...' node server/scripts/restore-backup.js \
 *     --in  /path/to/miwa-db-...miwabk \
 *     --out /path/to/restored-mftbrain.db
 *
 * Then, with the server stopped, replace $DB_PATH with the restored file
 * and reboot the server. The integrity check in initDb() will verify the
 * SQLite magic header before touching it.
 *
 * This script is pure Node + Node crypto — no additional dependencies.
 * It reads the backup file shape produced by services/backup.js:
 *   8 bytes "MIWABK01" | 16 bytes salt | 12 bytes IV | 16 bytes authTag | ciphertext
 */

const fs = require('fs');
const path = require('path');
const { decryptBackupBuffer } = require('../services/backup');

function parseArgs(argv) {
  const out = { in: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' || a === '-i') out.in = argv[++i];
    else if (a === '--out' || a === '-o') out.out = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: BACKUP_PASSPHRASE=... node restore-backup.js --in <file.miwabk> --out <file.db>');
      process.exit(0);
    }
  }
  return out;
}

function main() {
  const { in: inPath, out: outPath } = parseArgs(process.argv);
  if (!inPath || !outPath) {
    console.error('Usage: BACKUP_PASSPHRASE=... node restore-backup.js --in <file.miwabk> --out <file.db>');
    process.exit(1);
  }
  if (!process.env.BACKUP_PASSPHRASE) {
    console.error('BACKUP_PASSPHRASE environment variable is required.');
    process.exit(1);
  }
  if (!fs.existsSync(inPath)) {
    console.error(`Input file not found: ${inPath}`);
    process.exit(1);
  }
  if (fs.existsSync(outPath)) {
    console.error(`Output path already exists, refusing to overwrite: ${outPath}`);
    process.exit(1);
  }

  const packed = fs.readFileSync(inPath);
  let plain;
  try {
    plain = decryptBackupBuffer(packed, process.env.BACKUP_PASSPHRASE);
  } catch (err) {
    console.error(`Decryption failed: ${err.message}`);
    console.error('Check that BACKUP_PASSPHRASE matches the one used when the backup was created.');
    process.exit(2);
  }

  if (!plain.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
    console.error('Decrypted output does not look like a valid SQLite file — refusing to write.');
    process.exit(3);
  }

  fs.writeFileSync(outPath, plain);
  console.log(`Restored ${plain.length.toLocaleString()} bytes → ${path.resolve(outPath)}`);
  console.log('Next steps:');
  console.log('  1. Stop the running Miwa server.');
  console.log(`  2. Copy this file to $DB_PATH (e.g. /data/mftbrain.db) — overwriting the current one.`);
  console.log('  3. Restart the server. The initDb() magic-header check will verify it loaded cleanly.');
}

main();
