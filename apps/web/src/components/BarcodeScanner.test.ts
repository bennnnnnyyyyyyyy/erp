import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanCode } from '../lib/scanCode';

// The barcode scanner (SCANNING_PLAN.md step 2). The camera itself cannot run in a unit test; these check the rules around it.
const source = readFileSync(join(__dirname, 'BarcodeScanner.tsx'), 'utf8');

describe('barcode scanner', () => {
  it('cleans what was read: trims and drops control characters', () => {
    expect(cleanCode('  6221234567890\r\n')).toBe('6221234567890');
    expect(cleanCode('\u0000AB\u0007C\u007f')).toBe('ABC');
    expect(cleanCode('   ')).toBe('');
  });

  it("uses the browser's own reader first and loads ZXing only when there is none", () => {
    expect(source.indexOf('nativeDetector()')).toBeLessThan(source.indexOf("import('@zxing/browser')"));
    expect(source).not.toMatch(/^import .*@zxing/m); // not in the main bundle
  });

  it('stops the camera when it closes', () => {
    expect(source).toContain('zxingStop?.();');
    expect(source).toContain('t.stop();');
  });

  it('holds no form: it opens inside order and item forms', () => {
    expect(source).not.toContain('<form');
  });

  it('only the top dialog answers Escape (the scanner over an item form)', () => {
    const modal = readFileSync(join(__dirname, 'Modal.tsx'), 'utf8');
    expect(modal).toContain("if (open[open.length - 1] !== box) return;");
  });
});
