const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { singleFile } = require('../middleware/upload');
const { handle, badRequest, forbidden, notFound, requireId } = require('../utils/http');
const { detectFile, randomKey, saveBuffer, filePath, safeFilename, KEY_PATTERN } = require('../utils/files');
const { getSettings } = require('../services/settings');
const { requireMember, getMembership } = require('../services/conversations');
const { serializeAttachment } = require('../services/messages');

const uploads = express.Router();
const media = express.Router();
uploads.use(requireAuth);
media.use(requireAuth);

// Step 1 of sending a file: upload it, get an attachment id, then send a message that references it.
uploads.post('/', singleFile(), handle(async (req, res) => {
  const conversationId = requireId(req.body.conversation_id, 'conversation');
  await requireMember(conversationId, req.user.id);
  const { mime, ext, category } = await detectFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  const { allowed_file_categories: allowed } = await getSettings();
  if (!allowed.includes(category)) throw badRequest(`${category[0].toUpperCase()}${category.slice(1)} files are not allowed right now.`);

  const key = randomKey(ext);
  await saveBuffer('files', key, req.file.buffer);
  const duration = Number(req.body.duration_seconds);
  const [result] = await pool.query(
    `INSERT INTO message_attachments (message_id, uploaded_by, original_filename, storage_key, mime_type, size_bytes, duration_seconds)
     VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, safeFilename(req.file.originalname), key, mime, req.file.size,
      category === 'audio' && Number.isFinite(duration) && duration > 0 ? Math.min(duration, 3600) : null],
  );
  const [[row]] = await pool.query('SELECT * FROM message_attachments WHERE id = ?', [result.insertId]);
  res.status(201).json({ attachment: serializeAttachment(row) });
}));

media.get('/attachments/:id', handle(async (req, res) => {
  const id = requireId(req.params.id, 'file');
  const [rows] = await pool.query(
    `SELECT a.*, m.conversation_id, m.deleted_at FROM message_attachments a
     LEFT JOIN messages m ON m.id = a.message_id WHERE a.id = ? LIMIT 1`,
    [id],
  );
  const file = rows[0];
  if (!file || file.deleted_at) throw notFound('File not found.');
  if (file.conversation_id) {
    await requireMember(file.conversation_id, req.user.id);
  } else if (Number(file.uploaded_by) !== Number(req.user.id)) {
    throw forbidden();
  }
  const inline = /^(image|audio|video)\//.test(file.mime_type) || file.mime_type === 'application/pdf';
  const disposition = req.query.download === '1' || !inline ? 'attachment' : 'inline';
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath('files', file.storage_key));
}));

// Profile photos are visible to every signed-in user; group photos only to members.
media.get('/avatars/:key', handle(async (req, res) => {
  const { key } = req.params;
  if (!KEY_PATTERN.test(key)) throw notFound();
  const [users] = await pool.query("SELECT id FROM users WHERE avatar_key = ? AND account_status <> 'deleted' LIMIT 1", [key]);
  if (!users.length) {
    const [groups] = await pool.query('SELECT id FROM conversations WHERE avatar_key = ? LIMIT 1', [key]);
    if (!groups.length || !(await getMembership(groups[0].id, req.user.id))) throw notFound();
  }
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  res.sendFile(filePath('avatars', key));
}));

module.exports = { uploads, media };
