// Importing items (with opening stock), customers and suppliers from a CSV or Excel file (Sheets option A,
// documentation/planning/2026-11-09-google-sheets-options.md). Pure logic only: guessing the columns, checking each row, building the
// request body and the template file. The screen (modules/core/settings/ImportFromFile.tsx) sends one request per row to the same API
// routes the normal screens use, so every database rule still applies.

import { parseAmount } from './numbers';

export type ImportKind = 'items' | 'customers' | 'suppliers';
export const MAX_IMPORT_ROWS = 2000;

export type ImportField = 'sku' | 'code' | 'name' | 'nameAr' | 'uom' | 'openingQty' | 'unitCost' | 'contact' | 'city' | 'phone';

type FieldDef = { field: ImportField; label: string; header: string; required?: boolean; match: RegExp; example: string };

const CONTACT = /contact|person|attn|المسؤول|جهة\s*الاتصال|الشخص|مسئول/i;
const CITY = /city|town|location|المدينة|مدينة|العنوان/i;
const PHONE = /phone|mobile|tel|whatsapp|الهاتف|هاتف|موبايل|المحمول|تليفون|جوال/i;

// Header words in English and Arabic. The first field whose pattern matches a cell wins, and each column is used once, so the more
// specific fields come first (Arabic name before name, unit cost before unit).
export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  items: [
    { field: 'sku', label: 'SKU', header: 'SKU', required: true, match: /^(sku|item\s*code|item\s*no\.?|code|product\s*code|barcode)$|^(كود|الكود|رقم\s*الصنف|رمز)/i, example: 'ITM-001' },
    { field: 'nameAr', label: 'Name in Arabic', header: 'Name Arabic', match: /arabic|name\s*ar\b|الاسم\s*(بال)?عربي|اسم\s*(الصنف\s*)?(بال)?عربي/i, example: 'قلم أزرق' },
    { field: 'name', label: 'Name', header: 'Name', required: true, match: /name|description|item|product|الاسم|اسم|الصنف|البيان|الوصف/i, example: 'Blue pen' },
    { field: 'unitCost', label: 'Unit cost', header: 'Unit cost', match: /cost|price|التكلفة|تكلفة|السعر|سعر/i, example: '12.50' },
    { field: 'uom', label: 'Unit', header: 'Unit', match: /unit|uom|measure|الوحدة|وحدة/i, example: 'piece' },
    { field: 'openingQty', label: 'Opening quantity', header: 'Opening quantity', match: /qty|quantity|opening|stock|on\s*hand|الكمية|كمية|الرصيد|رصيد|مخزون/i, example: '100' },
  ],
  customers: [
    { field: 'code', label: 'Code (optional)', header: 'Code', match: /^(customer\s*)?(code|no\.?|number|id)$|^(كود|الكود|رقم|رمز)/i, example: 'C-1001' },
    { field: 'name', label: 'Name', header: 'Name', required: true, match: /name|company|customer|الاسم|اسم|العميل|الشركة/i, example: 'Example Trading Co' },
    { field: 'contact', label: 'Contact person', header: 'Contact person', match: CONTACT, example: 'Sara Ahmed' },
    { field: 'city', label: 'City', header: 'City', match: CITY, example: 'Cairo' },
    { field: 'phone', label: 'Phone', header: 'Phone', match: PHONE, example: '01000000000' },
  ],
  suppliers: [
    { field: 'code', label: 'Code (optional)', header: 'Code', match: /^(supplier\s*|vendor\s*)?(code|no\.?|number|id)$|^(كود|الكود|رقم|رمز)/i, example: 'S-2001' },
    { field: 'name', label: 'Name', header: 'Name', required: true, match: /name|company|supplier|vendor|الاسم|اسم|المورد|الشركة/i, example: 'Example Supplies Ltd' },
    { field: 'contact', label: 'Contact person', header: 'Contact person', match: CONTACT, example: 'Omar Hassan' },
    { field: 'city', label: 'City', header: 'City', match: CITY, example: 'Alexandria' },
    { field: 'phone', label: 'Phone', header: 'Phone', match: PHONE, example: '01200000000' },
  ],
};

export type ImportMapping = { columns: Partial<Record<ImportField, number | null>>; skipRows: number };

/** The header row (among the first 10 rows) that names the most fields, and the column of each field. When no row names the required
 *  fields, the fields are taken in column order and the first row is treated as the header. */
