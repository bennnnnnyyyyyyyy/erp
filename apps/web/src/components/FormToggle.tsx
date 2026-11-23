import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLabChoice } from '../lib/labChoice';
import { newUi } from '../lib/uiMode';
import { Modal } from './Modal';
import { Button } from './ui/button';
import { tr, trf } from '../lib/i18n';

// A "create" form that stays closed until asked for. List screens used to open with a large form above the list, so the records people
// came to look at started half a screen down. The button sits where the form would be; the form opens in place and closes again.

export function FormToggle({ label, children, open: controlled, onOpenChange }: { label: string; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const set = (v: boolean) => { setOwn(v); onOpenChange?.(v); };
  if (!open) {
    return <div className="form-toggle"><Button onClick={() => set(true)}>{label}</Button></div>;
  }
  return (
    <div className="form-card stack">
      <div className="form-toggle-head">
        <h2>{label}</h2>
        <Button variant="ghost" size="sm" onClick={() => set(false)}>{tr('Close')}</Button>
      </div>
      {children}
    </div>
  );
}

/** A button for something that cannot be undone (voiding). The first click asks, in place, without a browser dialog; the second does it. */
// New UI (plan of 23 Nov 2026): how a risky action is confirmed, in three versions being decided (Design Lab "Confirm"). Used in many places
// (cancel an order, cancel a request, remove something), so one choice changes the whole app. The action itself is unchanged.
//   A  Ask in place: the button turns into the question with Yes and Cancel (the behaviour before the new UI).
//   B  Dialog: a small window with the question, a red Yes and Keep it.
//   C  Undo: the action waits 6 seconds with an Undo bar, then is sent; leaving the page sends it at once.
export function ConfirmButton({ label, confirmLabel, question, onConfirm, disabled, size }: { label: string; confirmLabel: string; question: string; onConfirm: () => void; disabled?: boolean; size?: 'sm' }) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(0);
  // The old UI always asks in place (its behaviour on main); only the new UI (lib/uiMode.ts) uses the versions being decided.
  const choice = useLabChoice('confirm', ['A', 'B', 'C'] as const, 'A');
  const version = newUi ? choice : 'A';
  const fire = useRef(onConfirm);
  fire.current = onConfirm;
  const pendingRef = useRef(0);
  pendingRef.current = pending;
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setPending((n) => n - 1), 1000);
    return () => window.clearInterval(t);
  }, [pending > 0]);
  useEffect(() => {
    if (pending === 1) {
      const t = window.setTimeout(() => { setPending(0); fire.current(); }, 1000);
      return () => window.clearTimeout(t);
    }
  }, [pending]);
  // Leaving the page while the Undo bar shows sends the action straight away, so nothing is silently lost.
  useEffect(() => () => { if (pendingRef.current) fire.current(); }, []);
  if (version === 'C') {
    if (pending > 0) {
      return (
        <div className="undo-bar" role="status">
          <span>{trf('{action} in {n} s', { action: label, n: pending })}</span>
          <Button variant="outline" size={size} onClick={() => setPending(0)}>{tr('Undo')}</Button>
        </div>
      );
    }
    return <Button variant="outline" size={size} disabled={disabled} onClick={() => setPending(6)}>{label}</Button>;
  }
  if (version === 'B') {
    return (
      <>
        <Button variant="outline" size={size} disabled={disabled} onClick={() => setAsking(true)}>{label}</Button>
        {asking && (
          <Modal title={label} onClose={() => setAsking(false)}>
            <p>{question}</p>
            <div className="form-actions">
              <Button variant="destructive" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
              <Button variant="outline" onClick={() => setAsking(false)}>{tr('Keep it')}</Button>
            </div>
          </Modal>
        )}
      </>
    );
  }
  if (!asking) return <Button variant="outline" size={size} disabled={disabled} onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <div className="confirm-row" role="group" aria-label={question}>
      <span>{question}</span>
      <Button variant="destructive" size={size} disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>{tr('Cancel')}</Button>
    </div>
  );
}
