const cookie = require('cookie');
const pool = require('../db');
const { getCookieName, resolveSession } = require('../middleware/auth');
const { toId } = require('../utils/http');
const presence = require('./presence');
const messages = require('../services/messages');
const { getMembership } = require('../services/conversations');

const TYPING_LIMIT_MS = 400;

// Socket handlers reply through an ack callback: { ok: true, ... } or { ok: false, message }.
function respond(ack, work) {
  Promise.resolve()
    .then(work)
    .then((result) => typeof ack === 'function' && ack({ ok: true, ...(result || {}) }))
    .catch((error) => {
      if (!error.status) console.error('Socket handler error:', error);
      if (typeof ack === 'function') ack({ ok: false, message: error.status ? error.message : 'Something went wrong. Try again.' });
    });
}

// Users who share at least one conversation with this user and should hear about presence changes.
async function presenceAudience(userId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT other.user_id FROM conversation_members mine
     JOIN conversation_members other ON other.conversation_id = mine.conversation_id AND other.left_at IS NULL
     WHERE mine.user_id = ? AND mine.left_at IS NULL AND other.user_id <> ?`,
    [userId, userId],
  );
  return rows.map((row) => `user:${row.user_id}`);
}

function setupSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = cookie.parse(socket.handshake.headers.cookie || '')[getCookieName()];
      const user = await resolveSession(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (_error) {
      next(new Error('unauthorized'));
    }
  });

  // Listeners are registered synchronously below; this async setup runs after, so no early event is dropped.
  async function initialise(socket, userId) {
    try {
      const [memberships] = await pool.query('SELECT conversation_id FROM conversation_members WHERE user_id = ? AND left_at IS NULL', [userId]);
      socket.join(memberships.map((row) => `conversation:${row.conversation_id}`));
      if (socket.disconnected) return;

      const audience = await presenceAudience(userId);
      socket.emit('presence:initial', presence.onlineUserIds().filter((id) => audience.includes(`user:${id}`)));
      if (presence.add(userId, socket.id) && audience.length) {
        io.to(audience).emit('presence:update', { user_id: userId, online: true });
      }
      // Anything that arrived while this user was offline is now delivered.
      await messages.markDelivered(userId);
    } catch (error) {
      console.error('Socket setup failed:', error.message);
    }
  }

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const userId = Number(user.id);
    socket.join(`user:${userId}`);

    socket.on('conversation:join', (payload = {}, ack) => respond(ack, async () => {
      const conversationId = toId(payload.conversation_id);
      if (!conversationId || !(await getMembership(conversationId, userId))) return { joined: false };
      socket.join(`conversation:${conversationId}`);
      return { joined: true };
    }));

    socket.on('message:send', (payload = {}, ack) => respond(ack, async () => {
      const result = await messages.createMessage({
        conversationId: toId(payload.conversation_id),
        sender: user,
        body: payload.body,
        replyToId: payload.reply_to_message_id,
        attachmentIds: payload.attachment_ids,
        clientMessageId: payload.client_message_id,
      });
      return { message: result.message, duplicate: result.duplicate };
    }));

    socket.on('message:edit', (payload = {}, ack) => respond(ack, async () => ({
      message: await messages.editMessage(toId(payload.message_id), userId, payload.body),
    })));

    socket.on('message:delete', (payload = {}, ack) => respond(ack, async () => ({
      message: await messages.deleteMessage(toId(payload.message_id), userId),
    })));

    socket.on('reaction:add', (payload = {}, ack) => respond(ack, () => messages.setReaction(toId(payload.message_id), user, payload.emoji, true)));
    socket.on('reaction:remove', (payload = {}, ack) => respond(ack, () => messages.setReaction(toId(payload.message_id), user, payload.emoji, false)));

    socket.on('message:delivered', (payload = {}) => {
      const ids = Array.isArray(payload.message_ids) ? payload.message_ids : [payload.message_id];
      messages.markDelivered(userId, ids).catch(() => {});
    });

    socket.on('conversation:read', (payload = {}, ack) => respond(ack, async () => {
      const conversationId = toId(payload.conversation_id);
      if (conversationId) await messages.markRead(conversationId, userId);
    }));

    // Typing is never stored: it is relayed to the room only, rate-limited per socket.
    let lastTyping = 0;
    const relayTyping = (typing) => (payload = {}) => {
      const conversationId = toId(payload.conversation_id);
      const room = `conversation:${conversationId}`;
      if (!conversationId || !socket.rooms.has(room)) return;
      const now = Date.now();
      if (typing && now - lastTyping < TYPING_LIMIT_MS) return;
      lastTyping = now;
      socket.to(room).emit('typing:update', {
        conversation_id: conversationId, user_id: userId, display_name: user.display_name, typing,
      });
    };
    socket.on('typing:start', relayTyping(true));
    socket.on('typing:stop', relayTyping(false));

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('conversation:')) {
          socket.to(room).emit('typing:update', { conversation_id: Number(room.split(':')[1]), user_id: userId, typing: false });
        }
      }
    });

    socket.on('disconnect', async () => {
      if (!presence.remove(userId, socket.id)) return;
      try {
        await pool.query('UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [userId]);
        const audience = await presenceAudience(userId);
        if (audience.length) io.to(audience).emit('presence:update', { user_id: userId, online: false, last_seen_at: new Date().toISOString() });
      } catch (_error) { /* presence is best-effort */ }
    });

    initialise(socket, userId);
  });
}

module.exports = setupSockets;
