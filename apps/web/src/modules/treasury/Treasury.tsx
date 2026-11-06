import { useState } from 'react';
import { hasPermission, type AccountLine, type Branch, type TreasuryAccount, type TreasuryKind, type TreasuryTransfer } from '@erp/shared';
import { ClickRow } from '../../components/ClickRow';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api, apiDownload } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { usePeople } from '../../lib/people';
import { Link, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill, toMinor } from '../trade/common';
import { Notice, firstOfYear, money, side, sourceLabel, sourcePath, today, useNotice } from '../accounting/common';

// Treasury (documentation/plans/TREASURY_PLAN.md §6; database sql/051). Cash boxes, bank accounts and clearing accounts by branch;
// balances and lines come from the ledger. Owner and admin only; the database narrows adding accounts to the owner and the head
// accountant.

const KIND_LABEL: Record<TreasuryKind, string> = { cash: 'Cash box', bank: 'Bank account', clearing: 'Clearing account' };
const nameOf = (x: { name: string; nameAr: string | null }) => (currentLanguage() === 'ar' && x.nameAr ? x.nameAr : x.name);
const useAccounts = () => useLoad(() => api<TreasuryAccount[]>('/v1/treasury/accounts'));
const useBranches = () => useLoad(() => api<Branch[]>('/v1/core/branches'));

export function TreasuryPage() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'treasury.accounts.manage');
  const accounts = useAccounts();
  const branches = useBranches();
  const { message, busy, run } = useNotice();
  const [form, setForm] = useState({ code: '', name: '', nameAr: '', kind: 'cash' as TreasuryKind, currency: '', branchId: '', bankName: '', bankAccountNo: '' });
  if (!accounts.data || !branches.data) return <section className="page"><Loading error={accounts.error ?? branches.error} /></section>;
  const list = accounts.data;
  const branchName = (id: string | null) => {
    const b = branches.data?.find((x) => x.id === id);
    return b ? nameOf(b) : tr('No branch');
  };
  const groups = [...new Set(list.map((a) => a.branchId ?? ''))];
  const totals = new Map<string, number>();
  for (const a of list) if (a.kind !== 'clearing') totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balanceMinor);

  return (
    <section className="page wide">
      <h1>{tr('Treasury')}</h1>
      <p className="muted">{tr('Cash boxes and bank accounts, by branch. Balances come from the books; every payment by cash or bank goes through one of them.')}</p>
      <Notice message={message} />

      {!list.length ? (
        <div className="form-card stack">
          <p>{tr('No treasury accounts yet. Start with the main cash box, the main bank account and the clearing accounts, on the accounts your books already use.')}</p>
          {canManage ? (
            <div><Button disabled={busy} onClick={() => run(async () => {
              const r = await api<{ accountsAdded: number }>('/v1/treasury/setup/prepare', { method: 'POST' });
              return trf('{count} accounts added.', { count: r.accountsAdded });
            }, accounts.reload)}>{tr('Add the default treasury accounts')}</Button></div>
          ) : <p className="muted small">{tr('Only the owner or the head accountant can add them.')}</p>}
        </div>
      ) : (
        <>
          <p>{[...totals].map(([cur, v]) => trf('Cash and banks: {amount}', { amount: money(v, cur) })).join(' · ')}</p>
          {groups.map((g) => (
            <div key={g || 'none'}>
              <h2 className="related">{branchName(g || null)}</h2>
              <div className="table-wrap"><table><thead><tr>
                <th scope="col">{tr('Code')}</th><th scope="col">{tr('Name')}</th><th scope="col">{tr('Kind')}</th><th scope="col">{tr('Bank')}</th><th scope="col" className="right">{tr('Balance')}</th><th scope="col">{tr('Status')}</th>
              </tr></thead><tbody>
                {list.filter((a) => (a.branchId ?? '') === g).map((a) => (
                  <ClickRow key={a.id} to={`/treasury/accounts/${a.id}`}>
                    <td><Link to={`/treasury/accounts/${a.id}`}><code>{a.code}</code></Link></td>
                    <td>{nameOf(a)}</td>
                    <td>{tr(KIND_LABEL[a.kind])}</td>
                    <td>{a.bankName ? `${a.bankName}${a.bankAccountNo ? ` · ${a.bankAccountNo}` : ''}` : ''}</td>
                    <td className={a.balanceMinor < 0 ? 'right error' : 'right'}>{money(a.balanceMinor, a.currency)}</td>
                    <td>{a.active ? null : <Pill status="cancelled" label={tr('Inactive')} />}</td>
                  </ClickRow>
                ))}
              </tbody></table></div>
            </div>
          ))}
          {list.some((a) => a.kind !== 'clearing' && a.balanceMinor < 0) ? <p className="error small">{tr('A cash box or bank account below zero usually means a payment was recorded in the wrong one.')}</p> : null}
        </>
      )}

      {canManage && list.length ? (
        <FormToggle label={tr('Add a cash box or bank account')}>
          <div className="form-row">
            <label>{tr('Kind')}
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as TreasuryKind })}>
                <option value="cash">{tr('Cash box')}</option>
                <option value="bank">{tr('Bank account')}</option>
              </select>
            </label>
            <label>{tr('Code')}<input value={form.code} placeholder="CASH-2" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
            <label>{tr('Name')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>{tr('Branch')}
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                <option value="">{tr('No branch')}</option>
                {branches.data.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} · {nameOf(b)}</option>)}
              </select>
            </label>
            <label>{tr('Currency')}<input maxLength={3} placeholder={session.org?.defaultCurrency ?? 'EGP'} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
            {form.kind === 'bank' ? (
              <>
                <label>{tr('Bank name')}<input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></label>
                <label>{tr('Account number or IBAN')}<input value={form.bankAccountNo} maxLength={40} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} /></label>
              </>
            ) : null}
          </div>
          <p className="muted small">{tr('A new account in the books is created for it under group 19 (cash and banks).')}</p>
          <div><Button disabled={busy || !form.code.trim() || !form.name.trim()} onClick={() => run(async () => {
            await api('/v1/treasury/accounts', { method: 'POST', body: JSON.stringify({ ...form, createLedgerAccount: true }) });
            return trf('{code} added.', { code: form.code });
          }, () => { setForm({ ...form, code: '', name: '', nameAr: '', bankName: '', bankAccountNo: '' }); accounts.reload(); })}>{tr('Add')}</Button></div>
        </FormToggle>
      ) : null}
    </section>
  );
}

