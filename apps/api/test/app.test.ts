import { describe, expect, it } from 'vitest';
import app from '../src/index';

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };

describe('api', () => {
  it('answers /health', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { status: 'ok', env: 'test' } });
  });

  it('rejects /v1 without a token', async () => {
    const res = await app.request('/v1/core/session', {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  it('returns 503 when Supabase is not configured', async () => {
    const res = await app.request('/v1/core/session', { headers: { Authorization: 'Bearer x' } }, env);
    expect(res.status).toBe(503);
  });

  it('uses the standard shape for unknown routes', async () => {
    const res = await app.request('/nope', {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, status: 404 });
  });
});
