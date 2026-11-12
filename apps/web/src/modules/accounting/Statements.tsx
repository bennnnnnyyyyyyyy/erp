import { useState } from 'react';
import {
  ASSET_LINES,
  CLAIM_LINES,
  INCOME_LINES,
  STATEMENT_LINE_LABELS,
  buildBalanceSheet,
  buildIncomeStatement,
  hasPermission,
  sameDateLastYear,
  type Account,
  type FinancialLine,
  type StatementRow,
  type StatementSection,
} from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api, apiDownload } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, accountName, firstOfYear, money, today, useNotice } from './common';

// Financial statements (sql/085, documentation/plans/FINANCIAL_STATEMENTS_PLAN.md): the income statement for a period and the balance
// sheet at a date, from posted ledger entries, in the EAS 1 layout. Each account reports under its statement line (its own, its
// parent's, or the Egyptian chart default); the "Statement lines" page changes them.

type Answer = { currency: string; current: StatementRow[]; compare: StatementRow[] | null };

const lineLabel = (line: FinancialLine) => tr(STATEMENT_LINE_LABELS[line]);
const rowName = (r: StatementRow) => accountName(r); // computed equity rows carry their Arabic name from the database too
const rowKey = (r: StatementRow) => `${r.line}|${r.accountId ?? r.name}`;

/** One section: its accounts (each opens its lines for the period) and the section total, with the comparison column when asked. */
function SectionRows({ current, compare, currency, linkRange }: {
  current: StatementSection;
  compare: StatementSection | null;
  currency: string;
  linkRange: { from: string; to: string };
}) {
  const rows = [...current.rows, ...(compare?.rows ?? []).filter((r) => !current.rows.some((x) => rowKey(x) === rowKey(r)))];
  if (!rows.length && !current.totalMinor && !compare?.totalMinor) return null;
  const prior = (r: StatementRow) => compare?.rows.find((x) => rowKey(x) === rowKey(r))?.amountMinor ?? 0;
  const now = (r: StatementRow) => current.rows.find((x) => rowKey(x) === rowKey(r))?.amountMinor ?? 0;
  return (
    <>
      <tr><th scope="rowgroup" colSpan={compare ? 4 : 3} className="statement-section">{lineLabel(current.line)}</th></tr>
      {rows.map((r) => (
        <tr key={rowKey(r)}>
          <td>{r.code ? <code>{r.code}</code> : null}</td>
          <td>{r.accountId ? <Link to={`/accounting/accounts/${r.accountId}?from=${linkRange.from}&to=${linkRange.to}&currency=${currency}`}>{rowName(r)}</Link> : rowName(r)}</td>
          <td className="right">{money(now(r), currency)}</td>
          {compare ? <td className="right muted">{money(prior(r), currency)}</td> : null}
        </tr>
      ))}
      <tr>
        <th scope="row" colSpan={2}>{trf('Total: {line}', { line: lineLabel(current.line) })}</th>
        <td className="right"><strong>{money(current.totalMinor, currency)}</strong></td>
        {compare ? <td className="right muted"><strong>{money(compare.totalMinor, currency)}</strong></td> : null}
      </tr>
    </>
  );
}

function TotalRow({ label, now, prior, currency, strong }: { label: string; now: number; prior: number | null; currency: string; strong?: boolean }) {
  const cell = (v: number) => (strong ? <strong>{money(v, currency)}</strong> : money(v, currency));
  return (
    <tr className={strong ? 'statement-total' : undefined}>
      <th scope="row" colSpan={2}>{label}</th>
      <td className="right">{cell(now)}</td>
      {prior !== null ? <td className="right muted">{cell(prior)}</td> : null}
    </tr>
  );
}

function Head({ compare, nowLabel, priorLabel }: { compare: boolean; nowLabel: string; priorLabel: string }) {
  return (
    <thead><tr>
      <th scope="col">{tr('Code')}</th><th scope="col">{tr('Account')}</th>
      <th scope="col" className="right">{nowLabel}</th>
      {compare ? <th scope="col" className="right">{priorLabel}</th> : null}
    </tr></thead>
  );
}

