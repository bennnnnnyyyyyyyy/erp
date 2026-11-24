import type { ReportColumnType, ReportFilterOp, ReportTotalFn } from '@erp/shared';

// Names people read for the report builder's sources, columns, operators and totals (English; the Arabic is in lib/i18nReports.ts
// or, for words the app already uses, in the other Arabic tables). The keys come from the database's fixed list (sql/109).

export const SOURCE_LABELS: Record<string, string> = {
  sales_lines: 'Sales invoice lines',
  sales_orders: 'Sales orders',
  purchase_lines: 'Supplier bill lines',
  stock_on_hand: 'Stock on hand',
  stock_moves: 'Stock movements',
  receivables: 'Money owed by customers',
  expenses: 'Expenses',
  payments: 'Payments',
  ledger_lines: 'Ledger lines',
};

export const COLUMN_LABELS: Record<string, string> = {
  invoice_date: 'Invoice date',
  invoice_number: 'Invoice number',
  customer: 'Customer',
  customer_code: 'Customer code',
  customer_group: 'Customer group',
  item: 'Item',
  sku: 'Item code',
  item_group: 'Item group',
  warehouse: 'Warehouse',
  branch: 'Branch',
  qty: 'Quantity',
  unit_price: 'Unit price',
  net: 'Net',
  vat: 'VAT',
  total: 'Total',
  order_date: 'Order date',
  order_number: 'Order number',
  status: 'Status',
  lines: 'Lines',
  bill_date: 'Bill date',
  bill_number: 'Bill number',
  due_date: 'Due date',
  supplier: 'Supplier',
  supplier_code: 'Supplier code',
  unit_cost: 'Unit cost',
  uom: 'Unit',
  on_hand: 'On hand',
  reserved: 'Reserved',
  available: 'Available',
  reorder_level: 'Reorder level',
  move_date: 'Date',
  kind: 'Kind',
  reference: 'Reference',
  days_overdue: 'Days overdue',
  age_band: 'Days overdue band',
  invoice_total: 'Invoice total',
  owed: 'Still owed',
  expense_date: 'Expense date',
  expense_number: 'Expense number',
  category: 'Category',
  amount: 'Amount',
  note: 'Note',
  paid_on: 'Paid on',
  payment_number: 'Payment number',
  direction: 'In or out',
  method: 'Method',
  party: 'Customer or supplier',
  entry_date: 'Entry date',
  entry_number: 'Entry number',
  account_code: 'Account code',
  account: 'Account',
  account_type: 'Account type',
  debit: 'Debit',
  credit: 'Credit',
  memo: 'Memo',
  currency: 'Currency',
};

export const FN_LABELS: Record<ReportTotalFn, string> = { sum: 'Sum', count: 'Count', avg: 'Average', min: 'Lowest', max: 'Highest' };

const OP_LABELS: Record<ReportFilterOp, string> = {
  eq: 'is',
  ne: 'is not',
  in: 'is one of',
  contains: 'contains',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  between: 'is between',
  is_empty: 'is empty',
};
const DATE_OP_LABELS: Partial<Record<ReportFilterOp, string>> = { gt: 'is after', gte: 'is on or after', lt: 'is before', lte: 'is on or before' };
export const opLabel = (op: ReportFilterOp, type: ReportColumnType): string => (type === 'date' ? DATE_OP_LABELS[op] : undefined) ?? OP_LABELS[op];

/** Fixed values some text columns hold: shown with their names, and offered as a list in filters. */
export const VALUE_LABELS: Record<string, Record<string, string>> = {
  direction: { in: 'Money in', out: 'Money out' },
  method: { cash: 'Cash', bank: 'Bank', card: 'Card', cheque: 'Cheque', other: 'Other' },
  kind: { receipt: 'Receipt', issue: 'Issue', adjust: 'Adjustment', transfer_out: 'Transfer out', transfer_in: 'Transfer in', return_in: 'Return in' },
  account_type: { asset: 'Asset', liability: 'Liability', equity: 'Equity', expense: 'Expense', revenue: 'Revenue' },
  age_band: { '0-30': '0-30', '31-60': '31-60', '61-90': '61-90', '90+': '90+' },
};

export const sourceLabel = (key: string) => SOURCE_LABELS[key] ?? key;
export const columnLabel = (key: string) => COLUMN_LABELS[key] ?? key;