export function TreasuryAccountPage() {
  const session = useSession();
  const id = useParam('id');
  const canManage = hasPermission(session.permissions, 'treasury.accounts.manage');
  const accounts = useAccounts();
  const branches = useBranches();
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const [shown, setShown] = useState({ from, to });
  const lines = useLoad(() => api<{ currency: string; lines: AccountLine[] }>(`/v1/treasury/accounts/${id}/lines?from=${shown.from}&to=${shown.to}`));
  const { message, busy, run } = useNotice();
  const [edit, setEdit] = useState<{ name: string; nameAr: string; branchId: string; bankName: string; bankAccountNo: string } | null>(null);
  const a = accounts.data?.find((x) => x.id === id);
  if (!accounts.data || !branches.data) return <section className="page"><Loading error={accounts.error} /></section>;
  if (!a) return <section className="page"><p className="error">{tr('Not found')}</p></section>;
  const save = (patch: Partial<{ name: string; nameAr: string; branchId: string; bankName: string; bankAccountNo: string; active: boolean }>) => run(async () => {
    await api(`/v1/treasury/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({
      code: a.code, name: a.name, nameAr: a.nameAr ?? '', kind: a.kind, currency: a.currency, branchId: a.branchId ?? '', bankName: a.bankName ?? '', bankAccountNo: a.bankAccountNo ?? '', active: a.active, ...patch,
    }) });
    return tr('Saved.');
  }, () => { setEdit(null); accounts.reload(); });

  return (
    <section className="page wide">
      <p><Link to="/treasury">← {tr('Treasury')}</Link></p>
      <h1><code>{a.code}</code> · {nameOf(a)}</h1>
      <p className="muted">
        {tr(KIND_LABEL[a.kind])} · {a.currency}
        {a.bankName ? ` · ${a.bankName}${a.bankAccountNo ? ` ${a.bankAccountNo}` : ''}` : ''}
        {' · '}{trf('Balance today: {amount}', { amount: money(a.balanceMinor, a.currency) })}
      </p>
      <Notice message={message} />
      {canManage ? (
        edit ? (
          <div className="form-card stack">
            <div className="form-row">
              <label>{tr('Name')}<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={edit.nameAr} onChange={(e) => setEdit({ ...edit, nameAr: e.target.value })} /></label>
              <label>{tr('Branch')}
                <select value={edit.branchId} onChange={(e) => setEdit({ ...edit, branchId: e.target.value })}>
                  <option value="">{tr('No branch')}</option>
                  {branches.data.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} · {nameOf(b)}</option>)}
                </select>
              </label>
              {a.kind === 'bank' ? (
                <>
                  <label>{tr('Bank name')}<input value={edit.bankName} onChange={(e) => setEdit({ ...edit, bankName: e.target.value })} /></label>
                  <label>{tr('Account number or IBAN')}<input value={edit.bankAccountNo} maxLength={40} onChange={(e) => setEdit({ ...edit, bankAccountNo: e.target.value })} /></label>
                </>
              ) : null}
            </div>
            <div className="form-row">
              <Button disabled={busy || !edit.name.trim()} onClick={() => save(edit)}>{tr('Save')}</Button>
              <Button variant="ghost" onClick={() => setEdit(null)}>{tr('Cancel')}</Button>
            </div>
          </div>
        ) : (
          <div className="form-row">
            <Button variant="outline" onClick={() => setEdit({ name: a.name, nameAr: a.nameAr ?? '', branchId: a.branchId ?? '', bankName: a.bankName ?? '', bankAccountNo: a.bankAccountNo ?? '' })}>{tr('Edit')}</Button>
            {a.active
              ? <ConfirmButton label={tr('Deactivate')} confirmLabel={tr('Yes, deactivate')} question={tr('Deactivate this account? It must be empty first.')} disabled={busy} onConfirm={() => save({ active: false })} />
              : <Button variant="outline" disabled={busy} onClick={() => save({ active: true })}>{tr('Reactivate')}</Button>}
          </div>
        )
      ) : null}

      <div className="form-row">
        <label>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button variant="outline" disabled={!from || !to || to < from} onClick={() => { setShown({ from, to }); lines.reload(); }}>{tr('Show')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
          await apiDownload(`/v1/treasury/accounts/${a.id}/lines?from=${shown.from}&to=${shown.to}&format=csv`, `${a.code}-${shown.from}-to-${shown.to}.csv`);
          return tr('Downloaded.');
        })}>{tr('Download CSV')}</Button>
        <Button variant="ghost" onClick={() => window.print()}>{tr('Print')}</Button>
      </div>
      {!lines.data ? <Loading error={lines.error} /> : (
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('Date')}</th><th scope="col">{tr('Entry')}</th><th scope="col">{tr('Description')}</th><th scope="col" className="right">{tr('In')}</th><th scope="col" className="right">{tr('Out')}</th><th scope="col" className="right">{tr('Balance')}</th>
        </tr></thead><tbody>
          {lines.data.lines.map((l, i) => {
            const path = l.sourceType && l.sourceId ? sourcePath(l.sourceType, l.sourceId) : null;
            return (
              <tr key={l.lineId ?? `o${i}`}>
                <td className="nowrap">{formatDay(l.entryDate, session.org)}</td>
                <td>{l.entryId ? <Link to={`/accounting/entries/${l.entryId}`}><code>{l.entryNumber}</code></Link> : null}</td>
                <td>{l.isOpening ? <strong>{tr('Opening balance')}</strong> : <>{l.memo}{path ? <> · <Link to={path}>{sourceLabel(l.sourceType ?? '')}</Link></> : null}</>}</td>
                <td className="right">{side(l.debitMinor, lines.data!.currency)}</td>
                <td className="right">{side(l.creditMinor, lines.data!.currency)}</td>
                <td className="right">{money(l.balanceMinor, lines.data!.currency)}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}
    </section>
  );
}

export function TransfersPage() {
  const session = useSession();
  const person = usePeople();
  const canCreate = hasPermission(session.permissions, 'treasury.transfers.create');
  const accounts = useAccounts();
  const transfers = useLoad(() => api<TreasuryTransfer[]>('/v1/treasury/transfers'));
  const { message, busy, run } = useNotice();
  const [form, setForm] = useState({ fromAccountId: '', toAccountId: '', amount: '', date: today(), note: '' });
  if (!accounts.data || !transfers.data) return <section className="page"><Loading error={accounts.error ?? transfers.error} /></section>;
  const acc = new Map(accounts.data.map((a) => [a.id, a]));
  const label = (id: string) => { const a = acc.get(id); return a ? `${a.code} · ${nameOf(a)}` : id; };
  const active = accounts.data.filter((a) => a.active);
  const fromAcc = acc.get(form.fromAccountId);
  const targets = active.filter((a) => a.id !== form.fromAccountId && (!fromAcc || a.currency === fromAcc.currency));

  return (
    <section className="page wide">
      <h1>{tr('Transfers')}</h1>
      <p className="muted">{tr('Money moved between cash boxes and bank accounts, for example a cash deposit at the bank, or card payments settled into the bank.')}</p>
      <Notice message={message} />
      {canCreate ? (
        <FormToggle label={tr('New transfer')}>
          <div className="form-row">
            <label>{tr('From')}
              <select value={form.fromAccountId} onChange={(e) => setForm({ ...form, fromAccountId: e.target.value, toAccountId: '' })}>
                <option value="">{tr('Choose…')}</option>
                {active.map((a) => <option key={a.id} value={a.id}>{label(a.id)} ({money(a.balanceMinor, a.currency)})</option>)}
              </select>
            </label>
            <label>{tr('To')}
              <select value={form.toAccountId} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}>
                <option value="">{tr('Choose…')}</option>
                {targets.map((a) => <option key={a.id} value={a.id}>{label(a.id)}</option>)}
              </select>
            </label>
            <label>{tr('Amount')}<input inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>{tr('Date')}<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          </div>
          <label>{tr('Note (optional)')}<input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div><Button disabled={busy || !form.fromAccountId || !form.toAccountId || toMinor(form.amount) <= 0 || !form.date} onClick={() => run(async () => {
            const r = await api<{ number: string }>('/v1/treasury/transfers', { method: 'POST', body: JSON.stringify({
              fromAccountId: form.fromAccountId, toAccountId: form.toAccountId, amountMinor: toMinor(form.amount), date: form.date, note: form.note,
            }) });
            return trf('Transfer {number} recorded.', { number: r.number });
          }, () => { setForm({ ...form, amount: '', note: '' }); transfers.reload(); accounts.reload(); })}>{tr('Record transfer')}</Button></div>
        </FormToggle>
      ) : null}

      <div className="table-wrap"><table><thead><tr>
        <th scope="col">{tr('No.')}</th><th scope="col">{tr('Date')}</th><th scope="col">{tr('From')}</th><th scope="col">{tr('To')}</th><th scope="col">{tr('Note')}</th><th scope="col">{tr('By')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th>
      </tr></thead><tbody>
        {transfers.data.map((t) => (
          <tr key={t.id}>
            <td>{t.entryId ? <Link to={`/accounting/entries/${t.entryId}`}><code>{t.number}</code></Link> : <code>{t.number}</code>}</td>
            <td className="nowrap">{formatDay(t.transferDate, session.org)}</td>
            <td>{label(t.fromAccountId)}</td>
            <td>{label(t.toAccountId)}</td>
            <td>{t.note}</td>
            <td>{person(t.createdBy)}</td>
            <td className="right">{money(t.amountMinor, t.currency)}</td>
            <td><Pill status={t.status === 'void' ? 'cancelled' : 'received'} label={t.status === 'void' ? tr('Void') : tr('Recorded')} /></td>
            <td>{canCreate && t.status === 'recorded' ? (
              <ConfirmButton size="sm" label={tr('Void')} confirmLabel={tr('Yes, void')} question={tr('Void this transfer? A reversing entry is posted today.')} disabled={busy}
                onConfirm={() => run(async () => { await api(`/v1/treasury/transfers/${t.id}/void`, { method: 'POST' }); return trf('{number} voided.', { number: t.number }); }, () => { transfers.reload(); accounts.reload(); })} />
            ) : null}</td>
          </tr>
        ))}
        {!transfers.data.length && <tr><td colSpan={9} className="muted empty">{tr('No transfers yet.')}</td></tr>}
      </tbody></table></div>
    </section>
  );
}
