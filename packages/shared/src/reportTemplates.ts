import type { ReportDefinition } from './reports';

// Reports & Insights, step 3 (documentation/plans/REPORTS_INSIGHTS_PLAN.md): ready-made reports. Each one is an ordinary builder
// definition on the database's fixed list of sources (sql/109), so it runs through the same checks and only for the person's own
// company. Opening one runs it; "Save" keeps the person's own copy (it remembers the template's key). The period is a choice
// ("this month"), turned into dates when the template is opened. Names and descriptions are English; the Arabic is in the web app.

export type ReportPeriodPreset = 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'last_12_months' | 'this_year';
export type ReportArea = 'sales' | 'buy' | 'stock' | 'money' | 'tax';

export type ReportTemplate = {
  key: string;
  area: ReportArea;
  name: string;
  description: string;
  /** Null for a snapshot (stock on hand, money owed today). */
  period: ReportPeriodPreset | null;
  definition: Omit<ReportDefinition, 'period'>;
};

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  {
    key: 'sales_by_customer',
    area: 'sales',
    name: 'Sales by customer',
    description: 'Who bought the most this month.',
    period: 'this_month',
    definition: {
      source: 'sales_lines',
      groupBy: ['customer'],
      totals: [
        { column: 'total', fn: 'sum' },
        { column: 'qty', fn: 'sum' },
      ],
      sort: [{ column: 'sum_total', dir: 'desc' }],
      chart: { type: 'bar', x: 'customer', y: 'sum_total' },
    },
  },
  {
    key: 'top_items',
    area: 'sales',
    name: 'Top 20 products',
    description: 'The 20 products that brought in the most in the last 90 days.',
    period: 'last_90', // Ben, 24 Nov: the same 90 days as the home card "Top products"
    definition: {
      source: 'sales_lines',
      groupBy: ['item'],
      totals: [
        { column: 'total', fn: 'sum' },
        { column: 'qty', fn: 'sum' },
      ],
      sort: [{ column: 'sum_total', dir: 'desc' }],
      limit: 20,
      chart: { type: 'bar', x: 'item', y: 'sum_total' },
    },
  },
  {
    key: 'sales_by_item_group',
    area: 'sales',
    name: 'Sales by item group',
    description: 'Which groups of products sell, this month.',
    period: 'this_month',
    definition: {
      source: 'sales_lines',
      groupBy: ['item_group'],
      totals: [{ column: 'total', fn: 'sum' }],
      sort: [{ column: 'sum_total', dir: 'desc' }],
      chart: { type: 'pie', x: 'item_group', y: 'sum_total' },
    },
  },
  {
    key: 'sales_by_day',
    area: 'sales',
    name: 'Sales day by day',
    description: 'Invoiced sales for each day of the last 30 days.',
    period: 'last_30',
    definition: {
      source: 'sales_lines',
      groupBy: ['invoice_date'],
      totals: [{ column: 'total', fn: 'sum' }],
      sort: [{ column: 'invoice_date', dir: 'asc' }],
      chart: { type: 'line', x: 'invoice_date', y: 'sum_total' },
    },
  },
  {
    key: 'purchases_by_supplier',
    area: 'buy',
    name: 'Purchases by supplier',
    description: 'How much was billed by each supplier in the last 12 months.',
    period: 'last_12_months', // Ben, 24 Nov: the same 12 months as the home card "Your main suppliers"
    definition: {
      source: 'purchase_lines',
      groupBy: ['supplier'],
      totals: [{ column: 'total', fn: 'sum' }],
      sort: [{ column: 'sum_total', dir: 'desc' }],
      chart: { type: 'bar', x: 'supplier', y: 'sum_total' },
    },
  },
  {
    key: 'stock_by_warehouse',
    area: 'stock',
    name: 'Stock by warehouse',
    description: 'How many items, and how much is available, in each warehouse.',
    period: null,
    definition: {
      source: 'stock_on_hand',
      groupBy: ['warehouse'],
      totals: [
        { column: 'available', fn: 'sum' },
        { column: 'item', fn: 'count' },
      ],
      sort: [{ column: 'sum_available', dir: 'desc' }],
    },
  },
  {
    key: 'out_of_stock',
    area: 'stock',
    name: 'Out of stock',
    description: 'Items with nothing available, in each warehouse.',
    period: null,
    definition: {
      source: 'stock_on_hand',
      columns: ['item', 'sku', 'warehouse', 'on_hand', 'reserved', 'available'],
      filters: [{ column: 'available', op: 'lte', value: 0 }],
      sort: [{ column: 'item', dir: 'asc' }],
    },
  },
  {
    key: 'stock_moves_by_kind',
    area: 'stock',
    name: 'Stock movements by kind',
    description: 'Goods in, out and adjusted in the last 30 days.',
    period: 'last_30',
    definition: {
      source: 'stock_moves',
      groupBy: ['kind'],
      totals: [
        { column: 'qty', fn: 'sum' },
        { column: 'item', fn: 'count' },
      ],
    },
  },
  {
    key: 'receivables_ageing',
    area: 'money',
    name: 'Money owed by age',
    description: 'What customers still owe, by how many days it is late.',
    period: null,
    definition: {
      source: 'receivables',
      groupBy: ['age_band'],
      totals: [
        { column: 'owed', fn: 'sum' },
        { column: 'invoice_number', fn: 'count' },
      ],
      sort: [{ column: 'age_band', dir: 'asc' }],
      chart: { type: 'bar', x: 'age_band', y: 'sum_owed' },
    },
  },
  {
    key: 'owed_by_customer',
    area: 'money',
    name: 'Money owed by customer',
    description: 'Each customer who owes money, the amount and the oldest delay.',
    period: null,
    definition: {
      source: 'receivables',
      groupBy: ['customer'],
      totals: [
        { column: 'owed', fn: 'sum' },
        { column: 'days_overdue', fn: 'max' },
      ],
      sort: [{ column: 'sum_owed', dir: 'desc' }],
    },
  },
  {
    key: 'expenses_by_category',
    area: 'money',
    name: 'Expenses by category',
    description: 'Where the money went this month.',
    period: 'this_month',
    definition: {
      source: 'expenses',
      groupBy: ['category'],
      totals: [{ column: 'amount', fn: 'sum' }],
      sort: [{ column: 'sum_amount', dir: 'desc' }],
      chart: { type: 'pie', x: 'category', y: 'sum_amount' },
    },
  },
  {
    key: 'money_in_out',
    area: 'money',
    name: 'Money in and out',
    description: 'Payments received and made this month, by method.',
    period: 'this_month',
    definition: {
      source: 'payments',
      groupBy: ['direction', 'method'],
      totals: [
        { column: 'amount', fn: 'sum' },
        { column: 'payment_number', fn: 'count' },
      ],
    },
  },
  {
    key: 'vat_on_sales',
    area: 'tax',
    name: 'VAT on sales, day by day',
    description: 'Net sales and VAT charged for each day of last month.',
    period: 'last_month',
    definition: {
      source: 'sales_lines',
      groupBy: ['invoice_date'],
      totals: [
        { column: 'net', fn: 'sum' },
        { column: 'vat', fn: 'sum' },
      ],
      sort: [{ column: 'invoice_date', dir: 'asc' }],
    },
  },
  {
    key: 'vat_on_purchases',
    area: 'tax',
    name: 'VAT on purchases, by supplier',
    description: 'Net purchases and VAT paid to each supplier last month.',
    period: 'last_month',
    definition: {
      source: 'purchase_lines',
      groupBy: ['supplier'],
      totals: [
        { column: 'net', fn: 'sum' },
        { column: 'vat', fn: 'sum' },
      ],
      sort: [{ column: 'sum_vat', dir: 'desc' }],
    },
  },
];

export const findReportTemplate = (key: string): ReportTemplate | undefined => REPORT_TEMPLATES.find((t) => t.key === key);
