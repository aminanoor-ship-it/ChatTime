const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { withTransaction } = require('../db');
const { startSession, clearAuthCookie, requireAuth, resolveSession, getCookieName } = require('../middleware/auth');
const { handle, badRequest, HttpError } = require('../utils/http');
const { getSettings } = require('../services/settings');
const { publicSelf } = require('../services/users');
const realtime = require('../realtime');
const {
  USERNAME_PATTERN, EMAIL_PATTERN, PHONE_PATTERN, USERNAME_RULE, PHONE_RULE, passwordProblem,
} = require('../utils/validation');

const router = express.Router();

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 12);

function requireStrongPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem);
}

router.post('/register', handle(async (req, res) => {
  const settings = await getSettings();
  if (!settings.registration_open) throw new HttpError(403, 'New registrations are currently closed.');

  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const displayName = String(req.body.display_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (displayName.length < 2 || displayName.length > 80) throw badRequest('Full name must be 2–80 characters.');
  if (!USERNAME_PATTERN.test(username)) throw badRequest(USERNAME_RULE);
  if (!EMAIL_PATTERN.test(email) || email.length > 255) throw badRequest('Enter a valid email address.');
  if (phone && !PHONE_PATTERN.test(phone)) throw badRequest(PHONE_RULE);
  requireStrongPassword(password);
  if (req.body.accept_terms !== true) throw badRequest('Please agree to the Terms and Privacy Policy.');

  const passwordHash = await bcrypt.hash(password, 12);
  let userId;
  try {
    userId = await withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO users (username, email, password_hash, display_name, phone, role, account_status)
         VALUES (?, ?, ?, ?, ?, 'user', 'active')`,
        [username, email, passwordHash, displayName, phone || null],
      );
      await conn.query('INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)', [result.insertId]);
      return result.insertId;
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const field = String(error.message).includes('uq_users_email') ? 'email' : 'username';
      throw new HttpError(409, `That ${field} is already registered.`);
    }
    throw error;
  }

  await startSession(req, res, userId, false);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
  res.status(201).json({ user: publicSelf(rows[0]) });
}));

router.post('/login', handle(async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  if (!login || !password) throw badRequest('Enter your email or username and your password.');

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
    [login, login.toLowerCase()],
  );
  const user = rows[0];
  // Compare against a dummy hash when the account is missing so timing does not reveal it.
  const matches = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !matches) throw new HttpError(401, 'Incorrect email/username or password.');
  if (user.account_status !== 'active') {
    throw new HttpError(403, user.account_status === 'suspended'
      ? 'This account has been suspended. Contact support for help.'
      : 'This account is not active.');
  }
  await startSession(req, res, user.id, req.body.remember === true);
  res.json({ user: publicSelf(user) });
}));

router.get('/me', requireAuth, handle(async (req, res) => {
  res.json({ user: publicSelf(req.user) });
}));

router.post('/logout', handle(async (req, res) => {
  const user = await resolveSession(req.cookies?.[getCookieName()]);
  if (user) await pool.query('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ?', [user.session_id]);
  clearAuthCookie(res);
  res.json({ message: 'Signed out.' });
}));

// Always answers the same way so the form cannot be used to discover registered emails.
router.post('/forgot-password', handle(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const genericReply = { message: 'If that email is registered, a reset link is on its way.' };
  if (!EMAIL_PATTERN.test(email)) return res.json(genericReply);

  const [rows] = await pool.query("SELECT id FROM users WHERE email = ? AND account_status = 'active' LIMIT 1", [email]);
  if (rows.length) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))`,
      [rows[0].id, tokenHash],
    );
    const link = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
    // No email service is configured yet: the link is printed for the developer only.
    console.log(`\n[password reset] Link for ${email} (valid 30 minutes):\n${link}\n`);
  }
  res.json(genericReply);
}));

router.post('/reset-password', handle(async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw badRequest('This reset link is invalid or has expired.');
  requireStrongPassword(password);

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const userId = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
      [tokenHash],
    );
    if (!rows.length) throw badRequest('This reset link is invalid or has expired.');
    const passwordHash = await bcrypt.hash(password, 12);
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].user_id]);
    await conn.query('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [rows[0].user_id]);
    await conn.query('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [rows[0].user_id]);
    return rows[0].user_id;
  });
  realtime.disconnectUser(userId);
  res.json({ message: 'Password updated. You can now log in.' });
}));

router.post('/change-password', requireAuth, handle(async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current, rows[0].password_hash))) throw badRequest('Your current password is incorrect.');
  requireStrongPassword(next);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), req.user.id]);
  await pool.query(
    'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
    [req.user.id, req.user.session_id],
  );
  realtime.disconnectUser(req.user.id);
  res.json({ message: 'Password changed. Other devices have been signed out.' });
}));

module.exports = router;
