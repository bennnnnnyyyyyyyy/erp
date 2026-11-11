import { useState } from 'react';
import { ACCOUNT_KINDS, type Account } from '@erp/shared';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, accountLabel, accountName, depths, money, today, useChartManager, useNotice } from './common';

// Stock value check and the chart of accounts. The accounting setup guide is in SetupGuide.tsx (its accountant-only part in SetupAdvanced.tsx).

// ------------------------------------------------------------------ stock value check (sql/055)

type StockValueRow = { itemId: string; sku: string; name: string; onHand: number; avgCostMinor: number | null; bookMinor: number; targetMinor: number; differenceMinor: number };

/** Accounting > Stock value (decision D8, 9 Nov 2026): its own page, so it is found again when needed. */
export function StockValuePage() {
  const canRevalue = useChartManager();
  return (
    <section className="page wide">
      <h1>{tr('Stock value')}</h1>
      <StockValueCard canRevalue={canRevalue} />
    </section>
  );
}

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
          {off.length > 50 ? <p className="muted small">{trf('{n} more items are not shown; all of them are corrected together.', { n: off.length - 50 })}</p> : null}
          {/* The effect on profit is said before posting (decision D8): a correction moves the difference into this month's results. */}
          <p className="small"><strong>{trf('Effect on profit this month: {diff}.', { diff: money(sum('differenceMinor'), currency) })}</strong> {tr('The difference is booked as a stock adjustment, which changes this month\'s profit by the same amount.')}</p>
          {canRevalue ? (
            <div className="form-row">
              <label>{tr('Reason')}<input value={note} maxLength={300} placeholder={tr('e.g. Correct sample-data costs')} onChange={(e) => setNote(e.target.value)} /></label>
              <ConfirmButton label={tr('Revalue stock to average cost')} confirmLabel={tr('Yes, post the correction')} disabled={busy || !note.trim()}
                question={trf('Post one entry of {diff} to bring stock to average cost? Profit this month changes by the same amount. It cannot be edited afterwards, only reversed by another entry.', { diff: money(sum('differenceMinor'), currency) })}
                onConfirm={() => run(async () => {
                  const r = await api<{ items: number; netMinor: number }>('/v1/accounting/stock-value/revalue', { method: 'POST', body: JSON.stringify({ date: today(), note }) });
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
  const canManage = useChartManager();
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
