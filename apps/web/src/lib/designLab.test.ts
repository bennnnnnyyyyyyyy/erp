import { describe, expect, it } from 'vitest';
import { compositeOver, contrastRatio, luminance, nextRadioIndex, requiredRatio } from './designLab';

// The accessibility helpers behind the Design Lab (dev-only tool): the contrast arithmetic and the radio-group arrow keys.

describe('contrast arithmetic (WCAG)', () => {
  it('black on white is 21 : 1 and a colour against itself is 1 : 1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 130, 140], [120, 130, 140])).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrastRatio([20, 40, 60], [230, 220, 210])).toBeCloseTo(contrastRatio([230, 220, 210], [20, 40, 60]), 8);
  });
  it('#777 on white is just under 4.5 : 1 (the classic near miss)', () => {
    const r = contrastRatio([0x77, 0x77, 0x77], [255, 255, 255]);
    expect(r).toBeGreaterThan(4.4);
    expect(r).toBeLessThan(4.5);
  });
  it('luminance runs from 0 (black) to 1 (white)', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 8);
  });
  it('composites a colour with alpha over an opaque one', () => {
    expect(compositeOver([0, 0, 0, 0.5], [255, 255, 255])).toEqual([128, 128, 128]);
    expect(compositeOver([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30]);
    expect(compositeOver([10, 20, 30, 0], [200, 100, 50])).toEqual([200, 100, 50]);
  });
  it('asks 3 : 1 for large text and 4.5 : 1 otherwise', () => {
    expect(requiredRatio(16, 400)).toBe(4.5);
    expect(requiredRatio(24, 400)).toBe(3);
    expect(requiredRatio(19, 700)).toBe(3);
    expect(requiredRatio(19, 400)).toBe(4.5);
    expect(requiredRatio(14, 700)).toBe(4.5);
  });
});

describe('radio group arrow keys', () => {
  it('moves forward and back, wrapping around, in left-to-right', () => {
    expect(nextRadioIndex(0, 'ArrowRight', 4, false)).toBe(1);
    expect(nextRadioIndex(3, 'ArrowRight', 4, false)).toBe(0);
    expect(nextRadioIndex(0, 'ArrowLeft', 4, false)).toBe(3);
    expect(nextRadioIndex(2, 'ArrowDown', 4, false)).toBe(3);
    expect(nextRadioIndex(2, 'ArrowUp', 4, false)).toBe(1);
  });
  it('reverses left and right in right-to-left (Arabic), but not up and down', () => {
    expect(nextRadioIndex(0, 'ArrowLeft', 4, true)).toBe(1);
    expect(nextRadioIndex(0, 'ArrowRight', 4, true)).toBe(3);
    expect(nextRadioIndex(1, 'ArrowDown', 4, true)).toBe(2);
    expect(nextRadioIndex(1, 'ArrowUp', 4, true)).toBe(0);
  });
  it('jumps with Home and End, and ignores other keys and empty groups', () => {
    expect(nextRadioIndex(2, 'Home', 5, false)).toBe(0);
    expect(nextRadioIndex(2, 'End', 5, false)).toBe(4);
    expect(nextRadioIndex(2, 'a', 5, false)).toBeNull();
    expect(nextRadioIndex(0, 'Enter', 5, false)).toBeNull();
    expect(nextRadioIndex(0, 'ArrowRight', 0, false)).toBeNull();
  });
});