export function guessImportMapping(kind: ImportKind, rows: string[][]): ImportMapping {
  const defs = IMPORT_FIELDS[kind];
  let best: ImportMapping | null = null;
  let bestHits = 0;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const columns: Partial<Record<ImportField, number | null>> = {};
    const used = new Set<number>();
    (rows[r] ?? []).forEach((cell, i) => {
      const text = cell.trim();
      if (!text) return;
      for (const d of defs) {
        if (columns[d.field] === undefined && d.match.test(text)) {
          columns[d.field] = i;
          used.add(i);
          break;
        }
      }
    });
    const hits = Object.keys(columns).length;
    if (defs.filter((d) => d.required).every((d) => columns[d.field] !== undefined) && hits > bestHits) {
      best = { columns, skipRows: r + 1 };
      bestHits = hits;
    }
  }
  if (best) return best;
  const columns: Partial<Record<ImportField, number | null>> = {};
  defs.forEach((d, i) => {
    columns[d.field] = i;
  });
  return { columns, skipRows: 1 };
}

export type ImportRow = {
  /** The row's line number in the file (1 = first line). */
  line: number;
  values: Partial<Record<ImportField, string>>;
  /** The request body for the API route; null when the row has problems. */
  body: Record<string, unknown> | null;
  /** English sentences, shown through tr(); `{line}` in the duplicate message is filled by the screen. */
  problems: { text: string; line?: number }[];
};

const CODE_RE = /^[A-Za-z0-9-]{1,30}$/;

/** Turns the file's rows into import rows: values read, problems found, request bodies built. `warehouseId` is the one warehouse
 *  that receives the opening stock of every item in the file. */
export function buildImportRows(kind: ImportKind, rows: string[][], mapping: ImportMapping, warehouseId: string): ImportRow[] {
  const defs = IMPORT_FIELDS[kind];
  const seen = new Map<string, number>();
  const out: ImportRow[] = [];
  rows.slice(mapping.skipRows).forEach((cells, idx) => {
    if (!cells.some((c) => c.trim() !== '')) return;
    const values: Partial<Record<ImportField, string>> = {};
    for (const d of defs) {
      const col = mapping.columns[d.field];
      if (col !== undefined && col !== null) values[d.field] = (cells[col] ?? '').trim();
    }
    const line = mapping.skipRows + idx + 1;
    const problems: ImportRow['problems'] = [];
    if (!values.name) problems.push({ text: 'The name is missing' });
    const code = (kind === 'items' ? values.sku : values.code) ?? '';
    if (kind === 'items' && !code) problems.push({ text: 'The SKU is missing' });
    if (code) {
      if (kind !== 'items' && !CODE_RE.test(code)) problems.push({ text: 'A code is letters, digits and dashes, up to 30' });
      const key = code.toUpperCase();
      const first = seen.get(key);
      if (first !== undefined) problems.push({ text: 'This code is already on line {line} of the file', line: first });
      else seen.set(key, line);
    }
    let qty = 0;
    let costMinor: number | null = null;
    if (kind === 'items') {
      if (values.openingQty) {
        qty = parseAmount(values.openingQty);
        if (!Number.isFinite(qty)) {
          problems.push({ text: 'The opening quantity is not a number' });
          qty = 0;
        } else if (qty < 0) problems.push({ text: 'The opening quantity cannot be negative' });
      }
      if (values.unitCost) {
        const c = parseAmount(values.unitCost);
        if (!Number.isFinite(c)) problems.push({ text: 'The unit cost is not a number' });
        else if (c < 0) problems.push({ text: 'The unit cost cannot be negative' });
        else costMinor = Math.round(c * 100);
      }
      if (qty > 0 && !warehouseId) problems.push({ text: 'Choose a warehouse for the opening stock' });
    }
    let body: Record<string, unknown> | null = null;
    if (problems.length === 0) {
      body =
        kind === 'items'
          ? { sku: code, name: values.name, nameAr: values.nameAr ?? '', uom: values.uom || 'piece', openingQty: qty, warehouseId: qty > 0 ? warehouseId : '', unitCostMinor: costMinor }
          : { code, name: values.name, contact: values.contact ?? '', city: values.city ?? '', phone: values.phone ?? '' };
    }
    out.push({ line, values, body, problems });
  });
  return out;
}

export const importEndpoint: Record<ImportKind, string> = {
  items: '/v1/inventory/items',
  customers: '/v1/sales/customers',
  suppliers: '/v1/purchasing/suppliers',
};

export const importPermission: Record<ImportKind, string> = {
  items: 'inventory.items.manage',
  customers: 'sales.customers.manage',
  suppliers: 'purchasing.suppliers.manage',
};

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A header row plus one example row of made-up values, as CSV text (the header words are ones the column guess recognises). */
export function templateCsv(kind: ImportKind): string {
  const defs = IMPORT_FIELDS[kind];
  return `${defs.map((d) => csvCell(d.header)).join(',')}\r\n${defs.map((d) => csvCell(d.example)).join(',')}\r\n`;
}
