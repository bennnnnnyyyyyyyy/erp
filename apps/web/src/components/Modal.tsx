import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { tr } from '../lib/i18n';

// Rendered into document.body through a portal (Ben's walkthrough, 10 Nov 2026: "anything with a box is broken"). Drawn inside the
// page, a parent with an animation or transform turns `position: fixed` into "fixed inside that parent", so the dialog was squeezed
// into the list's area with its own scrollbar. At the body level it always covers the whole window.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    // The page behind does not scroll while the dialog is open.
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = before;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
