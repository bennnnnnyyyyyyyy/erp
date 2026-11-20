import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';
import { runHrSyncPass, syncCompany } from '../src/jobs/hrSync';
import { hrApiBase, hrSignatureHex, hrUrl, verifyHrSignature } from '../src/lib/hr/hrClient';
import { processHrWebhook } from '../src/lib/hr/hrWebhook';
import { checkIntegration } from '../src/lib/integrationChecks';

// HR & payroll app link (sql/102, proved by sql/tests/099; contract documentation/plans/hr-app/CONTRACT.md). The database is faked at
// the PostgREST edge (the secret-key client calls fetch), the HR app with a fake fetch, so the whole webhook and sync paths run here.

const env = {
  APP_ENV: 'test',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
} as Bindings;
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = 'hrc_AbCdEfGhIjKlMnOpQrStUvWx';
const SECRET = 'whsec_test_5b1f0c2e9d8a4f7b';

type RpcCall = { fn: string; args: Record<string, unknown> };
/** Fakes the database: every rpc is recorded and answered by `answer`. */
function fakeDb(answer: (fn: string, args: Record<string, unknown>) => unknown): RpcCall[] {
  const calls: RpcCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const m = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const args = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : '{}')) || '{}');
    calls.push({ fn: m[1] as string, args });
    return new Response(JSON.stringify(answer(m[1] as string, args) ?? null), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const signed = async (body: string, ts: number, secret = SECRET) => ({
  connection: CONN,
  eventId: 'evt_1',
  timestamp: String(ts),
  signature: `v1=${await hrSignatureHex(secret, String(ts), body)}`,
});

describe('HR webhook signatures (contract 6.2)', () => {
  const body = '{"id":"evt_test_1","type":"ping","api_version":"1","occurred_at":"2025-11-19T08:30:00Z","data":null}';
  it('matches the worked example in the contract and node crypto', async () => {
    const hex = await hrSignatureHex(SECRET, '1763541000', body);
    expect(hex).toBe('2407aec730788a553066421dc56d64d5bbd595f26b71b142f3e74f88b45b4460');
    expect(hex).toBe(createHmac('sha256', SECRET).update(`1763541000.${body}`).digest('hex'));
  });
  it('accepts within five minutes, either way; refuses outside, a wrong secret, or a changed body', async () => {
    const sig = `v1=${await hrSignatureHex(SECRET, '1763541000', body)}`;
    expect(await verifyHrSignature(SECRET, '1763541000', sig, body, (1763541000 + 299) * 1000)).toBe(true);
    expect(await verifyHrSignature(SECRET, '1763541000', sig, body, (1763541000 - 299) * 1000)).toBe(true);
    expect(await verifyHrSignature(SECRET, '1763541000', sig, body, (1763541000 + 301) * 1000)).toBe(false);
    expect(await verifyHrSignature('whsec_other', '1763541000', sig, body, 1763541000 * 1000)).toBe(false);
    expect(await verifyHrSignature(SECRET, '1763541000', sig, `${body} `, 1763541000 * 1000)).toBe(false);
    expect(await verifyHrSignature(SECRET, 'abc', sig, body, 1763541000 * 1000)).toBe(false);
  });
  it('accepts either signature during a rotation', async () => {
    const both = `v1=${'0'.repeat(64)},v1=${await hrSignatureHex(SECRET, '1763541000', body)}`;
    expect(await verifyHrSignature(SECRET, '1763541000', both, body, 1763541000 * 1000)).toBe(true);
  });
});

describe('HR app address', () => {
  it.each(['http://hr.example.com', 'https://localhost', 'https://10.0.0.5', 'https://user:pw@hr.example.com', 'https://hr.local', 'nonsense'])(
    'refuses %s',
    (u) => expect(() => hrApiBase(u)).toThrow(),
  );
  it('keeps a path prefix and drops any query', () => {
    expect(hrUrl(hrApiBase('https://x.example.com/hr/?a=1'), 'employees', { limit: 200, cursor: undefined })).toBe(
      'https://x.example.com/hr/erp/v1/employees?limit=200',
    );
  });
});

describe('HR webhook', () => {
  const now = 1_800_000_000_000;
  const ts = now / 1000;
  const body = JSON.stringify({ id: 'evt_1', type: 'employee.updated', api_version: '1', occurred_at: '2027-01-15T08:00:00Z', data: { object: 'employee', id: 'emp_1' } });

  it('ignores a malformed connection id without touching the database', async () => {
    const calls = fakeDb(() => null);
    const r = await processHrWebhook(env, body, { ...(await signed(body, ts)), connection: "x' or 1=1" }, now);
    expect(r).toEqual({ status: 200, body: { handled: 'ignored' } });
    expect(calls).toEqual([]);
  });
  it('ignores an unknown connection (nothing revealed)', async () => {
    fakeDb(() => null);
    expect((await processHrWebhook(env, body, await signed(body, ts), now)).body.handled).toBe('ignored');
  });
  it('refuses a bad signature, an old timestamp, or a company with no secret yet, and records nothing', async () => {
    const calls = fakeDb((fn) => (fn === 'hr__accept_webhook' ? { orgId: ORG, secret: SECRET } : 'ok'));
    expect((await processHrWebhook(env, body, await signed(body, ts, 'whsec_wrong_secret'), now)).status).toBe(401);
    expect((await processHrWebhook(env, body, await signed(body, ts - 600), now)).status).toBe(401);
    fakeDb((fn) => (fn === 'hr__accept_webhook' ? { orgId: ORG, secret: null } : 'ok'));
    expect((await processHrWebhook(env, body, await signed(body, ts), now)).status).toBe(401);
    expect(calls.some((c) => c.fn === 'hr__record_webhook')).toBe(false);
  });
  it('records a verified event for the company found by our connection id, never one named in the body', async () => {
    const calls = fakeDb((fn) => (fn === 'hr__accept_webhook' ? { orgId: ORG, secret: SECRET } : 'ok'));
    const evil = JSON.stringify({ ...JSON.parse(body), org_id: '22222222-2222-4222-8222-222222222222' });
    const r = await processHrWebhook(env, evil, await signed(evil, ts), now);
    expect(r).toEqual({ status: 200, body: { handled: 'ok' } });
    expect(calls.find((c) => c.fn === 'hr__accept_webhook')?.args).toEqual({ p_connection_id: CONN });
    expect(calls.find((c) => c.fn === 'hr__record_webhook')?.args).toEqual({ p_org: ORG, p_event_id: 'evt_1', p_type: 'employee.updated' });
  });
  it('answers duplicate for a replay, ignored for an unknown type, invalid for a bad body', async () => {
    fakeDb((fn) => (fn === 'hr__accept_webhook' ? { orgId: ORG, secret: SECRET } : 'duplicate'));
    expect((await processHrWebhook(env, body, await signed(body, ts), now)).body.handled).toBe('duplicate');
    const other = JSON.stringify({ id: 'evt_1', type: 'payroll_run.approved' });
    expect((await processHrWebhook(env, other, await signed(other, ts), now)).body.handled).toBe('ignored');
    expect((await processHrWebhook(env, 'not json', await signed('not json', ts), now)).status).toBe(400);
  });
  it('the public route ignores a request without our headers', async () => {
    const r = await app.request('/webhooks/hr-app', { method: 'POST', body: '{}' }, env);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { handled: string } }).data.handled).toBe('ignored');
  });
});

