const DAY = 86400000;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function formatClock(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

// Sidebar style: 10:24 · Yesterday · Mon · 12 Oct
export function formatListTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);
  if (diffDays === 0) return formatClock(date);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function formatDayLabel(value) {
  const date = new Date(value);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export const sameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export function formatLastSeen(value) {
  if (!value) return 'Offline';
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);
  if (diffDays === 0) return `Last seen today at ${formatClock(date)}`;
  if (diffDays === 1) return `Last seen yesterday at ${formatClock(date)}`;
  return `Last seen ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

export function formatRelative(value) {
  if (!value) return '';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return formatListTime(value);
}

// "Nov 01, 2023"
export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}

export function previewFor(message) {
  if (!message) return '';
  if (message.deleted_at) return 'Message deleted';
  switch (message.message_type) {
    case 'image': return message.body ? `📷 ${message.body}` : '📷 Photo';
    case 'audio': return '🎤 Voice message';
    case 'video': return message.body ? `🎬 ${message.body}` : '🎬 Video';
    case 'file': return message.body ? `📎 ${message.body}` : `📎 ${message.attachments?.[0]?.original_filename || 'File'}`;
    default: return message.body || '';
  }
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}
