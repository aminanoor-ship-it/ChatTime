import { useEffect, useRef, useState } from 'react';

// Small dropdown: a trigger button plus a list of { label, icon, onClick, danger, hidden } items.
export default function Menu({ trigger, items, align = 'right', label = 'More options', buttonClassName = 'icon-btn' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((item) => item && !item.hidden);
  if (!visible.length) return null;

  return (
    <div className="menu" ref={ref}>
      <button type="button" className={buttonClassName} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu-list menu-${align}`} role="menu">
          {visible.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                onClick={() => { setOpen(false); item.onClick(); }}
              >
                {Icon && <Icon size={17} />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
