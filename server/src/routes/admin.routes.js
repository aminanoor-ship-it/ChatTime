const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { handle, badRequest, forbidden, notFound, requireId } = require('../utils/http');
const { avatarUrl } = require('../utils/files');
const { likePattern } = require('../utils/validation');
const { getSettings, updateSettings } = require('../services/settings');
const { deleteMessage } = require('../services/messages');
const { previewFor } = require('../services/conversations');
const { notify } = require('../services/notifications');
const presence = require('../sockets/presence');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const PAGE_SIZE = 20;
const page = (value) => Math.max(Number.parseInt(value, 10) || 1, 1);

async function audit(req, action, targetType, targetId, details = null) {
  await pool.query(
    'INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, action, targetType, targetId, details ? JSON.stringify(details) : null, req.ip],
  );
}

router.get('/dashboard', handle(async (req, res) => {
  const [[users]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(account_status = 'active') AS active, SUM(account_status = 'suspended') AS suspended,
            SUM(created_at > UTC_TIMESTAMP() - INTERVAL 7 DAY) AS new_this_week, SUM(role = 'admin') AS admins
     FROM users WHERE account_status <> 'deleted'`,
  );
  const [[conversations]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(type = 'group') AS groups_total, SUM(type = 'direct') AS direct_total FROM conversations",
  );
  const [[messages]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) AS last_24h
     FROM messages WHERE deleted_at IS NULL AND message_type <> 'system'`,
  );
  const [[reports]] = await pool.query("SELECT SUM(status = 'open') AS open, SUM(status = 'under_review') AS under_review FROM content_reports");
  const [daily] = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS total FROM messages
     WHERE created_at >= UTC_DATE() - INTERVAL 13 DAY AND message_type <> 'system'
     GROUP BY DATE(created_at) ORDER BY day`,
  );
  const [recentUsers] = await pool.query(
    "SELECT id, username, display_name, avatar_key, created_at FROM users WHERE account_status <> 'deleted' ORDER BY id DESC LIMIT 5",
  );
  const [storage] = await pool.query('SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS files FROM message_attachments WHERE message_id IS NOT NULL');

  const days = [];
  const counts = new Map(daily.map((row) => [new Date(row.day).toISOString().slice(0, 10), Number(row.total)]));
  for (let i = 13; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ day, total: counts.get(day) || 0 });
  }

  res.json({
    users: {
      total: Number(users.total), active: Number(users.active || 0), suspended: Number(users.suspended || 0),
      new_this_week: Number(users.new_this_week || 0), admins: Number(users.admins || 0), online_now: presence.onlineCount(),
    },
    conversations: { total: Number(conversations.total), groups: Number(conversations.groups_total || 0), direct: Number(conversations.direct_total || 0) },
    messages: { total: Number(messages.total), last_24h: Number(messages.last_24h || 0), daily: days },
    reports: { open: Number(reports.open || 0), under_review: Number(reports.under_review || 0) },
    storage: { bytes: Number(storage[0].bytes), files: Number(storage[0].files) },
    recent_users: recentUsers.map((row) => ({ ...row, id: Number(row.id), avatar_url: avatarUrl(row.avatar_key), avatar_key: undefined })),
  });
}));

router.get('/users', handle(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const where = ["u.account_status <> 'deleted'"];
  const params = [];
  if (q) {
    const pattern = likePattern(q);
    where.push('(u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)');
    params.push(pattern, pattern, pattern);
  }
  if (['active', 'suspended'].includes(req.query.status)) {
    where.push('u.account_status = ?');
    params.push(req.query.status);
  }
  if (['user', 'admin'].includes(req.query.role)) {
    where.push('u.role = ?');
    params.push(req.query.role);
  }
  const current = page(req.query.page);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.email, u.display_name, u.avatar_key, u.role, u.account_status, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()) AS active_sessions,
            (SELECT COUNT(*) FROM content_reports r WHERE r.target_type = 'user' AND r.target_id = u.id) AS reports_against
     FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (current - 1) * PAGE_SIZE],
  );
  const online = new Set(presence.onlineUserIds());
  res.json({
    users: rows.map((row) => ({
      id: Number(row.id), username: row.username, email: row.email, display_name: row.display_name,
      avatar_url: avatarUrl(row.avatar_key), role: row.role, account_status: row.account_status,
      created_at: row.created_at, last_seen_at: row.last_seen_at, online: online.has(Number(row.id)),
      active_sessions: Number(row.active_sessions), reports_against: Number(row.reports_against),
    })),
    page: current, pages: Math.max(Math.ceil(Number(total) / PAGE_SIZE), 1), total: Number(total),
  });
}));

async function loadTarget(req) {
  const id = requireId(req.params.id, 'user');
  if (id === Number(req.user.id)) throw badRequest('You cannot change your own account from the admin panel.');
  const [rows] = await pool.query("SELECT id, role, display_name, account_status FROM users WHERE id = ? AND account_status <> 'deleted'", [id]);
  if (!rows.length) throw notFound('User not found.');
  return rows[0];
}

async function revokeAllSessions(userId) {
  const [result] = await pool.query('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
  realtime.toUser(userId, 'account:signed_out', { message: 'You were signed out by an administrator.' });
  realtime.disconnectUser(userId);
  return result.affectedRows;
}

router.patch('/users/:id/status', handle(async (req, res) => {
  const target = await loadTarget(req);
  const { status } = req.body;
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!['active', 'suspended'].includes(status)) throw badRequest('Choose active or suspended.');
  if (target.role === 'admin' && status === 'suspended') throw forbidden('Remove admin access before suspending this account.');
  await pool.query('UPDATE users SET account_status = ? WHERE id = ?', [status, target.id]);
  if (status === 'suspended') {
    realtime.toUser(target.id, 'account:suspended', { message: 'Your account has been suspended.' });
    await revokeAllSessions(target.id);
  }
  await audit(req, status === 'suspended' ? 'user.suspend' : 'user.reactivate', 'user', target.id, { previous: target.account_status, reason: reason || undefined });
  res.json({ message: `${target.display_name} is now ${status}.` });
}));

router.patch('/users/:id/role', handle(async (req, res) => {
  const target = await loadTarget(req);
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) throw badRequest('Choose user or admin.');
  if (role === target.role) return res.json({ message: 'No change.' });
  if (role === 'admin' && target.account_status !== 'active') throw badRequest('Only active accounts can become admins.');
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
  await audit(req, 'user.role_change', 'user', target.id, { from: target.role, to: role });
  notify({
    userId: target.id, actorId: req.user.id, type: 'security',
    title: role === 'admin' ? 'You are now a ChatTime administrator' : 'Your administrator access was removed',
  }).catch(() => {});
  realtime.toUser(target.id, 'account:updated', {});
  res.json({ message: `${target.display_name} is now ${role === 'admin' ? 'an admin' : 'a regular user'}.` });
}));

router.post('/users/:id/revoke-sessions', handle(async (req, res) => {
  const target = await loadTarget(req);
  const count = await revokeAllSessions(target.id);
  await audit(req, 'user.revoke_sessions', 'user', target.id, { sessions: count });
  res.json({ message: `Ended ${count} session${count === 1 ? '' : 's'} for ${target.display_name}.` });
}));

// Reports show only the reported item itself — not the surrounding conversation.
async function describeTarget(type, id) {
  if (type === 'user') {
    const [[user]] = await pool.query('SELECT id, username, display_name, account_status, role FROM users WHERE id = ?', [id]);
    return user ? { kind: 'user', id: Number(user.id), label: `${user.display_name} (@${user.username})`, user_id: Number(user.id), account_status: user.account_status, role: user.role } : null;
  }
  if (type === 'message') {
    const [[message]] = await pool.query(
      `SELECT m.id, m.body, m.message_type, m.deleted_at, m.created_at, m.conversation_id, u.id AS sender_id,
              u.username, u.display_name, u.account_status, u.role
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
      [id],
    );
    if (!message) return null;
    const [files] = await pool.query('SELECT original_filename FROM message_attachments WHERE message_id = ?', [id]);
    return {
      kind: 'message', id: Number(message.id), label: `Message by ${message.display_name} (@${message.username})`,
      content: message.deleted_at ? null : (message.body || previewFor(message)), attachments: files.map((f) => f.original_filename),
      deleted: Boolean(message.deleted_at), sent_at: message.created_at, conversation_id: Number(message.conversation_id),
      user_id: Number(message.sender_id), account_status: message.account_status, role: message.role,
    };
  }
  const [[conversation]] = await pool.query(
    `SELECT c.id, c.type, c.name, c.description, c.created_by, (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.left_at IS NULL) AS members
     FROM conversations c WHERE c.id = ?`,
    [id],
  );
  return conversation ? {
    kind: 'conversation', id: Number(conversation.id),
    label: conversation.type === 'group' ? `Group “${conversation.name}”` : 'Private chat',
    content: conversation.type === 'group' ? conversation.description : null, members: Number(conversation.members),
    user_id: conversation.type === 'group' ? Number(conversation.created_by) : null,
  } : null;
}

