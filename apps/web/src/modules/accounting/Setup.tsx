import { useState } from 'react';
import {
  ACCOUNT_KINDS,
  hasPermission,
  type Account,
  type AccountRole,
  type FiscalYear,
  type SwitchOnPreview,
  type SwitchOnResult,
  type UncostedReceipt,
} from '@erp/shared';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { usePeople } from '../../lib/people';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useReloadSession, useSession } from '../../session';
import { toMinor } from '../trade/common';
import { AccountSelect, Notice, accountLabel, accountName, depths, firstOfYear, money, useNotice } from './common';

// Accounting set-up (plan section 6): everything a company prepares before switching accounting on, and the switch itself. Works
// before accounting is on (the API's set-up routes are open then). The database decides who may change what: the chart, roles and
// receipt costs the owner and the head accountant; switch-on and the head accountant the owner.

const ROLE_LABEL: Record<AccountRole, string> = {
  inventory: 'Inventory',
  receivables: 'Customers (receivables)',
  cash: 'Cash',
  bank: 'Bank',
  card_clearing: 'Card payments in clearing',
  cheque_in_clearing: 'Cheques received, not yet cleared',
  cheque_out_clearing: 'Cheques issued, not yet cleared',
  other_clearing: 'Other payment methods in clearing',
  opening_balance: 'Opening balances',
  payables: 'Suppliers (payables)',
  grni: 'Goods received, not yet invoiced',
  expense_payables: 'Expenses payable',
  expense_default: 'Expenses (default)',
  stock_adjustment: 'Stock count differences',
  internal_use: 'Internal use of stock',
  price_variance: 'Purchase price differences',
  cogs: 'Cost of goods sold',
  sales_revenue: 'Sales revenue',
  sales_returns: 'Sales returns and allowances',
};

type RoleRow = { role: AccountRole; accountId: string | null };
type CategoryRow = { categoryId: string; name: string; accountId: string | null };
type HeadRow = { membershipId: string; userId: string; role: string; isHeadAccountant: boolean };

