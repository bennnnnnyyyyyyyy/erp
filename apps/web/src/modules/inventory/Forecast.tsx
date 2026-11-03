import { api } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { useLoad } from '../../lib/useLoad';
import { Link } from '../../lib/router';
import { Pill } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
// When will each item run out? From this organization's own issue history (sql/029). Items nobody issued in 90 days get no forecast.
// A date from thin data is a guess, and the screen says so.

type Row = {
  itemId: string; sku: string; name: string; uom: string; available: number; dailyRate: number; daysOfCover: number | null; runsOutOn: string | null;
  historyDays: number; issuesCount: number; confidence: 'good' | 'thin' | 'none'; leadDays: number; onOrder: number; suggestedOrder: number | null;
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-GB', { maximumFractionDigits: 2 }));

export function ForecastPage() {
  const data = useLoad(() => api<Row[]>('/v1/inventory/forecast'));
  if (!data.data) return <section className="page"><Loading error={data.error} /></section>;
  const rows = data.data;
  const used = rows.filter((r) => r.confidence !== 'none');
  const soon = used.filter((r) => (r.daysOfCover ?? 999) <= 14).length;
  const toOrder = used.filter((r) => (r.suggestedOrder ?? 0) > 0);
  const tone = (d: number | null) => (d === null ? 'ordered' : d <= 14 ? 'rejected' : d <= 30 ? 'submitted' : 'received');

  return (
    <section className="page wide">
      <h1>{tr('Stock forecast')}</h1>
      <p className="muted">{tr('When each item is likely to run out, based on the last 90 days.')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          { label: tr('Running out within 14 days'), value: String(soon), tone: soon > 0 ? 'text-destructive-foreground' : 'text-success-foreground' },
          { label: tr('Worth ordering now'), value: String(toOrder.length), tone: toOrder.length > 0 ? 'text-warning-foreground' : 'text-success-foreground' },
          { label: tr('Items with a forecast'), value: `${used.length} of ${rows.length}`, tone: '' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="text-sm font-medium text-muted-foreground">{k.label}</div>
            <div className={`mt-2 text-3xl font-semibold tracking-tight ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap mt-5"><table><thead><tr><th>{tr('Item')}</th><th className="right">{tr('Available')}</th><th className="right">{tr('Used per day')}</th><th>{tr('Runs out')}</th><th>{tr('How sure')}</th><th className="right">{tr('Supplier takes')}</th><th className="right">{tr('Already ordered')}</th><th className="right">{tr('Order now')}</th></tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.itemId}>
            <td>{r.sku} · {r.name}</td>
            <td className="right">{fmt(r.available)} {r.uom}</td>
            <td className="right">{r.confidence === 'none' ? '—' : fmt(r.dailyRate)}</td>
            <td>{r.runsOutOn ? <><Pill status={tone(r.daysOfCover)} label={trf('{n} days', { n: r.daysOfCover ?? '' })} /> <span className="muted small">{r.runsOutOn}</span></> : <span className="muted">{tr('no use in 90 days')}</span>}</td>
            <td>{r.confidence === 'good' ? <Pill status="received" label={tr('Solid history')} /> : r.confidence === 'thin' ? <span title={trf('{issues} issue(s) over {days} days', { issues: r.issuesCount, days: r.historyDays })}><Pill status="submitted" label={tr('Thin: a guess')} /></span> : ''}</td>
            <td className="right">{r.confidence === 'none' ? '' : trf('{n} days', { n: r.leadDays })}</td>
            <td className="right">{r.onOrder > 0 ? fmt(r.onOrder) : ''}</td>
            <td className="right">{r.suggestedOrder ? <b>{fmt(r.suggestedOrder)}</b> : ''}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={8} className="muted empty">{tr('No items yet.')}</td></tr>}
      </tbody></table></div>

      <p className="muted small">
        {tr('How it is worked out: usage per day = 50% of the latest 30 days + 30% of the 30 before + 20% of the 30 before that. Days left = available stock (on hand minus reserved) divided by usage per day. Order now = usage per day x (supplier lead time + 7 safety days) minus available minus what is already on order. The supplier time is the average of your own past purchases (7 days if the item was never bought). Seasonal swings are not modelled yet. To be told automatically, add an')} <Link to="/alerts">{tr('alert rule')}</Link>.
      </p>
    </section>
  );
}
