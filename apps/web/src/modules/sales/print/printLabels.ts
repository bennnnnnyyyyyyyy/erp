import type { DocLanguage } from '@erp/shared';

// The words ON the printed invoice. They follow the company's document language (Arabic by default, English, or both), not the language
// of the person's screen: a customer gets the same paper whoever prints it. The Arabic is a draft for Ben's review (Arabic review sheet).

export const PRINT_LABELS = {
  taxInvoice: { ar: 'فاتورة ضريبية', en: 'Tax invoice' },
  invoice: { ar: 'فاتورة', en: 'Invoice' },
  creditNote: { ar: 'إشعار دائن', en: 'Credit note' },
  debitNote: { ar: 'إشعار مدين', en: 'Debit note' },
  draft: { ar: 'مسودة', en: 'DRAFT' },
  void: { ar: 'ملغاة', en: 'VOID' },
  number: { ar: 'الرقم', en: 'Number' },
  date: { ar: 'التاريخ', en: 'Date' },
  dueDate: { ar: 'تاريخ الاستحقاق', en: 'Due date' },
  order: { ar: 'أمر البيع', en: 'Sales order' },
  forInvoice: { ar: 'عن الفاتورة', en: 'For invoice' },
  reason: { ar: 'السبب', en: 'Reason' },
  billTo: { ar: 'العميل', en: 'Bill to' },
  seller: { ar: 'البائع', en: 'Seller' },
  taxNumber: { ar: 'رقم التسجيل الضريبي', en: 'Tax registration number' },
  activityCode: { ar: 'كود النشاط', en: 'Activity code' },
  customerTaxId: { ar: 'الرقم الضريبي للعميل', en: 'Customer tax ID' },
  phone: { ar: 'الهاتف', en: 'Phone' },
  address: { ar: 'العنوان', en: 'Address' },
  lineNo: { ar: 'م', en: 'No.' },
  item: { ar: 'الصنف', en: 'Item' },
  itemCode: { ar: 'كود الصنف', en: 'Item code' },
  codeType: { ar: 'نوع الكود', en: 'Code type' },
  unitCode: { ar: 'كود الوحدة', en: 'Unit code' },
  qty: { ar: 'الكمية', en: 'Qty' },
  unitPrice: { ar: 'سعر الوحدة', en: 'Unit price' },
  unitPriceWithVat: { ar: 'سعر الوحدة شامل الضريبة', en: 'Unit price incl. VAT' },
  beforeVat: { ar: 'قبل الضريبة', en: 'Before VAT' },
  vatRate: { ar: 'نسبة الضريبة', en: 'VAT rate' },
  vat: { ar: 'ضريبة القيمة المضافة', en: 'VAT' },
  amount: { ar: 'القيمة', en: 'Amount' },
  lineTotal: { ar: 'الإجمالي', en: 'Total' },
  taxType: { ar: 'نوع الضريبة', en: 'Tax type' },
  subtotal: { ar: 'الإجمالي قبل الضريبة', en: 'Subtotal' },
  total: { ar: 'الإجمالي', en: 'Total' },
  totalWithVat: { ar: 'الإجمالي شامل الضريبة', en: 'Total incl. VAT' },
  salesAmount: { ar: 'إجمالي المبيعات', en: 'Total sales' },
  discount: { ar: 'الخصم', en: 'Discount' },
  netAmount: { ar: 'الصافي', en: 'Net amount' },
  bank: { ar: 'بيانات البنك', en: 'Bank details' },
  terms: { ar: 'شروط الدفع', en: 'Payment terms' },
  currency: { ar: 'العملة', en: 'Currency' },
  etaNotSubmitted: { ar: 'لم تُرسل إلى مصلحة الضرائب المصرية بعد', en: 'Not yet submitted to ETA' },
  etaQr: { ar: 'رمز QR من مصلحة الضرائب', en: 'ETA QR code' },
  appQr: { ar: 'امسح الرمز لفتح المستند في البرنامج', en: 'Scan to open in the app' },
  page: { ar: 'صفحة', en: 'Page' },
} as const;

export type PrintLabelKey = keyof typeof PRINT_LABELS;

/** One label in the document's language; "both" gives "Arabic / English". */
export function label(key: PrintLabelKey, lang: DocLanguage): string {
  const l = PRINT_LABELS[key];
  if (lang === 'en') return l.en;
  if (lang === 'ar') return l.ar;
  return `${l.ar} / ${l.en}`;
}

/** Arabic and "both" print right to left. */
export const printDir = (lang: DocLanguage): 'rtl' | 'ltr' => (lang === 'en' ? 'ltr' : 'rtl');
