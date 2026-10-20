import { io } from 'socket.io-client';

// One shared connection; it authenticates with the HttpOnly session cookie.
export const socket = io({ autoConnect: false, withCredentials: true, transports: ['websocket', 'polling'] });

// Emits an event and resolves with the server's ack, rejecting on { ok: false } or timeout.
export function request(event, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) return reject(Object.assign(new Error('The server did not respond. Check your connection.'), { ok: false }));
      if (!response?.ok) return reject(Object.assign(new Error(response?.message || 'Something went wrong.'), { ok: false }));
      resolve(response);
    });
  });
}
