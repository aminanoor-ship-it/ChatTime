const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { handle, badRequest, notFound, requireId, HttpError } = require('../utils/http');
const { requireMember } = require('../services/conversations');

const router = express.Router();
router.use(requireAuth);

const REASONS = ['spam', 'harassment', 'inappropriate_content', 'impersonation', 'other'];

router.post('/', handle(async (req, res) => {
  const targetType = req.body.target_type;
  const targetId = requireId(req.body.target_id, 'report target');
  const reason = req.body.reason;
  const details = String(req.body.details || '').trim();
  if (!['user', 'message', 'conversation'].includes(targetType)) throw badRequest('Choose what you are reporting.');
  if (!REASONS.includes(reason)) throw badRequest('Choose a reason for the report.');
  if (details.length > 2000) throw badRequest('Details can be up to 2,000 characters.');

  // The target is polymorphic, so confirm it exists and that the reporter can actually see it.
  if (targetType === 'user') {
    if (targetId === Number(req.user.id)) throw badRequest('You cannot report yourself.');
    const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!rows.length) throw notFound('User not found.');
  } else if (targetType === 'message') {
    const [rows] = await pool.query('SELECT conversation_id, sender_id FROM messages WHERE id = ?', [targetId]);
    if (!rows.length) throw notFound('Message not found.');
    await requireMember(rows[0].conversation_id, req.user.id);
    if (Number(rows[0].sender_id) === Number(req.user.id)) throw badRequest('You cannot report your own message.');
  } else {
    await requireMember(targetId, req.user.id);
  }

  const [existing] = await pool.query(
    "SELECT id FROM content_reports WHERE reporter_user_id = ? AND target_type = ? AND target_id = ? AND status IN ('open', 'under_review') LIMIT 1",
    [req.user.id, targetType, targetId],
  );
  if (existing.length) throw new HttpError(409, 'You already have an open report about this. Our team will review it.');

  await pool.query(
    'INSERT INTO content_reports (reporter_user_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, targetType, targetId, reason, details || null],
  );
  res.status(201).json({ message: 'Thanks — your report was sent to the moderators.' });
}));

module.exports = router;
