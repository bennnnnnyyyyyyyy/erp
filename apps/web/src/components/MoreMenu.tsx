import { useEffect, useId, useRef, useState } from 'react';
import { buttonVariants } from './ui/button';

// A small "More" menu (Reports declutter, Ben 25 Nov 2026): actions most people need now and then (export, print, alert, delete) wait
// behind one button instead of a row of equal buttons. Closes on a choice, a click outside or Escape. Same .menu style as the user menu.

export type MoreItem = { label: string; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean };

export function MoreMenu({ label, items }: { label: string; items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div className="more-menu" ref={ref}>
      <button ref={button} type="button" className={buttonVariants({ variant: 'outline' })} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" id={menuId} role="menu">
          {shown.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'menu-item danger' : 'menu-item'}
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
