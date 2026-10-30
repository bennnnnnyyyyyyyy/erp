import type { ReactNode } from 'react';
import { formatMoney, hasPermission } from '@erp/shared';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { cn } from '../../lib/cn';
import { useSession } from '../../session';

// The owner's first screen (documentation/plans/OWNER_INSIGHTS_PLAN.md): am I making or losing money, who owes me, what
// needs my decision, what is about to go wrong. Plain words, big numbers, every card opens the list behind it.
// A MANAGEMENT view, not statutory accounts: no VAT, cost is average cost. Shown only to people allowed to see money.

type Month = { month: string; revenue: number; cogs: number; expenses: number; net: number };
type Insights = {
  currency: string; asOf: string; months: Month[];
  owedToMeMinor: number; overdueMinor: number; iOweMinor: number; stockValueMinor: number; itemsLow: number;
  expiry: Record<'expired' | 'in30' | 'in60' | 'in90', { batches: number; valueMinor: number }>;
  decisions: { submitted: number; approvedNotIssued: number; oldestSubmittedHours: number };
  topProducts: { sku: string; name: string; revenue: number }[];
  topSuppliers: { name: string; valueMinor: number; sharePercent: number }[];
  singleSourceItems: number;
};

type Tone = 'good' | 'watch' | 'bad';
const TONE: Record<Tone, { dot: string; word: string }> = {
  good: { dot: 'bg-success', word: 'All good' },
  watch: { dot: 'bg-warning', word: 'Keep an eye on this' },
  bad: { dot: 'bg-destructive', word: 'Needs action' },
};

function Card({ to, title, tone, children }: { to: string; title: string; tone?: Tone; children: ReactNode }) {
  return (
    <Link to={to} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground no-underline shadow-xs transition-colors hover:bg-accent">
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
        {title}
        {tone && (
          <span className="flex items-center gap-1.5 text-xs">
            <span className={cn('size-2.5 rounded-full', TONE[tone].dot)} aria-hidden="true" />
            {TONE[tone].word}
          </span>
        )}
      </span>
      {children}
    </Link>
  );
}

