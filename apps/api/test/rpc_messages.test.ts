import { describe, expect, it } from 'vitest';
import { stockShortMessage, trimQty } from '../src/lib/rpc';

describe('stock shortage message', () => {
  it('drops trailing zeros from quantities', () => {
    expect(trimQty('1.000')).toBe('1');
    expect(trimQty('0.000')).toBe('0');
    expect(trimQty('2.500')).toBe('2.5');
    expect(trimQty('10.050')).toBe('10.05');
    expect(trimQty('100')).toBe('100');
  });

  it('says it in plain words', () => {
    expect(stockShortMessage('0.000 available, 1.000 requested')).toBe(
      'Not enough stock: you asked for 1, but only 0 are available in this warehouse.',
    );
    expect(stockShortMessage('1.000 available, 2.500 requested')).toBe(
      'Not enough stock: you asked for 2.5, but only 1 is available in this warehouse.',
    );
  });

  it('leaves unknown details alone', () => {
    expect(stockShortMessage('something else')).toBeNull();
  });
});
