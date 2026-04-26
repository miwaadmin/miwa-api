const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const AZURE_STORAGE_PREFIX = 'azure-blob://';
const DEFAULT_CONTAINER = 'miwa-clinical-files';

function getConnectionString() {
  return process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AZURE_BLOB_CONNECTION_STRING || '';
}

function getContainerName() {
  return process.env.AZURE_BLOB_CONTAINER || process.env.AZURE_STORAGE_CONTAINER || DEFAULT_CONTAINER;
}

function isAzureStorageConfigured() {
  return !!getConnectionString();
}

function makeStorageKey({ therapistId, patientId, originalName }) {
  const ext = path.extname(originalName || '').toLowerCase();
  const token = crypto.randomBytes(16).toString('hex');
  const date = new Date().toISOString().slice(0, 10);
  return [
    'documents',
    String(therapistId || 'unknown'),
    String(patientId || 'unknown'),
    date,
    `${Date.now()}-${token}${ext}`,
  ].join('/');
}

function parseAzureStoragePath(storagePath) {
  if (!storagePath?.startsWith(AZURE_STORAGE_PREFIX)) return null;
  const rest = storagePath.slice(AZURE_STORAGE_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return {
    containerName: rest.slice(0, slash),
    blobName: rest.slice(slash + 1),
  };
}

async function getContainerClient(containerName = getContainerName()) {
  const client = BlobServiceClient.fromConnectionString(getConnectionString());
  const container = client.getContainerClient(containerName);
  await container.createIfNotExists();
  return container;
}

async function uploadLocalFile({ localPath, key, contentType }) {
  if (!isAzureStorageConfigured()) return localPath;

  const containerName = getContainerName();
  const container = await getContainerClient(containerName);
  const blobName = key || `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
  const blockBlob = container.getBlockBlobClient(blobName);

  await blockBlob.uploadFile(localPath, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  });

  return `${AZURE_STORAGE_PREFIX}${containerName}/${blobName}`;
}

async function deleteStoredFile(storagePath) {
  const azurePath = parseAzureStoragePath(storagePath);
  if (!azurePath) {
    if (storagePath && fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
    return;
  }

  const container = await getContainerClient(azurePath.containerName);
  await container.deleteBlob(azurePath.blobName, { deleteSnapshots: 'include' }).catch((err) => {
    if (err?.statusCode !== 404) throw err;
  });
}

async function storedFileExists(storagePath) {
  const azurePath = parseAzureStoragePath(storagePath);
  if (!azurePath) return !!storagePath && fs.existsSync(storagePath);

  const container = await getContainerClient(azurePath.containerName);
  const blob = container.getBlobClient(azurePath.blobName);
  return blob.exists();
}

async function readStoredFile(storagePath) {
  const azurePath = parseAzureStoragePath(storagePath);
  if (!azurePath) return fs.readFileSync(storagePath);

  const container = await getContainerClient(azurePath.containerName);
  const blob = container.getBlobClient(azurePath.blobName);
  return blob.downloadToBuffer();
}

module.exports = {
  AZURE_STORAGE_PREFIX,
  deleteStoredFile,
  isAzureStorageConfigured,
  makeStorageKey,
  readStoredFile,
  storedFileExists,
  uploadLocalFile,
};
