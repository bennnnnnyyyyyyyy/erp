import { describe, expect, it } from 'vitest';
import { parseCsv } from '@erp/shared';
import { buildImportRows, guessImportMapping, IMPORT_FIELDS, type ImportKind, templateCsv } from './importRows';

describe('guessImportMapping', () => {
  it('finds item columns from English headers, unit cost before unit', () => {
    const m = guessImportMapping('items', [['SKU', 'Name', 'Name Arabic', 'Unit', 'Quantity', 'Unit cost']]);
    expect(m).toEqual({ columns: { sku: 0, name: 1, nameAr: 2, uom: 3, openingQty: 4, unitCost: 5 }, skipRows: 1 });
  });
  it('reads Arabic headers and skips title rows above the header', () => {
    const m = guessImportMapping('items', [['جرد المخزن'], ['الكود', 'الاسم', 'الوحدة', 'الكمية', 'التكلفة'], ['A1', 'x', 'قطعة', '5', '3']]);
    expect(m.skipRows).toBe(2);
    expect(m.columns).toMatchObject({ sku: 0, name: 1, uom: 2, openingQty: 3, unitCost: 4 });
  });
  it('finds customer columns', () => {
    const m = guessImportMapping('customers', [['Customer', 'Mobile', 'City', 'Contact']]);
    expect(m.columns).toMatchObject({ name: 0, phone: 1, city: 2, contact: 3 });
  });
  it('falls back to column order when no header is recognised', () => {
    const m = guessImportMapping('suppliers', [['a', 'b'], ['1', '2']]);
    expect(m.skipRows).toBe(1);
    expect(m.columns.code).toBe(0);
    expect(m.columns.name).toBe(1);
  });
});

describe('buildImportRows', () => {
  const items = (rows: string[][], wh = 'w1') => buildImportRows('items', rows, guessImportMapping('items', rows), wh);
  it('builds an item body with the cost in minor units and the warehouse for opening stock', () => {
    const [r] = items([['SKU', 'Name', 'Quantity', 'Unit cost'], ['p-1', 'Pen', '1,500', '12.5']]);
    expect(r?.problems).toEqual([]);
    expect(r?.body).toEqual({ sku: 'p-1', name: 'Pen', nameAr: '', uom: 'piece', openingQty: 1500, warehouseId: 'w1', unitCostMinor: 1250 });
  });
  it('flags missing name, missing sku, bad numbers and a duplicate code inside the file', () => {
    const rows = items([
      ['SKU', 'Name', 'Quantity', 'Unit cost'],
      ['A', '', '1', '1'],
      ['', 'No sku', '1', '1'],
      ['B', 'Bad qty', 'abc', '1'],
      ['C', 'Neg cost', '1', '-2'],
      ['D', 'Fine', '', ''],
      ['d', 'Again', '', ''],
    ]);
    expect(rows.map((r) => r.problems.map((p) => p.text))).toEqual([
      ['The name is missing'],
      ['The SKU is missing'],
      ['The opening quantity is not a number'],
      ['The unit cost cannot be negative'],
      [],
      ['This code is already on line {line} of the file'],
    ]);
    expect(rows[5]?.problems[0]?.line).toBe(6);
    expect(rows[4]?.body).toMatchObject({ openingQty: 0, warehouseId: '', unitCostMinor: null });
    expect(rows[0]?.body).toBeNull();
    expect(rows[2]?.line).toBe(4);
  });
  it('needs a warehouse only when there is opening stock', () => {
    const rows = [['SKU', 'Name', 'Quantity'], ['A', 'a', '3'], ['B', 'b', '0']];
    const r = items(rows, '');
    expect(r[0]?.problems[0]?.text).toBe('Choose a warehouse for the opening stock');
    expect(r[1]?.problems).toEqual([]);
  });
  it('builds customer and supplier bodies, code optional but checked when present', () => {
    const rows = [['Code', 'Name', 'City'], ['', 'Acme', 'Cairo'], ['bad code!', 'Beta', ''], ['C-2', '', '']];
    const r = buildImportRows('customers', rows, guessImportMapping('customers', rows), '');
    expect(r[0]?.body).toEqual({ code: '', name: 'Acme', contact: '', city: 'Cairo', phone: '' });
    expect(r[1]?.problems[0]?.text).toBe('A code is letters, digits and dashes, up to 30');
    expect(r[2]?.problems[0]?.text).toBe('The name is missing');
  });
  it('skips blank rows', () => {
    const rows = [['Name'], [''], ['Acme']];
    expect(buildImportRows('suppliers', rows, guessImportMapping('suppliers', rows), '')).toHaveLength(1);
  });
});

describe('templateCsv', () => {
  it.each(['items', 'customers', 'suppliers'] as ImportKind[])('%s: a header and one example row that map back to every field and import cleanly', (kind) => {
    const rows = parseCsv(templateCsv(kind));
    expect(rows).toHaveLength(2);
    const m = guessImportMapping(kind, rows);
    expect(m.skipRows).toBe(1);
    expect(Object.values(m.columns)).toHaveLength(IMPORT_FIELDS[kind].length);
    expect(IMPORT_FIELDS[kind].map((d) => m.columns[d.field])).toEqual(IMPORT_FIELDS[kind].map((_, i) => i));
    const built = buildImportRows(kind, rows, m, 'w1');
    expect(built).toHaveLength(1);
    expect(built[0]?.problems).toEqual([]);
  });
});
