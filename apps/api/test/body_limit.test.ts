import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';

// Repo audit 2026-11-06, finding 8: public webhooks refuse an oversized body before the handler reads it. Limits are per route:
// 100 KB for most webhooks, 1 MB for Shopify orders.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings;
const big = (bytes: number) => 'x'.repeat(bytes);

/** A body with no Content-Length, so the limit has to count the streamed bytes. */
function streamed(bytes: number): RequestInit {
  const chunk = new TextEncoder().encode(big(16 * 1024));
  let left = bytes;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (left <= 0) return controller.close();
      const part = chunk.subarray(0, Math.min(chunk.length, left));
      left -= part.length;
      controller.enqueue(part);
    },
  });
  return { method: 'POST', body, duplex: 'half' } as RequestInit;
}

describe('webhook body limits', () => {
  it.each(['whatsapp', 'telegram', 'paymob', 'fawry', 'bosta'])('/webhooks/%s refuses 200 KB with 413', async (hook) => {
    const r = await app.request(`/webhooks/${hook}`, { method: 'POST', body: big(200 * 1024) }, env);
    expect(r.status).toBe(413);
  });

  it('counts a streamed body that declares no length', async () => {
    const r = await app.request('/webhooks/paymob', streamed(300 * 1024), env);
    expect(r.status).toBe(413);
  });

  it('Shopify allows up to 1 MB: 500 KB reaches the handler, 2 MB does not', async () => {
    const ok = await app.request('/webhooks/shopify', { method: 'POST', body: big(500 * 1024) }, env);
    expect(ok.status).not.toBe(413);
    const tooBig = await app.request('/webhooks/shopify', { method: 'POST', body: big(2 * 1024 * 1024) }, env);
    expect(tooBig.status).toBe(413);
  });

  it('a normal-sized body still reaches the handler', async () => {
    const r = await app.request('/webhooks/fawry', { method: 'POST', body: 'garbage' }, env);
    expect(r.status).toBe(400);
  });
});
