// Reading a bank statement file in the browser (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md §7; Ben's Q1: CSV, Excel and Word
// now). The file never leaves the browser: only the lines are sent, with the file's SHA-256 so the same file is never imported twice.
// Excel (.xlsx) and Word (.docx) files are zip archives of XML; they are unpacked with the browser's own DecompressionStream (no
// library), and the first worksheet / every table in the document is turned into rows of text. MT940 goes to the shared reader.

import { type Mt940Error, type Mt940Statement, parseCsv, readMt940 } from '@erp/shared';

export type StatementFile =
  | { kind: 'rows'; format: 'csv' | 'xlsx' | 'docx'; rows: string[][]; hash: string; name: string }
  | { kind: 'mt940'; format: 'mt940'; statements: Mt940Statement[]; errors: Mt940Error[]; hash: string; name: string };

export class StatementFileError extends Error {}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

// ------------------------------------------------------------------ zip (stored or deflated entries; enough for Office files)

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files inside a zip archive, by name, read lazily. */
export async function unzip(bytes: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> {
  const v = new DataView(bytes);
  const u8 = new Uint8Array(bytes);
  // End of central directory: signature 0x06054b50, searched from the end (a comment may follow it).
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new StatementFileError('This file is not a valid Excel or Word file.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new StatementFileError('This file is damaged.');
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = u8.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new StatementFileError('This file uses a compression that cannot be read here.');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// The XML is read with patterns, not a DOM parser, so the same code runs in the browser and in the tests (plain Node). The parts read
// (rows, cells, text runs) are simple and regular in Office files.
const xml = async (files: Map<string, () => Promise<Uint8Array>>, name: string) => {
  const get = files.get(name);
  return get ? new TextDecoder().decode(await get()) : null;
};
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? _),
  );
/** Every element with this local name (any prefix), as [attributes, inner XML]. Self-closing elements have empty inner XML. */
const elements = (src: string, local: string): [string, string][] => {
  const re = new RegExp(`<(?:[\\w]+:)?${local}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w]+:)?${local}>)`, 'g');
  return [...src.matchAll(re)].map((m) => [m[1] ?? '', m[2] ?? '']);
};
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
const texts = (src: string) => elements(src, 't').map(([, inner]) => unescape(inner)).join('');

// ------------------------------------------------------------------ Excel: the first worksheet as rows of text

/** "B12" -> column index 1. */
const columnOf = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? 'A')].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(bytes: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(bytes);
  const shared = await xml(files, 'xl/sharedStrings.xml');
  const strings = shared ? elements(shared, 'si').map(([, inner]) => texts(inner)) : [];
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))[0];
  if (!sheetName) throw new StatementFileError('This Excel file has no worksheet.');
  const sheet = await xml(files, sheetName);
  if (!sheet) throw new StatementFileError('This Excel file has no worksheet.');
  const rows: string[][] = [];
  for (const [, row] of elements(sheet, 'row')) {
    const out: string[] = [];
    for (const [attrs, inner] of elements(row, 'c')) {
      const col = columnOf(attr(attrs, 'r') ?? 'A');
      const type = attr(attrs, 't');
      const value = unescape(elements(inner, 'v')[0]?.[1] ?? '');
      out[col] = type === 's' ? (strings[Number(value)] ?? '') : type === 'inlineStr' ? texts(inner) : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value;
    }
    const filled = Array.from(out, (x) => x ?? '');
    if (filled.some((x) => x.trim() !== '')) rows.push(filled);
  }
  return rows;
}

// ------------------------------------------------------------------ Word: every table in the document as rows of text

export async function readDocx(bytes: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(bytes);
  const doc = await xml(files, 'word/document.xml');
  if (!doc) throw new StatementFileError('This Word file has no document.');
  const rows: string[][] = [];
  for (const [, tr] of elements(doc, 'tr')) {
    const cells = elements(tr, 'tc').map(([, tc]) => elements(tc, 'p').map(([, p]) => texts(p)).join(' ').trim());
    if (cells.some((x) => x !== '')) rows.push(cells);
  }
  if (rows.length === 0) throw new StatementFileError('No table was found in this Word file.');
  return rows;
}

// ------------------------------------------------------------------ any statement file

export async function readStatementFile(file: File): Promise<StatementFile> {
  const bytes = await file.arrayBuffer();
  const hash = await sha256(bytes);
  const name = file.name;
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) return { kind: 'rows', format: 'xlsx', rows: await readXlsx(bytes), hash, name };
  if (lower.endsWith('.docx')) return { kind: 'rows', format: 'docx', rows: await readDocx(bytes), hash, name };
  if (lower.endsWith('.xls') || lower.endsWith('.doc')) {
    throw new StatementFileError('Old .xls and .doc files cannot be read: open the file and save it as .xlsx, .docx or .csv.');
  }
  if (lower.endsWith('.pdf')) throw new StatementFileError('PDF statements are not read yet. Export the statement as CSV, Excel or Word.');
  const textValue = new TextDecoder().decode(bytes);
  if (/^\s*(\{1:|:20:)/.test(textValue) || /\n:61:/.test(textValue)) {
    const r = readMt940(textValue);
    return { kind: 'mt940', format: 'mt940', statements: r.statements, errors: r.errors, hash, name };
  }
  return { kind: 'rows', format: 'csv', rows: parseCsv(textValue), hash, name };
}
