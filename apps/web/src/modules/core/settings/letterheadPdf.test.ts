import { describe, expect, it } from 'vitest';
import { fitDataUrl, isPdfFile } from './letterheadPdf';

describe('PDF letterhead size', () => {
  it('keeps the best picture that fits', () => {
    const tried: string[] = [];
    const url = fitDataUrl((w, q) => { tried.push(`${w}@${q}`); return 'x'.repeat(w * q); }, 700);
    // 1240 at every quality is too long (744 at 0.6); 992 at 0.7 is 694.4 -> 694 characters, the first that fits.
    expect(url).toHaveLength(694);
    expect(tried).toEqual(['1240@0.9', '1240@0.8', '1240@0.7', '1240@0.6', '992@0.9', '992@0.8', '992@0.7']);
  });
  it('gives null when nothing fits, and never takes an empty picture', () => {
    expect(fitDataUrl(() => 'x'.repeat(10_000), 100)).toBeNull();
    expect(fitDataUrl(() => '', 100)).toBeNull();
  });
  it('knows a PDF by its type or its name', () => {
    expect(isPdfFile(new File([''], 'head.pdf'))).toBe(true);
    expect(isPdfFile(new File([''], 'head', { type: 'application/pdf' }))).toBe(true);
    expect(isPdfFile(new File([''], 'head.png', { type: 'image/png' }))).toBe(false);
  });
});
