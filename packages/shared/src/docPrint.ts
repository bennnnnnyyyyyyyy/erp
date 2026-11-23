// Invoice printing (documentation/plans/INVOICE_PRINTING_PLAN.md, step 1c; sql/103). The shapes the print builder returns, the company's
// document settings, and the small pure helpers the print view needs (amounts with Western or Arabic-Indic digits, the ETA mapping).

import { minorUnitsFor } from './money';
import { buildDocument, toEtaInput, type BuiltDocument, type Issue, type SourceDocument } from './modules/einvoicing';

export const DOC_LAYOUTS = ['simple', 'detailed', 'eta'] as const;
export type DocLayout = (typeof DOC_LAYOUTS)[number];
export const DOC_LANGUAGES = ['ar', 'en', 'both'] as const;
export type DocLanguage = (typeof DOC_LANGUAGES)[number];
export const DOC_DIGITS = ['latn', 'arab'] as const;
export type DocDigits = (typeof DOC_DIGITS)[number];
export const DOC_SEND_MODES = ['device', 'queue'] as const;
export type DocSendMode = (typeof DOC_SEND_MODES)[number];
export const DOC_SEND_CHANNELS = ['whatsapp', 'email', 'download', 'print', 'link'] as const;
export type DocSendChannel = (typeof DOC_SEND_CHANNELS)[number];
/** What can be printed: a draft invoice, an issued (or void) invoice, a credit or debit note. Links and sends: invoice and note only. */
export const PRINT_DOC_TYPES = ['draft', 'invoice', 'note'] as const;
export type PrintDocType = (typeof PRINT_DOC_TYPES)[number];
export const SEND_DOC_TYPES = ['invoice', 'note'] as const;
export type SendDocType = (typeof SEND_DOC_TYPES)[number];

/** Image limits, the same as the database checks (sql/103): data: addresses, PNG, JPEG or WebP. */
export const DOC_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const DOC_LOGO_MAX_CHARS = 410_000;
export const DOC_LETTERHEAD_MAX_CHARS = 2_100_000;

export type DocSettings = {
  logo: string | null;
  letterhead: string | null;
  marginTopMm: number;
  marginBottomMm: number;
  headerText: string | null;
  footerText: string | null;
  bankDetails: string | null;
  paymentTerms: string | null;
  language: DocLanguage;
  digits: DocDigits;
  layout: DocLayout;
  /** Only in the settings screen (not in print data). */
  sendMode?: DocSendMode;
};

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  logo: null,
  letterhead: null,
  marginTopMm: 40,
  marginBottomMm: 30,
  headerText: null,
  footerText: null,
  bankDetails: null,
  paymentTerms: null,
  language: 'ar',
  digits: 'latn',
  layout: 'simple',
  sendMode: 'device',
};

export type PrintLine = {
  itemId: string;
  sku: string;
  name: string;
  uom: string | null;
  qty: number;
  unit: string | null;
  unitFactor: number | null;
  unitPriceMinor: number;
  priceIncludesVat: boolean;
  taxRate: number;
  netMinor: number;
  taxMinor: number;
  taxType: string | null;
  taxSubType: string | null;
  etaItemType: 'GS1' | 'EGS' | null;
  etaItemCode: string | null;
  etaUnitCode: string | null;
};

export type PrintDocument = {
  type: PrintDocType;
  /** 'invoice', or 'credit' / 'debit' for a note. */
  kind: 'invoice' | 'credit' | 'debit';
  id: string;
  /** Null for a draft: the number is given at issue. */
  number: string | null;
  /** draft | issued | discarded (drafts); issued | void (invoices); submitted | approved | rejected | cancelled (notes). */
  status: string;
  date: string;
  dueDate: string | null;
  currency: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  issuedAt: string | null;
  orderNumber: string | null;
  /** A note: the invoice it corrects. */
  invoiceNumber: string | null;
  invoiceDate?: string | null;
  reason: string | null;
  /** A draft that was issued: the invoice it became. */
  invoiceId?: string | null;
};

export type PrintParty = {
  name: string;
  contact: string | null;
  city: string | null;
  phone: string | null;
  code: string | null;
  taxIdType: 'B' | 'P' | 'F' | null;
  taxId: string | null;
  country: string | null;
  governate: string | null;
  regionCity: string | null;
  street: string | null;
  buildingNumber: string | null;
};

export type PrintCompany = {
  name: string;
  legalName: string | null;
  taxNumber: string | null;
  activityCode: string | null;
  vatRegistered: boolean;
  branch: {
    code: string;
    name: string;
    country: string;
    governate: string;
    regionCity: string;
    street: string;
    buildingNumber: string;
    postalCode: string | null;
  } | null;
};

export type DocPrintData = {
  document: PrintDocument;
  lines: PrintLine[];
  customer: PrintParty | null;
  company: PrintCompany;
  settings: DocSettings;
};

/**
 * A phone number as WhatsApp wants it: digits only, with the country code. An Egyptian mobile typed the local way (01xxxxxxxxx) gets 20
 * in front. A number that starts with + or 00 keeps its own country code. Anything too short to be a phone number gives null.
 * Used by the device send (wa.me) and the company send (sql/107), so both reach the same number.
 */
