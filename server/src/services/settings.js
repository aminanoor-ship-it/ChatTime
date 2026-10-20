const pool = require('../db');
const { badRequest } = require('../utils/http');

const FILE_CATEGORIES = ['image', 'document', 'audio', 'video'];

const DEFAULTS = {
  max_upload_mb: 15,
  allowed_file_categories: FILE_CATEGORIES,
  message_edit_window_minutes: 15,
  max_group_members: 100,
  registration_open: true,
};

// Each setting validates and normalises the value an admin submits.
const VALIDATORS = {
  max_upload_mb: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw badRequest('Maximum upload size must be 1–50 MB.');
    return n;
  },
  allowed_file_categories: (value) => {
    if (!Array.isArray(value)) throw badRequest('Allowed file types must be a list.');
    const clean = [...new Set(value)].filter((item) => FILE_CATEGORIES.includes(item));
    if (clean.length !== value.length) throw badRequest('Unknown file type category.');
    return clean;
  },
  message_edit_window_minutes: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1440) throw badRequest('Edit window must be 0–1440 minutes.');
    return n;
  },
  max_group_members: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 3 || n > 1000) throw badRequest('Group size limit must be 3–1000.');
    return n;
  },
  registration_open: (value) => {
    if (typeof value !== 'boolean') throw badRequest('Registration setting must be on or off.');
    return value;
  },
};

let cache = null;
let cacheAt = 0;

async function getSettings() {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM app_settings');
  const merged = { ...DEFAULTS };
  for (const row of rows) {
    if (!(row.setting_key in DEFAULTS)) continue;
    const value = typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value;
    try {
      merged[row.setting_key] = VALIDATORS[row.setting_key](value);
    } catch (_error) { /* keep the default for a malformed stored value */ }
  }
  cache = merged;
  cacheAt = Date.now();
  return merged;
}

async function updateSettings(patch, adminId) {
  const changes = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!VALIDATORS[key]) throw badRequest(`Unknown setting: ${key}`);
    changes[key] = VALIDATORS[key](value);
  }
  for (const [key, value] of Object.entries(changes)) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by_user_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by_user_id = VALUES(updated_by_user_id)`,
      [key, JSON.stringify(value), adminId],
    );
  }
  cache = null;
  return { settings: await getSettings(), changes };
}

module.exports = { getSettings, updateSettings };
