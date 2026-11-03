import type { ReactNode } from 'react';
import { hasPermission } from '@erp/shared';
import { formatWhole } from '../../lib/money';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { cn } from '../../lib/cn';
import { useSession } from '../../session';

import { Rich } from '../../components/Rich';
import { dateLocale, tr, trf } from '../../lib/i18n';
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

// Every card has a visible title, a one-line plain-words subtitle, and the period its figures cover.
function Card({ to, title, subtitle, period, tone, children }: { to: string; title: string; subtitle: string; period: string; tone?: Tone | undefined; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-w-0 flex-col gap-3 break-words rounded-xl border border-border bg-card p-5 text-card-foreground no-underline shadow-xs transition-colors hover:bg-accent">
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
          {title}
          {tone && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className={cn('size-2.5 rounded-full', TONE[tone].dot)} aria-hidden="true" />
              {tr(TONE[tone].word)}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{subtitle} · {period}</span>
      </span>
      {children}
    </Link>
  );
}

const monthName = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function OwnerSummary() {
  const session = useSession();
  const allowed = !demoMode && hasPermission(session.permissions, 'finance.reports.view');
  const data = useLoad(() => (allowed ? api<Insights>('/v1/finance/insights') : Promise.resolve(null as Insights | null)));
  if (!allowed) return null;
  if (data.error) return <p className="error notice">{tr('Could not load the summary:')} {data.error}</p>;
  const s = data.data;
  if (!s) return <p className="muted">{tr('Loading the summary…')}</p>;

  const money = (n: number) => formatWhole(n, s.currency);   // a summary: whole currency units fit the cards; exact amounts are in the lists
  const asOfDay = new Date(s.asOf).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: session.org?.timezone ?? 'UTC' });
  const last = s.months[s.months.length - 2];   // last full month
  const now = s.months[s.months.length - 1];    // this month so far
  const prev = s.months[s.months.length - 3];
  const peak = Math.max(1, ...s.months.map((m) => Math.abs(m.net)));
  // A new or empty company has twelve months of zeros. "Made EGP 0" in green with an "All good" dot reads as a verdict on nothing,
  // so a card only shows a figure's colour and a status once there is something behind it.
  const active = s.months.some((m) => m.revenue !== 0 || m.cogs !== 0 || m.expenses !== 0);
  const profitTone: Tone | undefined = !active || !last ? undefined : last.net < 0 ? 'bad' : prev && last.net < prev.net * 0.7 ? 'watch' : 'good';
  const yearNet = s.months.reduce((n, m) => n + m.net, 0);
  const oldWait = s.decisions.oldestSubmittedHours;
  const decisionTone: Tone = s.decisions.submitted === 0 ? 'good' : oldWait >= 24 ? 'bad' : 'watch';
  const expiring = s.expiry.expired.batches + s.expiry.in30.batches;
  const hasStock = s.stockValueMinor !== 0 || s.itemsLow > 0 || expiring + s.expiry.in60.batches + s.expiry.in90.batches > 0;
  const stockTone: Tone | undefined = !hasStock ? undefined : s.expiry.expired.batches > 0 || s.itemsLow >= 5 ? 'bad' : expiring + s.expiry.in60.batches + s.itemsLow > 0 ? 'watch' : 'good';
  const hasMoney = s.owedToMeMinor !== 0 || s.iOweMinor !== 0;
  const moneyTone: Tone | undefined = !hasMoney ? undefined : s.overdueMinor > 0 ? (s.overdueMinor > s.owedToMeMinor * 0.5 ? 'bad' : 'watch') : 'good';
  const supplierTone: Tone | undefined = s.topSuppliers.length === 0 ? undefined : (s.topSuppliers[0]?.sharePercent ?? 0) > 40 ? 'bad' : s.singleSourceItems > 0 ? 'watch' : 'good';
  const count = (n: number, one: string, many: string) => trf(n === 1 ? one : many, { n });

  return (
    <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 21rem), 1fr))' }} aria-label={tr('Business summary')}>
      <Card to="/finance/overview" title={tr('Am I making or losing money?')} subtitle={tr('What the business earned after its costs')} period={last ? trf('{month}, and the last 12 months', { month: monthName(last.month) }) : tr('last 12 months')} tone={profitTone}>
        {active && last ? (
          <>
            <span className={cn('font-semibold leading-tight tracking-tight', last.net < 0 ? 'text-destructive-foreground' : 'text-success-foreground')} style={{ fontSize: 'clamp(1.4rem, 2.2vw, 1.875rem)' }}>
              {trf(last.net < 0 ? 'Lost {amount}' : 'Made {amount}', { amount: money(Math.abs(last.net)) })}
            </span>
            <span className="text-sm text-muted-foreground">{trf('in {month}: sales {revenue}, cost of what you sold {cogs}, running costs {expenses}.', { month: monthName(last.month), revenue: money(last.revenue), cogs: money(last.cogs), expenses: money(last.expenses) })}</span>
            <div className="flex h-12 items-end gap-1" aria-hidden="true">
              {s.months.map((m) => (
                <span key={m.month} title={`${monthName(m.month)}: ${money(m.net)}`} className={cn('flex-1 rounded-sm', m.net < 0 ? 'bg-destructive' : 'bg-success')} style={{ height: `${Math.max(6, (Math.abs(m.net) / peak) * 100)}%` }} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{trf(yearNet < 0 ? 'Last 12 months: lost {amount} in total.' : 'Last 12 months: made {amount} in total.', { amount: money(Math.abs(yearNet)) })} {now && now.revenue + now.expenses > 0 ? trf(now.net < 0 ? 'This month so far: down {amount}.' : 'This month so far: up {amount}.', { amount: money(Math.abs(now.net)) }) : tr('This month so far: nothing recorded yet.')}</span>
          </>
        ) : <span className="text-sm text-muted-foreground">{tr('Nothing to show yet. Once you invoice sales and record expenses, this shows whether the business is making money.')}</span>}
      </Card>

      <Card to="/sales/invoices" title={tr('Money coming in and going out')} subtitle={tr('Who owes you and who you owe')} period={trf('all unpaid bills, as of {date}', { date: asOfDay })} tone={moneyTone}>
        <span className="font-semibold leading-tight tracking-tight" style={{ fontSize: 'clamp(1.4rem, 2.2vw, 1.875rem)' }}>{money(s.owedToMeMinor)}</span>
        <span className="text-sm text-muted-foreground"><Rich text={s.overdueMinor > 0 ? trf('customers still owe you, of which **{late}** is more than 30 days late.', { late: money(s.overdueMinor) }) : tr('customers still owe you.')} /></span>
        <span className="text-sm"><Rich text={trf('You owe suppliers and for expenses: **{amount}**.', { amount: money(s.iOweMinor) })} /></span>
      </Card>

      <Card to="/inventory/requests" title={tr('Waiting for your decision')} subtitle={tr('Stock requests a manager still has to approve')} period={trf('right now, {date}', { date: asOfDay })} tone={decisionTone}>
        <span className="font-semibold leading-tight tracking-tight" style={{ fontSize: 'clamp(1.4rem, 2.2vw, 1.875rem)' }}>{trf(s.decisions.submitted === 1 ? '{n} request' : '{n} requests', { n: s.decisions.submitted })}</span>
        <span className="text-sm text-muted-foreground">
          {s.decisions.submitted === 0 ? tr('Nothing is waiting for approval.') : (oldWait < 1 ? tr('The oldest has been waiting less than an hour.') : trf(oldWait === 1 ? 'The oldest has been waiting 1 hour.' : 'The oldest has been waiting {n} hours.', { n: oldWait }))}
          {s.decisions.approvedNotIssued > 0 && ` ${trf('{n} approved and waiting to be handed out.', { n: s.decisions.approvedNotIssued })}`}
        </span>
      </Card>

      <Card to="/inventory/batches" title={tr('Stock and expiry')} subtitle={tr('What is on the shelves and what is about to expire')} period={trf('as of {date}, looking 90 days ahead', { date: asOfDay })} tone={stockTone}>
        <span className="font-semibold leading-tight tracking-tight" style={{ fontSize: 'clamp(1.4rem, 2.2vw, 1.875rem)' }}>{money(s.stockValueMinor)}</span>
        <span className="text-sm text-muted-foreground">{tr('of stock on the shelves, at cost.')}</span>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {s.expiry.expired.batches > 0 && <li className="text-destructive-foreground"><b>{count(s.expiry.expired.batches, '{n} batch has expired', '{n} batches have expired')}</b> ({money(s.expiry.expired.valueMinor)})</li>}
          {s.expiry.in30.batches + s.expiry.in60.batches + s.expiry.in90.batches > 0
            ? <li><Rich text={trf('**{a}** expire within 30 days ({value}), **{b}** within 60, **{c}** within 90', { a: s.expiry.in30.batches, value: money(s.expiry.in30.valueMinor), b: s.expiry.in60.batches, c: s.expiry.in90.batches })} /></li>
            : <li className="text-muted-foreground">{tr('Nothing expires in the next 90 days.')}</li>}
          <li>{s.itemsLow > 0 ? <b>{count(s.itemsLow, '{n} item is at or below its reorder level', '{n} items are at or below their reorder level')}</b> : <span className="text-muted-foreground">{tr('No item is below its reorder level.')}</span>}</li>
        </ul>
      </Card>

      <Card to="/sales/invoices" title={tr('Best sellers')} subtitle={tr('The products that brought in the most sales')} period={tr('last 90 days')}>
        {s.topProducts.length === 0 ? <span className="text-sm text-muted-foreground">{tr('No sales yet.')}</span> : (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {s.topProducts.map((p, i) => (
              <li key={p.sku} className="flex justify-between gap-3"><span>{i + 1}. {p.name}</span><b>{money(p.revenue)}</b></li>
            ))}
          </ol>
        )}
      </Card>

      <Card to="/purchasing/suppliers" title={tr('Who you depend on')} subtitle={tr('The suppliers most of your purchases come from')} period={tr('last 12 months')} tone={supplierTone}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {s.topSuppliers.map((p) => <li key={p.name} className="flex justify-between gap-3"><span>{p.name}</span><b>{trf('{pct}% of purchases', { pct: p.sharePercent })}</b></li>)}
          {s.topSuppliers.length === 0 && <li className="text-muted-foreground">{tr('No purchases yet.')}</li>}
        </ul>
        {s.topSuppliers.length > 0 && <span className="text-sm text-muted-foreground">{s.singleSourceItems === 0 ? tr('Every item has more than one supplier.') : count(s.singleSourceItems, '{n} item comes from only one supplier.', '{n} items come from only one supplier.')}</span>}
      </Card>

      <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
        {trf('As of {datetime}. A management view: no VAT, cost of goods is the average cost of the stock, overdue means unpaid after 30 days. Not a statutory accounts report.', { datetime: new Date(s.asOf).toLocaleString(dateLocale(), { timeZone: session.org?.timezone ?? 'UTC' }) })}
      </p>
    </div>
  );
}
