// In-memory presence: user id -> set of socket ids. A user stays online while any tab is connected.
// With several server instances this would move to Redis.
const sockets = new Map();

module.exports = {
  add(userId, socketId) {
    const set = sockets.get(userId) || new Set();
    const cameOnline = set.size === 0;
    set.add(socketId);
    sockets.set(userId, set);
    return cameOnline;
  },
  remove(userId, socketId) {
    const set = sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size) return false;
    sockets.delete(userId);
    return true;
  },
  isOnline: (userId) => sockets.has(Number(userId)),
  onlineUserIds: () => [...sockets.keys()],
  onlineCount: () => sockets.size,
};
