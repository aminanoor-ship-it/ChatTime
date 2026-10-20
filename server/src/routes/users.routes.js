const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { singleFile } = require('../middleware/upload');
const { handle, badRequest, notFound, requireId, HttpError, bool } = require('../utils/http');
const {
  USERNAME_PATTERN, PHONE_PATTERN, USERNAME_RULE, PHONE_RULE, likePattern,
} = require('../utils/validation');
const { replaceAvatar } = require('../services/avatars');
const { publicSelf, publicUser } = require('../services/users');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth);

// Re-reads the profile, tells other clients about the public part, and returns the private view.
async function respondWithProfile(req, res) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  realtime.getIo()?.emit('user:updated', publicUser(rows[0]));
  res.json({ user: publicSelf(rows[0]) });
}

async function readPreferences(userId) {
  await pool.query('INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)', [userId]);
  const [[row]] = await pool.query('SELECT desktop_enabled, sound_enabled, email_enabled FROM notification_preferences WHERE user_id = ?', [userId]);
  return { desktop_enabled: bool(row.desktop_enabled), sound_enabled: bool(row.sound_enabled), email_enabled: bool(row.email_enabled) };
}

router.get('/', handle(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ users: [] });
  const pattern = likePattern(q);
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_key, u.bio, u.last_seen_at,
            (c.contact_user_id IS NOT NULL) AS is_contact,
            EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = ? AND b.blocked_user_id = u.id) AS blocked_by_me
     FROM users u
     LEFT JOIN user_contacts c ON c.owner_user_id = ? AND c.contact_user_id = u.id
     WHERE u.account_status = 'active' AND u.id <> ?
       AND (u.username LIKE ? OR u.display_name LIKE ? OR u.email = ?)
       AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = u.id AND b.blocked_user_id = ?)
     ORDER BY (u.username = ?) DESC, u.display_name ASC LIMIT 30`,
    [req.user.id, req.user.id, req.user.id, pattern, pattern, q.toLowerCase(), req.user.id, q],
  );
  res.json({
    users: rows.map((row) => ({ ...publicUser(row), is_contact: bool(row.is_contact), blocked_by_me: bool(row.blocked_by_me) })),
  });
}));

router.patch('/me', handle(async (req, res) => {
  const updates = {};
  if ('display_name' in req.body) {
    const value = String(req.body.display_name || '').trim();
    if (value.length < 2 || value.length > 80) throw badRequest('Full name must be 2–80 characters.');
    updates.display_name = value;
  }
  if ('username' in req.body) {
    const value = String(req.body.username || '').trim();
    if (!USERNAME_PATTERN.test(value)) throw badRequest(USERNAME_RULE);
    updates.username = value;
  }
  if ('bio' in req.body) {
    const value = String(req.body.bio || '').trim();
    if (value.length > 300) throw badRequest('About can be up to 300 characters.');
    updates.bio = value || null;
  }
  if ('phone' in req.body) {
    const value = String(req.body.phone || '').trim();
    if (value && !PHONE_PATTERN.test(value)) throw badRequest(PHONE_RULE);
    updates.phone = value || null;
  }
  if (!Object.keys(updates).length) throw badRequest('Nothing to update.');
  try {
    await pool.query('UPDATE users SET ? WHERE id = ?', [updates, req.user.id]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That username is already taken.');
    throw error;
  }
  await respondWithProfile(req, res);
}));

router.post('/me/avatar', singleFile({ fixedLimitMb: 5 }), handle(async (req, res) => {
  await replaceAvatar('user', req.user.id, req.file);
  await respondWithProfile(req, res);
}));

router.delete('/me/avatar', handle(async (req, res) => {
  await replaceAvatar('user', req.user.id, null);
  await respondWithProfile(req, res);
}));

router.get('/me/sessions', handle(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, device_name, ip_address, created_at, last_active_at, expires_at FROM user_sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY COALESCE(last_active_at, created_at) DESC`,
    [req.user.id],
  );
  res.json({ sessions: rows.map((row) => ({ ...row, id: Number(row.id), current: Number(row.id) === Number(req.user.session_id) })) });
}));

router.delete('/me/sessions/:id', handle(async (req, res) => {
  const id = requireId(req.params.id, 'session');
  if (id === Number(req.user.session_id)) throw badRequest('Use “Log out” to end the session you are using.');
  const [result] = await pool.query(
    'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [id, req.user.id],
  );
  if (!result.affectedRows) throw notFound('Session not found.');
  realtime.disconnectUser(req.user.id);
  res.json({ message: 'Session ended.' });
}));

router.get('/me/notification-preferences', handle(async (req, res) => {
  res.json({ preferences: await readPreferences(req.user.id) });
}));

router.patch('/me/notification-preferences', handle(async (req, res) => {
  const updates = {};
  for (const key of ['desktop_enabled', 'sound_enabled', 'email_enabled']) {
    if (key in req.body) {
      if (typeof req.body[key] !== 'boolean') throw badRequest('Preferences must be on or off.');
      updates[key] = req.body[key] ? 1 : 0;
    }
  }
  if (!Object.keys(updates).length) throw badRequest('Nothing to update.');
  await readPreferences(req.user.id);
  await pool.query('UPDATE notification_preferences SET ? WHERE user_id = ?', [updates, req.user.id]);
  res.json({ preferences: await readPreferences(req.user.id) });
}));

router.get('/:id', handle(async (req, res) => {
  const id = requireId(req.params.id, 'user');
  const [rows] = await pool.query(
    `SELECT u.*, (c.contact_user_id IS NOT NULL) AS is_contact, c.is_favorite, c.nickname,
            EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = ? AND b.blocked_user_id = u.id) AS blocked_by_me,
            EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = u.id AND b.blocked_user_id = ?) AS blocked_me
     FROM users u LEFT JOIN user_contacts c ON c.owner_user_id = ? AND c.contact_user_id = u.id
     WHERE u.id = ? AND u.account_status <> 'deleted' LIMIT 1`,
    [req.user.id, req.user.id, req.user.id, id],
  );
  if (!rows.length) throw notFound('User not found.');
  const row = rows[0];
  const [[shared]] = await pool.query(
    `SELECT COUNT(*) AS total FROM conversation_members a
     JOIN conversation_members b ON b.conversation_id = a.conversation_id AND b.user_id = ? AND b.left_at IS NULL
     JOIN conversations c ON c.id = a.conversation_id AND c.type = 'group'
     WHERE a.user_id = ? AND a.left_at IS NULL`,
    [id, req.user.id],
  );
  res.json({
    user: {
      ...publicUser(row),
      is_contact: bool(row.is_contact),
      is_favorite: bool(row.is_favorite),
      nickname: row.nickname || '',
      blocked_by_me: bool(row.blocked_by_me),
      blocked_me: bool(row.blocked_me),
      shared_groups: Number(shared.total),
      created_at: row.created_at,
    },
  });
}));

module.exports = router;
