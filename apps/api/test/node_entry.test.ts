import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindingsFromEnv, memoryLimiter, start } from '../src/node';

// On-prem step 1: the API served by Node's own HTTP server (src/node.ts) answers like the Worker.

describe('on-prem Node entry point', () => {
  let stop: () => void;
  const port = 18_787;
  beforeAll(() => {
    ({ stop } = start({ PORT: String(port), CRON_DISABLED: '1', ALLOWED_ORIGINS: 'http://localhost:5173' } as NodeJS.ProcessEnv));
  });
  afterAll(() => stop());

  it('answers the health check over real HTTP', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('refuses a signed-out /v1 call, as the Worker does', async () => {
    const res = await fetch(`http://localhost:${port}/v1/core/session`);
    expect(res.status).toBe(401);
  });

  it('reads settings from the environment and adds the limiters', () => {
    const b = bindingsFromEnv({
      SUPABASE_URL: 'http://db.local',
      ALLOWED_ORIGINS: 'https://erp.example',
      lowercase: 'x',
    } as NodeJS.ProcessEnv);
    expect(b.SUPABASE_URL).toBe('http://db.local');
    expect(b.ALLOWED_ORIGINS).toBe('https://erp.example');
    expect(b.APP_ENV).toBe('onprem');
    expect(typeof b.API_LIMITER?.limit).toBe('function');
    expect((b as Record<string, unknown>).lowercase).toBeUndefined();
  });

  it('limits per key and window like the Worker binding', async () => {
    const l = memoryLimiter(2, 60_000);
    expect((await l.limit({ key: 'a' })).success).toBe(true);
    expect((await l.limit({ key: 'a' })).success).toBe(true);
    expect((await l.limit({ key: 'a' })).success).toBe(false);
    expect((await l.limit({ key: 'b' })).success).toBe(true);
  });
});
