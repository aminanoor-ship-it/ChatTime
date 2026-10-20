const pool = require('../db');
const { badRequest } = require('../utils/http');
const { detectFile, randomKey, saveBuffer, removeFile } = require('../utils/files');

const OWNERS = { user: 'users', group: 'conversations' };

// Sets (or with no file, clears) the photo of a user or group and deletes the old file.
async function replaceAvatar(owner, id, file = null) {
  const table = OWNERS[owner];
  let key = null;
  if (file) {
    const { ext, category } = await detectFile(file.buffer, file.originalname, file.mimetype);
    if (category !== 'image') throw badRequest('Photos must be JPG, PNG, GIF or WebP images.');
    key = randomKey(ext);
    await saveBuffer('avatars', key, file.buffer);
  }
  const [[previous]] = await pool.query(`SELECT avatar_key FROM ${table} WHERE id = ?`, [id]);
  await pool.query(`UPDATE ${table} SET avatar_key = ? WHERE id = ?`, [key, id]);
  await removeFile('avatars', previous?.avatar_key);
  return key;
}

module.exports = { replaceAvatar };
