const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const SHORT_SESSION_MS = 24 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function getCookieName() {
  return process.env.COOKIE_NAME || 'chat_session';
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

// Creates a session row and sets the signed cookie that points at it.
// "remember" keeps the user signed in for 30 days; otherwise the cookie ends with the browser session.
async function startSession(req, res, userId, remember = false) {
  const lifetime = remember ? LONG_SESSION_MS : SHORT_SESSION_MS;
  const tokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  const userAgent = String(req.get('user-agent') || '').slice(0, 512);
  const [result] = await pool.query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, device_name, user_agent, ip_address, expires_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP())`,
    [userId, tokenHash, describeDevice(userAgent), userAgent, req.ip, Math.floor(lifetime / 1000)],
  );
  const token = jwt.sign({ sub: String(userId), sid: String(result.insertId) }, process.env.JWT_SECRET, {
    expiresIn: Math.floor(lifetime / 1000),
  });
  res.cookie(getCookieName(), token, remember ? { ...cookieOptions(), maxAge: lifetime } : cookieOptions());
  return result.insertId;
}

function describeDevice(userAgent) {
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
      : /Firefox\//.test(userAgent) ? 'Firefox'
        : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const os = /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
      : /iPhone|iPad/.test(userAgent) ? 'iOS'
        : /Mac OS/.test(userAgent) ? 'macOS'
          : /Linux/.test(userAgent) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

function clearAuthCookie(res) {
  res.clearCookie(getCookieName(), cookieOptions());
}

// Verifies a session token and returns the active user, or null.
async function resolveSession(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_error) {
    return null;
  }
  if (!payload.sid) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.email, u.display_name, u.phone, u.avatar_key, u.bio, u.role,
            u.account_status, u.created_at, s.id AS session_id
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [payload.sid, payload.sub],
  );
  const user = rows[0];
  if (!user || user.account_status !== 'active') return null;
  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await resolveSession(req.cookies?.[getCookieName()]);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ message: 'Please sign in to continue.' });
    }
    req.user = user;
    // Cheap activity marker for the sessions list; at most one write per minute per session.
    pool.query(
      `UPDATE user_sessions SET last_active_at = UTC_TIMESTAMP()
       WHERE id = ? AND (last_active_at IS NULL OR last_active_at < UTC_TIMESTAMP() - INTERVAL 1 MINUTE)`,
      [user.session_id],
    ).catch(() => {});
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Administrator access is required.' });
  }
  next();
}

module.exports = {
  getCookieName, startSession, clearAuthCookie, resolveSession, requireAuth, requireAdmin,
};
