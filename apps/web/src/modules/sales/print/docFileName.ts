import type { PrintDocument } from '@erp/shared';

// The name of a downloaded or saved document (Ben, 25 Nov 2026: "the name of the printed pdf is stupid"): the document and its
// customer, "INV-2026-00001 - Nile Foods.pdf". A credit or debit note says which it is, in the document's language ("Credit note
// CN-2026-00003 - …" / "إشعار دائن …"); a draft not issued yet has no number and says "Draft". Arabic letters stay; only what Windows
// refuses in a file name is taken out. Used for the PDF download and as the page title the browser's "Save as PDF" offers.

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what a file name must not contain
const WINDOWS_BAD = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A name Windows (and other systems) accepts: no <>:"/\|?* or control characters, no trailing dot or space, not a reserved name. */
export function safeFileName(name: string, max = 150): string {
  let t = name.replace(WINDOWS_BAD, ' ').replace(/\s+/g, ' ').trim();
  t = t.slice(0, max).replace(/[. ]+$/, '').trim();
  if (!t) return 'document';
  return WINDOWS_RESERVED.test(t) ? `_${t}` : t;
}

/** The name without its extension: "INV-2026-00001 - Nile Foods". */
export function docFileBase(doc: Pick<PrintDocument, 'kind' | 'number'>, customer: string | null | undefined, language: 'ar' | 'en' | 'both'): string {
  const ar = language === 'ar';
  const kind = doc.kind === 'credit' ? (ar ? 'إشعار دائن' : 'Credit note') : doc.kind === 'debit' ? (ar ? 'إشعار مدين' : 'Debit note') : null;
  const draft = doc.number ? null : ar ? 'مسودة' : 'Draft';
  const head = [kind, draft, doc.number].filter(Boolean).join(' ');
  const who = customer?.trim();
  return safeFileName(who ? `${head} - ${who}` : head);
}

export const pdfFileName = (doc: Pick<PrintDocument, 'kind' | 'number'>, customer: string | null | undefined, language: 'ar' | 'en' | 'both'): string =>
  `${docFileBase(doc, customer, language)}.pdf`;
