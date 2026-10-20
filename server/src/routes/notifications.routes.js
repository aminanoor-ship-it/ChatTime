const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { handle, requireId, notFound } = require('../utils/http');
const { serializeNotification, SELECT_NOTIFICATIONS } = require('../services/notifications');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth);

router.get('/', handle(async (req, res) => {
  const [rows] = await pool.query(`${SELECT_NOTIFICATIONS} WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`, [req.user.id]);
  const [[unread]] = await pool.query('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
  res.json({ notifications: rows.map(serializeNotification), unread_count: Number(unread.total) });
}));

router.patch('/read-all', handle(async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
  realtime.toUser(req.user.id, 'notification:read', { all: true });
  res.json({ ok: true });
}));

router.patch('/:id/read', handle(async (req, res) => {
  const id = requireId(req.params.id, 'notification');
  const [result] = await pool.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND user_id = ?',
    [id, req.user.id],
  );
  if (!result.affectedRows) throw notFound('Notification not found.');
  realtime.toUser(req.user.id, 'notification:read', { id });
  res.json({ ok: true });
}));

router.delete('/', handle(async (req, res) => {
  await pool.query('DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL', [req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
