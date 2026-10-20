const pool = require('../db');
const { forbidden, notFound, bool } = require('../utils/http');
const { avatarUrl } = require('../utils/files');
const realtime = require('../realtime');
const presence = require('../sockets/presence');

async function getMembership(conversationId, userId, db = pool) {
  const [rows] = await db.query(
    `SELECT cm.member_role, cm.is_muted, c.type, c.name
     FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.left_at IS NULL LIMIT 1`,
    [conversationId, userId],
  );
  return rows[0] || null;
}

async function requireMember(conversationId, userId, db = pool) {
  const membership = await getMembership(conversationId, userId, db);
  if (!membership) throw forbidden('You are not a member of this conversation.');
  return membership;
}

async function requireGroupManager(conversationId, userId, db = pool) {
  const membership = await requireMember(conversationId, userId, db);
  if (membership.type !== 'group') throw forbidden('This only applies to groups.');
  if (!['owner', 'admin'].includes(membership.member_role)) {
    throw forbidden('Only the group owner or an admin can do that.');
  }
  return membership;
}

// Adds someone to a group, or re-activates them if they were in it before.
async function activateMember(conn, conversationId, userId) {
  await conn.query(
    `INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES (?, ?, 'member')
     ON DUPLICATE KEY UPDATE left_at = NULL, member_role = 'member', joined_at = UTC_TIMESTAMP(), is_archived = 0`,
    [conversationId, userId],
  );
}

// Ends someone's membership (leave or removal); the row stays so history and re-joins work.
async function deactivateMember(conn, conversationId, userId) {
  await conn.query(
    "UPDATE conversation_members SET left_at = UTC_TIMESTAMP(), member_role = 'member', is_pinned = 0 WHERE conversation_id = ? AND user_id = ?",
    [conversationId, userId],
  );
}

async function activeMemberIds(conversationId, db = pool) {
  const [rows] = await db.query(
    'SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL',
    [conversationId],
  );
  return rows.map((row) => Number(row.user_id));
}

async function isBlockedBetween(userA, userB, db = pool) {
  const [rows] = await db.query(
    `SELECT 1 FROM user_blocks
     WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1`,
    [userA, userB, userB, userA],
  );
  return rows.length > 0;
}

// The other participant of a direct chat, or null for groups.
async function directPartnerId(conversationId, userId, db = pool) {
  const [rows] = await db.query(
    `SELECT CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END AS partner_id
     FROM direct_chat_pairs WHERE conversation_id = ? LIMIT 1`,
    [userId, conversationId],
  );
  return rows[0] ? Number(rows[0].partner_id) : null;
}

function previewFor(message) {
  if (message.deleted_at) return 'Message deleted';
  switch (message.message_type) {
    case 'image': return message.body ? `📷 ${message.body}` : '📷 Photo';
    case 'audio': return '🎤 Voice message';
    case 'video': return message.body ? `🎬 ${message.body}` : '🎬 Video';
    case 'file': return message.body ? `📎 ${message.body}` : '📎 File';
    default: return message.body || '';
  }
}

