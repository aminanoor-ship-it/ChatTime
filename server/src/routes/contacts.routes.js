const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { handle, badRequest, notFound, requireId, bool } = require('../utils/http');
const { publicUser } = require('../services/users');
const realtime = require('../realtime');

const contacts = express.Router();
const blocks = express.Router();
contacts.use(requireAuth);
blocks.use(requireAuth);

async function requireOtherActiveUser(req) {
  const id = requireId(req.params.userId, 'user');
  if (id === Number(req.user.id)) throw badRequest('You cannot do that to your own account.');
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ? AND account_status <> 'deleted' LIMIT 1", [id]);
  if (!rows.length) throw notFound('User not found.');
  return id;
}

contacts.get('/', handle(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_key, u.bio, u.last_seen_at, c.nickname, c.is_favorite, c.created_at AS added_at
     FROM user_contacts c JOIN users u ON u.id = c.contact_user_id
     WHERE c.owner_user_id = ? AND u.account_status = 'active'
     ORDER BY c.is_favorite DESC, COALESCE(c.nickname, u.display_name) ASC`,
    [req.user.id],
  );
  res.json({
    contacts: rows.map((row) => ({ ...publicUser(row), nickname: row.nickname || '', is_favorite: bool(row.is_favorite), added_at: row.added_at })),
  });
}));

contacts.post('/:userId', handle(async (req, res) => {
  const id = await requireOtherActiveUser(req);
  await pool.query('INSERT IGNORE INTO user_contacts (owner_user_id, contact_user_id) VALUES (?, ?)', [req.user.id, id]);
  res.status(201).json({ message: 'Contact added.' });
}));

contacts.patch('/:userId', handle(async (req, res) => {
  const id = requireId(req.params.userId, 'user');
  const updates = {};
  if ('nickname' in req.body) {
    const nickname = String(req.body.nickname || '').trim();
    if (nickname.length > 80) throw badRequest('Nickname can be up to 80 characters.');
    updates.nickname = nickname || null;
  }
  if ('is_favorite' in req.body) updates.is_favorite = req.body.is_favorite ? 1 : 0;
  if (!Object.keys(updates).length) throw badRequest('Nothing to update.');
  const [result] = await pool.query('UPDATE user_contacts SET ? WHERE owner_user_id = ? AND contact_user_id = ?', [updates, req.user.id, id]);
  if (!result.affectedRows) throw notFound('Contact not found.');
  res.json({ message: 'Contact updated.' });
}));

contacts.delete('/:userId', handle(async (req, res) => {
  const id = requireId(req.params.userId, 'user');
  await pool.query('DELETE FROM user_contacts WHERE owner_user_id = ? AND contact_user_id = ?', [req.user.id, id]);
  res.json({ message: 'Contact removed.' });
}));

blocks.get('/', handle(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_key, u.bio, u.last_seen_at, b.created_at AS blocked_at
     FROM user_blocks b JOIN users u ON u.id = b.blocked_user_id WHERE b.blocker_user_id = ? ORDER BY b.created_at DESC`,
    [req.user.id],
  );
  res.json({ blocked: rows.map((row) => ({ ...publicUser(row), blocked_at: row.blocked_at })) });
}));

// Blocking stops new messages and invitations both ways; existing history stays visible.
async function refreshDirectChat(userId, otherId) {
  const low = Math.min(userId, otherId);
  const high = Math.max(userId, otherId);
  const [rows] = await pool.query('SELECT conversation_id FROM direct_chat_pairs WHERE user_low_id = ? AND user_high_id = ?', [low, high]);
  if (rows.length) {
    realtime.toUsers([userId, otherId], 'conversation:refresh', { conversation_id: Number(rows[0].conversation_id) });
  }
}

blocks.post('/:userId', handle(async (req, res) => {
  const id = await requireOtherActiveUser(req);
  await pool.query('INSERT IGNORE INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)', [req.user.id, id]);
  await refreshDirectChat(Number(req.user.id), id);
  res.status(201).json({ message: 'User blocked.' });
}));

blocks.delete('/:userId', handle(async (req, res) => {
  const id = requireId(req.params.userId, 'user');
  await pool.query('DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [req.user.id, id]);
  await refreshDirectChat(Number(req.user.id), id);
  res.json({ message: 'User unblocked.' });
}));

module.exports = { contacts, blocks };
