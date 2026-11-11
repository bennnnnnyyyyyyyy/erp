import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { fail } from '../lib/response';

// System audit 2026-11-03, finding 4: a request limit in front of the API (Cloudflare Workers rate limiting binding, wrangler.toml
// [[ratelimits]]). Scopes:
//  - 'ip': counted per caller IP only, placed BEFORE requireAuth so requests with no or a bad token are counted too (audit 11 Nov
//    2026, finding 3). One office shares an IP, so this layer relies on the same generous limit as the others.
//  - 'api': counted per signed-in user when known (else per IP), after sign-in, so one office behind one IP is not one bucket.
//  - 'webhook': per IP.
// Without the binding (tests, local dev) nothing is limited. The limit is far above normal use: a page makes about six requests.

export function rateLimit(scope: 'api' | 'webhook' | 'ip') {
  return async (c: Context<AppEnv>, next: Next) => {
    const limiter = scope === 'ip' ? c.env.IP_LIMITER : c.env.API_LIMITER;
    if (!limiter) return next();
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const who = scope === 'ip' ? ip : ((c.get('user') as { id?: string } | undefined)?.id ?? ip);
    const { success } = await limiter.limit({ key: `${scope}:${who}` });
    if (!success) return fail(c, 429, 'Too many requests. Wait a minute and try again.', 'rate_limited');
    return next();
  };
}
