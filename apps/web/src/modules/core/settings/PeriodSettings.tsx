import { useEffect, useState } from 'react';
import type { OrgSettings } from '@erp/shared';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr } from '../../../lib/i18n';
import { useSession } from '../../../session';

// Settings > General: the closed-period lock date (sql/040, owners only) and the company's default payment terms (sql/041, owners and
// admins). Each saves through its own route; the database checks the role again and writes the audit row.

export function PeriodSettings({ org, onSaved }: { org: OrgSettings; onSaved: () => void }) {
  const session = useSession();
  const isOwner = session.role === 'owner';
  const canEdit = isOwner || session.role === 'admin';
  const [lockDate, setLockDate] = useState(org.lockDate ?? '');
  const [days, setDays] = useState(String(org.defaultPaymentTermsDays ?? 0));
  const [busy, setBusy] = useState<'lock' | 'terms' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setLockDate(org.lockDate ?? '');
    setDays(String(org.defaultPaymentTermsDays ?? 0));
  }, [org.lockDate, org.defaultPaymentTermsDays]);

  async function save(kind: 'lock' | 'terms', path: string, body: unknown) {
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      await api(path, { method: 'PUT', body: JSON.stringify(body) });
      setSaved(kind);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysNum = Number(days);
  const daysOk = days !== '' && Number.isInteger(daysNum) && daysNum >= 0 && daysNum <= 365;

  return (
    <div className="form-card stack">
      <h2>{tr('Closed periods and payment terms')}</h2>

      <label>
        {tr('Lock date')}
        <input type="date" max={today} value={lockDate} onChange={(e) => setLockDate(e.target.value)} disabled={!isOwner} />
        <span className="hint muted">
          {tr('Nothing dated on or before this day can be created or voided: invoices, supplier invoices, expenses and payments. Only an owner can change it, and every change is recorded in the audit log.')}
        </span>
      </label>
      {isOwner ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={busy !== null || lockDate === (org.lockDate ?? '')} onClick={() => save('lock', '/v1/core/org/lock-date', { date: lockDate || null })}>
            {busy === 'lock' ? tr('Saving…') : tr('Save lock date')}
          </Button>
          {org.lockDate ? (
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => save('lock', '/v1/core/org/lock-date', { date: null })}>
              {tr('Remove the lock')}
            </Button>
          ) : null}
          {saved === 'lock' ? <span className="muted">{tr('Saved.')}</span> : null}
        </div>
      ) : (
        <p className="muted small">{tr('Only an owner can change the lock date.')}</p>
      )}

      <label>
        {tr('Default payment terms (days)')}
        <input type="number" min={0} max={365} step={1} value={days} onChange={(e) => setDays(e.target.value)} disabled={!canEdit} />
        <span className="hint muted">{tr('Used when a customer or supplier has no terms of their own. An invoice is due this many days after its date.')}</span>
      </label>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={busy !== null || !daysOk || daysNum === (org.defaultPaymentTermsDays ?? 0)} onClick={() => save('terms', '/v1/core/org/payment-terms', { days: daysNum })}>
            {busy === 'terms' ? tr('Saving…') : tr('Save payment terms')}
          </Button>
          {saved === 'terms' ? <span className="muted">{tr('Saved.')}</span> : null}
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
