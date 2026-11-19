import { describe, expect, it } from 'vitest';
import { toBaseLine, unitAllowsDecimals, unitText } from './lineUnits';

describe('order line units (slice D)', () => {
  it('3 boxes of 12 at 120.00 = 36 pieces at 10.00, nothing lost', () => {
    expect(toBaseLine(3, 12000, 12, 'piece')).toEqual({ baseQty: 36, baseMinor: 1000, lineMinor: 36000, typedLineMinor: 36000, whole: true });
  });

  it('a box price that does not split: 1 box of 12 at 100.00 is saved as 8.33 a piece = 99.96', () => {
    const l = toBaseLine(1, 10000, 12, 'piece');
    expect(l.baseMinor).toBe(833);
    expect(l.lineMinor).toBe(9996);
    expect(l.typedLineMinor).toBe(10000);
  });

  it('half a box is whole pieces; 1.3 boxes is not', () => {
    expect(toBaseLine(1.5, 12000, 12, 'piece').whole).toBe(true);
    expect(toBaseLine(1.3, 12000, 12, 'piece').whole).toBe(false);
  });

  it('a measure may hold decimals: 1.5 drums of 25 kg = 37.5 kg', () => {
    const l = toBaseLine(1.5, 50000, 25, 'kg');
    expect(l.baseQty).toBe(37.5);
    expect(l.whole).toBe(true);
    expect(unitAllowsDecimals('Litre')).toBe(true);
    expect(unitAllowsDecimals('box')).toBe(false);
  });

  it('the base unit is factor 1', () => {
    expect(toBaseLine(2, 10000, 1, 'piece')).toMatchObject({ baseQty: 2, baseMinor: 10000, lineMinor: 20000 });
  });

  it('shows the typed unit beside the base quantity', () => {
    expect(unitText(36, 'piece', 'box', 12)).toBe('3 box (36 piece)');
    expect(unitText(18, 'piece', 'box', 12)).toBe('1.5 box (18 piece)');
    expect(unitText(36, 'piece', null, null)).toBe('36 piece');
  });
});
