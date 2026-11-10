import { describe, expect, it } from 'vitest';
import { readMt940 } from './mt940';

// A statement written for this test from the MT940 field rules (no real bank file; names and numbers are made up).
const FILE = [
  '{1:F01CIBEEGCXAXXX0000000000}{2:O9401200251110CIBEEGCXAXXX00000000002511101200N}{4:',
  ':20:STMT251110',
  ':25:EG12345678901234567890123',
  ':28C:00045/001',
  ':60F:C251101EGP10000,00',
  ':61:2511021102C1500,00NTRFINV-0042//CIB7781',
  ':86:Transfer from Delta Trading',
  'invoice INV-0042',
  ':61:2511031103D25,00NCHGNONREF',
  ':86:رسوم بنكية شهرية',
  ':61:251104D300,NCHKCHQ 000123',
  ':86:Cheque 000123 Nile Packaging',
  ':62F:C251104EGP11175,00',
  ':86:End of statement',
  '-}',
].join('\r\n');

describe('readMt940', () => {
  const { statements, errors } = readMt940(FILE);
  const s = statements[0];

  it('reads the header and balances', () => {
    expect(errors).toEqual([]);
    expect(s).toMatchObject({
      account: 'EG12345678901234567890123',
      statementNo: '00045/001',
      currency: 'EGP',
      openingMinor: 1000000,
      openingDate: '2025-11-01',
      closingMinor: 1117500,
      closingDate: '2025-11-04',
    });
  });

  it('reads each line: direction, amount, dates, references, the :86: text, and a running balance', () => {
    expect(s?.lines.map((l) => [l.bookingDate, l.amountMinor, l.reference, l.balanceMinor])).toEqual([
      ['2025-11-02', 150000, 'INV-0042 / CIB7781', 1150000],
      ['2025-11-03', -2500, '', 1147500],
      ['2025-11-04', -30000, 'CHQ 000123', 1117500],
    ]);
    expect(s?.lines[0]?.description).toBe('Transfer from Delta Trading invoice INV-0042');
    expect(s?.lines[1]?.description).toBe('رسوم بنكية شهرية');
    // the statement-level :86: after the closing balance is not glued onto the last line
    expect(s?.lines[2]?.description).toBe('Cheque 000123 Nile Packaging');
  });

  it('refuses a statement whose lines do not add up to the closing balance', () => {
    const r = readMt940(FILE.replace(':62F:C251104EGP11175,00', ':62F:C251104EGP11175,01'));
    expect(r.statements).toEqual([]);
    expect(r.errors[0]?.reason).toBe('balance');
  });

  it('reads reversals the right way round and an entry date across New Year', () => {
    const r = readMt940([':20:X', ':25:A1', ':60F:C251231EGP0,00', ':61:2512310101RD100,00NTRFREV1', ':62F:C260101EGP100,00'].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.statements[0]?.lines[0]).toMatchObject({ amountMinor: 10000, valueDate: '2025-12-31', bookingDate: '2026-01-01' });
  });

  it('reads several statements, a debit opening balance, and three-decimal currencies', () => {
    const two = [
      ':20:A',
      ':25:ACC1',
      ':60F:D251101EGP50,00',
      ':61:251102C80,00NTRFX',
      ':62F:C251102EGP30,00',
      ':20:B',
      ':25:ACC2',
      ':60F:C251101KWD1,250',
      ':61:251102D0,250NCHGY',
      ':62F:C251102KWD1,000',
    ].join('\n');
    const r = readMt940(two);
    expect(r.errors).toEqual([]);
    expect(r.statements.map((x) => [x.account, x.openingMinor, x.closingMinor])).toEqual([
      ['ACC1', -5000, 3000],
      ['ACC2', 1250, 1000],
    ]);
  });

  it('reports a line it cannot read, and a missing balance', () => {
    expect(readMt940([':20:A', ':60F:C251101EGP0,00', ':61:garbage', ':62F:C251101EGP0,00'].join('\n')).errors[0]?.reason).toBe('line');
    expect(readMt940([':20:A', ':61:251102C1,00NTRFX'].join('\n')).errors[0]?.reason).toBe('missing_balance');
  });
});

