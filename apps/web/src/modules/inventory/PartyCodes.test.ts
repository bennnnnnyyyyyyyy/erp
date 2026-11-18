import { describe, expect, it } from 'vitest';
import { codesFor } from './partyCodeUtils';

// "Their code" appears on a purchase order, bill or invoice only when one of its lines has a code at that party (Ben, 18 Nov).
describe('codesFor', () => {
  const codes = new Map([
    ['item-1', 'FC-50'],
    ['item-2', 'FC-100'],
  ]);

  it('keeps only the codes of the lines on the document', () => {
    expect([...codesFor(codes, ['item-1', 'item-9'])]).toEqual([['item-1', 'FC-50']]);
  });

  it('is empty when no line has a code, so the column is hidden', () => {
    expect(codesFor(codes, ['item-9', undefined]).size).toBe(0);
  });
});
