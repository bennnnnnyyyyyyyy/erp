import { DEFAULT_WORK_WEEK, type WorkWeek } from '@erp/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { useReloadSession, useSession } from '../../../session';

// The company's work week (sql/106; Ben, 23 Nov: "the company sets workday and clock-in times at the start"). Owners and admins; the
// database checks again and audits each change. "Remind me: next workday" in the low stock pop-up uses it. Shown in Settings > General
// and as a setup step (help/OnboardingStepsLate or the Getting started page).

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function WorkWeekCard({ onSaved }: { onSaved?: () => void }) {
  const session = useSession();
  const reload = useReloadSession();
  const saved: WorkWeek = session.org?.workWeek ?? DEFAULT_WORK_WEEK;
  const [days, setDays] = useState<number[]>(saved.days);
  const [start, setStart] = useState(saved.start);
  const [end, setEnd] = useState(saved.end);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await api('/v1/core/org/work-week', { method: 'PUT', body: JSON.stringify({ days, start, end }) });
      setNote({ ok: true, text: tr('Work week saved.') });
      reload();
      onSaved?.();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card stack" onSubmit={submit} aria-label={tr('Work week')}>
      <h2>{tr('Work week')}</h2>
      <p className="muted small">{tr('Your workdays and hours. Reminders such as "next workday" use them.')}</p>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">{tr('Workdays')}</legend>
        {DAYS.map((name, d) => (
          <label key={name} className="flex items-center gap-1">
            <input type="checkbox" checked={days.includes(d)} onChange={() => toggle(d)} />
            {tr(name)}
          </label>
        ))}
      </fieldset>
      <div className="form-row">
        <label>{tr('Work starts')}<input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>{tr('Work ends')}<input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {!days.length ? <p className="error small">{tr('Choose at least one workday.')}</p> : null}
      {days.length && start >= end ? <p className="error small">{tr('Work must start before it ends.')}</p> : null}
      <div className="form-actions">
        <Button type="submit" disabled={busy || !days.length || start >= end}>{busy ? tr('Saving…') : tr('Save work week')}</Button>
        {note ? <span className={note.ok ? 'muted small' : 'error small'} role="status">{note.text}</span> : null}
      </div>
      <p className="muted small">{trf('Now: {days}, {start} to {end}.', { days: saved.days.map((d) => tr(DAYS[d] ?? '')).join(', '), start: saved.start, end: saved.end })}</p>
    </form>
  );
}
