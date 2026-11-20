import type { Bindings } from '../env';
import { adminDb } from '../lib/db.admin';
import { HR_PAGE_LIMIT, type HrDeps, hrApiBase, hrCall, hrReason, hrUrl, isObj, parsePage, realHrDeps } from '../lib/hr/hrClient';

// The HR & payroll app sync (sql/102; documentation/plans/HR_APP_INTEGRATION_PLAN.md). Runs from the 5-minute scheduled handler.
// Master-key exception approved by Ben, 20 Nov 2026 (agents.md): no person is waiting. For each company whose HR app is on and whose
// read is due (every 15 minutes, or sooner after "Sync now" or a webhook), it reads branches, departments and employees from the HR
// app's API with that company's own ERP key, and hands each page to the database functions for THAT company only (hr__apply_*,
// keyed by the company the database returned with the key). Once a day it reads everything, so records the HR app no longer lists
// are removed. Keys never leave this file and are never logged.

const MAX_COMPANIES = 20;
const MAX_PAGES = 50;

type Due = {
  org_id: string;
  full_read: boolean;
  credentials: Record<string, string> | null;
  connection_id: string | null;
  subscription_id: string | null;
};
type Counts = Record<string, number>;
type Resource = { path: 'branches' | 'departments' | 'employees'; apply: (rows: unknown[]) => Promise<Counts> };

class StopRun extends Error {
  constructor(
    message: string,
    readonly result: 'partial' | 'failed',
  ) {
    super(message);
  }
}

