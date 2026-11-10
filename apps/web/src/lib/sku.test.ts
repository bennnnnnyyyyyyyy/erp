import { describe, expect, it } from 'vitest';
import { followingCodes, previewSku } from './sku';

describe('item codes', () => {
  it('previews the first code of a format', () => {
    expect(previewSku('itm-', 4)).toBe('ITM-0001');
    expect(previewSku('', 3)).toBe('001');
  });
  it('counts up from a code and keeps its width', () => {
    expect(followingCodes('ITM-0008', 3)).toEqual(['ITM-0008', 'ITM-0009', 'ITM-0010']);
    expect(followingCodes('A-99', 2)).toEqual(['A-99', 'A-100']);
  });
  it('leaves rows blank when the code has no number', () => {
    expect(followingCodes('ABC', 2)).toEqual(['ABC', '']);
  });
});