// How real banks bend the standard, as seen in public MT940 samples (Citi, ASN, Rabobank, Sberbank, German banks; 10 Nov 2026). Each
// case below is written for this test with made-up values, in the shape seen; the samples themselves are not in the repo.
describe('readMt940 with real-world variations', () => {
  const one = (...body: string[]) => readMt940([':20:A', ':25:ACC', ...body].join('\n'));

  it('reads an entry date left as four spaces', () => {
    const r = one(':60F:C251101EGP100,00', ':61:251102    DD20,00NMSCNONREF//', ':62F:C251102EGP80,00');
    expect(r.errors).toEqual([]);
    expect(r.statements[0]?.lines[0]).toMatchObject({ bookingDate: '2025-11-02', amountMinor: -2000 });
  });

  it('reads references longer than 16 characters, with spaces or a single slash', () => {
    const r = one(
      ':60F:C251101EGP100,00',
      ':61:2511020102D10,00NOVBEG380019000500000000263180002',
      ':61:251103D000000000005,00N0440121470966      A. Sample',
      ':61:251104C1,NMSC341241773/1XXXXX//O/341241774',
      ':62F:C251104EGP86,00',
    );
    expect(r.errors).toEqual([]);
    expect(r.statements[0]?.lines.map((l) => l.reference)).toEqual([
      'EG380019000500000000263180002',
      '0121470966      A. Sample',
      '341241773/1XXXXX / O/341241774',
    ]);
  });

  it('reads a type code padded with spaces, and a funds code letter', () => {
    const r = one(':60F:C251101EGP100,00', ':61:2511021102DF24,00S   X', ':62F:C251102EGP76,00');
    expect(r.errors).toEqual([]);
    expect(r.statements[0]?.lines[0]?.amountMinor).toBe(-2400);
  });

  it('reads "30 February" (month-end interest) as the last day of February', () => {
    const r = one(':60F:C240201EGP100,00', ':61:2402300301DR6,00N024NONREF', ':62F:C240301EGP94,00');
    expect(r.errors).toEqual([]);
    expect(r.statements[0]?.lines[0]).toMatchObject({ valueDate: '2024-02-29', bookingDate: '2024-03-01' });
    expect(one(':60F:C251101EGP0,00', ':61:251315C1,00NTRFX', ':62F:C251101EGP1,00').errors[0]?.reason).toBe('line');
  });

  it('leaves out zero lines', () => {
    const r = one(':60F:C251101EGP100,00', ':61:251102C0,00NDEFNONREF//', ':61:251102D1,00NTRFX', ':62F:C251102EGP99,00');
    expect(r.errors).toEqual([]);
    expect(r.statements[0]?.lines).toHaveLength(1);
  });

  it('strips the {5:} trailer block after each statement', () => {
    const block = (no: string, open: string, close: string) =>
      `{1:F01BANKXXXX0000000000}{2:O940BANKXXXXN}{3:}{4:\n:20:X\n:25:ACC\n:28C:${no}\n:60F:C2511${open}\n:62F:C2511${close}\n-}{5:{CHK:ABC}}`;
    const r = readMt940([block('1/1', '01EGP5,00', '01EGP5,00'), block('2/1', '02EGP5,00', '02EGP5,00')].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.statements).toHaveLength(2);
  });

  it('refuses a line after the closing balance, and does not give its :86: to the line before', () => {
    const r = one(
      ':60F:C251101EGP100,00',
      ':61:251102D1,00NTRFX',
      ':86:first',
      ':62F:C251102EGP99,00',
      ':61:251103C5,00NTRFY',
      ':86:stray',
    );
    expect(r.statements[0]?.lines).toHaveLength(1);
    expect(r.statements[0]?.lines[0]?.description).toBe('first');
    expect(r.errors).toEqual([expect.objectContaining({ reason: 'line', detail: expect.stringContaining('after the closing balance') })]);
  });

  it('takes the opening currency when the closing balance has none', () => {
    const r = one(':60F:C251101EGP0,00', ':61:251102C1050,00NTRFX', ':62F:C2511021050,00');
    expect(r.errors).toEqual([]);
    expect(r.statements[0]).toMatchObject({ currency: 'EGP', closingMinor: 105000 });
  });
});
