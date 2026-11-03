import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { rateLimit } from '../src/middleware/rateLimit';

// System audit 2026-11-03, finding 4. The limiter is the Cloudflare binding; here a fake one shows the middleware's behaviour.

function appWith(limiter?: { limit(o: { key: string }): Promise<{ success: boolean }> }, keys: string[] = []) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-1', email: 'a@b.c' });
    await next();
  });
  app.use('*', rateLimit('api'));
  app.get('/x', (c) => c.text('ok'));
  const env = {
    APP_ENV: 'test',
    ALLOWED_ORIGINS: '',
    API_LIMITER: limiter
      ? {
          limit: async (o: { key: string }) => {
            keys.push(o.key);
            return limiter.limit(o);
          },
        }
      : undefined,
  };
  return { app, env };
}

describe('rate limit middleware', () => {
  it('lets everything through when the binding is missing (tests, local dev)', async () => {
    const { app, env } = appWith(undefined);
    expect((await app.request('/x', {}, env)).status).toBe(200);
  });

  it('counts per signed-in user and passes while under the limit', async () => {
    const keys: string[] = [];
    const { app, env } = appWith({ limit: async () => ({ success: true }) }, keys);
    expect((await app.request('/x', {}, env)).status).toBe(200);
    expect(keys).toEqual(['api:user-1']);
  });

  it('answers 429 with a clear message when over the limit', async () => {
    const { app, env } = appWith({ limit: async () => ({ success: false }) });
    const res = await app.request('/x', {}, env);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ success: false, code: 'rate_limited' });
  });
});
