// The HR & payroll app's API, as our contract defines it (documentation/plans/hr-app/CONTRACT.md, v1). Pure HTTP and crypto: no
// database here. The sync job (jobs/hrSync.ts), the webhook (lib/hr/hrWebhook.ts) and "Check connection" (lib/integrationChecks.ts)
// use it. Keys are sent only in the Authorization header and never logged or returned.

export type HrDeps = { fetch: typeof fetch };
export const realHrDeps: HrDeps = { fetch: (...a) => fetch(...a) };

export const HR_TIMEOUT_MS = 10_000;
export const HR_PAGE_LIMIT = 200;
const enc = new TextEncoder();

type Obj = Record<string, unknown>;
export const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The saved HR app address, checked again before every call: public https host names only (no localhost, IP numbers or local names). */
export function hrApiBase(raw: string | undefined): URL {
  let u: URL;
  try {
    u = new URL(raw ?? '');
  } catch {
    throw new Error('The HR app address is not a valid web address');
  }
  const host = u.hostname.toLowerCase();
  const ipLike = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  if (u.protocol !== 'https:' || u.username || u.password || host === 'localhost' || ipLike || !host.includes('.') || /\.(local|internal|localhost|lan)$/.test(host)) {
    throw new Error('The HR app address must be a public https host name (not localhost or an IP number)');
  }
  u.search = '';
  u.hash = '';
  return u;
}

/** `{base}/erp/v1/{path}` with the query, keeping any path prefix of the base (for example https://x.example/hr). */
export function hrUrl(base: URL, path: string, query: Record<string, string | number | undefined> = {}): string {
  const u = new URL(base.toString());
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/erp/v1/${path.replace(/^\/+/, '')}`;
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

export type HrResponse = { status: number; body: unknown; retryAfter: number | null };

export async function hrCall(deps: HrDeps, url: string, key: string, init: RequestInit = {}): Promise<HrResponse> {
  const res = await deps.fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(HR_TIMEOUT_MS),
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'ERP-HR-Connector/1',
      'X-Request-Id': crypto.randomUUID(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const ra = Number(res.headers.get('Retry-After'));
  return { status: res.status, body, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
}

/** The HR app's short reason from its error shape ({error: {code, message}}), without anything that looks like a key. */
export function hrReason(r: HrResponse): string {
  const e = isObj(r.body) && isObj(r.body.error) ? r.body.error : {};
  const raw = [e.code, e.message].filter((x) => typeof x === 'string' && x).join(': ');
  const clean = raw.replace(/\b(hrk|hrat|hrrt|whsec)_[A-Za-z0-9_-]+/g, '[key]').replace(/https?:\/\/\S+/g, '[address]').replace(/\s+/g, ' ').trim();
  return `HTTP ${r.status}${clean ? `: ${clean.slice(0, 160)}` : ''}`;
}

export type HrPage = { data: Obj[]; nextCursor: string | null; hasMore: boolean };

/** One page of a list, or null when the answer is not the contract's shape. */
export function parsePage(body: unknown): HrPage | null {
  if (!isObj(body) || !Array.isArray(body.data)) return null;
  const nextCursor = typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null;
  return { data: body.data.filter(isObj), nextCursor, hasMore: body.has_more === true && nextCursor !== null };
}

// ------------------------------------------------------------------ webhook signatures (contract section 6.2)

export const HR_SIGNATURE_TOLERANCE_S = 300;

export async function hrSignatureHex(secret: string, timestamp: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${raw}`)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * True when `X-HR-Signature` (one or more `v1=<hex>`, comma separated, during a rotation) matches the body signed with the secret,
 * and `X-HR-Timestamp` is within five minutes of now (either way).
 */
export async function verifyHrSignature(secret: string, timestamp: string, header: string, raw: string, nowMs: number = Date.now()): Promise<boolean> {
  if (!secret || !/^\d{9,11}$/.test(timestamp) || !header) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > HR_SIGNATURE_TOLERANCE_S) return false;
  const expected = await hrSignatureHex(secret, timestamp, raw);
  const given = header
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3).toLowerCase());
  return given.slice(0, 5).some((g) => /^[0-9a-f]{64}$/.test(g) && sameText(g, expected));
}
