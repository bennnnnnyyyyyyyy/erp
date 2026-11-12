import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

// Audit 11 Nov 2026, finding 14. The sign-in check (middleware/auth.ts) with real signed tokens: malformed, expired, wrong issuer,
// wrong audience, wrong key, no subject. Then, with a valid token and a stubbed database answer, one "no permission" (403) and one
// "module off" (403) per route group, and the per-IP limiter before sign-in. No network: fetch is stubbed.

const SUPABASE_URL = 'https://proj.supabase.test';
const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const ORG = '22222222-2222-4222-8222-222222222222';
const ID = '11111111-1111-4111-8111-111111111111';

const baseEnv = {
  APP_ENV: 'test',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: 'pk-test',
  SUPABASE_JWKS_URL: JWKS_URL,
};

let privateKey: CryptoKey;
let otherKey: CryptoKey;

// What the stubbed database says about the caller (memberships and org_modules reads in middleware/tenant.ts).
let role: 'owner' | 'viewer' = 'viewer';
let modulesOn: string[] = [];

function stubFetch(keys: Record<string, unknown>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === JWKS_URL) return json({ keys });
      if (url.includes('/rest/v1/memberships')) {
        const row = {
          role,
          organizations: {
            id: ORG,
            name: 'Test Co',
            slug: 'test-co',
            default_currency: 'EGP',
            timezone: 'Africa/Cairo',
            settings: {},
            deleted_at: null,
          },
        };
        const accept = new Headers(init?.headers).get('Accept') ?? '';
        return json(accept.includes('object+json') ? row : [row]);
      }
      if (url.includes('/rest/v1/org_modules')) return json(modulesOn.map((module_key) => ({ module_key })));
      return new Response('unexpected request in test', { status: 500 });
    }),
  );
}

async function token(opts: { key?: CryptoKey; issuer?: string; audience?: string; expiresIn?: string | number; sub?: string | null } = {}) {
  const jwt = new SignJWT({ email: 'a@b.test' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? 'authenticated')
    .setExpirationTime(opts.expiresIn ?? '1h');
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? 'user-1');
  return jwt.sign(opts.key ?? privateKey);
}

const get = (path: string, jwt: string, env: Record<string, unknown> = baseEnv, extra: Record<string, string> = {}) =>
  app.request(path, { headers: { Authorization: `Bearer ${jwt}`, ...extra } }, env);

let jwkPublic: Record<string, unknown>;
const publicJwk = () => jwkPublic;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  jwkPublic = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
});
afterEach(() => vi.unstubAllGlobals());

describe('sign-in token checks', () => {
  it('rejects a malformed token, one that is not a JWT at all', async () => {
    stubFetch([publicJwk()]);
    for (const bad of ['x', 'a.b.c', 'not.a.jwt.at.all']) {
      const res = await get('/v1/core/session', bad);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ success: false, code: 'invalid_token' });
    }
  });

  it('rejects an expired token', async () => {
    stubFetch([publicJwk()]);
    const res = await get('/v1/core/session', await token({ expiresIn: Math.floor(Date.now() / 1000) - 60 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'invalid_token' });
  });

  it('rejects a token from the wrong issuer', async () => {
    stubFetch([publicJwk()]);
    const res = await get('/v1/core/session', await token({ issuer: 'https://evil.test/auth/v1' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'invalid_token' });
  });

  it('rejects the wrong audience, a token signed with another key, and a token without a subject', async () => {
    stubFetch([publicJwk()]);
    for (const jwt of [await token({ audience: 'anon' }), await token({ key: otherKey }), await token({ sub: null })]) {
      const res = await get('/v1/core/session', jwt);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'invalid_token' });
    }
  });

  it('accepts a good token (the next check, the organization header, is what answers)', async () => {
    stubFetch([publicJwk()]);
    const res = await get('/v1/core/session', await token());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'org_required' });
  });
});

