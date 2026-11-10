import { useState } from 'react';
import type { FiscalYear, SwitchOnPreview, SwitchOnResult } from '@erp/shared';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useReloadSession, useSession } from '../../session';
import { Notice, firstOfYear, money, useChartManager, useNotice } from './common';
import { AdvancedSetup } from './SetupAdvanced';
import { booksStart, firstFiscalYear, nextGuideStep } from './guideLogic';

// Guided accounting setup (decision R2 A, 10 Nov 2026): three steps in the order a company does them (when the books start, check the
// chart of accounts, opening balances), then the switch. Every call is one the old setup page already made; the accountant-only parts
// (which account each kind of document posts to, expense categories, old receipt costs, head accountant) are under "Advanced".
// Works before accounting is on (the API's set-up routes are open then). The database decides who may change what.

function StepCard({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="form-card stack">
      <h2>
        {done ? <span aria-hidden="true">✓ </span> : null}
        {n}. {title}
        {done ? <span className="sr-only"> ({tr('done')})</span> : null}
      </h2>
      {children}
    </div>
  );
}

export function AccountingSetupPage() {
  const session = useSession();
  const reloadSession = useReloadSession();
  const canManage = useChartManager();
  const isOwner = session.role === 'owner';
  const preview = useLoad(() => api<SwitchOnPreview>('/v1/accounting/setup/preview'));
  const years = useLoad(() => api<FiscalYear[]>('/v1/accounting/fiscal-years'));
  const { message, busy, run } = useNotice();
  const [start, setStart] = useState(firstOfYear());
  const [more, setMore] = useState({ name: '', startsOn: '', endsOn: '' });
  const [result, setResult] = useState<SwitchOnResult | null>(null);

  if (!preview.data || !years.data) return <section className="page"><Loading error={preview.error ?? years.error} /></section>;
  const p = preview.data;
  const list = years.data;
  const reloadAll = () => { preview.reload(); years.reload(); };
  const currency = session.org?.defaultCurrency ?? 'EGP';
  const next = nextGuideStep({ accountingOn: p.accountingOn, fiscalYears: list.length, chartAccounts: p.chartAccounts });
  const first = booksStart(list);
  const plan = firstFiscalYear(start);
  const ready = p.chartAccounts > 0 && p.missingRoles.length === 0 && p.uncostedReceipts === 0;
  const docs = p.documents;
  const docTotal = docs.stockMoves + docs.customerInvoices + docs.supplierInvoices + docs.expenses + docs.payments + docs.approvedNotes;

  return (
    <section className="page wide">
      <h1>{tr('Accounting setup')}</h1>
      <p className="muted">
        {p.accountingOn
          ? tr('Accounting is on. Every document now posts its entry automatically. The settings below can still be changed.')
          : tr('Three short steps, then one button. Nothing is posted until you switch accounting on at the end.')}
      </p>
      <Notice message={message} />

      <StepCard n={1} done={list.length > 0} title={tr('When do your books start?')}>
        <p className="muted small">{tr('Choose the first day your accounts cover, usually the first day of your financial year. Opening balances are dated this day.')}</p>
        {first ? <p>{trf('Your books start on {date}.', { date: formatDay(first, session.org) })}</p> : null}
        {!list.length && canManage ? (
          <div className="form-row">
            <label>{tr('Books start on')}<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <Button disabled={busy || !plan} onClick={() => plan && run(async () => {
              await api('/v1/accounting/fiscal-years', { method: 'POST', body: JSON.stringify(plan) });
              return trf('Fiscal year {name} added.', { name: plan.name });
            }, reloadAll)}>{tr('Save the start date')}</Button>
          </div>
        ) : null}
        {!list.length && !canManage ? <p className="muted small">{tr('Only the owner or the head accountant can set this.')}</p> : null}
        {list.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Name')}</th><th scope="col">{tr('Starts')}</th><th scope="col">{tr('Ends')}</th></tr></thead><tbody>
              {list.map((y) => <tr key={y.id}><td>{y.name}</td><td>{formatDay(y.startsOn, session.org)}</td><td>{formatDay(y.endsOn, session.org)}</td></tr>)}
            </tbody></table></div>
            {canManage ? (
              <FormToggle label={tr('Add another fiscal year')}>
                <div className="form-row">
                  <label>{tr('Name')}<input value={more.name} onChange={(e) => setMore({ ...more, name: e.target.value })} /></label>
                  <label>{tr('Starts')}<input type="date" value={more.startsOn} onChange={(e) => setMore({ ...more, startsOn: e.target.value })} /></label>
                  <label>{tr('Ends')}<input type="date" value={more.endsOn} onChange={(e) => setMore({ ...more, endsOn: e.target.value })} /></label>
                  <Button variant="outline" disabled={busy || !more.name.trim() || !more.startsOn || !more.endsOn || more.endsOn < more.startsOn} onClick={() => run(async () => {
                    await api('/v1/accounting/fiscal-years', { method: 'POST', body: JSON.stringify(more) });
                    return trf('Fiscal year {name} added.', { name: more.name.trim() });
                  }, years.reload)}>{tr('Add fiscal year')}</Button>
                </div>
              </FormToggle>
            ) : null}
          </>
        ) : null}
      </StepCard>

      <StepCard n={2} done={p.chartAccounts > 0} title={tr('Check your chart of accounts')}>
        <p className="muted small">
          {tr('The Egyptian unified chart of accounts is ready for you (groups 1 to 4). You can add your own accounts under any group.')}{' '}
          {p.chartAccounts ? trf('{count} accounts.', { count: p.chartAccounts }) : tr('No accounts yet.')}{' '}
          <Link to="/accounting/accounts">{tr('Open the chart of accounts')}</Link>
        </p>
        {canManage ? (
          <div>
            <Button variant={p.chartAccounts ? 'outline' : 'default'} disabled={busy} onClick={() => run(async () => {
              const r = await api<{ accountsAdded: number }>('/v1/accounting/setup/prepare', { method: 'POST' });
              return r.accountsAdded ? trf('{count} accounts added.', { count: r.accountsAdded }) : tr('The default chart is already complete.');
            }, reloadAll)}>{p.chartAccounts ? tr('Add any missing default accounts') : tr('Add the default chart')}</Button>
          </div>
        ) : null}
      </StepCard>

      <StepCard n={3} done={p.accountingOn} title={tr('Opening balances')}>
        <p className="muted small">{tr('Opening balances are what the business already owns and owes on the first day of your books: cash, bank, stock value, money owed to you and by you. They are entered as one manual journal of type Opening balances, dated the first day of a fiscal year. There is no separate opening-balances screen.')}</p>
        {p.accountingOn
          ? <p><Link to="/accounting/journals/new">{tr('Enter opening balances in Manual journals')}</Link></p>
          : <p className="muted small">{tr('Manual journals open once accounting is switched on, so do this right after the switch below.')}</p>}
      </StepCard>

      {/* the switch */}
      {!p.accountingOn ? (
        <div className="form-card stack">
          <h2>{tr('Switch accounting on')}</h2>
          <p>{trf('Switching on will post {count} past documents: {moves} stock movements, {sales} sales invoices, {purchases} purchase invoices, {expenses} expenses, {payments} payments and {notes} credit or debit notes.', {
            count: docTotal, moves: docs.stockMoves, sales: docs.customerInvoices, purchases: docs.supplierInvoices, expenses: docs.expenses, payments: docs.payments, notes: docs.approvedNotes,
          })}</p>
          {p.issuesWithoutCost ? <p className="muted small">{trf('{count} older stock issues have no cost recorded; they post at zero cost.', { count: p.issuesWithoutCost })}</p> : null}
          {p.uncostedReceipts ? <p className="error small">{trf('{count} stock receipts have no cost yet. Enter them under Advanced below before switching on.', { count: p.uncostedReceipts })}</p> : null}
          {p.chartAccounts > 0 && p.missingRoles.length ? <p className="error small">{tr('Some accounts that documents post to are not set. Open Advanced below.')}</p> : null}
          {next === 'opening-date' || next === 'chart' ? <p className="muted small">{tr('Do steps 1 and 2 first.')}</p> : null}
          {isOwner ? (
            <div>
              <ConfirmButton label={busy ? tr('Working…') : tr('Switch accounting on')} confirmLabel={tr('Yes, switch on')} disabled={busy || !ready}
                question={tr('Switch accounting on? Every past document is posted once, and accounting can never be switched off again.')}
                onConfirm={() => run(async () => {
                  const r = await api<SwitchOnResult>('/v1/accounting/setup/switch-on', { method: 'POST' });
                  setResult(r);
                  return trf('Accounting is on: {documents} documents posted as {entries} entries.', { documents: r.documents, entries: r.entries });
                }, () => { reloadAll(); reloadSession(); })} />
            </div>
          ) : <p className="muted small">{tr('Only an owner can switch accounting on.')}</p>}
        </div>
      ) : null}
      {p.accountingOn ? <p className="small"><Link to="/accounting/stock-value">{tr('Stock value check')} →</Link></p> : null}
      {result ? (
        <div className="form-card stack">
          <h2>{tr('Switch-on result')}</h2>
          <p>{trf('Debits {debits}, credits {credits}.', { debits: money(result.debitsMinor, currency), credits: money(result.creditsMinor, currency) })}{' '}
            <Link to="/accounting/trial-balance">{tr('Open the trial balance')}</Link></p>
        </div>
      ) : null}

      <details className="form-card">
        <summary className="cursor-pointer font-semibold">{tr('Advanced (for your accountant)')}</summary>
        <p className="muted small">{tr('Which account each kind of document posts to, expense categories, costs for old receipts and the head accountant. The default chart fills all of this; change something only if your accountant asks.')}</p>
        <AdvancedSetup preview={p} reloadPreview={preview.reload} />
      </details>
    </section>
  );
}
