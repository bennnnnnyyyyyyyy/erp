import { useState } from 'react';
import { formatMoney, type Account } from '@erp/shared';
import { currentLanguage, tr } from '../../lib/i18n';

// Shared bits of the accounting screens (documentation/plans/ACCOUNTING_PLAN.md section 6).

export const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });
/** A debit or credit cell: blank when zero, so the eye finds the side that has the amount. */
export const side = (amountMinor: number, currency: string) => (amountMinor ? money(amountMinor, currency) : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

/** The account's name in the person's language (Arabic when there is one and the screen is in Arabic). */
export const accountName = (a: Pick<Account, 'name' | 'nameAr'>) => (currentLanguage() === 'ar' && a.nameAr ? a.nameAr : a.name);
export const accountLabel = (a: Pick<Account, 'code' | 'name' | 'nameAr'>) => `${a.code} · ${accountName(a)}`;

/** Leaf, active accounts: the only ones entries, roles and categories may use. */
export const postable = (accounts: Account[]) => accounts.filter((a) => a.isLeaf && a.active);

/** Depth in the tree from the parent links (for indenting the chart). */
export function depths(accounts: Account[]): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, number>();
  const depth = (a: Account, guard = 0): number => {
    if (out.has(a.id)) return out.get(a.id)!;
    const p = a.parentId ? byId.get(a.parentId) : undefined;
    const d = p && guard < 30 ? depth(p, guard + 1) + 1 : 0;
    out.set(a.id, d);
    return d;
  };
  accounts.forEach((a) => depth(a));
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  stock_move: 'Stock movement',
  customer_invoice: 'Sales invoice',
  supplier_invoice: 'Purchase invoice',
  expense: 'Expense',
  payment: 'Payment',
  sales_note: 'Credit or debit note',
  manual_journal: 'Manual journal',
  cost_change: 'Cost change',
  treasury_transfer: 'Treasury transfer',
  stock_revaluation: 'Stock revaluation',
};
export const sourceLabel = (t: string) => tr(SOURCE_LABEL[t] ?? t);

/** Where the document behind an entry opens, when it has its own page. */
export function sourcePath(type: string, id: string): string | null {
  switch (type) {
    case 'customer_invoice':
      return `/sales/invoices/${id}`;
    case 'supplier_invoice':
      return `/purchasing/invoices/${id}`;
    case 'expense':
      return `/finance/expenses/${id}`;
    case 'payment':
      return `/finance/payments/${id}`;
    case 'manual_journal':
      return `/accounting/journals/${id}`;
    case 'stock_move':
      return '/inventory/ledger';
    case 'treasury_transfer':
      return '/treasury/transfers';
    default:
      return null;
  }
}

// Every event the posting functions write (sql/046-051); found missing in the live browser check of 6 Nov (raw codes showed).
const EVENT_LABEL: Record<string, string> = {
  posted: 'Posted',
  issued: 'Issued',
  voided: 'Voided',
  reversed: 'Reversed',
  recorded: 'Recorded',
  received: 'Received',
  approved: 'Approved',
  revalued: 'Revalued',
  invoiced: 'Invoiced',
  billed: 'Billed',
  expensed: 'Expense recorded',
  paid_in: 'Money received',
  paid_out: 'Money paid',
  issued_sale: 'Issued for a sale',
  issued_internal: 'Issued for internal use',
  received_other: 'Received (not from a purchase order)',
  returned_in: 'Returned by customer',
  adjusted: 'Count difference',
  credited: 'Credit note',
  debited: 'Debit note',
  transferred: 'Transferred',
};
/** A readable name for an event; an unknown one is shown with its underscores turned into spaces, never as a raw code. */
export const eventLabel = (e: string) => (EVENT_LABEL[e] ? tr(EVENT_LABEL[e]) : e.replace(/_/g, ' '));

/** Stock movement kinds (inv_stock_moves.kind) in words. */
const MOVE_LABEL: Record<string, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  adjust: 'Count adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  return_in: 'Customer return',
  revaluation: 'Revaluation',
};
export const moveLabel = (k: string) => (MOVE_LABEL[k] ? tr(MOVE_LABEL[k]) : k.replace(/_/g, ' '));

export function useNotice() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<string>, after?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await work() });
      after?.();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return { message, busy, run };
}

export function Notice({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={message.ok ? 'notice' : 'error notice'} role={message.ok ? 'status' : 'alert'}>
      {message.text}
    </p>
  );
}

/** An account picker limited to postable accounts. */
export function AccountSelect({ accounts, value, onChange, empty, label }: { accounts: Account[]; value: string; onChange: (id: string) => void; empty?: string; label?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? tr('Account')}>
      <option value="">{empty ?? tr('Choose…')}</option>
      {postable(accounts).map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </select>
  );
}
