import { describe, expect, it } from 'vitest';
import {
  fingerprints,
  type LedgerCandidate,
  parseCsv,
  parseStatementAmount,
  parseStatementDate,
  readStatement,
  suggestGroups,
  suggestMatches,
} from './bankStatements';

describe('parseCsv', () => {
  it('reads quoted cells with commas, quotes and line breaks, CRLF and a BOM', () => {
    const rows = parseCsv(
      '﻿Date,Description,Amount\r\n09/11/2026,"Transfer, ref ""INV-0042""",1500.00\r\n10/11/2026,"two\nlines",-20\r\n\r\n',
    );
    expect(rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['09/11/2026', 'Transfer, ref "INV-0042"', '1500.00'],
      ['10/11/2026', 'two\nlines', '-20'],
    ]);
  });
  it('detects semicolon and tab separators', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('keeps Arabic text as it is', () => {
    expect(parseCsv('التاريخ,البيان\n٠٩/١١/٢٠٢٦,تحويل وارد')[1]).toEqual(['٠٩/١١/٢٠٢٦', 'تحويل وارد']);
  });
});

describe('parseStatementAmount', () => {
  it.each([
    ['1,500.75', 150075],
    ['1500', 150000],
    ['-12.50', -1250],
    ['12.50-', -1250],
    ['(12.50)', -1250],
    ['+3', 300],
    ['١٬٥٠٠٫٧٥', 150075],
    ['EGP 1,000.00', 100000],
    ['1,000.00 ج.م', 100000],
    ['.5', 50],
  ])('%s -> %i', (text, minor) => {
    expect(parseStatementAmount(text)).toBe(minor);
  });
  it('reads a comma decimal when told to', () => {
    expect(parseStatementAmount('1.500,75', { decimal: ',' })).toBe(150075);
  });
  it('refuses what is not money, and never rounds extra decimals away', () => {
    for (const bad of ['', 'abc', '12.3.4', '1.505', '1-2']) expect(parseStatementAmount(bad)).toBeNull();
    expect(parseStatementAmount('1.500')).toBe(150); // trailing zero is fine
    expect(parseStatementAmount('1.234', { minorDigits: 3 })).toBe(1234); // Kuwaiti dinar style
  });
});

describe('parseStatementDate', () => {
  it('reads the three formats, other separators, two-digit years and a time part', () => {
    expect(parseStatementDate('09/11/2026', 'dd/mm/yyyy')).toBe('2026-11-09');
    expect(parseStatementDate('09-11-26', 'dd/mm/yyyy')).toBe('2026-11-09');
    expect(parseStatementDate('09.11.2026 14:05', 'dd/mm/yyyy')).toBe('2026-11-09');
    expect(parseStatementDate('11/09/2026', 'mm/dd/yyyy')).toBe('2026-11-09');
    expect(parseStatementDate('2026-11-09', 'yyyy-mm-dd')).toBe('2026-11-09');
    expect(parseStatementDate('٠٩/١١/٢٠٢٦', 'dd/mm/yyyy')).toBe('2026-11-09');
  });
  it('reads an Excel date serial', () => {
    expect(parseStatementDate('46335', 'dd/mm/yyyy')).toBe('2026-11-09');
  });
  it('refuses impossible dates', () => {
    for (const bad of ['31/02/2026', '2026-13-01', 'yesterday', '9/11', ''])
      expect(parseStatementDate(bad, bad.startsWith('2026') ? 'yyyy-mm-dd' : 'dd/mm/yyyy')).toBeNull();
  });
});

describe('readStatement', () => {
  const rows = parseCsv(
    [
      'Bank statement;;;;',
      'Date;Description;Reference;Debit;Credit;Balance',
      '01/11/2026;Opening;;;;10,000.00',
      '02/11/2026;Customer transfer;INV-0042;;1,500.00;11,500.00',
      '03/11/2026;رسوم بنكية;;25.00;;11,475.00',
      '04/11/2026;Bad date row;;;5.00;',
      '31/02/2026;Impossible;;;5.00;',
      '05/11/2026;Both;;1.00;2.00;',
      '06/11/2026;Not a number;;abc;;',
    ].join('\n'),
  );
  const mapping = {
    date: 0,
    description: 1,
    reference: 2,
    moneyOut: 3,
    moneyIn: 4,
    balance: 5,
    dateFormat: 'dd/mm/yyyy' as const,
    skipRows: 2,
  };
  const { lines, errors } = readStatement(rows, mapping);
  it('reads money in as positive and money out as negative, with the balance', () => {
    expect(lines.map((l) => [l.bookingDate, l.amountMinor, l.reference, l.balanceMinor])).toEqual([
      ['2026-11-02', 150000, 'INV-0042', 1150000],
      ['2026-11-03', -2500, '', 1147500],
      ['2026-11-04', 500, '', null],
    ]);
    expect(lines[1]?.description).toBe('رسوم بنكية');
  });
  it('lists the rows it could not read, by row number, and imports none of them', () => {
    expect(errors).toEqual([
      { row: 3, reason: 'amount' },
      { row: 7, reason: 'date' },
      { row: 8, reason: 'both_in_and_out' },
      { row: 9, reason: 'amount' },
    ]);
  });
  it('reads one signed amount column too', () => {
    const r = readStatement([['09/11/2026', 'fee', '(10.00)']], {
      date: 0,
      description: 1,
      amount: 2,
      dateFormat: 'dd/mm/yyyy',
      skipRows: 0,
    });
    expect(r.lines[0]?.amountMinor).toBe(-1000);
  });
});

