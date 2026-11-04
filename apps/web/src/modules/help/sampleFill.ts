import {
  SAMPLE_APPROVAL,
  SAMPLE_COMPANY,
  SAMPLE_CONDITIONS,
  SAMPLE_CUSTOMERS,
  SAMPLE_ITEMS,
  SAMPLE_SUPPLIERS,
  SAMPLE_WAREHOUSES,
  type SampleCondition,
  type SampleItem,
  type SampleParty,
  type SampleWarehouse,
} from './sampleCompany';

// Saving the setup wizard's tables (ONBOARDING_WIZARD_PLAN.md, Part B). The wizard's "Fill with sample data" only puts the sample rows
// into the tables on screen; Save then calls these with whatever rows are there (sample or typed), so both are saved the same way.
// Every write goes through an existing API route (the same audited database function as the normal screens). Each save first reads what
// already exists and skips it, so saving twice never duplicates; one row at a time, with progress; a failing row is reported and the rest
// continue. `api` is passed in so this file is tested without a network (onboardingSample.test.ts).

export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export type Report = { added: number; skipped: number; failed: string[] };
export type OnProgress = (done: number, total: number) => void;

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const errText = (label: string, e: unknown) => `${label}: ${(e as Error)?.message ?? String(e)}`;
const empty = (): Report => ({ added: 0, skipped: 0, failed: [] });
const low = (s: string) => s.trim().toLowerCase();

/** Who may see the fill buttons: the accounts named in the build setting DEMO_AUTOFILL_EMAILS (comma-separated). Empty = nobody. */
export function canFillSample(email: string | null | undefined, setting: string | undefined): boolean {
  if (!email || !setting) return false;
  const allowed = setting
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/** Currency, time zone and date format. The company name is never part of the sample: the presenter typed it at sign-up. */
export async function saveCompany(
  api: Api,
  org: { defaultCurrency: string; timezone: string; dateFormat: string },
  want: { defaultCurrency: string; timezone: string; dateFormat: string } = SAMPLE_COMPANY,
): Promise<Report> {
  const changes: Record<string, string> = {};
  if (org.defaultCurrency !== want.defaultCurrency) changes.defaultCurrency = want.defaultCurrency;
  if (org.timezone !== want.timezone) changes.timezone = want.timezone;
  if (org.dateFormat !== want.dateFormat) changes.dateFormat = want.dateFormat;
  if (Object.keys(changes).length === 0) return { added: 0, skipped: 1, failed: [] };
  try {
    await api('/v1/core/org', { method: 'PATCH', body: JSON.stringify(changes) });
    return { added: 1, skipped: 0, failed: [] };
  } catch (e) {
    return { added: 0, skipped: 0, failed: [errText('Company', e)] };
  }
}

/** How many rows are saved at the same time (efficiency audit 2026-11-04, F3). Each row is still its own audited call; the database
 * serialises the audit chain per company (advisory lock, sql/003), so this only removes waiting, never a check. */
export const PARALLEL = 4;

/** Runs `work` for every row, at most `limit` at once, counting progress up as rows finish. */
export async function inPool<T>(rows: T[], limit: number, work: (row: T) => Promise<void>, onProgress?: OnProgress): Promise<void> {
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < rows.length) {
      const row = rows[next++] as T;
      await work(row);
      done++;
      onProgress?.(done, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, lane));
}

/**
 * Saves rows that are matched by a key (name or code): a row whose key already exists, or appears earlier in the same table, is skipped.
 * The key is claimed before the save starts, so two identical rows saved at the same time cannot both be created.
 */
async function saveKeyed<T>(rows: T[], have: Set<string>, keyOf: (r: T) => string, save: (r: T, key: string) => Promise<void>, onProgress?: OnProgress): Promise<Report> {
  const report = empty();
  await inPool(
    rows,
    PARALLEL,
    async (r) => {
      const key = keyOf(r);
      if (have.has(key)) {
        report.skipped++;
        return;
      }
      have.add(key);
      try {
        await save(r, key);
        report.added++;
      } catch (e) {
        have.delete(key);
        report.failed.push(errText(key, e));
      }
    },
    onProgress,
  );
  return report;
}

/** Storage conditions (matched by name). */
export async function saveConditions(api: Api, rows: SampleCondition[] = SAMPLE_CONDITIONS, onProgress?: OnProgress): Promise<Report> {
  const existing = await api<{ name: string }[]>('/v1/inventory/storage-conditions');
  return saveKeyed(
    rows,
    new Set(existing.map((x) => low(x.name))),
    (c) => low(c.name),
    async (c) => {
      await api('/v1/inventory/storage-conditions', post({ name: c.name.trim(), minTempC: c.minTempC, maxTempC: c.maxTempC }));
    },
    onProgress,
  );
}

async function conditionIds(api: Api): Promise<Map<string, string>> {
  const list = await api<{ id: string; name: string }[]>('/v1/inventory/storage-conditions');
  return new Map(list.map((x) => [low(x.name), x.id]));
}

