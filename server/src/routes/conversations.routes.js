const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { singleFile } = require('../middleware/upload');
const {
  handle, badRequest, forbidden, notFound, requireId, toId, HttpError,
} = require('../utils/http');
const { avatarUrl } = require('../utils/files');
const { replaceAvatar } = require('../services/avatars');
const { getSettings } = require('../services/settings');
const { notify } = require('../services/notifications');
const { publicUser } = require('../services/users');
const convo = require('../services/conversations');
const messages = require('../services/messages');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth);

const conversationId = (req) => requireId(req.params.id, 'conversation');

router.get('/', handle(async (req, res) => {
  res.json({ conversations: await convo.listConversations(req.user.id) });
}));

router.post('/direct', handle(async (req, res) => {
  const targetId = requireId(req.body.user_id, 'user');
  const me = Number(req.user.id);
  if (targetId === me) throw badRequest('Choose someone else to chat with.');
  const [targets] = await pool.query("SELECT id FROM users WHERE id = ? AND account_status = 'active' LIMIT 1", [targetId]);
  if (!targets.length) throw notFound('That user is not available.');

  const low = Math.min(me, targetId);
  const high = Math.max(me, targetId);
  const findExisting = async () => {
    const [rows] = await pool.query('SELECT conversation_id FROM direct_chat_pairs WHERE user_low_id = ? AND user_high_id = ?', [low, high]);
    return rows[0]?.conversation_id || null;
  };

  const existingId = await findExisting();
  if (existingId) {
    // Reopening an existing chat also un-archives it for the person opening it.
    await pool.query('UPDATE conversation_members SET is_archived = 0 WHERE conversation_id = ? AND user_id = ?', [existingId, me]);
    return res.json({ conversation: await convo.getConversationForUser(existingId, me), existing: true });
  }
  if (await convo.isBlockedBetween(me, targetId)) throw forbidden('You cannot start a chat with this person.');

  let newId;
  try {
    newId = await withTransaction(async (conn) => {
      const [created] = await conn.query("INSERT INTO conversations (type, created_by) VALUES ('direct', ?)", [me]);
      await conn.query(
        "INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES (?, ?, 'member'), (?, ?, 'member')",
        [created.insertId, me, created.insertId, targetId],
      );
      await conn.query('INSERT INTO direct_chat_pairs (user_low_id, user_high_id, conversation_id) VALUES (?, ?, ?)', [low, high, created.insertId]);
      return created.insertId;
    });
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    newId = await findExisting();
    return res.json({ conversation: await convo.getConversationForUser(newId, me), existing: true });
  }
  realtime.joinConversation(me, newId);
  realtime.joinConversation(targetId, newId);
  realtime.toUsers([me, targetId], 'conversation:refresh', { conversation_id: Number(newId) });
  res.status(201).json({ conversation: await convo.getConversationForUser(newId, me), existing: false });
}));

// Validates people being added to a group: active, not blocked with the adder, within the size limit.
async function validateNewMembers(userIds, adderId, conversationIdForLimit = null) {
  const ids = [...new Set(userIds.map(toId))];
  if (ids.some((id) => !id)) throw badRequest('One or more selected people are invalid.');
  if (!ids.length) return [];
  const [valid] = await pool.query("SELECT id, display_name FROM users WHERE id IN (?) AND account_status = 'active'", [ids]);
  if (valid.length !== ids.length) throw badRequest('One or more selected people are unavailable.');
  const [blocked] = await pool.query(
    `SELECT 1 FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id IN (?)) OR (blocked_user_id = ? AND blocker_user_id IN (?)) LIMIT 1`,
    [adderId, ids, adderId, ids],
  );
  if (blocked.length) throw forbidden('You cannot add someone you have blocked or who has blocked you.');
  const { max_group_members: limit } = await getSettings();
  const current = conversationIdForLimit ? (await convo.activeMemberIds(conversationIdForLimit)).length : 1;
  if (current + ids.length > limit) throw badRequest(`Groups can have up to ${limit} members.`);
  return valid;
}

