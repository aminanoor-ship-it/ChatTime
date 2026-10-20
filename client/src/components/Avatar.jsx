import { initials } from '../lib/format';

// Soft initials backgrounds, picked stably from the id so a person keeps their colour.
const TONES = ['blue', 'teal', 'amber', 'violet', 'rose'];

export default function Avatar({ name, src, id = 0, size = 36, online = false, square = false, ring = false }) {
  const tone = square ? 'group' : TONES[Math.abs(Number(id) || hash(name)) % TONES.length];
  return (
    <span
      className={`avatar avatar-${tone} ${square ? 'avatar-square' : ''} ${ring ? 'avatar-ring' : ''}`}
      style={{ '--size': `${size}px` }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" loading="lazy" /> : initials(name)}
      {online && <i className="avatar-online" />}
    </span>
  );
}

function hash(value = '') {
  let total = 0;
  for (const char of String(value)) total = (total * 31 + char.charCodeAt(0)) | 0;
  return total;
}
