import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../lib/i18n';
import { NEXT_STEP_EVENT, type NextStep } from '../lib/nextStep';
import { Link, usePath } from '../lib/router';

// The page that unblocks a blocked action (lib/nextStep.ts): after an error that a page fixes, a small bar at the bottom offers that
// page, only when the person can open it (Ben, 25 Nov 2026). It goes away when the person moves on or closes it.

export function NextStepBar({ canOpen }: { canOpen: (path: string) => boolean }) {
  const [step, setStep] = useState<NextStep | null>(null);
  const path = usePath();
  const can = useRef(canOpen);
  can.current = canOpen;
  useEffect(() => {
    const show = (e: Event) => {
      const next = (e as CustomEvent<NextStep>).detail;
      setStep(next?.to && can.current(next.to) ? next : null);
    };
    window.addEventListener(NEXT_STEP_EVENT, show);
    return () => window.removeEventListener(NEXT_STEP_EVENT, show);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page closes the bar
  useEffect(() => setStep(null), [path]);
  if (!step?.to || typeof document === 'undefined') return null;
  return createPortal(
    <div className="next-step-bar" role="status">
      <span>{tr(step.text)}</span>
      <Link to={step.to} className="next-step-link">{`${tr('Open')}: ${tr(step.label ?? '')}`}</Link>
      <button type="button" onClick={() => setStep(null)} aria-label={tr('Close')}>×</button>
    </div>,
    document.body,
  );
}
