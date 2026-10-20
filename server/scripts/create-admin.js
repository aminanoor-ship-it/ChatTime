/**
 * Create the first administrator securely from environment variables.
 * Run from the server folder: npm run create-admin
 * Never commit a real .env file or share the administrator password.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const {
  USERNAME_PATTERN, EMAIL_PATTERN, USERNAME_RULE, passwordProblem,
} = require('../src/utils/validation');

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_DISPLAY_NAME'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment values: ${missing.join(', ')}`);
  process.exit(1);
}

async function main() {
  const username = process.env.ADMIN_USERNAME.trim();
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const displayName = process.env.ADMIN_DISPLAY_NAME.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(`ADMIN_USERNAME: ${USERNAME_RULE}`);
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('ADMIN_EMAIL is not a valid email address.');
  }
  // Administrators get a longer minimum on top of the normal password rules.
  const problem = password.length < 12 ? 'Password must be at least 12 characters long.' : passwordProblem(password);
  if (problem) {
    throw new Error(`ADMIN_PASSWORD: ${problem}`);
  }
  if (displayName.length < 2 || displayName.length > 80) {
    throw new Error('ADMIN_DISPLAY_NAME must be between 2 and 80 characters.');
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    const [existing] = await db.execute(
      'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email],
    );
    if (existing.length) {
      throw new Error('A user with this username or email already exists. No account was changed.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, display_name, role, account_status, email_verified_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', UTC_TIMESTAMP())`,
      [username, email, passwordHash, displayName],
    );

    console.log(`Administrator created successfully. User ID: ${result.insertId}`);
    console.log('Sign in using the configured admin username/email and password.');
    console.log('For safety, remove ADMIN_PASSWORD from the environment after creation and rotate it if it was exposed.');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`Could not create administrator: ${error.message}`);
  process.exitCode = 1;
});
