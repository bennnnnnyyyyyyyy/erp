import { describe, expect, it } from 'vitest';
import { buildBalanceSheet, buildIncomeStatement, sameDateLastYear, type StatementRow } from './accounting';

const row = (line: StatementRow['line'], amountMinor: number, code = '1'): StatementRow => ({
  line,
  accountId: code,
  code,
  name: code,
  nameAr: null,
  amountMinor,
});

describe('income statement', () => {
  it('builds gross, operating, before-tax and net profit in the EAS order', () => {
    const s = buildIncomeStatement([
      row('revenue', 30000),
      row('revenue', -1000, '412'),
      row('cost_of_sales', 12000),
      row('other_income', 500),
      row('operating_expenses', 2000),
      row('finance_costs', 300),
      row('income_tax', 200),
    ]);
    expect(s.sections.map((x) => x.line)).toEqual([
      'revenue',
      'cost_of_sales',
      'other_income',
      'operating_expenses',
      'finance_costs',
      'income_tax',
    ]);
    expect(s.sections[0]?.totalMinor).toBe(29000); // sales returns (a debit balance on a revenue account) reduce revenue
    expect(s.grossProfitMinor).toBe(17000);
    expect(s.operatingProfitMinor).toBe(15500);
    expect(s.profitBeforeTaxMinor).toBe(15200);
    expect(s.netProfitMinor).toBe(15000);
  });

  it('is all zeros with no rows', () => {
    expect(buildIncomeStatement([]).netProfitMinor).toBe(0);
  });
});

describe('balance sheet', () => {
  it('balances, and reports any difference instead of hiding it', () => {
    const rows = [row('cash', 178000), row('inventory', -12000), row('equity', 50000), row('equity', 16000), row('equity', 100000)];
    const b = buildBalanceSheet(rows);
    expect(b.totalAssetsMinor).toBe(166000);
    expect(b.totalEquityMinor).toBe(166000);
    expect(b.totalLiabilitiesMinor).toBe(0);
    expect(b.differenceMinor).toBe(0);
    expect(buildBalanceSheet([...rows, row('current_liabilities', 500)]).differenceMinor).toBe(-500);
  });
});

describe('comparison date', () => {
  it('is the same day a year earlier, clamped at month end', () => {
    expect(sameDateLastYear('2026-03-31')).toBe('2025-03-31');
    expect(sameDateLastYear('2028-02-29')).toBe('2027-02-28');
    expect(sameDateLastYear('2026-01-01')).toBe('2025-01-01');
  });
});