router.post('/groups', handle(async (req, res) => {
  const me = Number(req.user.id);
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  if (name.length < 2 || name.length > 100) throw badRequest('Group name must be 2–100 characters.');
  if (description.length > 500) throw badRequest('Description can be up to 500 characters.');
  const requested = (Array.isArray(req.body.member_ids) ? req.body.member_ids : []).filter((id) => Number(id) !== me);
  const members = await validateNewMembers(requested, me);

  const { id, systemIds } = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      "INSERT INTO conversations (type, name, description, created_by) VALUES ('group', ?, ?, ?)",
      [name, description || null, me],
    );
    const rows = [[result.insertId, me, 'owner'], ...members.map((m) => [result.insertId, m.id, 'member'])];
    await conn.query('INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES ?', [rows]);
    const ids = [await messages.insertSystemMessage(conn, result.insertId, me, `${req.user.display_name} created the group “${name}”`)];
    if (members.length) {
      ids.push(await messages.insertSystemMessage(conn, result.insertId, me, `${req.user.display_name} added ${listNames(members)}`));
    }
    return { id: result.insertId, systemIds: ids };
  });

  for (const userId of [me, ...members.map((m) => Number(m.id))]) realtime.joinConversation(userId, id);
  for (const member of members) {
    notify({
      userId: member.id, actorId: me, type: 'member_added', conversationId: id,
      title: `${req.user.display_name} added you to ${name}`,
    }).catch(() => {});
  }
  for (const systemId of systemIds) await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id);
  res.status(201).json({ conversation: await convo.getConversationForUser(id, me) });
}));

function listNames(users) {
  const names = users.map((user) => user.display_name);
  if (names.length <= 3) return names.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

router.get('/:id', handle(async (req, res) => {
  const id = conversationId(req);
  const conversation = await convo.getConversationForUser(id, req.user.id);
  const pinned = conversation.pinned_message_id ? await messages.getMessagesByIds([conversation.pinned_message_id]) : [];
  res.json({ conversation: { ...conversation, pinned_message: pinned[0] || null } });
}));

router.patch('/:id', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireGroupManager(id, req.user.id);
  const updates = {};
  const notes = [];
  if ('name' in req.body) {
    const name = String(req.body.name || '').trim();
    if (name.length < 2 || name.length > 100) throw badRequest('Group name must be 2–100 characters.');
    updates.name = name;
    notes.push(`${req.user.display_name} renamed the group to “${name}”`);
  }
  if ('description' in req.body) {
    const description = String(req.body.description || '').trim();
    if (description.length > 500) throw badRequest('Description can be up to 500 characters.');
    updates.description = description || null;
    notes.push(`${req.user.display_name} updated the group description`);
  }
  if ('allow_member_invites' in req.body) updates.allow_member_invites = req.body.allow_member_invites ? 1 : 0;
  if ('join_policy' in req.body) {
    if (!['invite_only', 'link'].includes(req.body.join_policy)) throw badRequest('Invalid join policy.');
    updates.join_policy = req.body.join_policy;
  }
  if (!Object.keys(updates).length) throw badRequest('Nothing to update.');
  const systemIds = await withTransaction(async (conn) => {
    await conn.query('UPDATE conversations SET ? WHERE id = ?', [updates, id]);
    const ids = [];
    for (const note of notes) ids.push(await messages.insertSystemMessage(conn, id, req.user.id, note));
    return ids;
  });
  for (const systemId of systemIds) await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id);
  res.json({ conversation: await convo.getConversationForUser(id, req.user.id) });
}));

router.post('/:id/avatar', singleFile({ fixedLimitMb: 5 }), handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireGroupManager(id, req.user.id);
  const key = await replaceAvatar('group', id, req.file);
  await convo.broadcastConversationRefresh(id);
  res.json({ avatar_url: avatarUrl(key) });
}));

