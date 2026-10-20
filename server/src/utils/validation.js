// Input rules shared by registration, profile edits and the admin bootstrap script.
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{6,25}$/;

const USERNAME_RULE = 'Username must be 3–30 characters: letters, numbers, dot, underscore or hyphen.';
const PHONE_RULE = 'Enter a valid phone number or leave it empty.';

// Returns a problem description, or null when the password is acceptable.
function passwordProblem(password) {
  if (password.length < 8 || password.length > 128) return 'Password must be 8–128 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Password needs both upper and lower case letters.';
  if (!/[0-9]/.test(password)) return 'Password needs at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password needs at least one symbol.';
  return null;
}

// Escapes LIKE wildcards so user input is matched literally.
const likePattern = (text) => `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;

module.exports = {
  USERNAME_PATTERN, EMAIL_PATTERN, PHONE_PATTERN, USERNAME_RULE, PHONE_RULE, passwordProblem, likePattern,
};
