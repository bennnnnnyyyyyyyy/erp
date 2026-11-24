import { describe, expect, it } from 'vitest';
import { readXlsx } from '../../lib/statementFiles';
import { columnName, crc32, sheetName, xlsxBytes } from './xlsx';

const buf = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

describe('Excel export', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('writes a file our own .xlsx reader reads back the same, Arabic and special characters included', async () => {
    const header = ['Customer', 'المبلغ', 'Currency'];
    const rows = [
      ['Nile & Co <Cairo>', 1250.5, 'EGP'],
      ['عميل "واحد"', -40, 'USD'],
      ['Empty amount', null, 'EGP'],
    ];
    const back = await readXlsx(buf(xlsxBytes('Sales: Nov/2026', header, rows, true)));
    expect(back).toEqual([header, ['Nile & Co <Cairo>', '1250.5', 'EGP'], ['عميل "واحد"', '-40', 'USD'], ['Empty amount', '', 'EGP']]);
  });

  it('makes a valid sheet name', () => {
    expect(sheetName('Sales: Nov/2026 [draft]')).toBe('Sales  Nov 2026  draft');
    expect(sheetName('x'.repeat(40)).length).toBe(31);
    expect(sheetName('  ')).toBe('Report');
  });
});