export function IncomeStatementPage() {
  const session = useSession();
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const [compare, setCompare] = useState(true);
  const [shown, setShown] = useState({ from, to, compare });
  const qs = () => {
    const base = `from=${shown.from}&to=${shown.to}`;
    return shown.compare ? `${base}&compareFrom=${sameDateLastYear(shown.from)}&compareTo=${sameDateLastYear(shown.to)}` : base;
  };
  const data = useLoad(() => api<Answer>(`/v1/accounting/statements/income?${qs()}`));
  const { message, busy, run } = useNotice();
  const cur = data.data?.currency ?? session.org?.defaultCurrency ?? 'EGP';
  const now = buildIncomeStatement(data.data?.current ?? []);
  const prior = data.data?.compare ? buildIncomeStatement(data.data.compare) : null;
  const sec = (s: typeof now | null, line: FinancialLine) => s?.sections.find((x) => x.line === line) ?? null;
  const section = (line: FinancialLine) => {
    const c = sec(now, line);
    return c ? <SectionRows key={line} current={c} compare={sec(prior, line)} currency={cur} linkRange={shown} /> : null;
  };
  const total = (label: string, pick: (s: typeof now) => number, strong = false) => (
    <TotalRow label={label} now={pick(now)} prior={prior ? pick(prior) : null} currency={cur} strong={strong} />
  );

  return (
    <section className="page wide">
      <h1>{tr('Income statement')}</h1>
      <p className="muted">{tr('Revenue, costs and profit for a period, from posted entries in the books, laid out as the Egyptian Accounting Standards present them. Each account opens its entries.')}</p>
      <Notice message={message} />
      <div className="form-row">
        <label>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />{tr('Compare with the same period last year')}</label>
        <Button variant="outline" disabled={!from || !to || to < from} onClick={() => { setShown({ from, to, compare }); data.reload(); }}>{tr('Show')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
          await apiDownload(`/v1/accounting/statements/income?${qs()}&format=csv`, `income-statement-${shown.from}-to-${shown.to}.csv`);
          return tr('Downloaded.');
        })}>{tr('Download CSV')}</Button>
        <Button variant="ghost" onClick={() => window.print()}>{tr('Print')}</Button>
      </div>
      {!data.data ? <Loading error={data.error} /> : (
        <div className="table-wrap"><table>
          <Head compare={!!prior} nowLabel={trf('{from} to {to}', { from: shown.from, to: shown.to })} priorLabel={trf('{from} to {to}', { from: sameDateLastYear(shown.from), to: sameDateLastYear(shown.to) })} />
          <tbody>
            {section('revenue')}
            {section('cost_of_sales')}
            {total(tr('Gross profit'), (s) => s.grossProfitMinor, true)}
            {section('other_income')}
            {section('operating_expenses')}
            {total(tr('Operating profit'), (s) => s.operatingProfitMinor, true)}
            {section('finance_costs')}
            {total(tr('Profit before tax'), (s) => s.profitBeforeTaxMinor)}
            {section('income_tax')}
            {total(tr('Net profit for the period'), (s) => s.netProfitMinor, true)}
          </tbody>
        </table></div>
      )}
      <p className="muted small">{tr('Change where an account appears:')} <Link to="/accounting/statement-lines">{tr('Statement lines')}</Link></p>
    </section>
  );
}

