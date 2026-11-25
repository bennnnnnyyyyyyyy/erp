import { useCallback, useState } from 'react';

// Save waits while a date box holds a date that cannot be used (Ben, 25 Nov 2026: "block Save while a date box shows a bad date").
// A form calls useDateGuard(), passes `onBad={guard.watch('date')}` to each DateInput, and adds `guard.blocked` to its Save checks.
export function useDateGuard(): { blocked: boolean; watch: (key: string) => (bad: boolean) => void } {
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const watch = useCallback((key: string) => (isBad: boolean) => setBad((b) => (!!b[key] === isBad ? b : { ...b, [key]: isBad })), []);
  return { blocked: Object.values(bad).some(Boolean), watch };
}
