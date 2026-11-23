import { describe, expect, it } from 'vitest';
import { pageUrl } from './pageUrl';

describe('pageUrl', () => {
  it('asks for the first page without an offset', () => {
    expect(pageUrl('/v1/inventory/requests', 0)).toBe('/v1/inventory/requests');
  });
  it('adds the offset, keeping filters the path already has', () => {
    expect(pageUrl('/v1/inventory/requests', 200)).toBe('/v1/inventory/requests?offset=200');
    expect(pageUrl('/v1/accounting/entries?from=2026-01-01', 300)).toBe('/v1/accounting/entries?from=2026-01-01&offset=300');
  });
});
