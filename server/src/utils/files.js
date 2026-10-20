const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const FileType = require('file-type');
const { badRequest } = require('./http');

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads'));
const DIRS = { avatars: path.join(UPLOAD_ROOT, 'avatars'), files: path.join(UPLOAD_ROOT, 'files') };

// Allow-list keyed by the type detected from the file's actual bytes.
const ALLOWED = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'audio/webm': 'audio', 'audio/ogg': 'audio', 'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/wav': 'audio', 'audio/x-wav': 'audio', 'audio/vnd.wave': 'audio',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
  'application/pdf': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'application/msword': 'document', 'application/x-cfb': 'document',
  'application/zip': 'document',
  'text/plain': 'document', 'text/csv': 'document', 'text/markdown': 'document',
};
const TEXT_TYPES = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown' };
const KEY_PATTERN = /^[a-f0-9]{32}\.[a-z0-9]{1,8}$/;

async function ensureUploadDirs() {
  await Promise.all(Object.values(DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

// Works out what a file really is from its contents; the browser's name and type are hints only.
async function detectFile(buffer, originalName, declaredMime = '') {
  const extension = path.extname(originalName || '').slice(1).toLowerCase();
  const detected = await FileType.fromBuffer(buffer);
  let mime = detected?.mime;
  let ext = detected?.ext;

  if (!detected) {
    // Plain-text formats have no signature: accept them only if they contain no binary bytes.
    if (TEXT_TYPES[extension] && !buffer.includes(0)) {
      mime = TEXT_TYPES[extension];
      ext = extension;
    }
  } else if (declaredMime.startsWith('audio/') && ['video/webm', 'video/mp4', 'audio/ogg', 'video/ogg'].includes(detected.mime)) {
    // Recorded voice notes use video containers with an audio-only track.
    mime = detected.mime.replace(/^video\//, 'audio/');
    ext = detected.ext === 'mp4' ? 'm4a' : detected.ext;
  } else if (detected.mime === 'application/x-cfb') {
    mime = 'application/msword';
  }

  const category = mime ? ALLOWED[mime] : null;
  if (!category) throw badRequest('This file type is not allowed.');
  return { mime, ext, category };
}

function randomKey(ext) {
  return `${crypto.randomBytes(16).toString('hex')}.${ext}`;
}

async function saveBuffer(kind, key, buffer) {
  await fs.writeFile(path.join(DIRS[kind], key), buffer, { flag: 'wx' });
}

function filePath(kind, key) {
  if (!KEY_PATTERN.test(key)) throw badRequest('Invalid file reference.');
  return path.join(DIRS[kind], key);
}

async function removeFile(kind, key) {
  if (!key || !KEY_PATTERN.test(key)) return;
  await fs.unlink(path.join(DIRS[kind], key)).catch(() => {});
}

function safeFilename(name) {
  const cleaned = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(-200) || 'file';
}

const avatarUrl = (key) => (key ? `/api/media/avatars/${key}` : null);
const attachmentUrl = (id) => `/api/media/attachments/${id}`;

module.exports = {
  ensureUploadDirs, detectFile, randomKey, saveBuffer, filePath, removeFile, safeFilename,
  avatarUrl, attachmentUrl, KEY_PATTERN,
};
