import { useState } from 'react';
import {
  hasPermission,
  journalProblem,
  type Account,
  type AccountLine,
  type JournalLineInput,
  type LedgerEntry,
  type ManualJournal,
  type TrialBalanceRow,
} from '@erp/shared';
import { ClickRow } from '../../components/ClickRow';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api, apiDownload } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { usePeople } from '../../lib/people';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill, toMinor } from '../trade/common';
import { AccountSelect, Notice, accountLabel, accountName, eventLabel, firstOfYear, money, side, sourceLabel, sourcePath, today, useNotice } from './common';

// The journal, manual journals with approval, the trial balance and an account's lines (plan section 6). Needs accounting on.

const useAccounts = () => useLoad(() => api<Account[]>('/v1/accounting/accounts'));

/** Whether this person may post and reverse without a second approval: the owner, or the head accountant (sql/045, 048). */
function usePostsDirect(): boolean {
  const session = useSession();
  const heads = useLoad(() =>
    api<{ userId: string; isHeadAccountant: boolean }[]>('/v1/accounting/setup/head-accountants').catch(() => [] as { userId: string; isHeadAccountant: boolean }[]),
  );
  if (!hasPermission(session.permissions, 'accounting.journal.post_direct')) return false;
  return session.role === 'owner' || (heads.data ?? []).some((h) => h.userId === session.userId && h.isHeadAccountant);
}
const byId = (list: Account[] | null) => new Map((list ?? []).map((a) => [a.id, a]));
const query = (name: string) => new URLSearchParams(window.location.search).get(name) ?? '';

// ------------------------------------------------------------------ journal (every posted entry)

export function EntriesPage() {
  const session = useSession();
  const [from, setFrom] = useState(query('from'));
  const [to, setTo] = useState(query('to'));
  const [source, setSource] = useState('');
  const [filter, setFilter] = useState({ from: query('from'), to: query('to'), source: '' });
  const entries = useLoad(() => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    return api<LedgerEntry[]>(`/v1/accounting/entries${qs.size ? `?${qs}` : ''}`);
  });

  return (
    <section className="page wide">
      <h1>{tr('Journal')}</h1>
      <p className="muted">{tr('Every entry in the books, newest first (at most 300 shown). Entries cannot be changed; a correction is a reversing entry.')}</p>
      <div className="form-row">
        <label>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>{tr('Document')}
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{tr('All')}</option>
            {['customer_invoice', 'supplier_invoice', 'stock_move', 'expense', 'payment', 'sales_note', 'manual_journal', 'cost_change'].map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
          </select>
        </label>
        <Button variant="outline" onClick={() => { setFilter({ from, to, source }); entries.reload(); }}>{tr('Show')}</Button>
      </div>
      {!entries.data ? <Loading error={entries.error} /> : (
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('No.')}</th><th scope="col">{tr('Date')}</th><th scope="col">{tr('Document')}</th><th scope="col">{tr('Description')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col" />
        </tr></thead><tbody>
          {entries.data.map((e) => (
            <ClickRow key={e.id} to={`/accounting/entries/${e.id}`}>
              <td><Link to={`/accounting/entries/${e.id}`}><code>{e.number}</code></Link></td>
              <td className="nowrap">{formatDay(e.entryDate, session.org)}</td>
              <td>{sourceLabel(e.sourceType)} · {eventLabel(e.event)}</td>
              <td>{e.memo}</td>
              <td className="right">{money(e.totalMinor, e.currency)}</td>
              <td>{e.isBackfill ? <span className="muted small">{tr('history')}</span> : null}</td>
            </ClickRow>
          ))}
          {!entries.data.length && <tr><td colSpan={6} className="muted empty">{tr('No entries yet.')}</td></tr>}
        </tbody></table></div>
      )}
    </section>
  );
}

