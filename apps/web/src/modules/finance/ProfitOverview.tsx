import { formatMoney } from '@erp/shared';
import { formatWhole } from '../../lib/money';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useLoad } from '../../lib/useLoad';

// The big version of the "Am I making or losing money?" card: 12 months of sales against total costs, the result for each month,
// and the year in one line. Same numbers as the home page (sql/027, insights_home). A management view, not statutory accounts.

type Month = { month: string; revenue: number; cogs: number; expenses: number; net: number };
type Insights = { currency: string; asOf: string; months: Month[] };

const monthShort = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLong = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 1,250,000 becomes "1.25M"; money axis labels, whole currency units. */
function compact(minor: number): string {
  const v = Math.abs(minor) / 100;
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${+(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}

export function ProfitOverviewPage() {
  const data = useLoad(() => api<Insights>('/v1/finance/insights'));
  if (data.error) return <section className="page"><p className="error">{data.error}</p></section>;
  const s = data.data;
  if (!s) return <section className="page"><p className="muted">Loading…</p></section>;

  const money = (n: number) => formatMoney({ amountMinor: n, currency: s.currency });
  const whole = (n: number) => formatWhole(n, s.currency);
  const months = s.months;
  const sum = (k: 'revenue' | 'cogs' | 'expenses' | 'net') => months.reduce((n, m) => n + m[k], 0);
  const revenue = sum('revenue'), costs = sum('cogs') + sum('expenses'), net = sum('net');
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;
  const lossMonths = months.filter((m) => m.net < 0).length;
  const best = months.reduce((a, m) => (m.net > a.net ? m : a), months[0]!);
  const worst = months.reduce((a, m) => (m.net < a.net ? m : a), months[0]!);

  // chart geometry
  const W = 1000, H = 360, L = 64, R = 16, T = 16, B = 40;
  const peak = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.cogs + m.expenses)));
  const nice = (() => { const mag = 10 ** Math.floor(Math.log10(peak)); const f = peak / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; })();
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const slot = (W - L - R) / months.length;
  const bar = Math.min(26, slot * 0.34);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => nice * f);

  return (
    <section className="page wide">
      <h1>Profit overview</h1>
      <p className="muted">Sales against what it cost to make and run the business, month by month. Cost of goods is the average cost of the stock that was sold; running costs are the expenses you recorded. No VAT. Not an accounts report.</p>

      <div className="mt-5 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 17rem), 1fr))' }}>
        {[
          { label: 'Result, last 12 months', value: `${net < 0 ? 'Lost ' : 'Made '}${whole(Math.abs(net))}`, tone: net < 0 ? 'text-destructive-foreground' : 'text-success-foreground', note: `${margin.toFixed(1)}% of sales` },
          { label: 'Sales', value: whole(revenue), tone: '', note: 'invoiced to customers' },
          { label: 'Costs', value: whole(costs), tone: '', note: `${whole(sum('cogs'))} of goods sold + ${whole(sum('expenses'))} running costs` },
          { label: 'Months in the red', value: `${lossMonths} of ${months.length}`, tone: lossMonths > 0 ? 'text-destructive-foreground' : 'text-success-foreground', note: `Best ${monthLong(best.month)}, weakest ${monthLong(worst.month)}` },
        ].map((k) => (
          <div key={k.label} className="min-w-0 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
            <div className="text-sm font-medium text-muted-foreground">{k.label}</div>
            <div className={cn('mt-2 break-words font-semibold leading-tight tracking-tight', k.tone)} style={{ fontSize: 'clamp(1.35rem, 2.1vw, 1.875rem)' }}>{k.value}</div>
            <div className="mt-1 break-words text-xs text-muted-foreground">{k.note}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold">Sales vs costs, every month</h2>
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm" style={{ background: 'var(--success)' }} />Sales</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm" style={{ background: 'var(--muted-foreground)', opacity: 0.55 }} />Costs</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales and costs per month for the last 12 months" className="mt-3 h-auto w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted-foreground)">{compact(t)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = L + slot * i + slot / 2;
            const cost = m.cogs + m.expenses;
            return (
              <g key={m.month}>
                <title>{`${monthLong(m.month)}: sales ${money(m.revenue)}, costs ${money(cost)}, result ${money(m.net)}`}</title>
                <rect x={cx - bar - 2} y={y(m.revenue)} width={bar} height={Math.max(0, y(0) - y(m.revenue))} rx="3" fill="var(--success)" />
                <rect x={cx + 2} y={y(cost)} width={bar} height={Math.max(0, y(0) - y(cost))} rx="3" fill="var(--muted-foreground)" opacity="0.55" />
                <text x={cx} y={H - 16} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{monthShort(m.month)}</text>
                <circle cx={cx} cy={H - 4} r="3.5" fill={m.net < 0 ? 'var(--destructive)' : 'var(--success)'} />
              </g>
            );
          })}
        </svg>
        <p className="mt-1 text-xs text-muted-foreground">The dot under each month is green when you made money that month and red when you lost money. Hover a month for its figures.</p>
      </div>

      <h2 className="related">Month by month</h2>
      <div className="table-wrap"><table><thead><tr><th>Month</th><th className="right">Sales</th><th className="right">Cost of goods</th><th className="right">Running costs</th><th className="right">Result</th><th className="right">Margin</th></tr></thead><tbody>
        {[...months].reverse().map((m) => (
          <tr key={m.month}><td>{monthLong(m.month)}</td><td className="right">{money(m.revenue)}</td><td className="right">{money(m.cogs)}</td><td className="right">{money(m.expenses)}</td>
            <td className={cn('right font-semibold', m.net < 0 ? 'text-destructive-foreground' : m.revenue + m.expenses > 0 ? 'text-success-foreground' : 'text-muted-foreground')}>{m.revenue + m.expenses === 0 ? 'nothing recorded' : money(m.net)}</td>
            <td className="right muted">{m.revenue > 0 ? `${((m.net / m.revenue) * 100).toFixed(1)}%` : ''}</td></tr>
        ))}
        <tr><td><b>Last 12 months</b></td><td className="right"><b>{money(revenue)}</b></td><td className="right"><b>{money(sum('cogs'))}</b></td><td className="right"><b>{money(sum('expenses'))}</b></td><td className={cn('right font-semibold', net < 0 ? 'text-destructive-foreground' : 'text-success-foreground')}>{money(net)}</td><td className="right">{margin.toFixed(1)}%</td></tr>
      </tbody></table></div>
      <p className="muted small">As of {new Date(s.asOf).toLocaleString('en-GB')}. The current month is incomplete until it ends.</p>
    </section>
  );
}
