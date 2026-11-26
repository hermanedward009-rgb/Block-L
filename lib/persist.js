const fs = require('fs');
const path = require('path');

const BLOB_DB_KEY = 'block-l/block_l.db';
let persistTimer = null;

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function restoreDatabase(dbPath) {
  if (!blobEnabled()) return false;

  const { list } = require('@vercel/blob');
  const { blobs } = await list({ prefix: 'block-l/' });
  const match =
    blobs.find((b) => b.pathname === BLOB_DB_KEY) ||
    blobs.find((b) => b.pathname.endsWith('block_l.db'));
  if (!match) return false;

  const res = await fetch(match.url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, buf);
  return true;
}

function schedulePersistDatabase(dbPath) {
  if (!blobEnabled() || !dbPath || !fs.existsSync(dbPath)) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistDatabase(dbPath).catch((err) => console.error('DB persist failed:', err.message));
  }, 1200);
}

async function persistDatabase(dbPath) {
  if (!blobEnabled() || !fs.existsSync(dbPath)) return;
  const { put } = require('@vercel/blob');
  const body = fs.readFileSync(dbPath);
  await put(BLOB_DB_KEY, body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/x-sqlite3'
  });
}

async function saveUpload(file) {
  if (!file) return null;

  if (!blobEnabled()) {
    return `/uploads/${file.filename}`;
  }

  const { put } = require('@vercel/blob');
  const name = file.filename || `${Date.now()}-${file.originalname || 'upload'}`;
  const body = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!body) return null;

  const blob = await put(`block-l/uploads/${name}`, body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: file.mimetype || 'application/octet-stream'
  });
  return blob.url;
}

module.exports = {
  blobEnabled,
  restoreDatabase,
  schedulePersistDatabase,
  persistDatabase,
  saveUpload
};