require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const pool = require('./db');
const migrate = require('./migrate');
const realtime = require('./realtime');
const setupSockets = require('./sockets');
const { requireAuth } = require('./middleware/auth');
const { ensureUploadDirs } = require('./utils/files');
const { getSettings } = require('./services/settings');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes');
const { contacts, blocks } = require('./routes/contacts.routes');
const { conversations, invites } = require('./routes/conversations.routes');
const messageRoutes = require('./routes/messages.routes');
const { uploads, media } = require('./routes/media.routes');
const notificationRoutes = require('./routes/notifications.routes');
const reportRoutes = require('./routes/reports.routes');
const adminRoutes = require('./routes/admin.routes');

const port = Number(process.env.PORT || 5000);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('CHANGE_') || process.env.JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET in server/.env to a random value of at least 32 characters before starting.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

const app = express();
const httpServer = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const io = new Server(httpServer, { cors: { origin: clientOrigin, credentials: true }, maxHttpBufferSize: 1e5 });
realtime.setIo(io);
setupSockets(io);

const limiter = (limit, minutes = 15) => rateLimit({
  windowMs: minutes * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Wait a little and try again.' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true, message: 'ChatTime backend is running' }));
app.get('/api/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, message: 'MySQL connection successful' });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    res.status(503).json({ ok: false, message: 'Could not connect to MySQL. Check server/.env and ensure MySQL is running.' });
  }
});

app.use(['/api/auth/login', '/api/auth/register'], limiter(30));
app.use(['/api/auth/forgot-password', '/api/auth/reset-password'], limiter(10));
app.use('/api/uploads', limiter(120));
app.use('/api/reports', limiter(20));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contacts);
app.use('/api/blocks', blocks);
app.use('/api/conversations', conversations);
app.use('/api/invites', invites);
app.use('/api/messages', messageRoutes);
app.use('/api/uploads', uploads);
app.use('/api/media', media);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

// Limits the client needs to show (upload size, allowed types, edit window).
app.get('/api/settings', requireAuth, async (_req, res, next) => {
  try {
    const { max_upload_mb, allowed_file_categories, message_edit_window_minutes, max_group_members } = await getSettings();
    res.json({ settings: { max_upload_mb, allowed_file_categories, message_edit_window_minutes, max_group_members } });
  } catch (error) { next(error); }
});

app.use('/api', (_req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((error, _req, res, _next) => {
  if (error.status && error.status < 500) return res.status(error.status).json({ message: error.message });
  if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed request.' });
  console.error(error);
  if (['ER_ACCESS_DENIED_ERROR', 'ECONNREFUSED', 'ER_BAD_DB_ERROR'].includes(error.code)) {
    return res.status(503).json({ message: 'The database is unavailable. Check your MySQL service and configuration.' });
  }
  res.status(500).json({ message: 'Unexpected server error. Check the backend terminal for details.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error(`Could not connect to MySQL (${error.code}): ${error.message}`);
    console.error('Check DB_HOST, DB_USER, DB_PASSWORD and DB_NAME in server/.env, and that the schema has been imported.');
    process.exit(1);
  }
  await migrate();
  await ensureUploadDirs();
  httpServer.listen(port, () => {
    console.log(`ChatTime backend running at http://localhost:${port}`);
    console.log(`Allowed frontend: ${clientOrigin}`);
  });
}

start().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});

function shutdown() {
  console.log('Shutting down ChatTime backend...');
  io.close();
  httpServer.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
