import { describe, expect, it } from 'vitest';
import { docFileBase, pdfFileName, safeFileName } from './docFileName';

describe('the name of a printed document', () => {
  it('is the number and the customer', () => {
    expect(pdfFileName({ kind: 'invoice', number: 'INV-2026-00001' }, 'Nile Foods', 'en')).toBe('INV-2026-00001 - Nile Foods.pdf');
    expect(pdfFileName({ kind: 'invoice', number: 'INV-2026-00001' }, 'شركة النيل للتوزيع', 'ar')).toBe('INV-2026-00001 - شركة النيل للتوزيع.pdf');
  });

  it('says which note it is, in the document language', () => {
    expect(docFileBase({ kind: 'credit', number: 'CN-2026-00003' }, 'Nile Foods', 'en')).toBe('Credit note CN-2026-00003 - Nile Foods');
    expect(docFileBase({ kind: 'debit', number: 'DN-2026-00001' }, 'شركة النيل', 'ar')).toBe('إشعار مدين DN-2026-00001 - شركة النيل');
    expect(docFileBase({ kind: 'credit', number: 'CN-1' }, 'X', 'both')).toBe('Credit note CN-1 - X');
  });

  it('calls a draft a draft', () => {
    expect(docFileBase({ kind: 'invoice', number: null }, 'Nile Foods', 'en')).toBe('Draft - Nile Foods');
    expect(docFileBase({ kind: 'invoice', number: null }, null, 'ar')).toBe('مسودة');
  });

  it('is safe for Windows', () => {
    expect(docFileBase({ kind: 'invoice', number: 'INV-1' }, 'A/B: "C" <D>|E?*', 'en')).toBe('INV-1 - A B C D E');
    expect(safeFileName('Shop Co.  ')).toBe('Shop Co');
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('   ')).toBe('document');
    expect(safeFileName('x'.repeat(300)).length).toBe(150);
  });
});