export function AccountingSetupPage() {
  const session = useSession();
  const reloadSession = useReloadSession();
  const person = usePeople();
  const isOwner = session.role === 'owner';
  const canManage = hasPermission(session.permissions, 'accounting.chart.manage');
  const preview = useLoad(() => api<SwitchOnPreview>('/v1/accounting/setup/preview'));
  const accounts = useLoad(() => api<Account[]>('/v1/accounting/accounts'));
  const roles = useLoad(() => api<RoleRow[]>('/v1/accounting/roles'));
  const categories = useLoad(() => api<CategoryRow[]>('/v1/accounting/category-accounts'));
  const heads = useLoad(() => api<HeadRow[]>('/v1/accounting/setup/head-accountants'));
  const uncosted = useLoad(() => api<UncostedReceipt[]>('/v1/accounting/setup/uncosted-receipts'));
  const years = useLoad(() => api<FiscalYear[]>('/v1/accounting/fiscal-years'));
  const { message, busy, run } = useNotice();
  const [costs, setCosts] = useState<Record<number, string>>({});
  const [year, setYear] = useState({ name: `FY${new Date().getFullYear()}`, startsOn: firstOfYear(), endsOn: `${new Date().getFullYear()}-12-31` });
  const [result, setResult] = useState<SwitchOnResult | null>(null);

  const all = [preview, accounts, roles, categories, heads, uncosted, years];
  if (all.some((x) => !x.data)) return <section className="page"><Loading error={all.find((x) => x.error)?.error} /></section>;
  const p = preview.data!;
  const list = accounts.data!;
  const reloadAll = () => all.forEach((x) => x.reload());
  const currency = session.org?.defaultCurrency ?? 'EGP';
  const ready = p.chartAccounts > 0 && p.missingRoles.length === 0 && p.uncostedReceipts === 0;
  const docs = p.documents;
  const docTotal = docs.stockMoves + docs.customerInvoices + docs.supplierInvoices + docs.expenses + docs.payments + docs.approvedNotes;

  return (
    <section className="page wide">
      <h1>{tr('Accounting setup')}</h1>
      <p className="muted">
        {p.accountingOn
          ? tr('Accounting is on. Every document now posts its entry automatically. The settings below can still be changed.')
          : tr('Prepare the chart of accounts and the account each kind of document posts to, then switch accounting on. Switching on posts every past document once, oldest first, and cannot be undone.')}
      </p>
      <Notice message={message} />

      {/* 1. chart */}
      <div className="form-card stack">
        <h2>{trf('1. Chart of accounts ({count} accounts)', { count: p.chartAccounts })}</h2>
        <p className="muted small">
          {tr('The default chart follows the Egyptian unified chart of accounts (groups 1 to 4). You can add your own accounts under any group.')}{' '}
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
      </div>

      {/* 2. roles */}
      <div className="form-card stack">
        <h2>{tr('2. Where each kind of document posts')}</h2>
        <p className="muted small">{tr('Each role points at one detail account. The default chart fills them all; change one only if your accountant asks.')}</p>
        {p.missingRoles.length ? <p className="error small">{trf('Not set yet: {roles}', { roles: p.missingRoles.map((r) => tr(ROLE_LABEL[r] ?? r)).join(', ') })}</p> : null}
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Role')}</th><th scope="col">{tr('Account')}</th></tr></thead><tbody>
          {roles.data!.map((r) => (
            <tr key={r.role}>
              <td>{tr(ROLE_LABEL[r.role] ?? r.role)}</td>
              <td>
                {canManage ? (
                  <AccountSelect accounts={list} value={r.accountId ?? ''} label={tr(ROLE_LABEL[r.role] ?? r.role)} onChange={(id) => id && run(async () => {
                    await api(`/v1/accounting/roles/${r.role}`, { method: 'PUT', body: JSON.stringify({ accountId: id }) });
                    return tr('Saved.');
                  }, () => { roles.reload(); preview.reload(); })} />
                ) : (
                  (() => { const a = list.find((x) => x.id === r.accountId); return a ? accountLabel(a) : '—'; })()
                )}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      </div>

      {/* 3. expense categories */}
      <div className="form-card stack">
        <h2>{tr('3. Expense categories')}</h2>
        <p className="muted small">{tr('Each expense category can post to its own expense account. Categories left empty post to the default expense account.')}</p>
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Category')}</th><th scope="col">{tr('Account')}</th></tr></thead><tbody>
          {categories.data!.map((c) => (
            <tr key={c.categoryId}>
              <td>{c.name}</td>
              <td>
                {canManage ? (
                  <AccountSelect accounts={list} value={c.accountId ?? ''} empty={tr('Default expense account')} label={c.name} onChange={(id) => run(async () => {
                    await api(`/v1/accounting/category-accounts/${c.categoryId}`, { method: 'PUT', body: JSON.stringify({ accountId: id || null }) });
                    return tr('Saved.');
                  }, categories.reload)} />
                ) : (
                  (() => { const a = list.find((x) => x.id === c.accountId); return a ? accountLabel(a) : tr('Default expense account'); })()
                )}
              </td>
            </tr>
          ))}
          {!categories.data!.length && <tr><td colSpan={2} className="muted empty">{tr('No expense categories yet.')}</td></tr>}
        </tbody></table></div>
      </div>

      {/* 4. uncosted receipts */}
      <div className="form-card stack">
        <h2>{trf('4. Stock received without a cost ({count})', { count: uncosted.data!.length })}</h2>
        <p className="muted small">{tr('Switching on values every past receipt. These were received without a cost and not from a purchase order, so enter what each unit cost. The current average cost is shown as a guide.')}</p>
        {uncosted.data!.length ? (
          <div className="table-wrap"><table><thead><tr>
            <th scope="col">{tr('Received')}</th><th scope="col">{tr('Item')}</th><th scope="col">{tr('Warehouse')}</th><th scope="col" className="right">{tr('Quantity')}</th>
            <th scope="col">{tr('Reference')}</th><th scope="col" className="right">{tr('Current average cost')}</th><th scope="col">{tr('Unit cost')}</th>
          </tr></thead><tbody>
            {uncosted.data!.map((r) => (
              <tr key={r.moveId}>
                <td className="nowrap">{formatDateTime(r.postedAt, session.org)}</td>
                <td><code>{r.sku}</code> {r.itemName}</td>
                <td>{r.warehouseName}</td>
                <td className="right">{r.qty}</td>
                <td>{r.ref}</td>
                <td className="right">{r.currentAvgCostMinor === null ? '—' : money(r.currentAvgCostMinor, currency)}</td>
                <td>
                  {canManage ? (
                    <span className="flex items-center gap-2">
                      <input inputMode="decimal" placeholder={r.currentAvgCostMinor === null ? '0.00' : (r.currentAvgCostMinor / 100).toFixed(2)} value={costs[r.moveId] ?? ''}
                        onChange={(e) => setCosts({ ...costs, [r.moveId]: e.target.value })} aria-label={trf('Unit cost of {sku}', { sku: r.sku })} />
                      <Button size="sm" variant="outline" disabled={busy || !(costs[r.moveId] ?? '').trim() || Number.isNaN(Number(costs[r.moveId]))} onClick={() => run(async () => {
                        await api(`/v1/accounting/setup/receipt-costs/${r.moveId}`, { method: 'PUT', body: JSON.stringify({ unitCostMinor: toMinor(costs[r.moveId] ?? '') }) });
                        return trf('Cost saved for {sku}.', { sku: r.sku });
                      }, () => { uncosted.reload(); preview.reload(); })}>{tr('Save')}</Button>
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="muted small">{tr('None: every receipt has a cost.')}</p>}
      </div>

      {/* 5. head accountant */}
      <div className="form-card stack">
        <h2>{tr('5. Head accountant')}</h2>
        <p className="muted small">{tr('The owner and the head accountant can change the chart and post journals without a second approval. Everyone else\'s journals wait for another person to approve them. Only an owner or admin can be head accountant.')}</p>
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Person')}</th><th scope="col">{tr('Role')}</th><th scope="col">{tr('Head accountant')}</th></tr></thead><tbody>
          {heads.data!.map((h) => (
            <tr key={h.membershipId}>
              <td>{person(h.userId)}</td>
              <td>{tr(h.role)}</td>
              <td>
                {h.role === 'owner' ? <span className="muted small">{tr('Owner (always allowed)')}</span>
                  : isOwner ? (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={h.isHeadAccountant} disabled={busy} onChange={(e) => run(async () => {
                        await api(`/v1/accounting/setup/head-accountants/${h.membershipId}`, { method: 'PUT', body: JSON.stringify({ on: e.target.checked }) });
                        return tr('Saved.');
                      }, heads.reload)} />
                      {h.isHeadAccountant ? tr('Yes') : tr('No')}
                    </label>
                  ) : (h.isHeadAccountant ? tr('Yes') : tr('No'))}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      </div>

      {/* 6. fiscal years */}
      <div className="form-card stack">
        <h2>{tr('6. Fiscal years')}</h2>
        <p className="muted small">{tr('Opening balances are dated the first day of a fiscal year, so add the year first.')}</p>
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Name')}</th><th scope="col">{tr('Starts')}</th><th scope="col">{tr('Ends')}</th></tr></thead><tbody>
          {years.data!.map((y) => <tr key={y.id}><td>{y.name}</td><td>{formatDay(y.startsOn, session.org)}</td><td>{formatDay(y.endsOn, session.org)}</td></tr>)}
          {!years.data!.length && <tr><td colSpan={3} className="muted empty">{tr('No fiscal years yet.')}</td></tr>}
        </tbody></table></div>
        {canManage ? (
          <div className="form-row">
            <label>{tr('Name')}<input value={year.name} onChange={(e) => setYear({ ...year, name: e.target.value })} /></label>
            <label>{tr('Starts')}<input type="date" value={year.startsOn} onChange={(e) => setYear({ ...year, startsOn: e.target.value })} /></label>
            <label>{tr('Ends')}<input type="date" value={year.endsOn} onChange={(e) => setYear({ ...year, endsOn: e.target.value })} /></label>
            <Button variant="outline" disabled={busy || !year.name.trim() || !year.startsOn || !year.endsOn || year.endsOn < year.startsOn} onClick={() => run(async () => {
              await api('/v1/accounting/fiscal-years', { method: 'POST', body: JSON.stringify(year) });
              return trf('Fiscal year {name} added.', { name: year.name.trim() });
            }, years.reload)}>{tr('Add fiscal year')}</Button>
          </div>
        ) : null}
      </div>

      {/* 7. switch on */}
      {!p.accountingOn ? (
        <div className="form-card stack">
          <h2>{tr('7. Switch accounting on')}</h2>
          <p>{trf('Switching on will post {count} past documents: {moves} stock movements, {sales} sales invoices, {purchases} purchase invoices, {expenses} expenses, {payments} payments and {notes} credit or debit notes.', {
            count: docTotal, moves: docs.stockMoves, sales: docs.customerInvoices, purchases: docs.supplierInvoices, expenses: docs.expenses, payments: docs.payments, notes: docs.approvedNotes,
          })}</p>
          {p.issuesWithoutCost ? <p className="muted small">{trf('{count} older stock issues have no cost recorded; they post at zero cost.', { count: p.issuesWithoutCost })}</p> : null}
          {!ready ? <p className="error small">{tr('Finish steps 1, 2 and 4 first.')}</p> : null}
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
      {p.accountingOn ? <StockValueCard canRevalue={canManage} /> : null}
      {result ? (
        <div className="form-card stack">
          <h2>{tr('Switch-on result')}</h2>
          <p>{trf('Debits {debits}, credits {credits}.', { debits: money(result.debitsMinor, currency), credits: money(result.creditsMinor, currency) })}{' '}
            <Link to="/accounting/trial-balance">{tr('Open the trial balance')}</Link></p>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ stock value check (sql/055)

type StockValueRow = { itemId: string; sku: string; name: string; onHand: number; avgCostMinor: number | null; bookMinor: number; targetMinor: number; differenceMinor: number };

/** Books vs quantity × average cost; the owner or head accountant can post one correcting entry. */
function StockValueCard({ canRevalue }: { canRevalue: boolean }) {
  const session = useSession();
  const rows = useLoad(() => api<StockValueRow[]>('/v1/accounting/stock-value'));
  const { message, busy, run } = useNotice();
  const [note, setNote] = useState('');
  const currency = session.org?.defaultCurrency ?? 'EGP';
  if (!rows.data) return <div className="form-card"><Loading error={rows.error} rows={2} /></div>;
  const off = rows.data.filter((r) => r.differenceMinor !== 0);
  const sum = (k: 'bookMinor' | 'targetMinor' | 'differenceMinor') => rows.data!.reduce((s, r) => s + r[k], 0);
  return (
    <div className="form-card stack">
      <h2>{tr('Stock value check')}</h2>
      <p className="muted small">{tr('Each item\'s value in the books should equal quantity on hand × average cost. It can drift when costs were set outside normal receipts, for example in imported or sample data.')}</p>
      <Notice message={message} />
      <p>{trf('In the books: {book}. At average cost: {target}. Difference: {diff} on {n} items.', {
        book: money(sum('bookMinor'), currency), target: money(sum('targetMinor'), currency), diff: money(sum('differenceMinor'), currency), n: off.length,
      })}</p>
      {off.length ? (
        <>
          <div className="table-wrap"><table><thead><tr>
            <th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('On hand')}</th><th scope="col" className="right">{tr('Average cost')}</th>
            <th scope="col" className="right">{tr('In the books')}</th><th scope="col" className="right">{tr('At average cost')}</th><th scope="col" className="right">{tr('Difference')}</th>
          </tr></thead><tbody>
            {off.slice(0, 50).map((r) => (
              <tr key={r.itemId}><td><code>{r.sku}</code> {r.name}</td><td className="right">{r.onHand}</td><td className="right">{r.avgCostMinor === null ? '—' : money(r.avgCostMinor, currency)}</td>
                <td className="right">{money(r.bookMinor, currency)}</td><td className="right">{money(r.targetMinor, currency)}</td><td className="right">{money(r.differenceMinor, currency)}</td></tr>
            ))}
          </tbody></table></div>
          {canRevalue ? (
            <div className="form-row">
              <label>{tr('Reason')}<input value={note} maxLength={300} placeholder={tr('e.g. Correct sample-data costs')} onChange={(e) => setNote(e.target.value)} /></label>
              <ConfirmButton label={tr('Revalue stock to average cost')} confirmLabel={tr('Yes, post the correction')} disabled={busy || !note.trim()}
                question={trf('Post one entry of {diff} to bring stock to average cost? It cannot be edited afterwards, only reversed by another entry.', { diff: money(sum('differenceMinor'), currency) })}
                onConfirm={() => run(async () => {
                  const r = await api<{ items: number; netMinor: number }>('/v1/accounting/stock-value/revalue', { method: 'POST', body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), note }) });
                  return trf('{n} items revalued; net {amount}.', { n: r.items, amount: money(r.netMinor, currency) });
                }, rows.reload)} />
            </div>
          ) : <p className="muted small">{tr('Only the owner or the head accountant can post the correction.')}</p>}
        </>
      ) : <p className="muted small">{tr('Every item is at quantity × average cost.')}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ chart of accounts

/** 'asset' is shown as "Asset" (or its Arabic), not the raw database value. */
const kindLabel = (k: string) => tr(k.charAt(0).toUpperCase() + k.slice(1));

export function ChartPage() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'accounting.chart.manage');
  const accounts = useLoad(() => api<Account[]>('/v1/accounting/accounts'));
  const { message, busy, run } = useNotice();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ parentId: '', code: '', name: '', nameAr: '', kind: 'expense' });
  const [editing, setEditing] = useState<{ id: string; name: string; nameAr: string } | null>(null);

  if (!accounts.data) return <section className="page"><Loading error={accounts.error} /></section>;
  const list = accounts.data;
  const depth = depths(list);
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((a) => a.code.startsWith(q) || a.name.toLowerCase().includes(q) || (a.nameAr ?? '').includes(query.trim())) : list;
  const parent = list.find((a) => a.id === form.parentId);
  const save = (a: Account, patch: Partial<{ name: string; nameAr: string; active: boolean }>) => run(async () => {
    await api(`/v1/accounting/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ name: patch.name ?? a.name, nameAr: patch.nameAr ?? a.nameAr ?? '', active: patch.active ?? a.active }) });
    return trf('{code} saved.', { code: a.code });
  }, () => { setEditing(null); accounts.reload(); });

  return (
    <section className="page wide">
      <h1>{tr('Chart of accounts')}</h1>
      <p className="muted">{tr('Groups hold sub-accounts; entries go to detail accounts only. A sub-account\'s code starts with its group\'s code.')}</p>
      <Notice message={message} />
      {!list.length ? <p className="muted">{tr('No accounts yet.')} <Link to="/accounting/setup">{tr('Add the default chart in Accounting setup.')}</Link></p> : null}

      {canManage && list.length ? (
        <FormToggle label={tr('Add an account')}>
          <div className="form-row">
            <label>{tr('Under')}
              <select value={form.parentId} onChange={(e) => { const pa = list.find((a) => a.id === e.target.value); setForm({ ...form, parentId: e.target.value, code: pa ? pa.code : form.code }); }}>
                <option value="">{tr('Top level (new group)')}</option>
                {list.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
              </select>
            </label>
            <label>{tr('Code')}<input inputMode="numeric" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} /></label>
            <label>{tr('Name')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
            {!form.parentId || parent?.kind === 'equity' || parent?.kind === 'liability' ? (
              <label>{tr('Kind')}
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {ACCOUNT_KINDS.filter((k) => !parent || k === 'equity' || k === 'liability').map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {parent ? <p className="muted small">{trf('The code must start with {code} and be longer.', { code: parent.code })}</p> : null}
          <div>
            <Button disabled={busy || !form.code || !form.name.trim()} onClick={() => run(async () => {
              await api('/v1/accounting/accounts', { method: 'POST', body: JSON.stringify({ ...form, kind: !form.parentId || parent?.kind === 'equity' || parent?.kind === 'liability' ? form.kind : null }) });
              return trf('Account {code} added.', { code: form.code });
            }, () => { setForm({ ...form, code: parent?.code ?? '', name: '', nameAr: '' }); accounts.reload(); })}>{tr('Add account')}</Button>
          </div>
        </FormToggle>
      ) : null}

      <label className="search">{tr('Search by code or name')}<input type="search" placeholder={tr('Search…')} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="table-wrap"><table><thead><tr>
        <th scope="col">{tr('Code')}</th><th scope="col">{tr('Name')}</th><th scope="col">{tr('Kind')}</th><th scope="col">{tr('Status')}</th>{canManage ? <th scope="col"><span className="sr-only">{tr('Actions')}</span></th> : null}
      </tr></thead><tbody>
        {shown.map((a) => (
          <tr key={a.id} className={a.active ? undefined : 'muted'}>
            <td><code>{a.code}</code></td>
            <td style={{ paddingInlineStart: `${0.75 + (depth.get(a.id) ?? 0) * 1.25}rem` }}>
              {editing?.id === a.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label={tr('Name')} />
                  <input dir="rtl" value={editing.nameAr} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} aria-label={tr('Name in Arabic (optional)')} />
                  <Button size="sm" disabled={busy || !editing.name.trim()} onClick={() => save(a, { name: editing.name, nameAr: editing.nameAr })}>{tr('Save')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr('Cancel')}</Button>
                </span>
              ) : (
                <Link className="account-link" to={`/accounting/accounts/${a.id}`}>{a.isLeaf ? accountName(a) : <strong>{accountName(a)}</strong>}</Link>
              )}
            </td>
            <td>{kindLabel(a.kind)}</td>
            <td>{a.active ? (a.isLeaf ? tr('Detail') : tr('Group')) : tr('Inactive')}</td>
            {canManage ? (
              <td className="nowrap">
                {editing?.id !== a.id ? <Button size="sm" variant="ghost" onClick={() => setEditing({ id: a.id, name: a.name, nameAr: a.nameAr ?? '' })}>{tr('Edit')}</Button> : null}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(a, { active: !a.active })}>{a.active ? tr('Deactivate') : tr('Reactivate')}</Button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody></table></div>
    </section>
  );
}