async function rpc<T>(env: Bindings, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb(env).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Registers our webhook with the HR app once (contract 4.7). Optional: an HR app without webhooks still syncs every 15 minutes. */
async function registerWebhook(env: Bindings, d: Due, base: URL, key: string, deps: HrDeps): Promise<string | null> {
  if (d.subscription_id || !d.connection_id) return null;
  const ours = env.API_PUBLIC_URL?.replace(/\/+$/, '');
  if (!ours || !/^https:\/\//.test(ours)) return 'no webhook: API_PUBLIC_URL is not set';
  const r = await hrCall(deps, hrUrl(base, 'webhook-subscriptions'), key, {
    method: 'POST',
    body: JSON.stringify({ url: `${ours}/webhooks/hr-app`, connection_id: d.connection_id, events: ['*'] }),
  });
  const b = isObj(r.body) ? r.body : {};
  if ((r.status === 200 || r.status === 201) && typeof b.id === 'string' && typeof b.signing_secret === 'string') {
    await rpc<void>(env, 'hr__save_subscription', { p_org: d.org_id, p_subscription_id: b.id, p_signing_secret: b.signing_secret });
    return null;
  }
  return r.status === 404 ? 'no webhook: the HR app does not offer webhooks yet' : `no webhook: ${hrReason(r)}`;
}

async function readAll(
  deps: HrDeps,
  base: URL,
  key: string,
  res: Resource,
  since: string | undefined,
): Promise<{ counts: Counts; latest: string | undefined; complete: boolean }> {
  const total: Counts = {};
  let latest = since;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await hrCall(deps, hrUrl(base, res.path, { limit: HR_PAGE_LIMIT, cursor, updated_since: cursor ? undefined : since }), key);
    if (r.status === 429) throw new StopRun(`the HR app asked us to slow down (${res.path})`, 'partial');
    if (r.status === 401 || r.status === 403) throw new StopRun(`the HR app refused the ERP key: ${hrReason(r)}`, 'failed');
    if (r.status === 410 && cursor)
      throw new StopRun(`the HR app's page marker expired (${res.path}); the next run starts again`, 'partial');
    if (r.status !== 200) throw new StopRun(`the HR app answered ${hrReason(r)} (${res.path})`, 'failed');
    const p = parsePage(r.body);
    if (!p) throw new StopRun(`the HR app's answer is not in the agreed shape (${res.path})`, 'failed');
    for (let i = 0; i < p.data.length; i += HR_PAGE_LIMIT) {
      const c = await res.apply(p.data.slice(i, i + HR_PAGE_LIMIT));
      for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + Number(v);
    }
    for (const row of p.data) {
      const u = typeof row.updated_at === 'string' ? row.updated_at : undefined;
      if (u && !Number.isNaN(Date.parse(u)) && (!latest || Date.parse(u) > Date.parse(latest)))
        latest = new Date(Date.parse(u)).toISOString();
    }
    if (!p.hasMore) return { counts: total, latest, complete: true };
    cursor = p.nextCursor ?? undefined;
  }
  return { counts: total, latest, complete: false };
}

/** One company: claim it, read, record the result. Never throws for the HR app's own failures (they are recorded). */
export async function syncCompany(env: Bindings, d: Due, deps: HrDeps = realHrDeps): Promise<'ok' | 'partial' | 'failed' | 'busy'> {
  const begun = await rpc<{ runId: string; cursors: Record<string, string> } | null>(env, 'hr__begin_sync', {
    p_org: d.org_id,
    p_full: d.full_read,
  });
  if (!begun) return 'busy';
  const run = begun.runId;
  const cursors: Record<string, string> = { ...(begun.cursors ?? {}) };
  const counts: Counts = {};
  const notes: string[] = [];
  let result: 'ok' | 'partial' | 'failed' = 'ok';
  let complete = true;
  try {
    const key = d.credentials?.api_key;
    if (!key) throw new StopRun('save the ERP key first', 'failed');
    let base: URL;
    try {
      base = hrApiBase(d.credentials?.base_url);
    } catch (e) {
      throw new StopRun(e instanceof Error ? e.message : 'the HR app address is not allowed', 'failed');
    }
    const note = await registerWebhook(env, d, base, key, deps);
    if (note) notes.push(note);
    const resources: Resource[] = [
      {
        path: 'branches',
        apply: (rows) => rpc<Counts>(env, 'hr__apply_units', { p_org: d.org_id, p_run: run, p_kind: 'branch', p_rows: rows }),
      },
      {
        path: 'departments',
        apply: (rows) => rpc<Counts>(env, 'hr__apply_units', { p_org: d.org_id, p_run: run, p_kind: 'department', p_rows: rows }),
      },
      { path: 'employees', apply: (rows) => rpc<Counts>(env, 'hr__apply_employees', { p_org: d.org_id, p_run: run, p_rows: rows }) },
    ];
    for (const res of resources) {
      const got = await readAll(deps, base, key, res, d.full_read ? undefined : cursors[res.path]);
      for (const [k, v] of Object.entries(got.counts)) counts[k] = (counts[k] ?? 0) + v;
      if (got.latest) cursors[res.path] = got.latest;
      if (!got.complete) {
        complete = false;
        result = 'partial';
        notes.push(`more ${res.path} than one run reads; the rest comes next time`);
      }
    }
  } catch (e) {
    if (e instanceof StopRun) {
      result = e.result;
      notes.push(e.message);
    } else {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      result = 'failed';
      notes.push(timeout ? 'the HR app did not answer within 10 seconds' : 'could not reach the HR app');
      if (!timeout) console.error('hr sync', e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, '[address]') : String(e));
    }
    complete = false;
  }
  await rpc<void>(env, 'hr__finish_sync', {
    p_org: d.org_id,
    p_run: run,
    p_result: result,
    p_error: notes.length ? notes.join('; ').slice(0, 300) : null,
    p_cursors: cursors,
    p_counts: counts,
    p_full_complete: d.full_read && complete && result === 'ok',
  });
  return result;
}

/** One pass of the scheduled job: every company that is due, one after the other. */
export async function runHrSyncPass(
  env: Bindings,
  deps: HrDeps = realHrDeps,
): Promise<{ companies: number; results: Record<string, number> }> {
  const due = await rpc<Due[] | null>(env, 'hr__sync_due', { p_limit: MAX_COMPANIES });
  const results: Record<string, number> = {};
  for (const d of due ?? []) {
    let r: string;
    try {
      r = await syncCompany(env, d, deps);
    } catch (e) {
      r = 'error';
      console.error('hr sync company', e instanceof Error ? e.message : String(e));
    }
    results[r] = (results[r] ?? 0) + 1;
  }
  return { companies: (due ?? []).length, results };
}
