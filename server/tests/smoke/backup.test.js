const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptBuffer, decryptBackupBuffer } = require('../../services/backup');

test('backup encrypt/decrypt round-trip', async (t) => {
  await t.test('same passphrase round-trips successfully', () => {
    // Use a fake "SQLite-shaped" buffer so the verifier accepts it.
    const plaintext = Buffer.concat([
      Buffer.from('SQLite format 3\0'),
      Buffer.from('x'.repeat(2000)),
    ]);
    const encrypted = encryptBuffer(plaintext, 'correct horse battery staple');
    assert.ok(encrypted.length > plaintext.length);
    const decrypted = decryptBackupBuffer(encrypted, 'correct horse battery staple');
    assert.equal(decrypted.length, plaintext.length);
    assert.ok(decrypted.equals(plaintext));
  });

  await t.test('wrong passphrase is rejected (auth tag mismatch)', () => {
    const plaintext = Buffer.from('SQLite format 3\0' + 'data');
    const encrypted = encryptBuffer(plaintext, 'right-passphrase');
    assert.throws(() => decryptBackupBuffer(encrypted, 'wrong-passphrase'));
  });

  await t.test('truncated/corrupt blob is rejected', () => {
    const plaintext = Buffer.from('SQLite format 3\0' + 'data');
    const encrypted = encryptBuffer(plaintext, 'pass');
    // Lop off the last 8 bytes — fails the GCM auth check
    const truncated = encrypted.slice(0, encrypted.length - 8);
    assert.throws(() => decryptBackupBuffer(truncated, 'pass'));
  });

  await t.test('blob without MIWABK magic header is rejected', () => {
    const fake = Buffer.alloc(100, 0); // all zeros
    assert.throws(
      () => decryptBackupBuffer(fake, 'whatever'),
      /magic header/i,
    );
  });
});
