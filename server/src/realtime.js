// Holds the Socket.IO server so services can emit events without access to req.app.
let io = null;

module.exports = {
  setIo(instance) { io = instance; },
  getIo() { return io; },
  toUser(userId, event, payload) { io?.to(`user:${userId}`).emit(event, payload); },
  toUsers(userIds, event, payload) {
    if (!io || !userIds.length) return;
    io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
  },
  toConversation(conversationId, event, payload) { io?.to(`conversation:${conversationId}`).emit(event, payload); },
  joinConversation(userId, conversationId) { io?.in(`user:${userId}`).socketsJoin(`conversation:${conversationId}`); },
  leaveConversation(userId, conversationId) { io?.in(`user:${userId}`).socketsLeave(`conversation:${conversationId}`); },
  disconnectUser(userId) { io?.in(`user:${userId}`).disconnectSockets(true); },
};