export function EntryPage() {
  const session = useSession();
  const person = usePeople();
  const id = useParam('id');
  const entry = useLoad(() => api<LedgerEntry>(`/v1/accounting/entries/${id}`));
  const accounts = useAccounts();
  if (!entry.data || !accounts.data) return <section className="page"><Loading error={entry.error ?? accounts.error} /></section>;
  const e = entry.data;
  const acc = byId(accounts.data);
  const path = sourcePath(e.sourceType, e.sourceId);
  const lines = e.lines ?? [];
  return (
    <section className="page wide">
      <p><Link to="/accounting/entries">← {tr('Journal')}</Link></p>
      <h1><code>{e.number}</code> · {formatDay(e.entryDate, session.org)}</h1>
      <p>{e.memo}</p>
      <p className="muted small">
        {sourceLabel(e.sourceType)} · {eventLabel(e.event)}{path ? <> · <Link to={path}>{tr('Open the document')}</Link></> : null}
        {e.isBackfill ? <> · {tr('Posted from history at switch-on')}</> : null}
        {e.postedBy ? <> · {trf('Posted by {name}', { name: person(e.postedBy) })}</> : null}
        {e.approvedBy ? <> · {trf('Approved by {name}', { name: person(e.approvedBy) })}</> : null}
        {' · '}{formatDateTime(e.createdAt, session.org)}
      </p>
      {e.reversesEntryId ? <p><Link to={`/accounting/entries/${e.reversesEntryId}`}>{tr('This entry reverses an earlier entry')}</Link></p> : null}
      <div className="table-wrap"><table><thead><tr>
        <th scope="col">{tr('Account')}</th><th scope="col">{tr('Note')}</th><th scope="col" className="right">{tr('Debit')}</th><th scope="col" className="right">{tr('Credit')}</th>
      </tr></thead><tbody>
        {lines.map((l) => {
          const a = acc.get(l.accountId);
          return (
            <tr key={l.lineNo}>
              <td>{a ? <Link to={`/accounting/accounts/${a.id}?from=${firstOfYear()}&to=${today()}`}>{accountLabel(a)}</Link> : l.accountId}</td>
              <td>{l.memo}</td>
              <td className="right">{side(l.debitMinor, e.currency)}</td>
              <td className="right">{side(l.creditMinor, e.currency)}</td>
            </tr>
          );
        })}
        <tr><th scope="row" colSpan={2}>{tr('Total')}</th><td className="right"><strong>{money(lines.reduce((s, l) => s + l.debitMinor, 0), e.currency)}</strong></td><td className="right"><strong>{money(lines.reduce((s, l) => s + l.creditMinor, 0), e.currency)}</strong></td></tr>
      </tbody></table></div>
    </section>
  );
}

// ------------------------------------------------------------------ manual journals

const STATUS_PILL: Record<ManualJournal['status'], string> = { draft: 'pending', posted: 'received', rejected: 'rejected', cancelled: 'cancelled' };
const STATUS_LABEL: Record<ManualJournal['status'], string> = { draft: 'Waiting for approval', posted: 'Posted', rejected: 'Rejected', cancelled: 'Withdrawn' };

export function JournalsPage() {
  const session = useSession();
  const person = usePeople();
  const [status, setStatus] = useState('draft');
  const journals = useLoad(() => api<ManualJournal[]>(`/v1/accounting/journals${status ? `?status=${status}` : ''}`));
  const canCreate = hasPermission(session.permissions, 'accounting.journal.create');
  return (
    <section className="page wide">
      <h1>{tr('Manual journals')}</h1>
      <p className="muted">{tr('Entries typed by hand, and opening balances. Someone other than the author approves them before they post, unless the author is the owner or the head accountant.')}</p>
      <div className="form-row">
        {canCreate ? <Button onClick={() => navigate('/accounting/journals/new')}>{tr('New manual journal')}</Button> : null}
        <label>{tr('Show')}
          <select value={status} onChange={(e) => { setStatus(e.target.value); journals.reload(); }}>
            <option value="draft">{tr('Waiting for approval')}</option>
            <option value="posted">{tr('Posted')}</option>
            <option value="rejected">{tr('Rejected')}</option>
            <option value="cancelled">{tr('Withdrawn')}</option>
            <option value="">{tr('All')}</option>
          </select>
        </label>
      </div>
      {!journals.data ? <Loading error={journals.error} /> : (
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('No.')}</th><th scope="col">{tr('Date')}</th><th scope="col">{tr('Description')}</th><th scope="col">{tr('By')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th>
        </tr></thead><tbody>
          {journals.data.map((j) => (
            <ClickRow key={j.id} to={`/accounting/journals/${j.id}`}>
              <td><Link to={`/accounting/journals/${j.id}`}><code>{j.number}</code></Link></td>
              <td className="nowrap">{formatDay(j.entryDate, session.org)}</td>
              <td>{j.kind === 'opening' ? `${tr('Opening balances')} · ` : ''}{j.memo}</td>
              <td>{person(j.createdBy)}</td>
              <td className="right">{money(j.totalMinor, j.currency)}</td>
              <td><Pill status={STATUS_PILL[j.status]} label={tr(STATUS_LABEL[j.status])} /></td>
            </ClickRow>
          ))}
          {!journals.data.length && <tr><td colSpan={6} className="muted empty">{tr('Nothing here.')}</td></tr>}
        </tbody></table></div>
      )}
    </section>
  );
}

