import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callRpc, stockShortMessage, trimQty, VAT_MISMATCH_MESSAGE } from '../src/lib/rpc';

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

  it('is replaced for a VAT mismatch, whose amounts are in minor units (walkthrough 19 Nov: "(250)" read as 250 pounds)', async () => {
    const detail = 'the VAT entered (250) is too far from the VAT worked out from the lines (168): check the rates on the lines';
    await expect(callRpc(fakeClient({ message: 'VAT_MISMATCH', details: detail }), 'x')).rejects.toMatchObject({
      message: VAT_MISMATCH_MESSAGE,
      status: 409,
    });
  });
});

describe('details people read (dead-ends audit, 25 Nov 2026)', () => {
  const fakeClient = (error: { message: string; details?: string }) =>
    ({ rpc: async () => ({ data: null, error: { code: 'P0001', hint: '', ...error } }) }) as unknown as SupabaseClient;

  it('drops raw record ids', async () => {
    await expect(
      callRpc(fakeClient({ message: 'UNCOSTED_RECEIPTS', details: 'stock receipt 3f2a1b0c-1111-4222-8333-944445555666 has no cost' }), 'x'),
    ).rejects.toMatchObject({
      message: 'Some stock receipts have no cost yet: enter them in Accounting setup first: stock receipt has no cost',
    });
  });

  it('writes an account role as words', async () => {
    await expect(callRpc(fakeClient({ message: 'ACCOUNT_ROLE_MISSING', details: 'inventory_asset' }), 'x')).rejects.toMatchObject({
      message: 'An account role is not set up in Accounting setup: inventory asset',
      code: 'account_role_missing',
    });
  });

  it('names the bank statement refusals instead of "something went wrong"', async () => {
    await expect(
      callRpc(fakeClient({ message: 'DUPLICATE_FILE', details: 'this file was already imported for this account' }), 'x'),
    ).rejects.toMatchObject({
      message: 'This file was already imported for this account',
      code: 'duplicate_file',
    });
    await expect(
      callRpc(fakeClient({ message: 'RECONCILE_DIFFERENCE', details: 'bank 100, books 90: difference 10' }), 'x'),
    ).rejects.toMatchObject({
      message: 'The statement does not match the books yet: bank 100, books 90: difference 10',
      code: 'reconcile_difference',
    });
  });
});