// Builds sidebar rows for one user: titles, partner info, unread counts and last-message details.
async function listConversations(userId, onlyConversationId = null) {
  const params = [userId, userId];
  let filter = '';
  if (onlyConversationId) {
    filter = 'AND c.id = ?';
    params.push(onlyConversationId);
  }
  const [rows] = await pool.query(
    `SELECT c.id, c.type, c.name, c.description, c.avatar_key, c.created_at, c.created_by,
            c.last_message_at, c.last_message_preview, c.pinned_message_id, c.join_policy, c.allow_member_invites,
            mine.member_role, mine.is_muted, mine.is_pinned, mine.is_archived, mine.joined_at,
            (SELECT COUNT(*) FROM message_receipts r JOIN messages um ON um.id = r.message_id
              WHERE r.user_id = mine.user_id AND r.status <> 'read' AND um.conversation_id = c.id
                AND um.deleted_at IS NULL) AS unread_count,
            (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id AND x.left_at IS NULL) AS member_count,
            (SELECT MAX(lm.id) FROM messages lm WHERE lm.conversation_id = c.id) AS last_message_id,
            other.id AS other_id, other.username AS other_username, other.display_name AS other_name,
            other.avatar_key AS other_avatar, other.bio AS other_bio, other.last_seen_at AS other_last_seen,
            other.account_status AS other_status
     FROM conversation_members mine
     JOIN conversations c ON c.id = mine.conversation_id
     LEFT JOIN direct_chat_pairs dp ON dp.conversation_id = c.id
     LEFT JOIN users other ON other.id = CASE WHEN dp.user_low_id = ? THEN dp.user_high_id ELSE dp.user_low_id END
     WHERE mine.user_id = ? AND mine.left_at IS NULL ${filter}
     ORDER BY mine.is_pinned DESC, COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT 300`,
    params,
  );

  const lastIds = rows.map((row) => row.last_message_id).filter(Boolean);
  const lastById = new Map();
  if (lastIds.length) {
    const [lastRows] = await pool.query(
      `SELECT m.id, m.sender_id, m.message_type, m.deleted_at, u.display_name AS sender_name,
              (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id) AS receipt_total,
              (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id AND r.status = 'read') AS read_count,
              (SELECT COUNT(*) FROM message_receipts r WHERE r.message_id = m.id AND r.status <> 'sent') AS delivered_count
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN (?)`,
      [lastIds],
    );
    for (const row of lastRows) lastById.set(Number(row.id), row);
  }

  const blockedIds = await blockedRelations(userId);

  return rows.map((row) => {
    const last = lastById.get(Number(row.last_message_id));
    const isDirect = row.type === 'direct';
    return {
      id: Number(row.id),
      type: row.type,
      title: isDirect ? row.other_name : row.name,
      description: row.description,
      avatar_url: isDirect ? avatarUrl(row.other_avatar) : avatarUrl(row.avatar_key),
      created_at: row.created_at,
      created_by: Number(row.created_by),
      last_message_at: row.last_message_at,
      last_message_preview: row.last_message_preview || '',
      last_message: last ? {
        id: Number(last.id),
        sender_id: Number(last.sender_id),
        sender_name: last.sender_name,
        message_type: last.message_type,
        status: aggregateStatus(last),
      } : null,
      pinned_message_id: row.pinned_message_id ? Number(row.pinned_message_id) : null,
      join_policy: row.join_policy,
      allow_member_invites: bool(row.allow_member_invites),
      member_role: row.member_role,
      member_count: Number(row.member_count),
      unread_count: Number(row.unread_count),
      is_muted: bool(row.is_muted),
      is_pinned: bool(row.is_pinned),
      is_archived: bool(row.is_archived),
      other_user: isDirect && row.other_id ? {
        id: Number(row.other_id),
        username: row.other_username,
        display_name: row.other_name,
        avatar_url: avatarUrl(row.other_avatar),
        bio: row.other_bio || '',
        last_seen_at: row.other_last_seen,
        online: presence.isOnline(row.other_id),
        account_status: row.other_status,
        blocked_by_me: blockedIds.byMe.has(Number(row.other_id)),
        blocked_me: blockedIds.me.has(Number(row.other_id)),
      } : null,
    };
  });
}

async function getConversationForUser(conversationId, userId) {
  const [conversation] = await listConversations(userId, conversationId);
  if (!conversation) throw notFound('Conversation not found.');
  return conversation;
}

async function blockedRelations(userId) {
  const [rows] = await pool.query(
    'SELECT blocker_user_id, blocked_user_id FROM user_blocks WHERE blocker_user_id = ? OR blocked_user_id = ?',
    [userId, userId],
  );
  const byMe = new Set();
  const me = new Set();
  for (const row of rows) {
    if (Number(row.blocker_user_id) === Number(userId)) byMe.add(Number(row.blocked_user_id));
    else me.add(Number(row.blocker_user_id));
  }
  return { byMe, me };
}

function aggregateStatus(row) {
  const total = Number(row.receipt_total);
  if (!total) return 'sent';
  if (Number(row.read_count) >= total) return 'read';
  if (Number(row.delivered_count) >= total) return 'delivered';
  return 'sent';
}

// Tells every member's client to re-fetch its own view of a conversation.
async function broadcastConversationRefresh(conversationId, extraUserIds = []) {
  const members = await activeMemberIds(conversationId);
  realtime.toUsers([...new Set([...members, ...extraUserIds])], 'conversation:refresh', { conversation_id: Number(conversationId) });
}

module.exports = {
  getMembership, requireMember, requireGroupManager, activateMember, deactivateMember, activeMemberIds, isBlockedBetween, directPartnerId,
  previewFor, listConversations, getConversationForUser, aggregateStatus, broadcastConversationRefresh,
};
