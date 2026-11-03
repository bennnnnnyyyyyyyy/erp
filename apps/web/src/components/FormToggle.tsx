import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { tr } from '../lib/i18n';

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
export function ConfirmButton({ label, confirmLabel, question, onConfirm, disabled }: { label: string; confirmLabel: string; question: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button variant="outline" disabled={disabled} onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <div className="confirm-row" role="group" aria-label={question}>
      <span>{question}</span>
      <Button variant="destructive" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button variant="ghost" onClick={() => setAsking(false)}>{tr('Cancel')}</Button>
    </div>
  );
}
