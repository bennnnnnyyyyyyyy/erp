import { describe, expect, it } from 'vitest';
import { guessMapping, readDocx, readStatementFile, readXlsx, sha256, StatementFileError } from './statementFiles';

describe('guessMapping', () => {
  it('finds the columns from an English header with money in and out', () => {
    const m = guessMapping([['Bank statement'], ['Date', 'Description', 'Ref', 'Debit', 'Credit', 'Balance'], ['09/11/2026', 'x', '', '5', '', '1']]);
    expect(m).toMatchObject({ date: 0, description: 1, reference: 2, moneyOut: 3, moneyIn: 4, balance: 5, skipRows: 2, dateFormat: 'dd/mm/yyyy' });
  });
  it('reads bilingual and Arabic headers, and a value date before the booking date', () => {
    expect(guessMapping([['Date التاريخ', 'Description الوصف', 'Debit مدين', 'Credit ائتمان', 'Balance الرصيد']])).toMatchObject({ date: 0, description: 1, moneyOut: 2, moneyIn: 3, balance: 4 });
    expect(guessMapping([['تاريخ القيمة', 'التاريخ', 'البيان', 'المبلغ'], ['2026-11-09', '2026-11-09', 'x', '5']])).toMatchObject({ valueDate: 0, date: 1, description: 2, amount: 3, dateFormat: 'yyyy-mm-dd' });
  });
  it('gives up when no row names a date and an amount', () => {
    expect(guessMapping([['a', 'b'], ['1', '2']])).toBeNull();
  });
});

// Minimal Office files built here (a zip with the few XML parts the reader needs), so no real bank file is committed.
async function zip(files: Record<string, string>, deflate = false): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(content);
    const data = deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, deflate ? 8 : 0, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let p = 0;
  for (const part of all) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

const XLSX = {
  'xl/sharedStrings.xml':
    '<?xml version="1.0"?><sst xmlns="x"><si><t>Date</t></si><si><t>Description</t></si><si><t>Amount</t></si><si><r><t>Transfer </t></r><r><t>from Delta &amp; Co</t></r></si><si><t>رسوم بنكية</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2"><v>46335</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>1500.75</v></c></row>' +
    '<row r="3"/>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>10/11/2026</t></is></c><c r="B4" t="s"><v>4</v></c><c r="D4"><v>-25</v></c></row>' +
    '</sheetData></worksheet>',
};

const DOCX = {
  'word/document.xml':
    '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Account statement</w:t></w:r></w:p><w:tbl>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Date</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Details</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>09/11/2026</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t xml:space="preserve">Cheque </w:t></w:r><w:r><w:t>000123</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>(300.00)</w:t></w:r></w:p></w:tc></w:tr>' +
    '</w:tbl></w:body></w:document>',
};

describe('readXlsx', () => {
  it('reads the first worksheet: shared and inline strings, rich text, numbers, gaps, entities and Arabic', async () => {
    expect(await readXlsx(await zip(XLSX))).toEqual([
      ['Date', 'Description', 'Amount'],
      ['46335', 'Transfer from Delta & Co', '1500.75'],
      ['10/11/2026', 'رسوم بنكية', '', '-25'],
    ]);
  });
  it('reads compressed (deflated) entries too, which is how Excel saves them', async () => {
    expect((await readXlsx(await zip(XLSX, true)))[1]?.[1]).toBe('Transfer from Delta & Co');
  });
});

describe('readDocx', () => {
  it('reads table rows and joins the text runs of each cell', async () => {
    expect(await readDocx(await zip(DOCX, true))).toEqual([
      ['Date', 'Details', 'Amount'],
      ['09/11/2026', 'Cheque 000123', '(300.00)'],
    ]);
  });
  it('says so when there is no table', async () => {
    await expect(readDocx(await zip({ 'word/document.xml': '<w:document><w:body><w:p/></w:body></w:document>' }))).rejects.toBeInstanceOf(StatementFileError);
  });
});

describe('readStatementFile', () => {
  const file = (name: string, content: BlobPart) => new File([content], name);
  it('recognises the format by name or content, and fingerprints the file', async () => {
    const csv = await readStatementFile(file('nov.csv', 'Date;Amount\n09/11/2026;10'));
    expect(csv).toMatchObject({ kind: 'rows', format: 'csv', rows: [['Date', 'Amount'], ['09/11/2026', '10']] });
    expect(csv.hash).toBe(await sha256(new TextEncoder().encode('Date;Amount\n09/11/2026;10').buffer as ArrayBuffer));
    const mt = await readStatementFile(file('stmt.txt', ':20:A\n:25:ACC\n:60F:C251101EGP0,00\n:61:251102C10,00NTRFX\n:62F:C251102EGP10,00'));
    expect(mt).toMatchObject({ kind: 'mt940', format: 'mt940' });
    expect((await readStatementFile(file('a.xlsx', await zip(XLSX)))).format).toBe('xlsx');
  });
  it('refuses old Office files and PDF with a clear message', async () => {
    await expect(readStatementFile(file('old.xls', 'x'))).rejects.toThrow(/save it as/);
    await expect(readStatementFile(file('s.pdf', 'x'))).rejects.toThrow(/PDF/);
  });
});