router.get('/reports', handle(async (req, res) => {
  const where = [];
  const params = [];
  if (['open', 'under_review', 'resolved', 'dismissed'].includes(req.query.status)) {
    where.push('r.status = ?');
    params.push(req.query.status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const current = page(req.query.page);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM content_reports r ${clause}`, params);
  const [rows] = await pool.query(
    `SELECT r.*, rep.display_name AS reporter_name, rep.username AS reporter_username, rev.display_name AS reviewer_name
     FROM content_reports r JOIN users rep ON rep.id = r.reporter_user_id LEFT JOIN users rev ON rev.id = r.reviewed_by_user_id
     ${clause} ORDER BY FIELD(r.status, 'open', 'under_review', 'resolved', 'dismissed'), r.id DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (current - 1) * PAGE_SIZE],
  );
  const reports = await Promise.all(rows.map(async (row) => ({
    id: Number(row.id), target_type: row.target_type, target_id: Number(row.target_id), reason: row.reason,
    details: row.details, status: row.status, resolution_note: row.resolution_note,
    created_at: row.created_at, reviewed_at: row.reviewed_at, reviewer_name: row.reviewer_name,
    reporter: { id: Number(row.reporter_user_id), display_name: row.reporter_name, username: row.reporter_username },
    target: await describeTarget(row.target_type, row.target_id),
  })));
  res.json({ reports, page: current, pages: Math.max(Math.ceil(Number(total) / PAGE_SIZE), 1), total: Number(total) });
}));

