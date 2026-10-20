// Idempotent upgrades so a database created from an older copy of
// realtime_chat_schema.sql gains the columns ChatTime needs. Safe to run on every start.
const pool = require('./db');

async function columnInfo(table, column) {
  const [rows] = await pool.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows[0] || null;
}

async function constraintExists(name) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ? LIMIT 1`,
    [name],
  );
  return rows.length > 0;
}

async function migrate() {
  if (!(await columnInfo('conversations', 'pinned_message_id'))) {
    await pool.query('ALTER TABLE conversations ADD COLUMN pinned_message_id BIGINT UNSIGNED NULL AFTER last_message_preview');
    console.log('Migration: added conversations.pinned_message_id');
  }
  if (!(await constraintExists('fk_conversations_pinned_message'))) {
    await pool.query(
      `ALTER TABLE conversations ADD CONSTRAINT fk_conversations_pinned_message
       FOREIGN KEY (pinned_message_id) REFERENCES messages(id) ON DELETE SET NULL`,
    );
  }

  // Files are uploaded before the message that carries them is sent.
  const attachmentMessage = await columnInfo('message_attachments', 'message_id');
  if (attachmentMessage && attachmentMessage.IS_NULLABLE === 'NO') {
    await pool.query('ALTER TABLE message_attachments MODIFY message_id BIGINT UNSIGNED NULL');
    console.log('Migration: message_attachments.message_id is now nullable');
  }

  if (!(await columnInfo('user_sessions', 'last_active_at'))) {
    await pool.query('ALTER TABLE user_sessions ADD COLUMN last_active_at DATETIME NULL AFTER revoked_at');
  }
}

module.exports = migrate;
