// Report library (REPORTS_INSIGHTS_PLAN.md, step 1): the reports that already exist, in one place, by area. Each entry is a link to the
// existing screen. Nothing here gives access: an entry is shown only when the person can already open that page (its app's module is on
// and they hold the page's permission), which the caller decides with the registry (`canOpen`). Kept free of React and of the registry
// itself so it can be tested without a browser.

import { REPORT_TEMPLATES, type ReportArea } from '@erp/shared';

export type { ReportArea };

export type LibraryEntry = {
  area: ReportArea;
  /** The full address of the existing report page. */
  path: string;
  /** One plain sentence: what the report answers (English; the Arabic is in i18nReports.ts). */
  description: string;
};

/** Area headings, in the order they are shown (Ben, 23 Nov: Sales, Buy, Stock, Money, Tax). */
export const AREAS: { key: ReportArea; label: string }[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'buy', label: 'Buying' },
  { key: 'stock', label: 'Stock' },
  { key: 'money', label: 'Money' },
  { key: 'tax', label: 'Tax' },
];

export const LIBRARY: readonly LibraryEntry[] = [
  { area: 'sales', path: '/finance/product-sales', description: 'How much of each product you sold, and for how much.' },
  { area: 'sales', path: '/sales/invoices', description: 'Every sales invoice, with its status and what is still owed.' },
  { area: 'sales', path: '/reports/forecast', description: 'What you are likely to sell next, by product or by customer.' },
  { area: 'buy', path: '/purchasing', description: 'Every purchase order and its status.' },
  { area: 'buy', path: '/purchasing/invoices', description: 'Every bill from your suppliers.' },
  { area: 'stock', path: '/inventory/stock', description: 'How much you have of each item, in each warehouse.' },
  { area: 'stock', path: '/inventory/forecast', description: 'When each item will run out, and how much to order.' },
  { area: 'stock', path: '/inventory/batches', description: 'Batches and their expiry dates.' },
  { area: 'stock', path: '/inventory/ledger', description: 'Every stock movement in and out.' },
  { area: 'stock', path: '/accounting/stock-value', description: 'What your stock is worth, from the books.' },
  { area: 'money', path: '/finance/overview', description: 'Sales, costs and expenses: is the company making money?' },
  { area: 'money', path: '/finance/owed', description: 'What customers owe you, and what you owe suppliers.' },
  { area: 'money', path: '/finance/payments', description: 'Money received and money paid.' },
  { area: 'money', path: '/finance', description: 'What the company spent.' },
  { area: 'money', path: '/finance/statements', description: 'One customer, supplier or item over a period, with a running balance.' },
  { area: 'money', path: '/treasury', description: 'The balance of each cash box and bank account.' },
  { area: 'money', path: '/accounting/trial-balance', description: 'Every account with its debit and credit totals.' },
  { area: 'money', path: '/accounting/income-statement', description: 'Income and costs for a period.' },
  { area: 'money', path: '/accounting/balance-sheet', description: 'What the company owns and owes on a date.' },
  { area: 'tax', path: '/finance/vat', description: 'VAT on sales and purchases for a period, and what to pay.' },
];

/** A ready-made report (step 3) shows in its area after the screens; `ready` marks it. */
export type ShownReport = LibraryEntry & { title: string; ready?: boolean };
export type ShownArea = { key: ReportArea; label: string; reports: ShownReport[] };

/**
 * The areas and reports this person can open. `canOpen(path)` returns the page's title (English) when the person can open that exact
 * page, or null. `search` keeps the reports whose title or description contains it (case ignored; the caller passes the texts already
 * translated through `translate`). `sourceKeys`: the report sources this person may use (rpt_sources); their ready-made reports are
 * added. Areas with no report left are dropped.
 */
export function libraryFor(
  canOpen: (path: string) => string | null,
  search = '',
  translate: (s: string) => string = (s) => s,
  sourceKeys: ReadonlySet<string> = new Set(),
): ShownArea[] {
  const q = search.trim().toLocaleLowerCase();
  const shown: ShownReport[] = [];
  for (const e of LIBRARY) {
    const title = canOpen(e.path);
    if (!title) continue;
    if (q && !`${translate(title)} ${translate(e.description)}`.toLocaleLowerCase().includes(q)) continue;
    shown.push({ ...e, title });
  }
  for (const t of REPORT_TEMPLATES) {
    if (!sourceKeys.has(t.definition.source)) continue;
    if (q && !`${translate(t.name)} ${translate(t.description)}`.toLocaleLowerCase().includes(q)) continue;
    shown.push({ area: t.area, path: `/reports/template/${t.key}`, description: t.description, title: t.name, ready: true });
  }
  return AREAS.map((a) => ({ ...a, reports: shown.filter((r) => r.area === a.key) })).filter((a) => a.reports.length > 0);
}