router.patch('/:id/preferences', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireMember(id, req.user.id);
  const updates = {};
  for (const key of ['is_muted', 'is_pinned', 'is_archived']) {
    if (key in req.body) updates[key] = req.body[key] ? 1 : 0;
  }
  if (!Object.keys(updates).length) throw badRequest('Nothing to update.');
  await pool.query('UPDATE conversation_members SET ? WHERE conversation_id = ? AND user_id = ?', [updates, id, req.user.id]);
  const conversation = await convo.getConversationForUser(id, req.user.id);
  realtime.toUser(req.user.id, 'conversation:refresh', { conversation_id: id });
  res.json({ conversation });
}));

router.get('/:id/members', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireMember(id, req.user.id);
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_key, u.bio, u.last_seen_at, cm.member_role, cm.joined_at
     FROM conversation_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = ? AND cm.left_at IS NULL
     ORDER BY FIELD(cm.member_role, 'owner', 'admin', 'member'), u.display_name`,
    [id],
  );
  res.json({ members: rows.map((row) => ({ ...publicUser(row), member_role: row.member_role, joined_at: row.joined_at })) });
}));

async function canInvite(id, userId) {
  const membership = await convo.requireMember(id, userId);
  if (membership.type !== 'group') throw forbidden('Members can only be added to groups.');
  if (['owner', 'admin'].includes(membership.member_role)) return membership;
  const [[settings]] = await pool.query('SELECT allow_member_invites FROM conversations WHERE id = ?', [id]);
  if (!settings.allow_member_invites) throw forbidden('Only the group owner or an admin can add people.');
  return membership;
}

router.post('/:id/members', handle(async (req, res) => {
  const id = conversationId(req);
  const membership = await canInvite(id, req.user.id);
  const current = new Set(await convo.activeMemberIds(id));
  const requested = (Array.isArray(req.body.user_ids) ? req.body.user_ids : []).filter((uid) => !current.has(Number(uid)));
  if (!requested.length) throw badRequest('Choose at least one person who is not already in the group.');
  const added = await validateNewMembers(requested, req.user.id, id);

  const systemId = await withTransaction(async (conn) => {
    for (const user of added) await convo.activateMember(conn, id, user.id);
    return messages.insertSystemMessage(conn, id, req.user.id, `${req.user.display_name} added ${listNames(added)}`);
  });
  for (const user of added) {
    realtime.joinConversation(user.id, id);
    notify({
      userId: user.id, actorId: req.user.id, type: 'member_added', conversationId: id,
      title: `${req.user.display_name} added you to ${membership.name}`,
    }).catch(() => {});
  }
  await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id);
  res.status(201).json({ message: `${added.length} ${added.length === 1 ? 'person' : 'people'} added.` });
}));

router.delete('/:id/members/:userId', handle(async (req, res) => {
  const id = conversationId(req);
  const targetId = requireId(req.params.userId, 'user');
  if (targetId === Number(req.user.id)) throw badRequest('Use “Leave group” to leave.');
  const manager = await convo.requireGroupManager(id, req.user.id);
  const target = await convo.getMembership(id, targetId);
  if (!target) throw notFound('That person is not in this group.');
  if (target.member_role === 'owner') throw forbidden('The group owner cannot be removed.');
  if (target.member_role === 'admin' && manager.member_role !== 'owner') throw forbidden('Only the owner can remove an admin.');

  const [[targetUser]] = await pool.query('SELECT display_name FROM users WHERE id = ?', [targetId]);
  const systemId = await withTransaction(async (conn) => {
    await convo.deactivateMember(conn, id, targetId);
    return messages.insertSystemMessage(conn, id, req.user.id, `${req.user.display_name} removed ${targetUser.display_name}`);
  });
  realtime.leaveConversation(targetId, id);
  await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id, [targetId]);
  res.json({ message: 'Member removed.' });
}));

router.patch('/:id/members/:userId', handle(async (req, res) => {
  const id = conversationId(req);
  const targetId = requireId(req.params.userId, 'user');
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) throw badRequest('Choose admin or member.');
  const me = await convo.requireMember(id, req.user.id);
  if (me.type !== 'group' || me.member_role !== 'owner') throw forbidden('Only the group owner can change roles.');
  const target = await convo.getMembership(id, targetId);
  if (!target || target.member_role === 'owner') throw badRequest('That role cannot be changed.');
  await pool.query('UPDATE conversation_members SET member_role = ? WHERE conversation_id = ? AND user_id = ?', [role, id, targetId]);
  const [[targetUser]] = await pool.query('SELECT display_name FROM users WHERE id = ?', [targetId]);
  const systemId = await withTransaction((conn) => messages.insertSystemMessage(
    conn, id, req.user.id,
    role === 'admin' ? `${req.user.display_name} made ${targetUser.display_name} an admin` : `${targetUser.display_name} is no longer an admin`,
  ));
  await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id);
  res.json({ message: 'Role updated.' });
}));

router.post('/:id/leave', handle(async (req, res) => {
  const id = conversationId(req);
  const me = Number(req.user.id);
  const membership = await convo.requireMember(id, me);
  if (membership.type !== 'group') throw badRequest('You can archive a private chat instead of leaving it.');

  const systemId = await withTransaction(async (conn) => {
    if (membership.member_role === 'owner') {
      // Hand ownership to the longest-serving admin, otherwise the longest-serving member.
      const [[successor]] = await conn.query(
        `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL AND user_id <> ?
         ORDER BY FIELD(member_role, 'admin', 'member'), joined_at LIMIT 1`,
        [id, me],
      );
      if (successor) await conn.query("UPDATE conversation_members SET member_role = 'owner' WHERE conversation_id = ? AND user_id = ?", [id, successor.user_id]);
    }
    await convo.deactivateMember(conn, id, me);
    return messages.insertSystemMessage(conn, id, me, `${req.user.display_name} left the group`);
  });
  realtime.leaveConversation(me, id);
  await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id, [me]);
  res.json({ message: 'You left the group.' });
}));

router.get('/:id/messages', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireMember(id, req.user.id);
  res.json(await messages.listMessages(id, { beforeId: req.query.before, afterId: req.query.after, limit: req.query.limit }));
}));

router.get('/:id/messages/search', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireMember(id, req.user.id);
  res.json({ messages: await messages.searchMessages(id, req.query.q) });
}));

// HTTP fallback for sending; the live client normally sends over Socket.IO.
router.post('/:id/messages', handle(async (req, res) => {
  const result = await messages.createMessage({
    conversationId: conversationId(req),
    sender: req.user,
    body: req.body.body,
    replyToId: req.body.reply_to_message_id,
    attachmentIds: req.body.attachment_ids,
    clientMessageId: req.body.client_message_id,
  });
  res.status(result.duplicate ? 200 : 201).json(result);
}));

router.post('/:id/read', handle(async (req, res) => {
  await messages.markRead(conversationId(req), req.user.id);
  res.json({ ok: true });
}));

router.put('/:id/pin', handle(async (req, res) => {
  const messageId = req.body.message_id === null ? null : requireId(req.body.message_id, 'message');
  res.json({ pinned_message: await messages.setPinnedMessage(conversationId(req), req.user.id, messageId) });
}));

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

router.get('/:id/shared', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireMember(id, req.user.id);
  const kind = req.query.kind;
  if (kind === 'links') {
    const [rows] = await pool.query(
      `SELECT m.id, m.body, m.created_at, u.display_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.body REGEXP 'https?://' ORDER BY m.id DESC LIMIT 60`,
      [id],
    );
    const links = rows.flatMap((row) => (row.body.match(URL_PATTERN) || []).map((url) => ({
      message_id: Number(row.id), url, sender_name: row.sender_name, created_at: row.created_at,
    })));
    return res.json({ items: links });
  }
  if (!['media', 'files'].includes(kind)) throw badRequest('Choose media, files or links.');
  const mediaClause = kind === 'media'
    ? "(a.mime_type LIKE 'image/%' OR a.mime_type LIKE 'video/%')"
    : "(a.mime_type NOT LIKE 'image/%' AND a.mime_type NOT LIKE 'video/%')";
  const [rows] = await pool.query(
    `SELECT a.*, m.id AS msg_id, u.display_name AS sender_name FROM message_attachments a
     JOIN messages m ON m.id = a.message_id JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND ${mediaClause}
     ORDER BY a.id DESC LIMIT 60`,
    [id],
  );
  res.json({
    items: rows.map((row) => ({ ...messages.serializeAttachment(row), message_id: Number(row.msg_id), sender_name: row.sender_name })),
  });
}));

router.post('/:id/invites', handle(async (req, res) => {
  const id = conversationId(req);
  await canInvite(id, req.user.id);
  const token = crypto.randomBytes(24).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const days = Math.min(Math.max(Number(req.body.expires_in_days) || 7, 1), 30);
  const maxUses = toId(req.body.max_uses);
  await pool.query(
    `INSERT INTO group_invites (conversation_id, invited_by, invite_token_hash, expires_at, max_uses)
     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?)`,
    [id, req.user.id, tokenHash, days, maxUses],
  );
  res.status(201).json({ token, expires_in_days: days, max_uses: maxUses });
}));

router.delete('/:id/invites', handle(async (req, res) => {
  const id = conversationId(req);
  await convo.requireGroupManager(id, req.user.id);
  await pool.query(
    'UPDATE group_invites SET revoked_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND revoked_at IS NULL AND invite_token_hash IS NOT NULL',
    [id],
  );
  res.json({ message: 'All invite links for this group have been turned off.' });
}));

// Invite-link preview and acceptance live on their own router: /api/invites/:token
const invites = express.Router();
invites.use(requireAuth);

async function findInvite(token, db = pool, lock = false) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token))) throw notFound('This invite link is invalid or has expired.');
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const [rows] = await db.query(
    `SELECT gi.*, c.name, c.description, c.avatar_key, u.display_name AS inviter_name
     FROM group_invites gi JOIN conversations c ON c.id = gi.conversation_id JOIN users u ON u.id = gi.invited_by
     WHERE gi.invite_token_hash = ? AND gi.revoked_at IS NULL
       AND (gi.expires_at IS NULL OR gi.expires_at > UTC_TIMESTAMP())
       AND (gi.max_uses IS NULL OR gi.use_count < gi.max_uses) LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [tokenHash],
  );
  if (!rows.length) throw notFound('This invite link is invalid or has expired.');
  return rows[0];
}