describe('fingerprints', () => {
  it('tells identical lines on the same day apart, and is the same for the same file', () => {
    const l = {
      row: 1,
      bookingDate: '2026-11-09',
      valueDate: null,
      description: 'ATM  withdrawal',
      reference: '',
      amountMinor: -50000,
      balanceMinor: null,
    };
    const a = fingerprints('acc', [l, { ...l, row: 2 }]);
    expect(a[0]).not.toBe(a[1]);
    expect(fingerprints('acc', [{ ...l, description: 'atm withdrawal' }, l])).toEqual(a);
    expect(fingerprints('other', [l])[0]).not.toBe(a[0]);
  });
});

describe('suggestMatches', () => {
  const line = { bookingDate: '2026-11-09', amountMinor: 150000, reference: 'TRF 123', description: 'From Delta Trading inv-0042' };
  const c = (id: string, date: string, amountMinor: number, documentNumbers: string[] = []): LedgerCandidate => ({
    id,
    date,
    amountMinor,
    documentNumbers,
  });

  it('exact: same amount and our document number in the bank text, within 7 days', () => {
    const s = suggestMatches(line, [c('a', '2026-11-04', 150000, ['INV-0042']), c('b', '2026-11-09', 150000, ['PAY-0001'])]);
    expect(s[0]).toMatchObject({ tier: 'exact', candidateIds: ['a'] });
    expect(s[1]).toMatchObject({ tier: 'possible', candidateIds: ['b'] });
  });
  it('strong: the only same-amount line within 3 days', () => {
    expect(suggestMatches(line, [c('a', '2026-11-07', 150000)])).toEqual([
      { tier: 'strong', candidateIds: ['a'], days: 2, why: ['amount', 'date', 'only_one'] },
    ]);
  });
  it('possible: several same-amount lines, nearest first; the person chooses', () => {
    const s = suggestMatches(line, [c('far', '2026-11-01', 150000), c('near', '2026-11-08', 150000)]);
    expect(s.map((x) => [x.tier, x.candidateIds[0]])).toEqual([
      ['possible', 'near'],
      ['possible', 'far'],
    ]);
  });
  it('nothing for other amounts, the other direction, or more than 10 days away', () => {
    expect(suggestMatches(line, [c('a', '2026-11-09', 150001), c('b', '2026-11-09', -150000), c('c', '2026-10-20', 150000)])).toEqual([]);
  });
  it('a short document number is not enough for exact', () => {
    expect(suggestMatches(line, [c('a', '2026-11-09', 150000, ['12'])])[0]?.tier).toBe('strong');
  });
});

describe('suggestGroups', () => {
  it('finds ledger lines on nearby days that add up exactly, smallest group first', () => {
    const cands: LedgerCandidate[] = [
      { id: 'a', date: '2026-11-09', amountMinor: 100000, documentNumbers: [] },
      { id: 'b', date: '2026-11-09', amountMinor: 50000, documentNumbers: [] },
      { id: 'c', date: '2026-11-08', amountMinor: 30000, documentNumbers: [] },
      { id: 'd', date: '2026-11-08', amountMinor: 20000, documentNumbers: [] },
      { id: 'e', date: '2026-11-09', amountMinor: -50000, documentNumbers: [] },
    ];
    const g = suggestGroups({ bookingDate: '2026-11-09', amountMinor: 150000 }, cands);
    expect(g[0]).toEqual(['a', 'b']);
    expect(g).toContainEqual(['a', 'c', 'd']);
    expect(g.flat()).not.toContain('e');
  });
});
