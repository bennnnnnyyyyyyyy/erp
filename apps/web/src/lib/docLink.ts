import type { PrintDocument } from '@erp/shared';

// QR codes on printed invoices (SCANNING_PLAN.md step 4). The code holds a link INTO the app: only signed-in staff of the company can
// open what it points to (the pages load through row level security, so another company's code opens nothing). The app's scanner
// follows a scanned link only when it is one of these pages on this same site.

/** The app page for a printed document: the invoice page, else the print page (drafts not yet issued, credit and debit notes). */
export function docAppPath(doc: Pick<PrintDocument, 'type' | 'id' | 'invoiceId'>): string {
  if (doc.type === 'invoice') return `/sales/invoices/${doc.id}`;
  if (doc.type === 'draft' && doc.invoiceId) return `/sales/invoices/${doc.invoiceId}`;
  return `/sales/print/${doc.type}/${doc.id}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const APP_PATHS = [new RegExp(`^/sales/invoices/${UUID}$`, 'i'), new RegExp(`^/sales/print/(invoice|draft|note)/${UUID}$`, 'i')];

/** A scanned code as a page of this app to open, or null: another site, another kind of page, or not a link at all. */
export function appPathFromScan(code: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(code.trim());
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return APP_PATHS.some((re) => re.test(url.pathname)) ? url.pathname : null;
}
