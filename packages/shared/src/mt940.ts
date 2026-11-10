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
    .replace(/\n-\}/g, '\n');
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

const yymmdd = (s: string): string | null => {
  if (!/^\d{6}$/.test(s)) return null;
  const y = 2000 + Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

/** MT940 amounts use a comma and may end with it ("300," is 300.00). */
const mtAmount = (s: string | undefined) => (s ?? '').replace(/,$/, ',0');

const minorDigitsOf = (ccy: string) => (['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD'].includes(ccy) ? 3 : ccy === 'JPY' ? 0 : 2);

/** "C251101EGP1234,56" -> { sign, date, currency, minor }. */
function balance(v: string): { date: string; currency: string; minor: number } | null {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/.exec(v.trim());
  if (!m) return null;
  const date = yymmdd(m[2] ?? '');
  const minor = parseStatementAmount(mtAmount(m[4]), { decimal: ',', minorDigits: minorDigitsOf(m[3] ?? '') });
  if (!date || minor === null) return null;
  return { date, currency: m[3] ?? '', minor: m[1] === 'D' ? -minor : minor };
}

const LINE_61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([NSF][A-Z0-9]{3})([^/\n]{0,16})(?:\/\/([^\n]{0,16}))?(?:\n([\s\S]*))?$/;

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
        const b = balance(f.value);
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
        if (!cur) break;
        const m = LINE_61.exec(f.value);
        const valueDate = m ? yymmdd(m[1] ?? '') : null;
        const minor = m ? parseStatementAmount(mtAmount(m[5]), { decimal: ',', minorDigits: minorDigitsOf(cur.currency ?? '') }) : null;
        if (!m || !valueDate || minor === null || minor === 0) {
          errors.push({ statement: statements.length + 1, reason: 'line', detail: f.value.split('\n')[0] ?? '' });
          break;
        }
        // The entry (booking) date is MMDD in the value date's year, or the year next to it when the two straddle New Year.
        let bookingDate = valueDate;
        if (m[2]) {
          const vy = Number(valueDate.slice(0, 4));
          const vm = Number(valueDate.slice(5, 7));
          const em = Number(m[2].slice(0, 2));
          const ey = vm === 12 && em === 1 ? vy + 1 : vm === 1 && em === 12 ? vy - 1 : vy;
          bookingDate = yymmdd(`${String(ey).slice(2)}${m[2]}`) ?? valueDate;
        }
        const credit = m[3] === 'C' || m[3] === 'RD'; // a reversal of a debit is money in, and the other way round
        const reference = [m[7]?.trim() === 'NONREF' ? '' : (m[7] ?? '').trim(), m[8] ? m[8].trim() : ''].filter(Boolean).join(' / ');
        cur.lines.push({
          row,
          bookingDate,
          valueDate,
          description: (m[9] ?? '').replace(/\n/g, ' ').trim(),
          reference,
          amountMinor: credit ? minor : -minor,
          balanceMinor: null,
        });
        break;
      }
      case '86': {
        // Only the :86: right after a :61: describes that line; one at the end of a statement is about the statement.
        const last = after === '61' ? cur?.lines[cur.lines.length - 1] : undefined;
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
