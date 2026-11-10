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

export type ImportRow = {
  id: string;
  accountId: string;
  fileName: string;
  format: string;
  periodFrom: string;
  periodTo: string;
  closingMinor: number | null;
  added: number;
  skipped: number;
  importedAt: string;
  counts: { open: number; matched: number; ignored: number };
};
export type Entry = { id: string; date: string; amountMinor: number; documentNumbers: string[]; memo: string; entryNumber: string };
export type Suggestion = { tier: 'exact' | 'strong' | 'possible' | 'group'; candidateIds: string[]; days: number; entries: Entry[] };
export type Line = {
  id: string;
  lineNo: number;
  bookingDate: string;
  description: string;
  reference: string;
  amountMinor: number;
  balanceMinor: number | null;
  status: 'open' | 'matched' | 'ignored';
  ignoreReason: string | null;
  /** A rule (sql/068) whose text this line contains: record it as an expense in that category. */
  rule: { ruleId: string; categoryId: string; contains: string } | null;
  matches: { entryLineId: string; amountMinor: number }[];
  suggestions: Suggestion[];
};
export type ImportDetail = { id: string; accountId: string; fileName: string; periodFrom: string; periodTo: string; closingMinor: number | null; lines: Line[] };
export type Reconciliation = {
  id: string;
  toDate: string;
  bankClosingMinor: number;
  ledgerBalanceMinor: number;
  unmatchedLedgerMinor: number;
  ignoredBankMinor: number;
  status: 'closed' | 'reopened';
  closedAt: string;
  reopenReason: string | null;
};

export const TIER_LABEL: Record<Suggestion['tier'], string> = { exact: 'Exact match', strong: 'Likely match', possible: 'Possible match', group: 'Several entries' };
export const STATUS_LABEL: Record<Line['status'], string> = { open: 'Open', matched: 'Matched', ignored: 'Ignored' };
export const STATUS_PILL: Record<Line['status'], string> = { open: 'submitted', matched: 'received', ignored: 'cancelled' };

export type Category = { id: string; name: string };