export function BalanceSheetPage() {
  const session = useSession();
  const [at, setAt] = useState(today());
  const [compare, setCompare] = useState(true);
  const [shown, setShown] = useState({ at, compare });
  const qs = () => (shown.compare ? `at=${shown.at}&compareAt=${sameDateLastYear(shown.at)}` : `at=${shown.at}`);
  const data = useLoad(() => api<Answer>(`/v1/accounting/statements/balance?${qs()}`));
  const { message, busy, run } = useNotice();
  const cur = data.data?.currency ?? session.org?.defaultCurrency ?? 'EGP';
  const now = buildBalanceSheet(data.data?.current ?? []);
  const prior = data.data?.compare ? buildBalanceSheet(data.data.compare) : null;
  const linkRange = { from: firstOfYear(), to: shown.at };
  const rows = (lines: readonly FinancialLine[], pick: (b: typeof now) => StatementSection[]) =>
    lines.map((line) => {
      const c = pick(now).find((x) => x.line === line);
      const p = prior ? pick(prior).find((x) => x.line === line) ?? null : null;
      return c ? <SectionRows key={line} current={c} compare={p} currency={cur} linkRange={linkRange} /> : null;
    });
  const total = (label: string, pick: (b: typeof now) => number) => (
    <TotalRow label={label} now={pick(now)} prior={prior ? pick(prior) : null} currency={cur} strong />
  );

  return (
    <section className="page wide">
      <h1>{tr('Balance sheet')}</h1>
      <p className="muted">{tr('What the company owns and owes on a date, from posted entries in the books. Until year-end closing is built, the profit of the year so far and of earlier unclosed years show under equity.')}</p>
      <Notice message={message} />
      <div className="form-row">
        <label>{tr('On')}<input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />{tr('Compare with the same day last year')}</label>
        <Button variant="outline" disabled={!at} onClick={() => { setShown({ at, compare }); data.reload(); }}>{tr('Show')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
          await apiDownload(`/v1/accounting/statements/balance?${qs()}&format=csv`, `balance-sheet-${shown.at}.csv`);
          return tr('Downloaded.');
        })}>{tr('Download CSV')}</Button>
        <Button variant="ghost" onClick={() => window.print()}>{tr('Print')}</Button>
      </div>
      {!data.data ? <Loading error={data.error} /> : (
        <>
          <p className={now.differenceMinor === 0 ? 'muted small' : 'error small'} role={now.differenceMinor === 0 ? undefined : 'alert'}>
            {now.differenceMinor === 0
              ? tr('The balance sheet balances: assets equal equity plus liabilities.')
              : trf('The balance sheet is out by {amount}. This is a system fault: contact support.', { amount: money(now.differenceMinor, cur) })}
          </p>
          <div className="table-wrap"><table>
            <Head compare={!!prior} nowLabel={shown.at} priorLabel={sameDateLastYear(shown.at)} />
            <tbody>
              {rows(ASSET_LINES, (b) => b.assets)}
              {total(tr('Total assets'), (b) => b.totalAssetsMinor)}
              {rows(CLAIM_LINES, (b) => b.claims)}
              {total(tr('Total equity and liabilities'), (b) => b.totalEquityMinor + b.totalLiabilitiesMinor)}
            </tbody>
          </table></div>
        </>
      )}
      <p className="muted small">{tr('Change where an account appears:')} <Link to="/accounting/statement-lines">{tr('Statement lines')}</Link></p>
    </section>
  );
}

/** Where each account appears on the statements: its own line, or (blank) its parent's or the Egyptian chart default. */
export function StatementLinesPage() {
  const session = useSession();
  const accounts = useLoad(() => api<Account[]>('/v1/accounting/accounts'));
  const own = useLoad(() => api<{ accountId: string; line: FinancialLine }[]>('/v1/accounting/statement-lines'));
  const { message, busy, run } = useNotice();
  const canManage = hasPermission(session.permissions, 'accounting.chart.manage');
  const lineOf = (id: string) => own.data?.find((x) => x.accountId === id)?.line ?? '';
  const choices = (a: Account) => (a.kind === 'revenue' || a.kind === 'expense' ? INCOME_LINES : [...ASSET_LINES, ...CLAIM_LINES]);

  return (
    <section className="page wide">
      <p><Link to="/accounting/income-statement">← {tr('Income statement')}</Link> · <Link to="/accounting/balance-sheet">{tr('Balance sheet')}</Link></p>
      <h1>{tr('Statement lines')}</h1>
      <p className="muted">{tr('Where each account appears on the income statement and balance sheet. "Default" follows the parent account, or the Egyptian chart group. Set a line only where an account belongs elsewhere.')}</p>
      <Notice message={message} />
      {!accounts.data || !own.data ? <Loading error={accounts.error ?? own.error} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{tr('Code')}</th><th scope="col">{tr('Account')}</th><th scope="col">{tr('Statement line')}</th></tr></thead>
          <tbody>
            {accounts.data.map((a) => (
              <tr key={a.id}>
                <td><code>{a.code}</code></td>
                <td>{a.isLeaf ? accountName(a) : <strong>{accountName(a)}</strong>}</td>
                <td>
                  {canManage ? (
                    <select aria-label={trf('Statement line for {account}', { account: `${a.code} ${accountName(a)}` })} value={lineOf(a.id)} disabled={busy}
                      onChange={(e) => run(async () => {
                        await api(`/v1/accounting/accounts/${a.id}/statement-line`, { method: 'PUT', body: JSON.stringify({ line: e.target.value || null }) });
                        return tr('Saved.');
                      }, own.reload)}>
                      <option value="">{tr('Default')}</option>
                      {choices(a).map((l) => <option key={l} value={l}>{lineLabel(l)}</option>)}
                    </select>
                  ) : lineOf(a.id) ? lineLabel(lineOf(a.id) as FinancialLine) : <span className="muted">{tr('Default')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}
