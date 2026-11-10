import { useState } from 'react';
import {
  fingerprints,
  hasPermission,
  readStatement,
  STATEMENT_DATE_FORMATS,
  type StatementDateFormat,
  type StatementLine,
  type StatementMapping,
  type StatementRowError,
  type TreasuryAccount,
} from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { money } from '../accounting/common';
import { type Category, type Line } from './statementTypes';

// ------------------------------------------------------------------ explaining a line (sql/068)

export type OpenItem = { id: string; kind: 'customer_invoice' | 'supplier_invoice' | 'expense'; number: string; currency: string; leftMinor: number; dueDate: string };
export type ExplainKind = 'expense' | 'customer_payment' | 'supplier_payment' | 'transfer';

/** Record what an unmatched bank line was: money out as an expense, a supplier payment or a transfer; money in as a customer payment
 *  or a transfer. Saved through the usual functions (with their checks), dated on the bank line, for its amount, and matched. */
export function ExplainForm({ line, accountId, currency, busy, onCancel, onSubmit }: {
  line: Line;
  accountId: string;
  currency: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, string>) => void;
}) {
  const out = line.amountMinor < 0;
  const kinds: ExplainKind[] = out ? ['expense', 'supplier_payment', 'transfer'] : ['customer_payment', 'transfer'];
  const [kind, setKind] = useState<ExplainKind>(kinds[0] ?? 'transfer');
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const categories = useLoad(() => (out ? api<Category[]>('/v1/finance/categories') : Promise.resolve([] as Category[])));
  const items = useLoad(() => api<OpenItem[]>(`/v1/finance/open-items?direction=${out ? 'out' : 'in'}`).catch(() => [] as OpenItem[]));
  const accounts = useLoad(() => api<TreasuryAccount[]>('/v1/treasury/accounts'));
  const amount = Math.abs(line.amountMinor);
  // Open invoices or bills in this currency, closest amount first: the right one is usually at the top.
  const open = (items.data ?? [])
    .filter((i) => i.kind === (kind === 'customer_payment' ? 'customer_invoice' : 'supplier_invoice') && i.currency === currency)
    .sort((a, b) => Math.abs(a.leftMinor - amount) - Math.abs(b.leftMinor - amount))
    .slice(0, 30);
  const others = (accounts.data ?? []).filter((a) => a.id !== accountId && a.active && a.currency === currency);
  const KIND_LABEL: Record<ExplainKind, string> = {
    expense: 'An expense paid from the bank',
    supplier_payment: 'A payment to a supplier',
    customer_payment: 'A payment from a customer',
    transfer: out ? 'A transfer to another of our accounts' : 'A transfer from another of our accounts',
  };
  const ready = kind === 'expense' || choice !== '';
  const body = (): Record<string, string> => {
    const b: Record<string, string> = { kind, note };
    if (kind === 'expense' && choice) b.categoryId = choice;
    if (kind === 'customer_payment') b.invoiceId = choice;
    if (kind === 'supplier_payment') b.billId = choice;
    if (kind === 'transfer') b.otherAccountId = choice;
    return b;
  };

  return (
    <div className="form-card stack">
      <label>
        {tr('What was it?')}
        <select value={kind} onChange={(e) => { setKind(e.target.value as ExplainKind); setChoice(''); }}>
          {kinds.map((k) => <option key={k} value={k}>{tr(KIND_LABEL[k])}</option>)}
        </select>
      </label>
      {kind === 'expense' && (
        <label>
          {tr('Expense category')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr('Bank charges (created if missing)')}</option>
            {(categories.data ?? []).filter((c) => c.name.toLowerCase() !== 'bank charges').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {(kind === 'customer_payment' || kind === 'supplier_payment') && (
        <label>
          {kind === 'customer_payment' ? tr('Which invoice?') : tr('Which supplier bill?')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr('Choose…')}</option>
            {open.map((i) => <option key={i.id} value={i.id}>{i.number} · {trf('{amount} still due', { amount: money(i.leftMinor, i.currency) })}</option>)}
          </select>
        </label>
      )}
      {(kind === 'customer_payment' || kind === 'supplier_payment') && items.data && open.length === 0 && <p className="muted small">{tr('Nothing open in this currency.')}</p>}
      {kind === 'transfer' && (
        <label>
          {tr('The other account')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr('Choose…')}</option>
            {others.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </label>
      )}
      <label>{tr('Note (optional)')}<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={line.description} /></label>
      <p className="muted small">{trf('Recorded on {date} for {amount}, through this bank account, then matched to this line.', { date: line.bookingDate, amount: money(amount, currency) })}</p>
      <div className="form-actions">
        <Button size="sm" disabled={busy || !ready} onClick={() => onSubmit(body())}>{tr('Record and match')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{tr('Cancel')}</Button>
      </div>
    </div>
  );
}
