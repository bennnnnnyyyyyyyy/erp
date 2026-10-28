import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../env';
import { HttpError, NotConfiguredError } from '../lib/errors';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(jwksUrl: string) {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/** Verifies the Supabase Auth access token in `Authorization: Bearer <jwt>` and sets `c.var.user`. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Sign in required', 'unauthenticated');

  const supabaseUrl = c.env.SUPABASE_URL;
  if (!supabaseUrl) throw new NotConfiguredError('Supabase');

  try {
    const jwksUrl = c.env.SUPABASE_JWKS_URL || new URL('/auth/v1/.well-known/jwks.json', supabaseUrl).toString();
    const { payload } = await jwtVerify(token, jwksFor(jwksUrl), {
      issuer: new URL('/auth/v1', supabaseUrl).toString(),
      audience: 'authenticated',
    });
    if (!payload.sub) throw new Error('token has no subject');
    c.set('user', { id: payload.sub, email: String(payload.email ?? '') });
  } catch {
    throw new HttpError(401, 'Your session has expired. Sign in again.', 'invalid_token');
  }
  await next();
});