type Party = { id: string; name: string };
type DraftLine = { accountId: string; debit: string; credit: string; party: string; memo: string };
const blankLine = (): DraftLine => ({ accountId: '', debit: '', credit: '', party: '', memo: '' });

/** The journal editor: new (no id) or one's own draft. Running totals show whether it balances before saving. */
export function JournalEditPage() {
  const session = useSession();
  const id = useParam('id');
  const accounts = useAccounts();
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers').catch(() => [] as Party[]));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers').catch(() => [] as Party[]));
  const existing = useLoad(() => (id ? api<ManualJournal>(`/v1/accounting/journals/${id}`) : Promise.resolve(null)));
  const { message, busy, run } = useNotice();
  const [form, setForm] = useState<{ entryDate: string; memo: string; kind: 'manual' | 'opening'; currency: string; lines: DraftLine[] } | null>(null);
  const currencyDefault = session.org?.defaultCurrency ?? 'EGP';
  const canPost = usePostsDirect();

  if (!accounts.data || !customers.data || !suppliers.data || existing.loading) {
    return <section className="page"><Loading error={accounts.error ?? existing.error} /></section>;
  }
  const f = form ?? (existing.data
    ? {
        entryDate: existing.data.entryDate, memo: existing.data.memo, kind: existing.data.kind, currency: existing.data.currency,
        lines: (existing.data.lines ?? []).map((l) => ({
          accountId: l.accountId, debit: l.debitMinor ? (l.debitMinor / 100).toFixed(2) : '', credit: l.creditMinor ? (l.creditMinor / 100).toFixed(2) : '',
          party: l.partyType && l.partyId ? `${l.partyType}:${l.partyId}` : '', memo: l.memo ?? '',
        })),
      }
    : { entryDate: today(), memo: '', kind: 'manual' as const, currency: currencyDefault, lines: [blankLine(), blankLine()] });
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  const setLine = (i: number, patch: Partial<DraftLine>) => set({ lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

  const lines: JournalLineInput[] = f.lines
    .filter((l) => l.accountId || l.debit || l.credit)
    .map((l) => {
      const [pt, pid] = l.party.split(':');
      return {
        accountId: l.accountId,
        debitMinor: toMinor(l.debit),
        creditMinor: toMinor(l.credit),
        ...(pt && pid ? { partyType: pt as 'customer' | 'supplier', partyId: pid } : {}),
        ...(l.memo.trim() ? { memo: l.memo.trim() } : {}),
      };
    });
  const dr = lines.reduce((s, l) => s + (l.debitMinor ?? 0), 0);
  const cr = lines.reduce((s, l) => s + (l.creditMinor ?? 0), 0);
  const problem = journalProblem(lines);
  const problemText = problem === 'too_few_lines' ? tr('Add at least two lines.') : problem === 'bad_line' ? tr('Each line needs an account and either a debit or a credit.') : problem === 'unbalanced' ? trf('Debits and credits differ by {amount}.', { amount: money(Math.abs(dr - cr), f.currency) }) : null;

  const save = (post: boolean) => run(async () => {
    const body = JSON.stringify({ entryDate: f.entryDate, memo: f.memo, kind: f.kind, currency: f.currency, lines, post });
    const r = id
      ? await api<{ id: string; number: string; status: string }>(`/v1/accounting/journals/${id}`, { method: 'PUT', body })
      : await api<{ id: string; number: string; status: string }>('/v1/accounting/journals', { method: 'POST', body });
    navigate(`/accounting/journals/${r.id}`);
    return r.status === 'posted' ? trf('{number} posted.', { number: r.number }) : trf('{number} saved and waiting for approval.', { number: r.number });
  });

  return (
    <section className="page wide">
      <p><Link to="/accounting/journals">← {tr('Manual journals')}</Link></p>
      <h1>{id ? trf('Change draft {number}', { number: existing.data?.number ?? '' }) : tr('New manual journal')}</h1>
      <Notice message={message} />
      <div className="form-card stack">
        <div className="form-row">
          <label>{tr('Date')}<input type="date" value={f.entryDate} onChange={(e) => set({ entryDate: e.target.value })} /></label>
          <label>{tr('Type')}
            <select value={f.kind} onChange={(e) => set({ kind: e.target.value as 'manual' | 'opening' })}>
              <option value="manual">{tr('Manual journal')}</option>
              <option value="opening">{tr('Opening balances')}</option>
            </select>
          </label>
          <label>{tr('Currency')}<input value={f.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></label>
        </div>
        {f.kind === 'opening' ? <p className="muted small">{tr('Opening balances are dated the first day of a fiscal year. Put the difference on the opening balances account.')}</p> : null}
        <label>{tr('Description')}<input value={f.memo} maxLength={500} onChange={(e) => set({ memo: e.target.value })} /></label>
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('Account')}</th><th scope="col" className="right">{tr('Debit')}</th><th scope="col" className="right">{tr('Credit')}</th><th scope="col">{tr('Customer or supplier (optional)')}</th><th scope="col">{tr('Note')}</th><th scope="col" />
        </tr></thead><tbody>
          {f.lines.map((l, i) => (
            <tr key={i}>
              <td><AccountSelect accounts={accounts.data!} value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} /></td>
              <td><input inputMode="decimal" placeholder="0.00" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} aria-label={tr('Debit')} /></td>
              <td><input inputMode="decimal" placeholder="0.00" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} aria-label={tr('Credit')} /></td>
              <td>
                <select value={l.party} onChange={(e) => setLine(i, { party: e.target.value })} aria-label={tr('Customer or supplier (optional)')}>
                  <option value="">{tr('None')}</option>
                  {customers.data!.length ? <optgroup label={tr('Customers')}>{customers.data!.map((c) => <option key={c.id} value={`customer:${c.id}`}>{c.name}</option>)}</optgroup> : null}
                  {suppliers.data!.length ? <optgroup label={tr('Suppliers')}>{suppliers.data!.map((s) => <option key={s.id} value={`supplier:${s.id}`}>{s.name}</option>)}</optgroup> : null}
                </select>
              </td>
              <td><input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} aria-label={tr('Note')} /></td>
              <td>{f.lines.length > 2 ? <Button size="sm" variant="ghost" onClick={() => set({ lines: f.lines.filter((_, k) => k !== i) })}>{tr('Remove')}</Button> : null}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">{tr('Total')}</th>
            <td className="right"><strong>{money(dr, f.currency)}</strong></td>
            <td className="right"><strong>{money(cr, f.currency)}</strong></td>
            <td colSpan={3}>{problemText ? <span className="error small">{problemText}</span> : <span className="muted small">{tr('Balanced.')}</span>}</td>
          </tr>
        </tbody></table></div>
        <div className="form-row">
          <Button variant="outline" onClick={() => set({ lines: [...f.lines, blankLine()] })}>{tr('Add a line')}</Button>
          <Button disabled={busy || !!problem || !f.memo.trim() || !f.entryDate} onClick={() => save(false)}>{tr('Save for approval')}</Button>
          {canPost ? <Button variant="outline" disabled={busy || !!problem || !f.memo.trim() || !f.entryDate} onClick={() => save(true)}>{tr('Post now')}</Button> : null}
        </div>
        <p className="muted small">{canPost ? tr('You may post without approval (owner or head accountant).') : tr('Someone else has to approve your journal.')}</p>
      </div>
    </section>
  );
}