router.patch('/reports/:id', handle(async (req, res) => {
  const id = requireId(req.params.id, 'report');
  const { status } = req.body;
  const note = String(req.body.resolution_note || '').trim();
  if (!['open', 'under_review', 'resolved', 'dismissed'].includes(status)) throw badRequest('Choose a valid status.');
  if (note.length > 1000) throw badRequest('Notes can be up to 1,000 characters.');
  const [[report]] = await pool.query('SELECT id, status, reporter_user_id FROM content_reports WHERE id = ?', [id]);
  if (!report) throw notFound('Report not found.');
  await pool.query(
    `UPDATE content_reports SET status = ?, resolution_note = ?, reviewed_by_user_id = ?,
       reviewed_at = IF(? IN ('resolved', 'dismissed'), UTC_TIMESTAMP(), reviewed_at) WHERE id = ?`,
    [status, note || null, req.user.id, status, id],
  );
  await audit(req, 'report.update', 'report', id, { from: report.status, to: status });
  if (['resolved', 'dismissed'].includes(status) && !['resolved', 'dismissed'].includes(report.status)) {
    notify({
      userId: report.reporter_user_id, type: 'system',
      title: status === 'resolved' ? 'Your report was reviewed and action was taken' : 'Your report was reviewed',
      body: 'Thank you for helping keep ChatTime safe.',
    }).catch(() => {});
  }
  res.json({ message: 'Report updated.' });
}));

router.post('/reports/:id/remove-message', handle(async (req, res) => {
  const id = requireId(req.params.id, 'report');
  const [[report]] = await pool.query("SELECT target_id FROM content_reports WHERE id = ? AND target_type = 'message'", [id]);
  if (!report) throw notFound('This report is not about a message.');
  await deleteMessage(report.target_id, req.user.id, { moderator: true });
  await audit(req, 'message.moderator_delete', 'message', report.target_id, { report_id: id });
  res.json({ message: 'Message removed.' });
}));

router.get('/settings', handle(async (req, res) => {
  res.json({ settings: await getSettings() });
}));

router.patch('/settings', handle(async (req, res) => {
  const { settings, changes } = await updateSettings(req.body, req.user.id);
  if (Object.keys(changes).length) await audit(req, 'settings.update', 'settings', null, changes);
  realtime.getIo()?.emit('settings:updated', {});
  res.json({ settings, message: 'Settings saved.' });
}));

router.get('/audit-logs', handle(async (req, res) => {
  const current = page(req.query.page);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_audit_logs');
  const [rows] = await pool.query(
    `SELECT l.*, a.display_name AS admin_name, a.username AS admin_username,
            CASE WHEN l.target_type = 'user' THEN (SELECT display_name FROM users WHERE id = l.target_id) END AS target_name
     FROM admin_audit_logs l JOIN users a ON a.id = l.admin_user_id ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    [PAGE_SIZE, (current - 1) * PAGE_SIZE],
  );
  res.json({
    logs: rows.map((row) => ({
      id: Number(row.id), action: row.action, target_type: row.target_type, target_id: row.target_id ? Number(row.target_id) : null,
      target_name: row.target_name, details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
      ip_address: row.ip_address, created_at: row.created_at, admin: { display_name: row.admin_name, username: row.admin_username },
    })),
    page: current, pages: Math.max(Math.ceil(Number(total) / PAGE_SIZE), 1),
  });
}));

module.exports = router;