export function waPhone(raw: string | null | undefined, defaultCountry = '20'): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  let digits = t.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = defaultCountry + digits.slice(1);
  digits = digits.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** A plain check that a typed email address looks like one (the database checks again). */
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Sending from the company (sql/107): what the print page needs to know. */
export type DocQueueSend = {
  id: string;
  channel: 'email' | 'whatsapp';
  recipient: string;
  queuedAt: string;
  /** The message's state in the queue: pending, sending, sent, failed, expired, cancelled; unknown once old messages are cleaned up. */
  status: string;
  error: string | null;
  deliveredAt: string | null;
};
export type DocQueueStatus = {
  sendMode: DocSendMode;
  emailConnected: boolean;
  /** Set by the API: WhatsApp is set up on this server, with the approved invoice template. */
  whatsappReady: boolean;
  customerEmail: string | null;
  customerPhone: string | null;
  sends: DocQueueSend[];
};

/** A printout is a draft (DRAFT mark) unless it is an issued or void invoice, or an approved note. */
export function isDraftPrint(d: PrintDocument): boolean {
  if (d.type === 'draft') return true;
  if (d.type === 'note') return d.status !== 'approved';
  return false;
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Western digits to Arabic-Indic digits (and the Arabic decimal and thousands signs); other characters stay as they are. */
export function toArabicDigits(text: string): string {
  return text
    .replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)] ?? d)
    .replace(/\./g, '٫')
    .replace(/,/g, '٬');
}

/** Digits as the company chose them. */
export function withDigits(text: string, digits: DocDigits): string {
  return digits === 'arab' ? toArabicDigits(text) : text;
}

/** Minor units as an exact decimal with thousands separators, no currency sign: 123456 EGP -> "1,234.56". Exact for any bigint. */
export function formatAmount(amountMinor: number | bigint, currency: string, digits: DocDigits = 'latn'): string {
  const places = minorUnitsFor(currency);
  const v = BigInt(amountMinor);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const scale = 10n ** BigInt(places);
  const whole = (a / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = places > 0 ? `.${(a % scale).toString().padStart(places, '0')}` : '';
  return withDigits(`${neg ? '-' : ''}${whole}${frac}`, digits);
}

/** A quantity without needless zeros: 2.500 -> "2.5". */
export function formatQty(qty: number, digits: DocDigits = 'latn'): string {
  const text = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
  return withDigits(text, digits);
}

/** The ETA document (as ETA sending will build it) for the printed document, with everything that is missing. Same builder as sending. */
export function etaForPrint(d: DocPrintData, references?: string[]): { built: BuiltDocument | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const add = (code: string, message: string) => issues.push({ code, path: '', message, severity: 'error' });
  const c = d.company;
  if (!c.taxNumber) add('COMPANY_TAX_NUMBER', 'the company tax registration number');
  if (!c.activityCode) add('ACTIVITY_CODE', 'the company activity code');
  if (!c.branch) add('BRANCH_ADDRESS', 'a company branch with its address');
  if (!d.customer) add('CUSTOMER', 'the customer');
  else if (d.customer.taxIdType === 'B' && !d.customer.taxId) add('CUSTOMER_TAX_ID', 'the customer tax ID (business customer)');
  if (issues.length || !c.taxNumber || !c.activityCode || !c.branch || !d.customer) return { built: null, issues };
  const src: SourceDocument = {
    kind: d.document.kind,
    version: '1.0',
    number: d.document.number ?? 'DRAFT',
    issuedAt: d.document.issuedAt ?? new Date().toISOString(),
    currency: d.document.currency,
    company: {
      registrationNumber: c.taxNumber,
      legalName: c.legalName ?? c.name,
      activityCode: c.activityCode,
      branch: {
        code: c.branch.code,
        address: {
          country: c.branch.country,
          governate: c.branch.governate,
          regionCity: c.branch.regionCity,
          street: c.branch.street,
          buildingNumber: c.branch.buildingNumber,
          ...(c.branch.postalCode ? { postalCode: c.branch.postalCode } : {}),
        },
      },
    },
    customer: { ...d.customer, name: d.customer.name },
    // The line's own stored rate (what the invoice charged), not today's item default.
    lines: d.lines.map((l) => ({
      qty: l.qty,
      // a price typed with VAT: ETA wants the price before VAT (rounded to whole minor units; the line net is exact)
      unitPriceMinor: l.priceIncludesVat ? Math.round(l.netMinor / (l.qty || 1)) : l.unitPriceMinor,
      item: {
        name: l.name,
        etaItemType: l.etaItemType,
        etaItemCode: l.etaItemCode,
        etaUnitCode: l.etaUnitCode,
        defaultTaxRate: l.taxType && l.taxSubType ? { taxType: l.taxType, subType: l.taxSubType, rate: l.taxRate } : null,
      },
    })),
    ...(references ? { references } : {}),
  };
  const mapped = toEtaInput(src);
  issues.push(...mapped.issues.filter((i) => i.severity === 'error'));
  if (!mapped.input || issues.length) return { built: null, issues };
  try {
    return { built: buildDocument(mapped.input), issues };
  } catch (e) {
    add('BUILD', e instanceof Error ? e.message : String(e));
    return { built: null, issues };
  }
}
