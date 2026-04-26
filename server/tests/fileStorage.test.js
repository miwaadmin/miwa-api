const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  deleteStoredFile,
  isAzureStorageConfigured,
  makeStorageKey,
  readStoredFile,
  storedFileExists,
  uploadLocalFile,
} = require('../services/fileStorage');

test('file storage falls back to local disk when Azure Blob is not configured', async () => {
  const prevConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const prevBlobConnection = process.env.AZURE_BLOB_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_BLOB_CONNECTION_STRING;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miwa-file-storage-'));
  const filePath = path.join(dir, 'sample.txt');
  fs.writeFileSync(filePath, 'clinical file placeholder');

  try {
    assert.equal(isAzureStorageConfigured(), false);
    const storedPath = await uploadLocalFile({ localPath: filePath, key: 'unused-key' });
    assert.equal(storedPath, filePath);
    assert.equal(await storedFileExists(storedPath), true);
    assert.equal((await readStoredFile(storedPath)).toString(), 'clinical file placeholder');

    await deleteStoredFile(storedPath);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    if (prevConnection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    else process.env.AZURE_STORAGE_CONNECTION_STRING = prevConnection;
    if (prevBlobConnection === undefined) delete process.env.AZURE_BLOB_CONNECTION_STRING;
    else process.env.AZURE_BLOB_CONNECTION_STRING = prevBlobConnection;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('storage keys avoid original filename PHI', () => {
  const key = makeStorageKey({
    therapistId: 12,
    patientId: 34,
    originalName: 'Maria Lopez intake.pdf',
  });

  assert.match(key, /^documents\/12\/34\/\d{4}-\d{2}-\d{2}\/\d+-[a-f0-9]{32}\.pdf$/);
  assert.equal(key.includes('Maria'), false);
  assert.equal(key.includes('Lopez'), false);
});
