// Accounting (documentation/plans/ACCOUNTING_PLAN.md; database sql/045-049). Shapes shared by the API and the web app.

/** The account roles posting uses (sql/045 `acc_account_roles`). Every one must point at an account before switch-on (sql/047). */
export const ACCOUNT_ROLES = [
  'inventory',
  'receivables',
  'cash',
  'bank',
  'card_clearing',
  'cheque_in_clearing',
  'cheque_out_clearing',
  'other_clearing',
  'opening_balance',
  'payables',
  'grni',
  'expense_payables',
  'expense_default',
  'stock_adjustment',
  'internal_use',
  'price_variance',
  'cogs',
  'sales_revenue',
  'sales_returns',
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type AccountKind = 'asset' | 'liability' | 'equity' | 'expense' | 'revenue';
export const ACCOUNT_KINDS: readonly AccountKind[] = ['asset', 'liability', 'equity', 'expense', 'revenue'];

export type Account = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  kind: AccountKind;
  active: boolean;
  /** No sub-accounts: only these take entry lines and roles. */
  isLeaf: boolean;
};

export type SwitchOnPreview = {
  accountingOn: boolean;
  chartAccounts: number;
  missingRoles: AccountRole[];
  uncostedReceipts: number;
  issuesWithoutCost: number;
  documents: {
    stockMoves: number;
    customerInvoices: number;
    supplierInvoices: number;
    expenses: number;
    payments: number;
    approvedNotes: number;
  };
};

export type SwitchOnResult = {
  documents: number;
  entries: number;
  debitsMinor: number;
  creditsMinor: number;
  chartSeeded: number;
  ms: number;
};

export type UncostedReceipt = {
  moveId: number;
  postedAt: string;
  itemId: string;
  sku: string;
  itemName: string;
  warehouseName: string;
  qty: number;
  ref: string | null;
  currentAvgCostMinor: number | null;
};

export type FiscalYear = { id: string; name: string; startsOn: string; endsOn: string; status: 'open' | 'closed' };

export type JournalLineInput = {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
  partyType?: 'customer' | 'supplier';
  partyId?: string;
  memo?: string;
};

export type JournalStatus = 'draft' | 'posted' | 'rejected' | 'cancelled';

export type ManualJournal = {
  id: string;
  number: string;
  kind: 'manual' | 'opening';
  entryDate: string;
  currency: string;
  memo: string;
  status: JournalStatus;
  direct: boolean;
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  entryId: string | null;
  totalMinor: number;
  createdAt: string;
  lines?: (JournalLineInput & { lineNo: number; debitMinor: number; creditMinor: number })[];
};

export type LedgerEntry = {
  id: string;
  number: string;
  entryDate: string;
  currency: string;
  sourceType: string;
  sourceId: string;
  event: string;
  memo: string | null;
  reversesEntryId: string | null;
  isBackfill: boolean;
  postedBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  totalMinor: number;
  lines?: {
    lineNo: number;
    accountId: string;
    debitMinor: number;
    creditMinor: number;
    partyType: 'customer' | 'supplier' | null;
    partyId: string | null;
    itemId: string | null;
    warehouseId: string | null;
    memo: string | null;
  }[];
};

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  nameAr: string | null;
  kind: AccountKind;
  parentId: string | null;
  isLeaf: boolean;
  currency: string;
  openingMinor: number;
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
};

/** sql/049 `acc_account_lines`: an opening row, then each line with the running balance. */
export type AccountLine = {
  isOpening: boolean;
  lineId: number | null;
  entryId: string | null;
  entryNumber: string | null;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  event: string | null;
  memo: string | null;
  /** The sub-account's code when a group account is opened. */
  accountCode: string | null;
  partyType: 'customer' | 'supplier' | null;
  partyId: string | null;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};

/** Debits equal credits, at least two lines, each line one side above zero. The database checks the same (sql/048). */
export function journalProblem(lines: readonly JournalLineInput[]): 'too_few_lines' | 'bad_line' | 'unbalanced' | null {
  if (lines.length < 2) return 'too_few_lines';
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const d = l.debitMinor ?? 0;
    const c = l.creditMinor ?? 0;
    if (!l.accountId || !Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0 || d > 0 === c > 0) return 'bad_line';
    dr += d;
    cr += c;
  }
  return dr === cr ? null : 'unbalanced';
}