export function JournalPage() {
  const session = useSession();
  const person = usePeople();
  const id = useParam('id');
  const journal = useLoad(() => api<ManualJournal>(`/v1/accounting/journals/${id}`));
  const accounts = useAccounts();
  const { message, busy, run } = useNotice();
  const [comment, setComment] = useState('');
  const [reverse, setReverse] = useState({ date: today(), memo: '' });
  const postsDirect = usePostsDirect();
  if (!journal.data || !accounts.data) return <section className="page"><Loading error={journal.error ?? accounts.error} /></section>;
  const j = journal.data;
  const acc = byId(accounts.data);
  const mine = j.createdBy === session.userId;
  const canApprove = hasPermission(session.permissions, 'accounting.journal.approve') && !mine && j.status === 'draft';
  const canReverse = postsDirect && j.status === 'posted';
  const lines = j.lines ?? [];
  return (
    <section className="page wide">
      <p><Link to="/accounting/journals">← {tr('Manual journals')}</Link></p>
      <h1><code>{j.number}</code> · {formatDay(j.entryDate, session.org)} <Pill status={STATUS_PILL[j.status]} label={tr(STATUS_LABEL[j.status])} /></h1>
      <p>{j.kind === 'opening' ? `${tr('Opening balances')} · ` : ''}{j.memo}</p>
      <p className="muted small">
        {trf('Written by {name}', { name: person(j.createdBy) })} · {formatDateTime(j.createdAt, session.org)}
        {j.direct ? <> · {tr('Posted directly by the owner or head accountant')}</> : null}
        {j.decidedBy ? <> · {trf('{decision} by {name}', { decision: j.status === 'rejected' ? tr('Rejected') : tr('Approved'), name: person(j.decidedBy) })}</> : null}
        {j.decisionComment ? <> · “{j.decisionComment}”</> : null}
        {j.entryId ? <> · <Link to={`/accounting/entries/${j.entryId}`}>{tr('Open the entry')}</Link></> : null}
      </p>
      <Notice message={message} />
      <div className="table-wrap"><table><thead><tr>
        <th scope="col">{tr('Account')}</th><th scope="col">{tr('Note')}</th><th scope="col" className="right">{tr('Debit')}</th><th scope="col" className="right">{tr('Credit')}</th>
      </tr></thead><tbody>
        {lines.map((l) => {
          const a = acc.get(l.accountId);
          return <tr key={l.lineNo}><td>{a ? accountLabel(a) : l.accountId}</td><td>{l.memo}</td><td className="right">{side(l.debitMinor, j.currency)}</td><td className="right">{side(l.creditMinor, j.currency)}</td></tr>;
        })}
        <tr><th scope="row" colSpan={2}>{tr('Total')}</th><td className="right"><strong>{money(j.totalMinor, j.currency)}</strong></td><td className="right"><strong>{money(j.totalMinor, j.currency)}</strong></td></tr>
      </tbody></table></div>

      {j.status === 'draft' && mine ? (
        <div className="form-row">
          <Button variant="outline" onClick={() => navigate(`/accounting/journals/${j.id}/edit`)}>{tr('Change')}</Button>
          <ConfirmButton label={tr('Withdraw')} confirmLabel={tr('Yes, withdraw')} question={tr('Withdraw this draft? It will not post.')} disabled={busy}
            onConfirm={() => run(async () => { await api(`/v1/accounting/journals/${j.id}/cancel`, { method: 'POST' }); return tr('Withdrawn.'); }, journal.reload)} />
          <span className="muted small">{tr('Someone else has to approve your journal.')}</span>
        </div>
      ) : null}
      {canApprove ? (
        <div className="form-card stack">
          <h2>{tr('Decide')}</h2>
          <label>{tr('Comment (optional)')}<input value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-row">
            <Button disabled={busy} onClick={() => run(async () => {
              await api(`/v1/accounting/journals/${j.id}/approve`, { method: 'POST', body: JSON.stringify({ comment }) });
              return trf('{number} approved and posted.', { number: j.number });
            }, journal.reload)}>{tr('Approve and post')}</Button>
            <ConfirmButton label={tr('Reject')} confirmLabel={tr('Yes, reject')} question={tr('Reject this journal? This is final.')} disabled={busy}
              onConfirm={() => run(async () => {
                await api(`/v1/accounting/journals/${j.id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) });
                return trf('{number} rejected.', { number: j.number });
              }, journal.reload)} />
          </div>
        </div>
      ) : null}
      {canReverse ? (
        <div className="form-card stack">
          <h2>{tr('Reverse')}</h2>
          <p className="muted small">{tr('A posted journal is never changed. Reversing posts the opposite entry on the date you choose. Owner or head accountant, once.')}</p>
          <div className="form-row">
            <label>{tr('Date')}<input type="date" value={reverse.date} onChange={(e) => setReverse({ ...reverse, date: e.target.value })} /></label>
            <label>{tr('Reason')}<input value={reverse.memo} maxLength={500} onChange={(e) => setReverse({ ...reverse, memo: e.target.value })} /></label>
            <ConfirmButton label={tr('Reverse')} confirmLabel={tr('Yes, reverse')} question={tr('Post a reversing entry?')} disabled={busy || !reverse.memo.trim() || !reverse.date}
              onConfirm={() => run(async () => {
                await api(`/v1/accounting/journals/${j.id}/reverse`, { method: 'POST', body: JSON.stringify(reverse) });
                return trf('{number} reversed.', { number: j.number });
              }, journal.reload)} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ trial balance and account lines

export function TrialBalancePage() {
  const session = useSession();
  const [from, setFrom] = useState(query('from') || firstOfYear());
  const [to, setTo] = useState(query('to') || today());
  const [currency, setCurrency] = useState(session.org?.defaultCurrency ?? 'EGP');
  const [leafOnly, setLeafOnly] = useState(false);
  const [shown, setShown] = useState({ from, to, currency });
  const rows = useLoad(() => api<TrialBalanceRow[]>(`/v1/accounting/trial-balance?from=${shown.from}&to=${shown.to}&currency=${shown.currency}`));
  const { message, busy, run } = useNotice();
  const list = (rows.data ?? []).filter((r) => !leafOnly || r.isLeaf);
  const leaves = (rows.data ?? []).filter((r) => r.isLeaf);
  const total = (k: 'openingMinor' | 'debitMinor' | 'creditMinor' | 'closingMinor') => leaves.reduce((s, r) => s + r[k], 0);
  const balanced = total('debitMinor') === total('creditMinor') && total('closingMinor') === 0;

  return (
    <section className="page wide">
      <h1>{tr('Trial balance')}</h1>
      <p className="muted">{tr('Opening balance, debits and credits in the period, and closing balance for every account, in one currency. Debit balances are positive, credit balances negative. Groups add up their sub-accounts.')}</p>
      <Notice message={message} />
      <div className="form-row">
        <label>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>{tr('Currency')}<input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        <Button variant="outline" disabled={!from || !to || to < from || currency.length !== 3} onClick={() => { setShown({ from, to, currency }); rows.reload(); }}>{tr('Show')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
          await apiDownload(`/v1/accounting/trial-balance?from=${shown.from}&to=${shown.to}&currency=${shown.currency}&format=csv`, `trial-balance-${shown.from}-to-${shown.to}.csv`);
          return tr('Downloaded.');
        })}>{tr('Download CSV')}</Button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={leafOnly} onChange={(e) => setLeafOnly(e.target.checked)} />{tr('Detail accounts only')}</label>
      </div>
      {!rows.data ? <Loading error={rows.error} /> : (
        <>
          <p className={balanced ? 'muted small' : 'error small'}>{balanced ? tr('The books balance: debits equal credits.') : tr('The books do not balance. Tell the owner: this should never happen.')}</p>
          <div className="table-wrap"><table><thead><tr>
            <th scope="col">{tr('Code')}</th><th scope="col">{tr('Account')}</th><th scope="col" className="right">{tr('Opening')}</th><th scope="col" className="right">{tr('Debit')}</th><th scope="col" className="right">{tr('Credit')}</th><th scope="col" className="right">{tr('Closing')}</th>
          </tr></thead><tbody>
            {list.map((r) => (
              <ClickRow key={r.accountId} to={`/accounting/accounts/${r.accountId}?from=${shown.from}&to=${shown.to}&currency=${shown.currency}`}>
                <td><code>{r.code}</code></td>
                <td>{r.isLeaf ? accountName(r) : <strong>{accountName(r)}</strong>}</td>
                <td className="right">{money(r.openingMinor, r.currency)}</td>
                <td className="right">{side(r.debitMinor, r.currency)}</td>
                <td className="right">{side(r.creditMinor, r.currency)}</td>
                <td className="right">{money(r.closingMinor, r.currency)}</td>
              </ClickRow>
            ))}
            {!list.length && <tr><td colSpan={6} className="muted empty">{tr('No accounts yet.')}</td></tr>}
            <tr>
              <th scope="row" colSpan={2}>{tr('Total of detail accounts')}</th>
              <td className="right"><strong>{money(total('openingMinor'), shown.currency)}</strong></td>
              <td className="right"><strong>{money(total('debitMinor'), shown.currency)}</strong></td>
              <td className="right"><strong>{money(total('creditMinor'), shown.currency)}</strong></td>
              <td className="right"><strong>{money(total('closingMinor'), shown.currency)}</strong></td>
            </tr>
          </tbody></table></div>
        </>
      )}
    </section>
  );
}

export function AccountLinesPage() {
  const session = useSession();
  const id = useParam('id');
  const accounts = useAccounts();
  const [from, setFrom] = useState(query('from') || firstOfYear());
  const [to, setTo] = useState(query('to') || today());
  const [currency, setCurrency] = useState(query('currency') || session.org?.defaultCurrency || 'EGP');
  const [shown, setShown] = useState({ from, to, currency });
  const lines = useLoad(() => api<AccountLine[]>(`/v1/accounting/accounts/${id}/lines?from=${shown.from}&to=${shown.to}&currency=${shown.currency}`));
  const account = accounts.data?.find((a) => a.id === id);
  return (
    <section className="page wide">
      <p><Link to="/accounting/accounts">← {tr('Chart of accounts')}</Link> · <Link to={`/accounting/trial-balance?from=${shown.from}&to=${shown.to}`}>{tr('Trial balance')}</Link></p>
      <h1>{account ? accountLabel(account) : tr('Account')}</h1>
      {account && !account.isLeaf ? <p className="muted small">{tr('A group account: its sub-accounts\' lines are included.')}</p> : null}
      <div className="form-row">
        <label>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>{tr('Currency')}<input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        <Button variant="outline" disabled={!from || !to || to < from || currency.length !== 3} onClick={() => { setShown({ from, to, currency }); lines.reload(); }}>{tr('Show')}</Button>
      </div>
      {!lines.data ? <Loading error={lines.error} /> : (
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('Date')}</th><th scope="col">{tr('Entry')}</th><th scope="col">{tr('Description')}</th>{account && !account.isLeaf ? <th scope="col">{tr('Account')}</th> : null}
          <th scope="col" className="right">{tr('Debit')}</th><th scope="col" className="right">{tr('Credit')}</th><th scope="col" className="right">{tr('Balance')}</th>
        </tr></thead><tbody>
          {lines.data.map((l, i) => (
            <tr key={l.lineId ?? `o${i}`}>
              <td className="nowrap">{formatDay(l.entryDate, session.org)}</td>
              <td>{l.entryId ? <Link to={`/accounting/entries/${l.entryId}`}><code>{l.entryNumber}</code></Link> : null}</td>
              <td>{l.isOpening ? <strong>{tr('Opening balance')}</strong> : l.memo}</td>
              {account && !account.isLeaf ? <td>{l.accountCode ? <code>{l.accountCode}</code> : null}</td> : null}
              <td className="right">{side(l.debitMinor, shown.currency)}</td>
              <td className="right">{side(l.creditMinor, shown.currency)}</td>
              <td className="right">{money(l.balanceMinor, shown.currency)}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </section>
  );
}