// ------------------------------------------------------------------ the sync job

type HrRoute = (url: URL, init?: RequestInit) => Response;
const hrDeps = (route: HrRoute) => {
  const seen: { url: URL; auth: string | null }[] = [];
  return {
    seen,
    deps: {
      fetch: (async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        seen.push({ url, auth: new Headers(init?.headers).get('Authorization') });
        return route(url, init);
      }) as unknown as typeof fetch,
    },
  };
};
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const due = (over: Record<string, unknown> = {}) => ({
  org_id: ORG,
  full_read: true,
  credentials: { base_url: 'https://hr.example.com', api_key: 'hrk_test_key' },
  connection_id: CONN,
  subscription_id: 'sub_1',
  ...over,
});
const dbForSync = () =>
  fakeDb((fn) =>
    fn === 'hr__begin_sync'
      ? { runId: 'run-1', cursors: { employees: '2026-11-01T00:00:00.000Z' } }
      : fn.startsWith('hr__apply')
        ? { added: 1, changed: 0, removed: 0, skipped: 0 }
        : null,
  );

describe('HR sync job', () => {
  it('reads every page with the company key and hands each page to that company only', async () => {
    const calls = dbForSync();
    const { seen, deps } = hrDeps((url) => {
      if (url.pathname === '/erp/v1/branches')
        return url.searchParams.get('cursor')
          ? json({ data: [{ id: 'br_2', name: 'B', active: true, updated_at: '2026-11-18T12:00:00Z' }], next_cursor: null, has_more: false })
          : json({ data: [{ id: 'br_1', name: 'A', active: true, updated_at: '2026-11-17T12:00:00Z' }], next_cursor: 'c2', has_more: true });
      if (url.pathname === '/erp/v1/departments') return json({ data: [], next_cursor: null, has_more: false });
      return json({ data: [{ id: 'emp_1', display_name: 'X', status: 'active', updated_at: '2026-11-19T08:00:00Z' }], next_cursor: null, has_more: false });
    });
    expect(await syncCompany(env, due(), deps)).toBe('ok');
    expect(seen.every((s) => s.auth === 'Bearer hrk_test_key')).toBe(true);
    expect(seen.map((s) => s.url.pathname + s.url.search)).toEqual([
      '/erp/v1/branches?limit=200',
      '/erp/v1/branches?limit=200&cursor=c2',
      '/erp/v1/departments?limit=200',
      '/erp/v1/employees?limit=200',
    ]);
    const applies = calls.filter((c) => c.fn.startsWith('hr__apply'));
    expect(applies).toHaveLength(3);
    expect(applies.every((c) => c.args.p_org === ORG && c.args.p_run === 'run-1')).toBe(true);
    const finish = calls.find((c) => c.fn === 'hr__finish_sync')?.args;
    expect(finish).toMatchObject({ p_org: ORG, p_result: 'ok', p_full_complete: true, p_error: null });
    expect((finish?.p_cursors as Record<string, string>).employees).toBe('2026-11-19T08:00:00.000Z');
  });
  it('an incremental read asks only for changes since the saved cursor', async () => {
    dbForSync();
    const { seen, deps } = hrDeps(() => json({ data: [], next_cursor: null, has_more: false }));
    await syncCompany(env, due({ full_read: false }), deps);
    expect(seen.find((s) => s.url.pathname.endsWith('/employees'))?.url.searchParams.get('updated_since')).toBe('2026-11-01T00:00:00.000Z');
  });
  it('a refused key fails the run, keeps no partial "full" result, and never puts the key in the error', async () => {
    const calls = dbForSync();
    const { deps } = hrDeps(() => json({ error: { code: 'invalid_token', message: 'bad key hrk_test_key' } }, 401));
    expect(await syncCompany(env, due(), deps)).toBe('failed');
    const finish = calls.find((c) => c.fn === 'hr__finish_sync')?.args;
    expect(finish).toMatchObject({ p_result: 'failed', p_full_complete: false });
    expect(String(finish?.p_error)).not.toContain('hrk_test_key');
  });
  it('slows down on 429 (partial, no full-read removal)', async () => {
    const calls = dbForSync();
    const { deps } = hrDeps(() => json({ error: { code: 'rate_limited' } }, 429, { 'Retry-After': '30' }));
    expect(await syncCompany(env, due(), deps)).toBe('partial');
    expect(calls.find((c) => c.fn === 'hr__finish_sync')?.args.p_full_complete).toBe(false);
  });
  it('refuses a local address before calling anything', async () => {
    const calls = dbForSync();
    const { seen, deps } = hrDeps(() => json({}));
    expect(await syncCompany(env, due({ credentials: { base_url: 'https://127.0.0.1', api_key: 'k' } }), deps)).toBe('failed');
    expect(seen).toEqual([]);
    expect(calls.find((c) => c.fn === 'hr__finish_sync')?.args.p_result).toBe('failed');
  });
  it('registers our webhook once when the public address is known, and keeps the signing secret through the database', async () => {
    const calls = dbForSync();
    const { seen, deps } = hrDeps((url, init) =>
      url.pathname.endsWith('/webhook-subscriptions')
        ? json({ id: 'sub_9', signing_secret: 'whsec_new_secret_123456', events: ['*'], created_at: '2026-11-20T10:00:00Z' }, 201)
        : init?.method === 'POST'
          ? json({}, 500)
          : json({ data: [], next_cursor: null, has_more: false }),
    );
    await syncCompany({ ...env, API_PUBLIC_URL: 'https://api.erp.test/' }, due({ subscription_id: null }), deps);
    const post = seen.find((s) => s.url.pathname.endsWith('/webhook-subscriptions'));
    expect(post).toBeDefined();
    expect(calls.find((c) => c.fn === 'hr__save_subscription')?.args).toEqual({
      p_org: ORG,
      p_subscription_id: 'sub_9',
      p_signing_secret: 'whsec_new_secret_123456',
    });
  });
  it('skips a company another run holds', async () => {
    fakeDb(() => null);
    const { seen, deps } = hrDeps(() => json({}));
    expect(await syncCompany(env, due(), deps)).toBe('busy');
    expect(seen).toEqual([]);
  });
  it('one pass works through the due companies', async () => {
    fakeDb((fn) => (fn === 'hr__sync_due' ? [due(), due({ org_id: '22222222-2222-4222-8222-222222222222' })] : fn === 'hr__begin_sync' ? null : null));
    expect(await runHrSyncPass(env, hrDeps(() => json({})).deps)).toEqual({ companies: 2, results: { busy: 2 } });
  });
});

