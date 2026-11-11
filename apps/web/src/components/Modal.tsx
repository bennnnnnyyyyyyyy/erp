import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { tr } from '../lib/i18n';
import { nextTrapIndex, tabbableWithin } from './modalFocus';

// Rendered into document.body through a portal (Ben's walkthrough, 10 Nov 2026: "anything with a box is broken"). Drawn inside the
// page, a parent with an animation or transform turns `position: fixed` into "fixed inside that parent", so the dialog was squeezed
// into the list's area with its own scrollbar. At the body level it always covers the whole window.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves into the dialog on open, stays inside while it is open (Tab wraps), the page behind is inert, and focus goes back
  // to what had it before on close. Runs once per open: `onClose` is read through a ref so a re-render does not steal focus.
  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.hasAttribute('inert') ?? false;
    appRoot?.setAttribute('inert', '');
    // Prefer the first field or action in the body over the close button; fall back to the close button, then the dialog itself.
    const items = tabbableWithin(box);
    (items.find((el) => !el.classList.contains('icon-btn')) ?? items[0] ?? box).focus();

    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = tabbableWithin(box);
      const to = nextTrapIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      (list[to] ?? box).focus();
    };
    document.addEventListener('keydown', keys);
    // The page behind does not scroll while the dialog is open.
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keys);
      document.body.style.overflow = before;
      if (!wasInert) appRoot?.removeAttribute('inert');
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialog}>
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
