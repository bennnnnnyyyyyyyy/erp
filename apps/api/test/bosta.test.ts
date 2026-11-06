import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';
import { processBostaWebhook } from '../src/lib/shipping/bosta';

// Bosta shipments (sql/058, proved by sql/tests/053). The webhook's checks that need the database run there; here the early refusals
// and the route guards.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings;
const ID = '11111111-1111-4111-8111-111111111111';

describe('Bosta webhook', () => {
  it('refuses a body that is not a JSON object before touching the database', async () => {
    expect((await processBostaWebhook(env, 'garbage', 'x')).status).toBe(400);
    expect((await processBostaWebhook(env, '[1]', 'x')).status).toBe(400);
  });
  it('ignores an update without our reference or state', async () => {
    expect((await processBostaWebhook(env, '{"state": 45}', 'x')).body.handled).toBe('ignored');
    expect((await processBostaWebhook(env, '{"businessReference": "SHabc"}', 'x')).body.handled).toBe('ignored');
  });
  it('the public route refuses garbage with 400', async () => {
    expect((await app.request('/webhooks/bosta', { method: 'POST', body: 'garbage' }, env)).status).toBe(400);
  });
});

describe('shipment routes', () => {
  const routes: [string, string][] = [
    ['GET', '/v1/sales/shipments'],
    ['POST', '/v1/sales/shipments'],
    ['POST', `/v1/sales/shipments/${ID}/cancel`],
    ['POST', `/v1/sales/shipments/${ID}/simulate-step`],
  ];
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, env)).status).toBe(401);
  });
});