// One representative route per group, each behind a permission a viewer lacks (viewers hold only the ".read" keys).
const GROUPS: [string, string, string][] = [
  ['core', 'PATCH', '/v1/core/org'],
  ['inventory', 'POST', '/v1/inventory/items'],
  ['tasks', 'POST', '/v1/tasks'],
  ['messaging', 'POST', '/v1/messaging/process'],
  ['purchasing', 'PUT', `/v1/purchasing/suppliers/${ID}`],
  ['sales', 'PUT', `/v1/sales/customers/${ID}`],
  ['finance', 'POST', '/v1/finance/expenses'],
  ['alerts', 'POST', '/v1/alerts/teams'],
  ['einvoicing', 'PUT', '/v1/einvoicing/profile'],
  ['accounting', 'POST', '/v1/accounting/journals'],
  ['treasury', 'POST', '/v1/treasury/accounts'],
];

const call = async (method: string, path: string) => {
  const jwt = await token();
  return app.request(
    path,
    {
      method,
      headers: { Authorization: `Bearer ${jwt}`, 'X-Org-Id': ORG, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    },
    baseEnv,
  );
};

describe('permission and module gates, one route per group', () => {
  it.each(GROUPS)('%s: a viewer is refused with 403 forbidden', async (key, method, path) => {
    role = 'viewer';
    modulesOn = GROUPS.map(([k]) => k);
    stubFetch([publicJwk()]);
    const res = await call(method, path);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
    expect(key).toBeTruthy();
  });

  it.each(GROUPS.filter(([k]) => k !== 'core'))(
    '%s: a module that is switched off is refused with 403 module_disabled',
    async (_key, method, path) => {
      role = 'owner';
      modulesOn = [];
      stubFetch([publicJwk()]);
      const res = await call(method, path);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'module_disabled' });
    },
  );
});

describe('per-IP limiter before sign-in', () => {
  it('counts requests with a bad token from one IP and answers 429 once over the limit', async () => {
    const seen: string[] = [];
    let n = 0;
    const env = {
      ...baseEnv,
      IP_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          seen.push(key);
          return { success: ++n <= 3 };
        },
      },
    };
    stubFetch([publicJwk()]);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.request(
        '/v1/core/session',
        { headers: { Authorization: 'Bearer garbage', 'cf-connecting-ip': '203.0.113.9' } },
        env,
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    expect(new Set(seen)).toEqual(new Set(['ip:203.0.113.9']));
  });

  it('counts requests with no token at all', async () => {
    const env = { ...baseEnv, IP_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await app.request('/v1/core/session', { headers: { 'cf-connecting-ip': '203.0.113.9' } }, env);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'rate_limited' });
  });
});

// Every write route, not one per group: a viewer (".read" keys only) must be refused before any data is touched. Routes a viewer
// may use on purpose are listed in VIEWER_MAY with the reason; a new write route fails this test until it checks a permission.
const VIEWER_MAY: Record<string, string> = {
  'POST /v1/core/me/language': 'changes only the caller’s own language',
  'POST /v1/core/ai/assistant': 'answers questions with the caller’s own read access; changes nothing',
  'POST /v1/core/ai/transcribe': 'turns the caller’s voice note into text; changes nothing',
  'POST /v1/messaging/notifications/read': 'marks the caller’s own notifications read',
  'POST /v1/messaging/telegram/link': 'links the caller’s own Telegram',
  'POST /v1/messaging/identities': 'adds the caller’s own WhatsApp number',
  'POST /v1/messaging/identities/:id/confirm': 'confirms the caller’s own number with its code',
  'POST /v1/messaging/identities/:id/revoke': 'removes the caller’s own number',
};
const MODULE_KEYS = GROUPS.map(([k]) => k);
const writeRoutes = [
  ...new Set(
    app.routes
      .filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && MODULE_KEYS.includes(r.path.split('/')[2] ?? ''))
      .map((r) => `${r.method} ${r.path}`),
  ),
].filter((r) => !(r in VIEWER_MAY));

describe('permission gate on every write route', () => {
  it('finds the write routes', () => expect(writeRoutes.length).toBeGreaterThan(50));
  it.each(writeRoutes)('%s: a viewer is refused', async (route) => {
    const [method = '', path = ''] = route.split(' ');
    role = 'viewer';
    modulesOn = MODULE_KEYS;
    stubFetch([publicJwk()]);
    const res = await call(method, path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, ID));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
  });
});
