import { describe, expect, it } from 'vitest';
import { isBadAmount, parseAmount, toMinor } from './numbers';

describe('parseAmount', () => {
  it('reads plain, comma-grouped and decimal amounts', () => {
    expect(parseAmount('1500')).toBe(1500);
    expect(parseAmount('1,500')).toBe(1500);
    expect(parseAmount(' 1,500.75 ')).toBe(1500.75);
    expect(parseAmount('.5')).toBe(0.5);
  });
  it('reads Arabic digits and separators', () => {
    expect(parseAmount('١٥٠٠')).toBe(1500);
    expect(parseAmount('١٬٥٠٠٫٥')).toBe(1500.5);
    expect(parseAmount('۲۵')).toBe(25);
  });
  it('is NaN for blank and for text that is not a number', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('12a')).toBeNaN();
    expect(parseAmount('1.2.3')).toBeNaN();
  });
});

describe('toMinor and isBadAmount', () => {
  it('turns money into minor units', () => {
    expect(toMinor('18.50')).toBe(1850);
    expect(toMinor('١٬٠٠٠')).toBe(100000);
    expect(toMinor('')).toBe(0);
  });
  it('flags only typed text that is not a number', () => {
    expect(isBadAmount('')).toBe(false);
    expect(isBadAmount('1,500')).toBe(false);
    expect(isBadAmount('abc')).toBe(true);
  });
});
