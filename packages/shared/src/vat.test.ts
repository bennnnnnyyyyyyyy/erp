import { describe, expect, it } from 'vitest';
import { calcLine } from './modules/einvoicing/calc';
import { fmtDec, fromMinor2, toMinor2 } from './modules/einvoicing/decimal';
import { invoiceDueMinor, vatLine, vatTotals } from './vat';

describe('vatLine', () => {
  it('rounds the tax per line, half away from zero (the sql/086 known answers)', () => {
    expect(vatLine(3, 333, 14)).toEqual({ netMinor: 999, taxMinor: 140, grossMinor: 1139 }); // 139.86
    expect(vatLine(1, 1050, 5)).toEqual({ netMinor: 1050, taxMinor: 53, grossMinor: 1103 }); // 52.5 rounds up
    expect(vatLine(2, 333, 5)).toEqual({ netMinor: 666, taxMinor: 33, grossMinor: 699 }); // 33.3
    expect(vatLine(1.5, 101, 0)).toEqual({ netMinor: 152, taxMinor: 0, grossMinor: 152 }); // 151.5 rounds up
    expect(vatLine(1.005, 200, 14)).toEqual({ netMinor: 201, taxMinor: 28, grossMinor: 229 }); // no float drift
  });

  it('sums lines into document totals', () => {
    const t = vatTotals([vatLine(3, 333, 14), vatLine(1, 1050, 5), vatLine(1, 100, 0)]);
    expect(t).toEqual({ netMinor: 2149, taxMinor: 193, grossMinor: 2342 });
    expect(invoiceDueMinor(t.grossMinor, 380, 210)).toBe(2172);
  });

  it('agrees with the ETA line calculator for VAT-only lines', () => {
    const cases: [string, number, number][] = [
      ['3', 333, 14],
      ['1', 1050, 5],
      ['2.5', 12345, 14],
      ['7', 99, 14],
      ['0.333', 1000, 14],
      ['12', 1, 5],
    ];
    for (const [qty, price, rate] of cases) {
      const eta = calcLine({
        description: 'x',
        itemType: 'EGS',
        itemCode: 'EG-1-1',
        unitType: 'EA',
        quantity: qty,
        unitPriceEGP: fmtDec(fromMinor2(price)),
        taxes: [{ taxType: 'T1', subType: 'V009', rate: String(rate) }],
      });
      const ours = vatLine(Number(qty), price, rate);
      expect(ours.netMinor).toBe(Number(toMinor2(eta.netTotal)));
      expect(ours.taxMinor).toBe(Number(toMinor2(eta.taxes[0]?.amount ?? 0n)));
      expect(ours.grossMinor).toBe(Number(toMinor2(eta.total)));
    }
  });
});
