import { describe, expect, it } from 'vitest';
import type { PrintDocument } from '@erp/shared';
import { looksLikeEmail, mailtoUrl, sendMessage, waPhone, whatsappUrl } from './sendText';

describe('WhatsApp phone numbers', () => {
  it('adds Egypt to a local mobile number and keeps a given country code', () => {
    expect(waPhone('01001234567')).toBe('201001234567');
    expect(waPhone('+20 100 123 4567')).toBe('201001234567');
    expect(waPhone('00971501234567')).toBe('971501234567');
    expect(waPhone('٠١٠٠١٢٣٤٥٦٧')).toBe('201001234567');
    expect(waPhone('123')).toBeNull();
    expect(waPhone(null)).toBeNull();
  });
});

describe('the message', () => {
  const doc = { kind: 'invoice', number: 'INV-2026-00001' } as PrintDocument;
  it('is in the document language, with the link', () => {
    expect(sendMessage(doc, 'Acme', 'https://x/i/abc', 'ar')).toBe('فاتورة INV-2026-00001 من Acme:\nhttps://x/i/abc');
    expect(sendMessage(doc, 'Acme', 'https://x/i/abc', 'en')).toBe('Invoice INV-2026-00001 from Acme:\nhttps://x/i/abc');
    expect(sendMessage(doc, 'Acme', 'u', 'both')).toContain('Invoice INV-2026-00001');
  });
  it('builds the WhatsApp and email addresses safely', () => {
    expect(whatsappUrl('201001234567', 'a b&c')).toBe('https://wa.me/201001234567?text=a%20b%26c');
    expect(mailtoUrl('a@b.co', 'S', 'B')).toBe('mailto:a@b.co?subject=S&body=B');
    expect(mailtoUrl('not an email', 'S', 'B')).toBe('mailto:?subject=S&body=B');
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail('a@b')).toBe(false);
  });
});