const monthName = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function OwnerSummary() {
  const session = useSession();
  const allowed = !demoMode && hasPermission(session.permissions, 'finance.reports.view');
  const data = useLoad(() => (allowed ? api<Insights>('/v1/finance/insights') : Promise.resolve(null as Insights | null)));
  if (!allowed) return null;
  if (data.error) return <p className="error notice">Could not load the summary: {data.error}</p>;
  const s = data.data;
  if (!s) return <p className="muted">Loading the summary…</p>;

  const money = (n: number) => formatMoney({ amountMinor: n, currency: s.currency });
  const last = s.months[s.months.length - 2];   // last full month
  const now = s.months[s.months.length - 1];    // this month so far
  const prev = s.months[s.months.length - 3];
  const peak = Math.max(1, ...s.months.map((m) => Math.abs(m.net)));
  const profitTone: Tone = !last ? 'watch' : last.net < 0 ? 'bad' : prev && last.net < prev.net * 0.7 ? 'watch' : 'good';
  const yearNet = s.months.reduce((n, m) => n + m.net, 0);
  const oldWait = s.decisions.oldestSubmittedHours;
  const decisionTone: Tone = s.decisions.submitted === 0 ? 'good' : oldWait >= 24 ? 'bad' : 'watch';
  const expiring = s.expiry.expired.batches + s.expiry.in30.batches;
  const stockTone: Tone = s.expiry.expired.batches > 0 || s.itemsLow >= 5 ? 'bad' : expiring + s.expiry.in60.batches + s.itemsLow > 0 ? 'watch' : 'good';
  const moneyTone: Tone = s.overdueMinor > 0 ? (s.overdueMinor > s.owedToMeMinor * 0.5 ? 'bad' : 'watch') : 'good';
  const supplierTone: Tone = (s.topSuppliers[0]?.sharePercent ?? 0) > 40 ? 'bad' : s.singleSourceItems > 0 ? 'watch' : 'good';

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Business summary">
      <Card to="/finance/overview" title="Am I making or losing money?" tone={profitTone}>
        {last ? (
          <>
            <span className={cn('text-3xl font-semibold tracking-tight', last.net < 0 ? 'text-destructive-foreground' : 'text-success-foreground')}>
              {last.net < 0 ? 'Lost ' : 'Made '}{money(Math.abs(last.net))}
            </span>
            <span className="text-sm text-muted-foreground">in {monthName(last.month)}: sales {money(last.revenue)}, cost of what you sold {money(last.cogs)}, running costs {money(last.expenses)}.</span>
          </>
        ) : <span className="text-sm text-muted-foreground">No sales recorded yet.</span>}
        <div className="flex h-12 items-end gap-1" aria-hidden="true">
          {s.months.map((m) => (
            <span key={m.month} title={`${monthName(m.month)}: ${money(m.net)}`} className={cn('flex-1 rounded-sm', m.net < 0 ? 'bg-destructive' : 'bg-success')} style={{ height: `${Math.max(6, (Math.abs(m.net) / peak) * 100)}%` }} />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Last 12 months: {yearNet < 0 ? 'lost' : 'made'} {money(Math.abs(yearNet))} in total. This month so far: {now && now.revenue + now.expenses > 0 ? `${now.net < 0 ? 'down' : 'up'} ${money(Math.abs(now.net))}` : 'nothing recorded yet'}.</span>
      </Card>

      <Card to="/sales/invoices" title="Money coming in and going out" tone={moneyTone}>
        <span className="text-3xl font-semibold tracking-tight">{money(s.owedToMeMinor)}</span>
        <span className="text-sm text-muted-foreground">customers still owe you{s.overdueMinor > 0 ? <>, of which <b className="text-destructive-foreground">{money(s.overdueMinor)}</b> is more than 30 days late</> : ''}.</span>
        <span className="text-sm">You owe suppliers and for expenses: <b>{money(s.iOweMinor)}</b>.</span>
      </Card>

      <Card to="/inventory/requests" title="Waiting for your decision" tone={decisionTone}>
        <span className="text-3xl font-semibold tracking-tight">{s.decisions.submitted} request{s.decisions.submitted === 1 ? '' : 's'}</span>
        <span className="text-sm text-muted-foreground">
          {s.decisions.submitted === 0 ? 'Nothing is waiting for approval.' : `The oldest has been waiting ${oldWait < 1 ? 'less than an hour' : `${oldWait} hour${oldWait === 1 ? '' : 's'}`}.`}
          {s.decisions.approvedNotIssued > 0 && ` ${s.decisions.approvedNotIssued} approved and waiting to be handed out.`}
        </span>
      </Card>

      <Card to="/inventory/batches" title="Stock and expiry" tone={stockTone}>
        <span className="text-3xl font-semibold tracking-tight">{money(s.stockValueMinor)}</span>
        <span className="text-sm text-muted-foreground">of stock on the shelves, at cost.</span>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          <li><b className={s.expiry.expired.batches ? 'text-destructive-foreground' : ''}>{s.expiry.expired.batches}</b> batch(es) already expired ({money(s.expiry.expired.valueMinor)})</li>
          <li><b>{s.expiry.in30.batches}</b> expire within 30 days ({money(s.expiry.in30.valueMinor)}), <b>{s.expiry.in60.batches}</b> within 60, <b>{s.expiry.in90.batches}</b> within 90</li>
          <li><b>{s.itemsLow}</b> item(s) at or below their reorder level</li>
        </ul>
      </Card>

      <Card to="/sales/invoices" title="Best sellers, last 90 days">
        {s.topProducts.length === 0 ? <span className="text-sm text-muted-foreground">No sales yet.</span> : (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {s.topProducts.map((p, i) => (
              <li key={p.sku} className="flex justify-between gap-3"><span>{i + 1}. {p.name}</span><b>{money(p.revenue)}</b></li>
            ))}
          </ol>
        )}
      </Card>

      <Card to="/purchasing/suppliers" title="Who you depend on" tone={supplierTone}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {s.topSuppliers.map((p) => <li key={p.name} className="flex justify-between gap-3"><span>{p.name}</span><b>{p.sharePercent}% of purchases</b></li>)}
          {s.topSuppliers.length === 0 && <li className="text-muted-foreground">No purchases yet.</li>}
        </ul>
        <span className="text-sm text-muted-foreground">{s.singleSourceItems} item(s) bought from only one supplier in the last year.</span>
      </Card>

      <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
        As of {new Date(s.asOf).toLocaleString('en-GB', { timeZone: session.org?.timezone ?? 'UTC' })}. A management view: no VAT, cost of goods is the average cost of the stock, overdue means unpaid after 30 days. Not a statutory accounts report.
      </p>
    </div>
  );
}
