import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';
import { processShopifyWebhook, shopifyHmacBase64 } from '../src/lib/store/shopify';

// Shopify orders in (sql/059, proved by sql/tests/054). Signature maths and early refusals here; the rest needs the database.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings;

describe('Shopify webhook', () => {
  it('signs with HMAC-SHA256 in base64 (same as node crypto)', async () => {
    const body = '{"id":1001,"name":"#1001"}';
    expect(await shopifyHmacBase64('shpss_secret', body)).toBe(createHmac('sha256', 'shpss_secret').update(body).digest('base64'));
  });
  it('refuses a shop domain that is not a myshopify.com name before touching the database', async () => {
    const r = await processShopifyWebhook(env, '{}', { shop: 'evil.example.com', hmac: 'x', topic: 'orders/create', webhookId: '' });
    expect(r.status).toBe(400);
  });
  it('the public route refuses a missing shop header with 400', async () => {
    expect((await app.request('/webhooks/shopify', { method: 'POST', body: '{}' }, env)).status).toBe(400);
  });
});

describe('online order routes', () => {
  const routes: [string, string][] = [
    ['GET', '/v1/sales/online-orders'],
    ['POST', '/v1/sales/online-orders/test'],
  ];
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, env)).status).toBe(401);
  });
});
