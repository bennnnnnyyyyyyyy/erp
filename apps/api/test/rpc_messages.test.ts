import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callRpc, stockShortMessage, trimQty } from '../src/lib/rpc';

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

describe('a database detail that repeats the message', () => {
  // Ben's walkthrough (10 Nov): "This purchase order needs approval before goods can be received: this purchase order needs approval…"
  const fakeClient = (error: { message: string; details?: string }) =>
    ({ rpc: async () => ({ data: null, error: { code: 'P0001', hint: '', ...error } }) }) as unknown as SupabaseClient;

  it('is left out', async () => {
    await expect(
      callRpc(fakeClient({ message: 'NOT_APPROVED', details: 'this purchase order needs approval before goods can be received' }), 'x'),
    ).rejects.toMatchObject({ message: 'This purchase order needs approval before goods can be received', status: 409 });
  });

  it('is kept when it adds something', async () => {
    await expect(callRpc(fakeClient({ message: 'INVALID_STATE', details: 'the order is pending' }), 'x')).rejects.toMatchObject({
      message: 'That is not possible in the current state: the order is pending',
    });
  });
});
