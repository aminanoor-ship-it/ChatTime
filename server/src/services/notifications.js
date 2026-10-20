const pool = require('../db');
const realtime = require('../realtime');
const { avatarUrl } = require('../utils/files');

function serializeNotification(row) {
  return {
    id: Number(row.id),
    type: row.type,
    title: row.title,
    body: row.body,
    conversation_id: row.conversation_id ? Number(row.conversation_id) : null,
    message_id: row.message_id ? Number(row.message_id) : null,
    read_at: row.read_at,
    created_at: row.created_at,
    actor: row.actor_id ? {
      id: Number(row.actor_id),
      display_name: row.actor_name,
      avatar_url: avatarUrl(row.actor_avatar),
    } : null,
  };
}

const SELECT_NOTIFICATIONS = `
  SELECT n.id, n.type, n.title, n.body, n.conversation_id, n.message_id, n.read_at, n.created_at,
         a.id AS actor_id, a.display_name AS actor_name, a.avatar_key AS actor_avatar
  FROM notifications n LEFT JOIN users a ON a.id = n.actor_user_id`;

// Stores a notification and pushes it live to the recipient's open tabs.
async function notify({ userId, actorId = null, type, conversationId = null, messageId = null, title, body = null }) {
  if (actorId && Number(actorId) === Number(userId)) return null;
  const [result] = await pool.query(
    `INSERT INTO notifications (user_id, actor_user_id, type, conversation_id, message_id, title, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, actorId, type, conversationId, messageId, String(title).slice(0, 120), body ? String(body).slice(0, 255) : null],
  );
  const [rows] = await pool.query(`${SELECT_NOTIFICATIONS} WHERE n.id = ?`, [result.insertId]);
  const notification = serializeNotification(rows[0]);
  realtime.toUser(userId, 'notification:new', notification);
  return notification;
}

module.exports = { notify, serializeNotification, SELECT_NOTIFICATIONS };
