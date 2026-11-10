// MT940 bank statements (SWIFT customer statement message): CIB's corporate portal offers them, and many banks' corporate services do
// (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md §11). Built from the public standard, without bank samples, so each bank's first
// real file is still a check. Produces the same StatementLine as the CSV reader (bankStatements.ts), so the rest of the import does not
// care which format came in. Pure functions; nothing is saved here.
//
// The fields used:
//   :25:  account          :28C: statement number          :60F:/:60M: opening balance   C|D YYMMDD CCY amount
//   :61:  one line:  value date YYMMDD, [entry date MMDD], C|D|RC|RD, [funds code], amount, type (N/F/S + 3), reference[//bank ref]
//   :86:  free text for the line above (may span several lines)          :62F:/:62M: closing balance
// A file may hold several statements (one per :20:), and may be wrapped in {1:...}{2:...}{4: ... -} blocks.

import { parseStatementAmount, type StatementLine } from './bankStatements';

export type Mt940Statement = {
  account: string;
  statementNo: string;
  currency: string;
  openingMinor: number;
  openingDate: string;
  closingMinor: number;
  closingDate: string;
  lines: StatementLine[];
};

export type Mt940Error = { statement: number; reason: 'balance' | 'line' | 'currency' | 'missing_balance'; detail: string };

/** Fields in order: tag and value (a value keeps its line breaks). Lines before the first tag and block wrappers are ignored. */
function fields(text: string): { tag: string; value: string }[] {
  const body = text
    .replace(/\r\n?/g, '\n')
    .replace(/\{[1-3]:[^}]*\}/g, '')
    .replace(/\{4:\n?/g, '')
    .replace(/\n-\}/g, '\n')
    // the trailer block, e.g. "{5:}" or "{5:{CHK:...}}" after "-}" (ASN Bank sample): otherwise it sticks to the closing balance
    .replace(/\{5:(?:\{[^}]*\}|[^{}])*\}/g, '');
  const out: { tag: string; value: string }[] = [];
  for (const raw of body.split('\n')) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(raw);
    if (m) out.push({ tag: m[1] ?? '', value: m[2] ?? '' });
    else if (out.length && raw.trim() !== '' && raw.trim() !== '-') {
      const last = out[out.length - 1];
      if (last) last.value += `\n${raw}`;
    }
  }
  return out;
}

/** YYMMDD to an ISO date. Some banks (German ones, for interest) date the end of a month as its 30th, even "30 February": a day
 *  29-31 past the month's end is read as the month's last day. Anything else invalid is refused. */
const yymmdd = (s: string): string | null => {
  if (!/^\d{6}$/.test(s)) return null;
  const y = 2000 + Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last && d < 29) return null;
  return new Date(Date.UTC(y, m - 1, Math.min(d, last))).toISOString().slice(0, 10);
};

/** MT940 amounts use a comma and may end with it ("300," is 300.00). */
const mtAmount = (s: string | undefined) => (s ?? '').replace(/,$/, ',0');

const minorDigitsOf = (ccy: string) => (['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD'].includes(ccy) ? 3 : ccy === 'JPY' ? 0 : 2);

/** "C251101EGP1234,56" -> { sign, date, currency, minor }. */
function balance(v: string, fallbackCurrency = ''): { date: string; currency: string; minor: number } | null {
  // The currency is sometimes left out of a closing balance (an older German sample): it is then the opening balance's.
  const m = /^([CD])(\d{6})([A-Z]{3})?(\d[\d,]*)$/.exec((v.split('\n')[0] ?? '').trim());
  if (!m) return null;
  const date = yymmdd(m[2] ?? '');
  const ccy = m[3] ?? fallbackCurrency;
  const minor = parseStatementAmount(mtAmount(m[4]), { decimal: ',', minorDigits: minorDigitsOf(ccy) });
  if (!date || minor === null || !ccy) return null;
  return { date, currency: ccy, minor: m[1] === 'D' ? -minor : minor };
}

// Real files bend the standard (seen in public samples from Citi, ASN, Rabobank, Sberbank and others, 10 Nov 2026): the entry date
// left as four spaces, a type code padded with spaces or not starting with N/S/F, and references longer than 16 characters, with spaces
// or a single "/". So: the reference runs to "//" or the end of the line, and the bank reference to the end of the line.
const LINE_61 = /^(\d{6})(\d{4}| {4})?(RC|RD|C|D)([A-Z])?(\d[\d,]*)([A-Z][A-Z0-9 ]{3})(.*?)(?:\/\/(.*))?(?:\n([\s\S]*))?$/;

/** Reads every statement in an MT940 file. Lines that cannot be read and statements whose balances do not add up are returned as
 *  errors (never imported: a statement that does not add up is refused whole). */
