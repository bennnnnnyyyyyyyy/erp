import type { DocLanguage, PrintDocument } from '@erp/shared';
import { label } from './printLabels';

// Pure helpers for "Send by WhatsApp / email" from the person's own device (Ben, 23 Nov 2026: the company chooses device or server; the
// server way comes next). Tested in sendText.test.ts.

/**
 * A phone number as wa.me wants it: digits only, with the country code. An Egyptian mobile typed the local way (01xxxxxxxxx) gets 20
 * in front. A number that starts with + or 00 keeps its own country code. Anything too short to be a phone number gives null.
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

/** A plain check that a typed email address looks like one. */
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
