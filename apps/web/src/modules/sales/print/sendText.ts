import { type DocLanguage, looksLikeEmail, type PrintDocument } from '@erp/shared';
import { label } from './printLabels';

// Pure helpers for "Send by WhatsApp / email" from the person's own device (Ben, 23 Nov 2026: the company chooses device or server; the
// server way comes next). The company's own send (sql/107) builds the same words in the database. Tested in sendText.test.ts.

// waPhone and looksLikeEmail live in @erp/shared (the company send uses them too, sql/107).
export { looksLikeEmail, waPhone } from '@erp/shared';

/** The document's name in a message: "فاتورة INV-2026-00001" / "Invoice INV-2026-00001". */
function docName(doc: PrintDocument, lang: DocLanguage): string {
  const kind = doc.kind === 'credit' ? 'creditNote' : doc.kind === 'debit' ? 'debitNote' : 'invoice';
  return `${label(kind, lang)} ${doc.number ?? ''}`.trim();
}

/** The message sent with the link. In the document's language; "both" writes Arabic, then English. */
export function sendMessage(doc: PrintDocument, company: string, url: string, lang: DocLanguage): string {
  const ar = `${docName(doc, 'ar')} من ${company}:\n${url}`;
  const en = `${docName(doc, 'en')} from ${company}:\n${url}`;
  if (lang === 'ar') return ar;
  if (lang === 'en') return en;
  return `${ar}\n\n${en}`;
}

export function emailSubject(doc: PrintDocument, company: string, lang: DocLanguage): string {
  const ar = `${docName(doc, 'ar')} - ${company}`;
  const en = `${docName(doc, 'en')} - ${company}`;
  return lang === 'en' ? en : lang === 'ar' ? ar : `${ar} / ${en}`;
}

export const whatsappUrl = (phone: string | null, text: string): string =>
  `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;

export const mailtoUrl = (to: string, subject: string, body: string): string =>
  `mailto:${looksLikeEmail(to) ? to.trim() : ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