export function readMt940(text: string): { statements: Mt940Statement[]; errors: Mt940Error[] } {
  const statements: Mt940Statement[] = [];
  const errors: Mt940Error[] = [];
  let cur: (Partial<Mt940Statement> & { lines: StatementLine[] }) | null = null;
  let row = 0;
  const finish = () => {
    if (!cur) return;
    const n = statements.length + errors.filter((e) => e.reason === 'balance' || e.reason === 'missing_balance').length + 1;
    if (cur.openingMinor === undefined || cur.closingMinor === undefined) {
      errors.push({ statement: n, reason: 'missing_balance', detail: 'the opening (:60F:) or closing (:62F:) balance is missing' });
    } else {
      const sum = cur.lines.reduce((a, l) => a + l.amountMinor, 0);
      if (cur.openingMinor + sum !== cur.closingMinor) {
        errors.push({
          statement: n,
          reason: 'balance',
          detail: `opening ${cur.openingMinor} + lines ${sum} is not the closing ${cur.closingMinor}`,
        });
      } else {
        let running = cur.openingMinor;
        for (const l of cur.lines) {
          running += l.amountMinor;
          l.balanceMinor = running;
        }
        statements.push(cur as Mt940Statement);
      }
    }
    cur = null;
  };

  let prev = '';
  let lastLine: StatementLine | undefined; // the line the last :61: produced (none when it was refused or left out)
  for (const f of fields(text)) {
    const after = prev;
    prev = f.tag;
    switch (f.tag) {
      case '20':
        finish();
        cur = { account: '', statementNo: '', currency: '', lines: [] };
        break;
      case '25':
        if (cur) cur.account = f.value.trim();
        break;
      case '28C':
        if (cur) cur.statementNo = f.value.trim();
        break;
      case '60F':
      case '60M': {
        const b = balance(f.value);
        if (cur && b) Object.assign(cur, { openingMinor: b.minor, openingDate: b.date, currency: b.currency });
        break;
      }
      case '62F':
      case '62M': {
        const b = balance(f.value, cur?.currency ?? '');
        if (cur && b) {
          if (cur.currency && b.currency !== cur.currency) {
            errors.push({ statement: statements.length + 1, reason: 'currency', detail: `${cur.currency} opening, ${b.currency} closing` });
          }
          Object.assign(cur, { closingMinor: b.minor, closingDate: b.date });
        }
        break;
      }
      case '61': {
        row++;
        lastLine = undefined;
        if (!cur) break;
        // A line after the closing balance belongs to no statement: refused, never added to the one already closed.
        if (cur.closingMinor !== undefined) {
          errors.push({
            statement: statements.length + 1,
            reason: 'line',
            detail: `after the closing balance: ${f.value.split('\n')[0] ?? ''}`,
          });
          break;
        }
        const m = LINE_61.exec(f.value);
        const valueDate = m ? yymmdd(m[1] ?? '') : null;
        const minor = m ? parseStatementAmount(mtAmount(m[5]), { decimal: ',', minorDigits: minorDigitsOf(cur.currency ?? '') }) : null;
        if (!m || !valueDate || minor === null) {
          errors.push({ statement: statements.length + 1, reason: 'line', detail: f.value.split('\n')[0] ?? '' });
          break;
        }
        // A zero line (a waived fee, a notice; seen in Citi's sample) changes nothing and has nothing to match: left out.
        if (minor === 0) break;
        // The entry (booking) date is MMDD in the value date's year, or the year next to it when the two straddle New Year.
        let bookingDate = valueDate;
        if (m[2]?.trim()) {
          const vy = Number(valueDate.slice(0, 4));
          const vm = Number(valueDate.slice(5, 7));
          const em = Number(m[2].slice(0, 2));
          const ey = vm === 12 && em === 1 ? vy + 1 : vm === 1 && em === 12 ? vy - 1 : vy;
          bookingDate = yymmdd(`${String(ey).slice(2)}${m[2]}`) ?? valueDate;
        }
        const credit = m[3] === 'C' || m[3] === 'RD'; // a reversal of a debit is money in, and the other way round
        const reference = [m[7]?.trim() === 'NONREF' ? '' : (m[7] ?? '').trim(), m[8] ? m[8].trim() : ''].filter(Boolean).join(' / ');
        lastLine = {
          row,
          bookingDate,
          valueDate,
          description: (m[9] ?? '').replace(/\n/g, ' ').trim(),
          reference,
          amountMinor: credit ? minor : -minor,
          balanceMinor: null,
        };
        cur.lines.push(lastLine);
        break;
      }
      case '86': {
        // Only the :86: right after a :61: describes that line; one at the end of a statement is about the statement.
        const last = after === '61' ? lastLine : undefined;
        if (last) last.description = [last.description, f.value.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ');
        break;
      }
      default:
        break;
    }
  }
  finish();
  return { statements, errors };
}