/** Warehouses (matched by code), each with its storage condition when one is named and exists. */
export async function saveWarehouses(api: Api, rows: SampleWarehouse[] = SAMPLE_WAREHOUSES, onProgress?: OnProgress): Promise<Report> {
  const [existing, conds] = await Promise.all([api<{ code: string }[]>('/v1/inventory/warehouses'), conditionIds(api)]);
  return saveKeyed(
    rows,
    new Set(existing.map((x) => x.code.toUpperCase())),
    (w) => w.code.trim().toUpperCase(),
    async (w, code) => {
      const made = await api<{ id: string }>('/v1/inventory/warehouses', post({ code, name: w.name.trim(), nameAr: w.nameAr.trim() }));
      const cond = w.condition ? conds.get(low(w.condition)) : undefined;
      if (cond) await api(`/v1/inventory/warehouses/${made.id}/storage`, post({ conditionId: cond }));
    },
    onProgress,
  );
}

/** Items (matched by code) with opening stock in their warehouse, their average cost, and their storage condition. */
export async function saveItems(api: Api, rows: SampleItem[] = SAMPLE_ITEMS, onProgress?: OnProgress): Promise<Report> {
  const [existing, whList, conds] = await Promise.all([
    api<{ sku: string }[]>('/v1/inventory/items'),
    api<{ id: string; code: string }[]>('/v1/inventory/warehouses'),
    conditionIds(api),
  ]);
  const whs = new Map(whList.map((w) => [w.code.toUpperCase(), w.id]));
  return saveKeyed(
    rows,
    new Set(existing.map((x) => x.sku.toUpperCase())),
    (it) => it.sku.trim().toUpperCase(),
    async (it, sku) => {
      const warehouseId = whs.get(it.warehouse.trim().toUpperCase()) ?? null;
      // The cost travels with the create request (efficiency audit F4): one request per item instead of two.
      const made = await api<{ id: string }>(
        '/v1/inventory/items',
        post({
          sku,
          name: it.name.trim(),
          nameAr: it.nameAr.trim(),
          uom: it.uom.trim() || 'piece',
          openingQty: warehouseId ? it.openingQty : 0,
          warehouseId,
          unitCostMinor: it.costMinor > 0 ? it.costMinor : undefined,
        }),
      );
      const cond = it.condition ? conds.get(low(it.condition)) : undefined;
      if (cond) await api(`/v1/inventory/items/${made.id}/batching`, post({ tracks: false, conditionId: cond }));
    },
    onProgress,
  );
}

/** Suppliers or customers (matched by name). */
export async function saveParties(api: Api, path: '/v1/purchasing/suppliers' | '/v1/sales/customers', rows: SampleParty[], onProgress?: OnProgress): Promise<Report> {
  const existing = await api<{ name: string }[]>(path);
  return saveKeyed(
    rows,
    new Set(existing.map((x) => low(x.name))),
    (p) => low(p.name),
    async (p) => {
      await api(path, post({ name: p.name.trim(), contact: p.contact.trim(), city: p.city.trim() }));
    },
    onProgress,
  );
}

/** One company-wide approval rule (skipped if the same rule exists). */
export async function saveApproval(api: Api, rule: { minTotalQty: number; requiredApprovals: number } = SAMPLE_APPROVAL): Promise<Report> {
  const existing = await api<{ warehouseId: string | null; minTotalQty: number; requiredApprovals: number }[]>('/v1/inventory/approval-policies');
  if (existing.some((p) => p.warehouseId === null && p.minTotalQty === rule.minTotalQty && p.requiredApprovals === rule.requiredApprovals)) {
    return { added: 0, skipped: 1, failed: [] };
  }
  try {
    await api('/v1/inventory/approval-policies', post({ ...rule, warehouseId: null }));
    return { added: 1, skipped: 0, failed: [] };
  } catch (e) {
    return { added: 0, skipped: 0, failed: [errText('Approval rule', e)] };
  }
}

export type FillStage = 'company' | 'storage' | 'warehouses' | 'items' | 'suppliers' | 'customers' | 'approval';
export const FILL_STAGES: FillStage[] = ['company', 'storage', 'warehouses', 'items', 'suppliers', 'customers', 'approval'];

/** The whole sample company in one go (everything except language and team), in order, reporting each stage. */
export async function fillEverything(
  api: Api,
  org: { defaultCurrency: string; timezone: string; dateFormat: string },
  onStage: (stage: FillStage, done: number, total: number) => void,
): Promise<Record<FillStage, Report>> {
  const out = {} as Record<FillStage, Report>;
  onStage('company', 0, 1);
  out.company = await saveCompany(api, org);
  out.storage = await saveConditions(api, SAMPLE_CONDITIONS, (d, t) => onStage('storage', d, t));
  out.warehouses = await saveWarehouses(api, SAMPLE_WAREHOUSES, (d, t) => onStage('warehouses', d, t));
  out.items = await saveItems(api, SAMPLE_ITEMS, (d, t) => onStage('items', d, t));
  out.suppliers = await saveParties(api, '/v1/purchasing/suppliers', SAMPLE_SUPPLIERS, (d, t) => onStage('suppliers', d, t));
  out.customers = await saveParties(api, '/v1/sales/customers', SAMPLE_CUSTOMERS, (d, t) => onStage('customers', d, t));
  onStage('approval', 0, 1);
  out.approval = await saveApproval(api);
  return out;
}
