import { useState } from 'react';
import type { ReportSource, ReportTotal } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr } from '../../lib/i18n';
import { parseAmount } from '../../lib/numbers';
import { useSession } from '../../session';
import { headerLabel } from './cells';

// Reports & Insights, step 5 (sql/111): "Alert me when" one of a saved company report's totals goes above or below a limit. It becomes
// an alert rule (switch it off or retire it on the Alerts page). The database refuses recipients who may not see the report's data.

const PERIODS = [
  ['today', 'Today'],
  ['last_7', 'Last 7 days'],
  ['this_month', 'This month'],
  ['last_30', 'Last 30 days'],
] as const;
const REPEATS = [
  [1, 'Every hour at most'],
  [24, 'Once a day at most'],
  [168, 'Once a week at most'],
] as const;
type Who = 'me' | 'owners' | 'owners_admins';

export function ReportAlert({ reportId, reportName, totals, source, onClose }: { reportId: string; reportName: string; totals: ReportTotal[]; source: ReportSource; onClose: (message: string | null) => void }) {
  const session = useSession();
  const [total, setTotal] = useState(totals[0] ? `${totals[0].fn}_${totals[0].column}` : '');
  const [compare, setCompare] = useState<'above' | 'below'>('above');
  const [limit, setLimit] = useState('');
  const [currency, setCurrency] = useState(session.org?.defaultCurrency ?? 'EGP');
  const [period, setPeriod] = useState<string>(source.period ? 'this_month' : '');
  const [repeat, setRepeat] = useState(24);
  const [who, setWho] = useState<Who>('me');
  const [name, setName] = useState(reportName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = totals.find((t) => `${t.fn}_${t.column}` === total);
  const isMoney = chosen ? chosen.fn !== 'count' && source.columns.find((c) => c.key === chosen.column)?.type === 'money' : false;
  const number = parseAmount(limit);

  async function create() {
    setError(null);
    if (!Number.isFinite(number)) return setError(tr('Give the limit as a number.'));
    setBusy(true);
    const recipients =
      who === 'me'
        ? [{ type: 'user', id: session.userId }]
        : who === 'owners'
          ? [{ type: 'role', role: 'owner' }]
          : [{ type: 'role', role: 'owner' }, { type: 'role', role: 'admin' }];
    try {
      await api(`/v1/reports/saved/${reportId}/alert`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          total,
          compare,
          // money is stored in minor units, like every amount
          threshold: isMoney ? Math.round(number * 100) : number,
          currency: isMoney ? currency.trim().toUpperCase() : null,
          period: source.period ? period || null : null,
          repeatHours: repeat,
          recipients,
        }),
      });
      onClose(tr('Alert made. You can switch it off on the Alerts page.'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="report-panel no-print">
      <legend>{tr('Alert me when')}</legend>
      <div className="report-row">
        <label>
          {tr('Total')}
          <select value={total} onChange={(e) => setTotal(e.target.value)}>
            {totals.map((t) => <option key={`${t.fn}_${t.column}`} value={`${t.fn}_${t.column}`}>{headerLabel(`${t.fn}_${t.column}`)}</option>)}
          </select>
        </label>
        <label>
          {tr('Goes')}
          <select value={compare} onChange={(e) => setCompare(e.target.value as 'above' | 'below')}>
            <option value="above">{tr('above')}</option>
            <option value="below">{tr('below')}</option>
          </select>
        </label>
        <label>
          {tr('Limit')}
          <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        {isMoney && (
          <label>
            {tr('Currency')}
            <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />
          </label>
        )}
        {source.period && (
          <label>
            {tr('Checked for')}
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="report-row">
        <label>
          {tr('Tell')}
          <select value={who} onChange={(e) => setWho(e.target.value as Who)}>
            <option value="me">{tr('Only me')}</option>
            <option value="owners">{tr('All owners')}</option>
            <option value="owners_admins">{tr('All owners and admins')}</option>
          </select>
        </label>
        <label>
          {tr('How often')}
          <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
            {REPEATS.map(([h, l]) => <option key={h} value={h}>{tr(l)}</option>)}
          </select>
        </label>
        <label>
          {tr('Name')}
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <p className="muted small">{tr('Checked every few minutes. Only people who may see this report’s data can be told.')}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="report-actions">
        <Button disabled={busy || !total || !name.trim() || limit.trim() === ''} onClick={create}>{busy ? tr('Working…') : tr('Make the alert')}</Button>
        <Button variant="ghost" onClick={() => onClose(null)}>{tr('Cancel')}</Button>
      </div>
    </fieldset>
  );
}
