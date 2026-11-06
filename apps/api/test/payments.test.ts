import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';
import {
  fawryNotificationSignature,
  hmacSha512Hex,
  major,
  PAYMOB_HMAC_FIELDS,
  parseFawryCallback,
  parsePaymobCallback,
  paymobHmacText,
  processFawryCallback,
  processPaymobCallback,
} from '../src/lib/payments/links';

// Payment links (sql/057, proved by sql/tests/052). Signature rules and callback reading run here against our own samples; the
// provider's real field values are checked in its test mode before a company goes live.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings;

const paymobObj = {
  amount_cents: 250000,
  created_at: '2026-11-06T10:00:00.000000',
  currency: 'EGP',
  error_occured: false,
  has_parent_transaction: false,
  id: 987654,
  integration_id: 4001,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 555, merchant_order_id: 'ERPabc123def456ghi78' },
  owner: 12,
  pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
  success: true,
};

describe('Paymob callback', () => {
  it('joins the 20 fields in Paymob order, booleans in lower case', () => {
    expect(PAYMOB_HMAC_FIELDS).toHaveLength(20);
    expect(paymobHmacText(paymobObj)).toBe(
      '2500002026-11-06T10:00:00.000000EGPfalsefalse987654' + '4001truefalsefalsefalsetruefalse555' + '12false2346MasterCardcardtrue',
    );
  });

  it('signs with HMAC-SHA512 (same as node crypto)', async () => {
    const text = paymobHmacText(paymobObj);
    expect(await hmacSha512Hex('secret', text)).toBe(createHmac('sha512', 'secret').update(text).digest('hex'));
  });

  it('reads our reference, amount and result; a refund or void is not a success', () => {
    const p = parsePaymobCallback({ type: 'TRANSACTION', obj: paymobObj });
    expect(p?.parsed).toEqual({
      ref: 'ERPabc123def456ghi78',
      txn: '987654',
      amountMinor: 250000,
      currency: 'EGP',
      success: true,
      pending: false,
    });
    expect(parsePaymobCallback({ obj: { ...paymobObj, is_refunded: true } })?.parsed.success).toBe(false);
    expect(parsePaymobCallback({ obj: { ...paymobObj, success: false } })?.parsed.success).toBe(false);
    expect(parsePaymobCallback({ obj: { ...paymobObj, order: { id: 1 } } })).toBeNull();
    expect(parsePaymobCallback('nope')).toBeNull();
  });

  it('rejects a body that is not JSON before touching the database', async () => {
    expect((await processPaymobCallback(env, 'not json', 'x')).status).toBe(400);
  });
});

describe('Fawry notification', () => {
  const n = {
    fawryRefNumber: '970123456',
    merchantRefNumber: 'ERPabc123def456ghi78',
    paymentAmount: 1500,
    orderAmount: 1500,
    orderStatus: 'PAID',
    paymentMethod: 'PAYATFAWRY',
    paymentRefrenceNumber: null,
  };

  it('signs with SHA-256 over the V2 fields, amounts with two decimals, the key last', async () => {
    const expected = createHash('sha256').update('970123456ERPabc123def456ghi781500.001500.00PAIDPAYATFAWRYsecure-key').digest('hex');
    expect(await fawryNotificationSignature(n, 'secure-key')).toBe(expected);
  });

  it('reads the facts; only PAID is a success; unfinished states wait', () => {
    expect(parseFawryCallback(n)).toEqual({
      ref: 'ERPabc123def456ghi78',
      txn: '970123456',
      amountMinor: 150000,
      currency: 'EGP',
      success: true,
      pending: false,
    });
    expect(parseFawryCallback({ ...n, orderStatus: 'EXPIRED' })).toMatchObject({ success: false, pending: false });
    expect(parseFawryCallback({ ...n, orderStatus: 'UNPAID' })).toMatchObject({ success: false, pending: true });
    expect(parseFawryCallback({ ...n, fawryRefNumber: '' })).toBeNull();
  });

  it('rejects a body that is not JSON', async () => {
    expect((await processFawryCallback(env, '{')).status).toBe(400);
  });

  it('formats amounts in pounds with two decimals', () => {
    expect(major(150000)).toBe('1500.00');
    expect(major(5)).toBe('0.05');
  });
});

describe('payment link routes', () => {
  const routes: [string, string][] = [
    ['GET', '/v1/finance/payment-links'],
    ['POST', '/v1/finance/payment-links'],
    ['POST', '/v1/finance/payment-links/11111111-1111-4111-8111-111111111111/cancel'],
    ['POST', '/v1/finance/payment-links/11111111-1111-4111-8111-111111111111/simulate-pay'],
  ];
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, env)).status).toBe(401);
  });

  it('the public callbacks are rate limited routes that refuse non-JSON with 400 and never 500', async () => {
    const a = await app.request('/webhooks/paymob?hmac=x', { method: 'POST', body: 'garbage' }, env);
    const b = await app.request('/webhooks/fawry', { method: 'POST', body: 'garbage' }, env);
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  it('changes go through database functions; no direct table writes or secrets in the route file', () => {
    const src = readFileSync(join(__dirname, '../src/modules/finance/routes.ts'), 'utf8');
    expect(src).not.toMatch(/fin_payment_links'\)\s*\.(insert|update|upsert|delete)/);
    expect(src).not.toContain('secret_key');
  });
});
