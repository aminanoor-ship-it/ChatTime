const pool = require('../db');
const { withTransaction } = require('../db');
const realtime = require('../realtime');
const { badRequest, forbidden, notFound, toId } = require('../utils/http');
const { avatarUrl, attachmentUrl, removeFile } = require('../utils/files');
const { likePattern } = require('../utils/validation');
const { getSettings } = require('./settings');
const { notify } = require('./notifications');
const {
  requireMember, directPartnerId, isBlockedBetween, previewFor, aggregateStatus,
} = require('./conversations');

const MAX_BODY = 4000;
const MAX_ATTACHMENTS = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMOJI_PATTERN = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u;

const SELECT_MESSAGES = `
  SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.message_type, m.body,
         m.reply_to_message_id, m.edited_at, m.deleted_at, m.created_at,
         u.display_name AS sender_name, u.username AS sender_username, u.avatar_key AS sender_avatar,
         (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id) AS receipt_total,
         (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id AND r.status = 'read') AS read_count,
         (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id AND r.status <> 'sent') AS delivered_count
  FROM messages m JOIN users u ON u.id = m.sender_id`;

function attachmentKind(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function serializeAttachment(row) {
  return {
    id: Number(row.id),
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
    kind: attachmentKind(row.mime_type),
    url: attachmentUrl(row.id),
    created_at: row.created_at,
  };
}

// Adds attachments, reactions, reply previews and delivery status to raw message rows.
async function hydrate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const replyIds = [...new Set(rows.map((row) => row.reply_to_message_id).filter(Boolean))];

  const [[attachments], [reactions], [replies]] = await Promise.all([
    pool.query('SELECT * FROM message_attachments WHERE message_id IN (?) ORDER BY id', [ids]),
    pool.query(
      `SELECT r.message_id, r.emoji, r.user_id, u.display_name FROM message_reactions r
       JOIN users u ON u.id = r.user_id WHERE r.message_id IN (?) ORDER BY r.created_at`,
      [ids],
    ),
    replyIds.length
      ? pool.query(
        `SELECT m.id, m.sender_id, m.message_type, m.body, m.deleted_at, u.display_name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN (?)`,
        [replyIds],
      )
      : [[]],
  ]);

  const attachmentsByMessage = groupBy(attachments, 'message_id');
  const reactionsByMessage = groupBy(reactions, 'message_id');
  const replyById = new Map(replies.map((reply) => [Number(reply.id), reply]));

  return rows.map((row) => {
    const deleted = Boolean(row.deleted_at);
    const reply = row.reply_to_message_id ? replyById.get(Number(row.reply_to_message_id)) : null;
    return {
      id: Number(row.id),
      conversation_id: Number(row.conversation_id),
      client_message_id: row.client_message_id,
      message_type: row.message_type,
      body: deleted ? null : row.body,
      sender: {
        id: Number(row.sender_id),
        display_name: row.sender_name,
        username: row.sender_username,
        avatar_url: avatarUrl(row.sender_avatar),
      },
      reply_to: reply ? {
        id: Number(reply.id),
        sender_id: Number(reply.sender_id),
        sender_name: reply.sender_name,
        preview: previewFor(reply).slice(0, 140),
        deleted: Boolean(reply.deleted_at),
      } : null,
      attachments: deleted ? [] : (attachmentsByMessage.get(Number(row.id)) || []).map(serializeAttachment),
      reactions: deleted ? [] : summarizeReactions(reactionsByMessage.get(Number(row.id)) || []),
      status: aggregateStatus(row),
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      created_at: row.created_at,
    };
  });
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = Number(row[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function summarizeReactions(rows) {
  const byEmoji = new Map();
  for (const row of rows) {
    if (!byEmoji.has(row.emoji)) byEmoji.set(row.emoji, { emoji: row.emoji, count: 0, user_ids: [], names: [] });
    const entry = byEmoji.get(row.emoji);
    entry.count += 1;
    entry.user_ids.push(Number(row.user_id));
    entry.names.push(row.display_name);
  }
  return [...byEmoji.values()];
}

async function getMessagesByIds(ids) {
  if (!ids.length) return [];
  const [rows] = await pool.query(`${SELECT_MESSAGES} WHERE m.id IN (?) ORDER BY m.id`, [ids]);
  return hydrate(rows);
}

async function getMessage(id) {
  const [message] = await getMessagesByIds([id]);
  if (!message) throw notFound('Message not found.');
  return message;
}

// Cursor pagination: newest page first, or the page before/after a message id.
async function listMessages(conversationId, { beforeId, afterId, limit = 40 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const params = [conversationId];
  let cursor = '';
  let order = 'DESC';
  if (toId(beforeId)) {
    cursor = 'AND m.id < ?';
    params.push(toId(beforeId));
  } else if (toId(afterId)) {
    cursor = 'AND m.id > ?';
    params.push(toId(afterId));
    order = 'ASC';
  }
  params.push(size + 1);
  const [rows] = await pool.query(
    `${SELECT_MESSAGES} WHERE m.conversation_id = ? ${cursor} ORDER BY m.id ${order} LIMIT ?`,
    params,
  );
  const hasMore = rows.length > size;
  const page = rows.slice(0, size);
  if (order === 'DESC') page.reverse();
  return { messages: await hydrate(page), has_more: hasMore };
}

async function searchMessages(conversationId, query) {
  const q = String(query || '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const [rows] = await pool.query(
    `${SELECT_MESSAGES} WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.message_type <> 'system'
     AND m.body LIKE ? ORDER BY m.id DESC LIMIT 50`,
    [conversationId, likePattern(q)],
  );
  return hydrate(rows);
}

async function assertCanPost(conversationId, userId, db = pool) {
  const membership = await requireMember(conversationId, userId, db);
  if (membership.type === 'direct') {
    const partnerId = await directPartnerId(conversationId, userId, db);
    if (partnerId && await isBlockedBetween(userId, partnerId, db)) {
      throw forbidden('You can no longer send messages in this chat because a block is active.');
    }
  }
  return membership;
}

function messageTypeFor(attachmentRows) {
  if (!attachmentRows.length) return 'text';
  const kinds = new Set(attachmentRows.map((row) => attachmentKind(row.mime_type)));
  if (kinds.size === 1) {
    const [kind] = kinds;
    return kind === 'file' ? 'file' : kind;
  }
  return 'file';
}

// Persists a message, attaches uploads, creates recipient receipts, then broadcasts after commit.
async function createMessage({ conversationId, sender, body, replyToId, attachmentIds = [], clientMessageId }) {
  const text = typeof body === 'string' ? body.trim() : '';
  const fileIds = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : []).map(toId))];
  if (fileIds.some((id) => !id)) throw badRequest('Invalid attachment.');
  if (fileIds.length > MAX_ATTACHMENTS) throw badRequest(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
  if (!text && !fileIds.length) throw badRequest('Message cannot be empty.');
  if (text.length > MAX_BODY) throw badRequest(`Messages can be up to ${MAX_BODY.toLocaleString()} characters.`);
  const clientId = clientMessageId && UUID_PATTERN.test(clientMessageId) ? clientMessageId.toLowerCase() : null;

  const membership = await assertCanPost(conversationId, sender.id);

  if (clientId) {
    const [existing] = await pool.query(
      'SELECT id FROM messages WHERE conversation_id = ? AND sender_id = ? AND client_message_id = ? LIMIT 1',
      [conversationId, sender.id, clientId],
    );
    if (existing.length) return { message: await getMessage(existing[0].id), duplicate: true };
  }

  const replyId = toId(replyToId);
  if (replyId) {
    const [reply] = await pool.query('SELECT id FROM messages WHERE id = ? AND conversation_id = ? LIMIT 1', [replyId, conversationId]);
    if (!reply.length) throw badRequest('The message you replied to is not in this conversation.');
  }

  let messageId;
  try {
    messageId = await withTransaction(async (conn) => {
      let attachmentRows = [];
      if (fileIds.length) {
        [attachmentRows] = await conn.query(
          `SELECT id, mime_type FROM message_attachments
           WHERE id IN (?) AND uploaded_by = ? AND message_id IS NULL FOR UPDATE`,
          [fileIds, sender.id],
        );
        if (attachmentRows.length !== fileIds.length) throw badRequest('One or more attachments are unavailable. Upload them again.');
      }
      const type = messageTypeFor(attachmentRows);
      const [result] = await conn.query(
        `INSERT INTO messages (conversation_id, sender_id, client_message_id, message_type, body, reply_to_message_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conversationId, sender.id, clientId, type, text || null, replyId],
      );
      if (fileIds.length) {
        await conn.query('UPDATE message_attachments SET message_id = ? WHERE id IN (?)', [result.insertId, fileIds]);
      }
      const preview = previewFor({ message_type: type, body: text }).replace(/\s+/g, ' ').slice(0, 255);
      await conn.query(
        'UPDATE conversations SET last_message_at = UTC_TIMESTAMP(), last_message_preview = ? WHERE id = ?',
        [preview, conversationId],
      );
      await conn.query(
        `INSERT INTO message_receipts (message_id, user_id, status)
         SELECT ?, user_id, 'sent' FROM conversation_members
         WHERE conversation_id = ? AND left_at IS NULL AND user_id <> ?`,
        [result.insertId, conversationId, sender.id],
      );
      return result.insertId;
    });
  } catch (error) {
    // A retry raced the first attempt: return the stored copy instead of failing.
    if (error.code === 'ER_DUP_ENTRY' && clientId) {
      const [existing] = await pool.query(
        'SELECT id FROM messages WHERE conversation_id = ? AND sender_id = ? AND client_message_id = ? LIMIT 1',
        [conversationId, sender.id, clientId],
      );
      if (existing.length) return { message: await getMessage(existing[0].id), duplicate: true };
    }
    throw error;
  }

  const message = await getMessage(messageId);
  realtime.toConversation(conversationId, 'message:new', message);
  if (membership.type === 'group' && text) notifyMentions(conversationId, membership.name, sender, text, messageId).catch(() => {});
  return { message, duplicate: false };
}

async function notifyMentions(conversationId, groupName, sender, text, messageId) {
  const usernames = [...new Set([...text.matchAll(/@([A-Za-z0-9_.-]{3,30})/g)].map((match) => match[1]))].slice(0, 10);
  if (!usernames.length) return;
  const [rows] = await pool.query(
    `SELECT u.id FROM users u JOIN conversation_members cm ON cm.user_id = u.id
     WHERE cm.conversation_id = ? AND cm.left_at IS NULL AND u.username IN (?) AND u.id <> ?`,
    [conversationId, usernames, sender.id],
  );
  for (const row of rows) {
    await notify({
      userId: row.id, actorId: sender.id, type: 'mention', conversationId, messageId,
      title: `${sender.display_name} mentioned you in ${groupName}`, body: text.slice(0, 200),
    });
  }
}

// Group events ("Hodan added Yusuf") are stored as system messages inside the caller's transaction.
async function insertSystemMessage(conn, conversationId, actorId, text) {
  const [result] = await conn.query(
    "INSERT INTO messages (conversation_id, sender_id, message_type, body) VALUES (?, ?, 'system', ?)",
    [conversationId, actorId, text],
  );
  await conn.query(
    'UPDATE conversations SET last_message_at = UTC_TIMESTAMP(), last_message_preview = ? WHERE id = ?',
    [text.slice(0, 255), conversationId],
  );
  return result.insertId;
}

async function emitMessage(messageId) {
  const message = await getMessage(messageId);
  realtime.toConversation(message.conversation_id, 'message:new', message);
  return message;
}

async function loadOwnedMessage(messageId, userId) {
  const [rows] = await pool.query(
    'SELECT id, conversation_id, sender_id, message_type, body, deleted_at, created_at FROM messages WHERE id = ? LIMIT 1',
    [messageId],
  );
  const row = rows[0];
  if (!row) throw notFound('Message not found.');
  await requireMember(row.conversation_id, userId);
  return row;
}

async function editMessage(messageId, userId, body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw badRequest('Message cannot be empty.');
  if (text.length > MAX_BODY) throw badRequest(`Messages can be up to ${MAX_BODY.toLocaleString()} characters.`);
  const row = await loadOwnedMessage(messageId, userId);
  if (Number(row.sender_id) !== Number(userId)) throw forbidden('You can only edit your own messages.');
  if (row.deleted_at || row.message_type === 'system') throw badRequest('This message cannot be edited.');
  if (row.message_type === 'audio') throw badRequest('Voice messages cannot be edited.');
  const { message_edit_window_minutes: windowMinutes } = await getSettings();
  const ageMinutes = (Date.now() - new Date(row.created_at).getTime()) / 60000;
  if (windowMinutes === 0 || ageMinutes > windowMinutes) {
    throw forbidden(windowMinutes === 0 ? 'Editing messages is turned off.' : `Messages can only be edited within ${windowMinutes} minutes.`);
  }
  await pool.query('UPDATE messages SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?', [text, messageId]);
  await refreshPreviewIfLatest(row.conversation_id, messageId);
  const message = await getMessage(messageId);
  realtime.toConversation(row.conversation_id, 'message:updated', message);
  return message;
}

// Soft-deletes a message. Senders delete their own; moderators pass { moderatorId }.
async function deleteMessage(messageId, userId, { moderator = false } = {}) {
  const [rows] = await pool.query('SELECT id, conversation_id, sender_id, deleted_at FROM messages WHERE id = ? LIMIT 1', [messageId]);
  const row = rows[0];
  if (!row) throw notFound('Message not found.');
  if (!moderator) {
    await requireMember(row.conversation_id, userId);
    if (Number(row.sender_id) !== Number(userId)) throw forbidden('You can only delete your own messages.');
  }
  if (row.deleted_at) return getMessage(messageId);

  const [files] = await pool.query('SELECT storage_key FROM message_attachments WHERE message_id = ?', [messageId]);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE messages SET body = NULL, deleted_at = UTC_TIMESTAMP() WHERE id = ?', [messageId]);
    await conn.query('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);
    await conn.query('DELETE FROM message_attachments WHERE message_id = ?', [messageId]);
    await conn.query('UPDATE conversations SET pinned_message_id = NULL WHERE pinned_message_id = ?', [messageId]);
  });
  await Promise.all(files.map((file) => removeFile('files', file.storage_key)));
  await refreshPreviewIfLatest(row.conversation_id, messageId);
  const message = await getMessage(messageId);
  realtime.toConversation(row.conversation_id, 'message:updated', message);
  realtime.toConversation(row.conversation_id, 'conversation:pinned', { conversation_id: Number(row.conversation_id), message: null, only_if_id: Number(messageId) });
  return message;
}

async function refreshPreviewIfLatest(conversationId, messageId) {
  const [[latest]] = await pool.query(
    'SELECT id, message_type, body, deleted_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
    [conversationId],
  );
  if (latest && Number(latest.id) === Number(messageId)) {
    await pool.query('UPDATE conversations SET last_message_preview = ? WHERE id = ?', [previewFor(latest).slice(0, 255), conversationId]);
  }
}

async function setReaction(messageId, user, emoji, add) {
  const value = String(emoji || '');
  if (!value || value.length > 16 || !EMOJI_PATTERN.test(value)) throw badRequest('Choose a valid emoji.');
  const row = await loadOwnedMessage(messageId, user.id);
  if (row.deleted_at || row.message_type === 'system') throw badRequest('You cannot react to this message.');
  if (add) {
    const [count] = await pool.query('SELECT COUNT(*) AS total FROM message_reactions WHERE message_id = ? AND user_id = ?', [messageId, user.id]);
    if (Number(count[0].total) >= 6) throw badRequest('You can add up to 6 reactions to a message.');
    const [result] = await pool.query('INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [messageId, user.id, value]);
    if (result.affectedRows && Number(row.sender_id) !== Number(user.id)) {
      notify({
        userId: row.sender_id, actorId: user.id, type: 'message_reaction', conversationId: row.conversation_id, messageId,
        title: `${user.display_name} reacted ${value} to your message`, body: row.body ? row.body.slice(0, 200) : null,
      }).catch(() => {});
    }
  } else {
    await pool.query('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [messageId, user.id, value]);
  }
  const [reactions] = await pool.query(
    `SELECT r.message_id, r.emoji, r.user_id, u.display_name FROM message_reactions r
     JOIN users u ON u.id = r.user_id WHERE r.message_id = ? ORDER BY r.created_at`,
    [messageId],
  );
  const payload = { message_id: Number(messageId), conversation_id: Number(row.conversation_id), reactions: summarizeReactions(reactions) };
  realtime.toConversation(row.conversation_id, 'message:reactions', payload);
  return payload;
}

async function emitStatuses(messageIds) {
  if (!messageIds.length) return;
  const [rows] = await pool.query(
    `SELECT m.id, m.conversation_id,
       (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id) AS receipt_total,
       (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id AND r.status = 'read') AS read_count,
       (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id AND r.status <> 'sent') AS delivered_count
     FROM messages m WHERE m.id IN (?)`,
    [messageIds],
  );
  const byConversation = groupBy(rows, 'conversation_id');
  for (const [conversationId, list] of byConversation) {
    realtime.toConversation(conversationId, 'message:status', {
      conversation_id: conversationId,
      statuses: list.map((row) => ({ id: Number(row.id), status: aggregateStatus(row) })),
    });
  }
}

// Marks everything the user has received in a conversation as read.
async function markRead(conversationId, userId) {
  await requireMember(conversationId, userId);
  const [pending] = await pool.query(
    `SELECT r.message_id FROM message_receipts r JOIN messages m ON m.id = r.message_id
     WHERE r.user_id = ? AND m.conversation_id = ? AND r.status <> 'read' ORDER BY r.message_id DESC LIMIT 500`,
    [userId, conversationId],
  );
  await pool.query(
    `UPDATE message_receipts r JOIN messages m ON m.id = r.message_id
     SET r.status = 'read', r.read_at = UTC_TIMESTAMP(), r.delivered_at = COALESCE(r.delivered_at, UTC_TIMESTAMP())
     WHERE r.user_id = ? AND m.conversation_id = ? AND r.status <> 'read'`,
    [userId, conversationId],
  );
  await pool.query(
    'UPDATE conversation_members SET last_read_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId],
  );
  realtime.toUser(userId, 'conversation:read', { conversation_id: Number(conversationId) });
  await emitStatuses(pending.map((row) => Number(row.message_id)));
}

// Marks messages as delivered to this user's device; with no ids, everything still pending.
async function markDelivered(userId, messageIds = null) {
  const params = [userId];
  let filter = '';
  if (messageIds) {
    const ids = messageIds.map(toId).filter(Boolean).slice(0, 200);
    if (!ids.length) return;
    filter = 'AND message_id IN (?)';
    params.push(ids);
  }
  const [pending] = await pool.query(
    `SELECT message_id FROM message_receipts WHERE user_id = ? AND status = 'sent' ${filter} ORDER BY message_id DESC LIMIT 500`,
    params,
  );
  if (!pending.length) return;
  const ids = pending.map((row) => Number(row.message_id));
  await pool.query(
    "UPDATE message_receipts SET status = 'delivered', delivered_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'sent' AND message_id IN (?)",
    [userId, ids],
  );
  await emitStatuses(ids);
}

async function setPinnedMessage(conversationId, userId, messageId) {
  const membership = await requireMember(conversationId, userId);
  if (membership.type === 'group' && !['owner', 'admin'].includes(membership.member_role)) {
    throw forbidden('Only the group owner or an admin can pin messages.');
  }
  let message = null;
  if (messageId) {
    const [rows] = await pool.query(
      "SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL AND message_type <> 'system'",
      [messageId, conversationId],
    );
    if (!rows.length) throw badRequest('That message cannot be pinned.');
    message = await getMessage(messageId);
  }
  await pool.query('UPDATE conversations SET pinned_message_id = ? WHERE id = ?', [message ? message.id : null, conversationId]);
  realtime.toConversation(conversationId, 'conversation:pinned', { conversation_id: Number(conversationId), message });
  return message;
}

module.exports = {
  getMessagesByIds, listMessages, searchMessages, createMessage, insertSystemMessage,
  emitMessage, editMessage, deleteMessage, setReaction, markRead, markDelivered, setPinnedMessage,
  serializeAttachment,
};
