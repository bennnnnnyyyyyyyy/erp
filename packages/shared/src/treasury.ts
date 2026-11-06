// Treasury, branches and statements (documentation/plans/TREASURY_PLAN.md; database sql/050-052). Shapes shared by the API and the web.

export type Branch = { id: string; code: string; name: string; nameAr: string | null; active: boolean; taxBranchId: string | null };

export type TreasuryKind = 'cash' | 'bank' | 'clearing';

export type TreasuryAccount = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  kind: TreasuryKind;
  currency: string;
  branchId: string | null;
  ledgerAccountId: string;
  bankName: string | null;
  bankAccountNo: string | null;
  active: boolean;
  /** From the ledger, today (sql/051 trs_balances). */
  balanceMinor: number;
};

export type TreasuryTransfer = {
  id: string;
  number: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  currency: string;
  transferDate: string;
  note: string | null;
  status: 'recorded' | 'void';
  entryId: string | null;
  createdBy: string;
  createdAt: string;
};

/** sql/052 acc_party_statement: an opening row, then the party's receivable or payable lines with a running balance. */
export type PartyStatementLine = {
  isOpening: boolean;
  lineId: number | null;
  entryId: string | null;
  entryNumber: string | null;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  event: string | null;
  memo: string | null;
  accountCode: string | null;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};

/** sql/052 inv_item_statement: an opening row, then each stock move with running quantity and value. */
export type ItemStatementLine = {
  isOpening: boolean;
  moveId: number | null;
  moveDate: string;
  kind: string;
  ref: string | null;
  warehouseId: string | null;
  qtyIn: number | null;
  qtyOut: number | null;
  unitCostMinor: number | null;
  valueMinor: number | null;
  costKnown: boolean;
  balanceQty: number;
  balanceValueMinor: number;
};
