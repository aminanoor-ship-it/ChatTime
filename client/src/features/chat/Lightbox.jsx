import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

export default function Lightbox({ items, index: startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const item = items[index];

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, items.length - 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  const src = item.url || item.preview;
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Media viewer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="lightbox-bar">
        <span>{item.original_filename} · {index + 1} of {items.length}</span>
        {item.url && <a className="icon-btn" href={`${item.url}?download=1`} aria-label="Download"><Download size={20} /></a>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={22} /></button>
      </div>
      {index > 0 && <button type="button" className="lightbox-nav prev" onClick={() => setIndex(index - 1)} aria-label="Previous"><ChevronLeft size={28} /></button>}
      {item.kind === 'video'
        ? <video key={src} src={src} controls autoPlay className="lightbox-media" />
        : <img key={src} src={src} alt={item.original_filename} className="lightbox-media" />}
      {index < items.length - 1 && <button type="button" className="lightbox-nav next" onClick={() => setIndex(index + 1)} aria-label="Next"><ChevronRight size={28} /></button>}
    </div>,
    document.body,
  );
}
