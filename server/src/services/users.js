const { avatarUrl } = require('../utils/files');

// What a signed-in user may see about their own account.
function publicSelf(user) {
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email,
    display_name: user.display_name,
    phone: user.phone || '',
    bio: user.bio || '',
    avatar_url: avatarUrl(user.avatar_key),
    role: user.role,
    created_at: user.created_at,
  };
}

// What other users may see.
function publicUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    display_name: user.display_name,
    bio: user.bio || '',
    avatar_url: avatarUrl(user.avatar_key),
    last_seen_at: user.last_seen_at || null,
  };
}

module.exports = { publicSelf, publicUser };
