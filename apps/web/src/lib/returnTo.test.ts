import { describe, expect, it } from 'vitest';
import { isSafeReturnPath, rememberReturnPath, takeReturnPath } from './returnTo';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const invoice = '/sales/invoices/0b6e1f0a-1111-4222-8333-944445555666';

describe('deep links through sign-in', () => {
  it('opens the page asked for after a sign-in that came back to home (Google, emailed links)', () => {
    const s = memory();
    rememberReturnPath(invoice, s, 1000);
    expect(takeReturnPath('/', s, 2000)).toBe(invoice);
    expect(takeReturnPath('/', s, 3000)).toBeNull(); // used once
  });

  it('keeps the query (a report link with its choices)', () => {
    const s = memory();
    rememberReturnPath('/purchasing/orders/new?item=1&qty=2', s, 0);
    expect(takeReturnPath('/', s, 1)).toBe('/purchasing/orders/new?item=1&qty=2');
  });

  it('does nothing when the person is already on a page (a password sign-in stays where it was)', () => {
    const s = memory();
    rememberReturnPath(invoice, s, 0);
    expect(takeReturnPath(invoice, s, 1)).toBeNull();
    expect(takeReturnPath('/', s, 2)).toBeNull(); // forgotten
  });

  it('forgets a page after an hour, and never keeps home', () => {
    const s = memory();
    rememberReturnPath(invoice, s, 0);
    expect(takeReturnPath('/', s, 60 * 60 * 1000 + 1)).toBeNull();
    rememberReturnPath('/', s, 0);
    expect(takeReturnPath('/', s, 1)).toBeNull();
  });

  it('only goes to a page of this app', () => {
    for (const bad of ['//evil.example/x', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/i/some-token', '']) {
      expect(isSafeReturnPath(bad), bad).toBe(false);
    }
    expect(isSafeReturnPath('/reports/template/top_items')).toBe(true);
    const s = memory();
    s.setItem('erp.returnTo', JSON.stringify({ path: '//evil.example', at: 0 }));
    expect(takeReturnPath('/', s, 1)).toBeNull();
  });
});