invites.get('/:token', handle(async (req, res) => {
  const invite = await findInvite(req.params.token);
  const members = await convo.activeMemberIds(invite.conversation_id);
  res.json({
    invite: {
      conversation_id: Number(invite.conversation_id),
      name: invite.name,
      description: invite.description,
      avatar_url: avatarUrl(invite.avatar_key),
      inviter_name: invite.inviter_name,
      member_count: members.length,
      already_member: members.includes(Number(req.user.id)),
    },
  });
}));

invites.post('/:token/accept', handle(async (req, res) => {
  const me = Number(req.user.id);
  const preview = await findInvite(req.params.token);
  const id = Number(preview.conversation_id);
  if (await convo.getMembership(id, me)) {
    return res.json({ conversation: await convo.getConversationForUser(id, me), already_member: true });
  }
  if (await convo.isBlockedBetween(me, preview.invited_by)) throw forbidden('You cannot join through this invite.');
  const { max_group_members: limit } = await getSettings();
  if ((await convo.activeMemberIds(id)).length >= limit) throw new HttpError(409, 'This group is full.');

  const systemId = await withTransaction(async (conn) => {
    const invite = await findInvite(req.params.token, conn, true);
    await conn.query('UPDATE group_invites SET use_count = use_count + 1, accepted_at = UTC_TIMESTAMP() WHERE id = ?', [invite.id]);
    await convo.activateMember(conn, id, me);
    return messages.insertSystemMessage(conn, id, me, `${req.user.display_name} joined using an invite link`);
  });
  realtime.joinConversation(me, id);
  await messages.emitMessage(systemId);
  await convo.broadcastConversationRefresh(id);
  res.json({ conversation: await convo.getConversationForUser(id, me), already_member: false });
}));

module.exports = { conversations: router, invites };
