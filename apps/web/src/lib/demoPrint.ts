import { DEFAULT_DOC_SETTINGS, type DocPrintData, type DocSettings } from '@erp/shared';
import { DemoRuleError } from './demoInventory';

// Sample print data for the sample build (invoice printing, step 1c): one issued invoice and one draft that the ETA layout can print in
// full (company tax number, activity code, branch address, business customer, ETA item and unit codes). The layout picture tests
// (apps/web/e2e/print.e2e.ts) open these, so the numbers and dates are fixed: changing them changes the pictures.
// Open in the sample build: /sales/print/invoice/demo-inv-1 and /sales/print/draft/demo-draft-1.

const settings: DocSettings = { ...DEFAULT_DOC_SETTINGS, layout: 'eta', language: 'ar', digits: 'latn' };

const invoice: DocPrintData = {
  document: {
    type: 'invoice',
    kind: 'invoice',
    id: 'demo-inv-1',
    number: 'INV-2026-00001',
    status: 'issued',
    date: '2026-11-23',
    dueDate: '2026-12-23',
    currency: 'EGP',
    netMinor: 155000,
    taxMinor: 21700,
    grossMinor: 176700,
    issuedAt: '2026-11-23T10:00:00Z',
    orderNumber: 'SO-1001',
    invoiceNumber: null,
    reason: null,
  },
  lines: [
    {
      itemId: 'demo-i1', sku: 'FC-50', name: 'كريم وجه 50 مل', uom: 'piece', qty: 10, unit: null, unitFactor: null,
      unitPriceMinor: 12500, priceIncludesVat: false, taxRate: 14, netMinor: 125000, taxMinor: 17500,
      taxType: 'T1', taxSubType: 'V009', etaItemType: 'EGS', etaItemCode: 'EG-100200300-FC50', etaUnitCode: 'EA',
    },
    {
      itemId: 'demo-i2', sku: 'SVC-1', name: 'Delivery service', uom: 'piece', qty: 1, unit: null, unitFactor: null,
      unitPriceMinor: 30000, priceIncludesVat: false, taxRate: 14, netMinor: 30000, taxMinor: 4200,
      taxType: 'T1', taxSubType: 'V009', etaItemType: 'EGS', etaItemCode: 'EG-100200300-SVC', etaUnitCode: 'EA',
    },
  ],
  customer: {
    name: 'شركة النيل للتوزيع', contact: 'Sara Ali', city: 'Giza', phone: '+20 100 000 0000', code: 'C-001',
    taxIdType: 'B', taxId: '200300400', country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: '2 Sample St', buildingNumber: '2',
  },
  company: {
    name: 'Demo Trading Co.',
    legalName: 'شركة ديمو للتجارة',
    taxNumber: '100200300',
    activityCode: '4620',
    vatRegistered: true,
    branch: { code: '0', name: 'Head office', country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: '1 Sample St', buildingNumber: '1', postalCode: null },
  },
  settings,
};

const draft: DocPrintData = {
  ...invoice,
  document: { ...invoice.document, type: 'draft', id: 'demo-draft-1', number: null, status: 'draft', issuedAt: null },
};

const documents: Record<string, DocPrintData> = { 'invoice/demo-inv-1': invoice, 'draft/demo-draft-1': draft };

/** GET /v1/sales/print/:type/:id */
export function demoPrintData(type: string | undefined, id: string | undefined): DocPrintData {
  const d = documents[`${type}/${id}`];
  if (!d) throw new DemoRuleError(404, 'Document not found', 'not_found');
  return d;
}

/** GET /v1/core/doc-settings */
export function demoDocSettings(): DocSettings {
  return settings;
}