describe('HR app check connection', () => {
  const who = { orgId: ORG, email: 'o@test.invalid', apiBase: 'https://api.erp.test' };
  it('pings with the saved key and names the HR company', async () => {
    fakeDb((fn) => (fn === 'core__provider_credentials' ? { base_url: 'https://hr.example.com', api_key: 'hrk_k' } : null));
    const { seen, deps } = hrDeps(() => json({ app: 'hr-app', api_version: '1', tenant: { id: 't', name: 'Example Trading Co.' }, scopes: [], server_time: new Date().toISOString() }));
    const r = await checkIntegration(env, 'hr_app', who, deps);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Example Trading Co.');
    expect(seen[0]?.url.toString()).toBe('https://hr.example.com/erp/v1/ping');
  });
  it('says so when the key is refused, without the key', async () => {
    fakeDb(() => ({ base_url: 'https://hr.example.com', api_key: 'hrk_secret_value' }));
    const r = await checkIntegration(env, 'hr_app', who, hrDeps(() => json({ error: { code: 'invalid_token', message: 'hrk_secret_value is revoked' } }, 401)).deps);
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain('hrk_secret_value');
  });
  it('warns when the HR app clock is off (its webhooks would be refused)', async () => {
    fakeDb(() => ({ base_url: 'https://hr.example.com', api_key: 'k' }));
    const r = await checkIntegration(env, 'hr_app', who, hrDeps(() => json({ tenant: { name: 'X' }, server_time: new Date(Date.now() - 10 * 60_000).toISOString() })).deps);
    expect(r.message).toContain('clock');
  });
});

describe('People routes', () => {
  it.each([
    ['GET', '/v1/hr/employees'],
    ['GET', '/v1/hr/units'],
    ['GET', '/v1/hr/status'],
    ['POST', '/v1/hr/sync'],
    ['PUT', '/v1/hr/employees/11111111-1111-4111-8111-111111111111/link'],
    ['DELETE', '/v1/hr/employees/11111111-1111-4111-8111-111111111111/link'],
    ['PUT', '/v1/hr/units/11111111-1111-4111-8111-111111111111/branch'],
  ])('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings)).status).toBe(401);
  });
});
