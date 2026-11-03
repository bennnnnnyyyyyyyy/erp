import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { fail } from '../lib/response';

// System audit 2026-11-03, finding 4: a request limit in front of the API (Cloudflare Workers rate limiting binding, wrangler.toml
// [[ratelimits]]). Counted per signed-in user when known, else per caller IP, so one office behind one IP is not one bucket for
// signed-in traffic. Without the binding (tests, local dev) nothing is limited. The limit is far above normal use: a page makes
// about six requests.

export function rateLimit(scope: 'api' | 'webhook') {
  return async (c: Context<AppEnv>, next: Next) => {
    const limiter = c.env.API_LIMITER;
    if (!limiter) return next();
    const who = (c.get('user') as { id?: string } | undefined)?.id ?? c.req.header('cf-connecting-ip') ?? 'unknown';
    const { success } = await limiter.limit({ key: `${scope}:${who}` });
    if (!success) return fail(c, 429, 'Too many requests. Wait a minute and try again.', 'rate_limited');
    return next();
  };
}
