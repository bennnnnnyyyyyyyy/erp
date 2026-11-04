import {
  SAMPLE_APPROVAL,
  SAMPLE_COMPANY,
  SAMPLE_CONDITIONS,
  SAMPLE_CUSTOMERS,
  SAMPLE_ITEMS,
  SAMPLE_SUPPLIERS,
  SAMPLE_WAREHOUSES,
  type SampleCondition,
  type SampleParty,
} from './sampleCompany';

// "Fill with sample data" for the setup wizard (ONBOARDING_WIZARD_PLAN.md, Part B). Every write goes through an existing API route,
// so it is the same audited database function as a person using the screens. Each fill first reads what already exists and skips it,
// so pressing a button twice (or after a partial failure) never duplicates anything. One row at a time, with progress; a failing row is
// reported and the rest continue. `api` is passed in so this file is tested without a network (onboardingSample.test.ts).

export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export type Report = { added: number; skipped: number; failed: string[] };
export type OnProgress = (done: number, total: number) => void;

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
const errText = (label: string, e: unknown) => `${label}: ${(e as Error)?.message ?? String(e)}`;
const empty = (): Report => ({ added: 0, skipped: 0, failed: [] });

/** Who may see the fill buttons: the accounts named in the build setting DEMO_AUTOFILL_EMAILS (comma-separated). Empty = nobody. */
export function canFillSample(email: string | null | undefined, setting: string | undefined): boolean {
  if (!email || !setting) return false;
  const allowed = setting
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/** Currency, time zone and date format only. The company name is never touched: the presenter typed it at sign-up. */
export async function fillCompany(api: Api, org: { defaultCurrency: string; timezone: string; dateFormat: string }): Promise<Report> {
  const changes: Record<string, string> = {};
  if (org.defaultCurrency !== SAMPLE_COMPANY.defaultCurrency) changes.defaultCurrency = SAMPLE_COMPANY.defaultCurrency;
  if (org.timezone !== SAMPLE_COMPANY.timezone) changes.timezone = SAMPLE_COMPANY.timezone;
  if (org.dateFormat !== SAMPLE_COMPANY.dateFormat) changes.dateFormat = SAMPLE_COMPANY.dateFormat;
  if (Object.keys(changes).length === 0) return { added: 0, skipped: 1, failed: [] };
  try {
    await api('/v1/core/org', { method: 'PATCH', body: JSON.stringify(changes) });
    return { added: 1, skipped: 0, failed: [] };
  } catch (e) {
    return { added: 0, skipped: 0, failed: [errText('Company', e)] };
  }
}

/** Storage conditions; returns their ids by key (existing ones matched by name). */
export async function fillStorage(api: Api, onProgress?: OnProgress): Promise<{ report: Report; ids: Partial<Record<SampleCondition['key'], string>> }> {
  const report = empty();
  const ids: Partial<Record<SampleCondition['key'], string>> = {};
  const existing = await api<{ id: string; name: string }[]>('/v1/inventory/storage-conditions');
  for (const [i, c] of SAMPLE_CONDITIONS.entries()) {
    const found = existing.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
    if (found) {
      ids[c.key] = found.id;
      report.skipped++;
    } else {
      try {
        const made = await api<{ id: string }>('/v1/inventory/storage-conditions', post({ name: c.name, minTempC: c.minTempC, maxTempC: c.maxTempC }));
        ids[c.key] = made.id;
        report.added++;
      } catch (e) {
        report.failed.push(errText(c.name, e));
      }
    }
    onProgress?.(i + 1, SAMPLE_CONDITIONS.length);
  }
  return { report, ids };
}

/** Warehouses with their storage condition; returns ids by code (existing ones matched by code). */
export async function fillWarehouses(
  api: Api,
  conditions: Partial<Record<SampleCondition['key'], string>>,
  onProgress?: OnProgress,
): Promise<{ report: Report; ids: Record<string, string> }> {
  const report = empty();
  const ids: Record<string, string> = {};
  const existing = await api<{ id: string; code: string }[]>('/v1/inventory/warehouses');
  for (const [i, w] of SAMPLE_WAREHOUSES.entries()) {
    const found = existing.find((x) => x.code.toUpperCase() === w.code);
    if (found) {
      ids[w.code] = found.id;
      report.skipped++;
    } else {
      try {
        const made = await api<{ id: string }>('/v1/inventory/warehouses', post({ code: w.code, name: w.name, nameAr: w.nameAr }));
        ids[w.code] = made.id;
        const cond = conditions[w.condition];
        if (cond) await api(`/v1/inventory/warehouses/${made.id}/storage`, post({ conditionId: cond }));
        report.added++;
      } catch (e) {
        report.failed.push(errText(w.code, e));
      }
    }
    onProgress?.(i + 1, SAMPLE_WAREHOUSES.length);
  }
  return { report, ids };
}

/** Items with opening stock in their warehouse, their average cost, and the cold-room condition where needed. */
export async function fillItems(
  api: Api,
  warehouses: Record<string, string>,
  conditions: Partial<Record<SampleCondition['key'], string>>,
  onProgress?: OnProgress,
): Promise<Report> {
  const report = empty();
  const existing = await api<{ sku: string }[]>('/v1/inventory/items');
  const have = new Set(existing.map((x) => x.sku.toUpperCase()));
  for (const [i, it] of SAMPLE_ITEMS.entries()) {
    if (have.has(it.sku)) {
      report.skipped++;
    } else {
      const warehouseId = warehouses[it.warehouse];
      try {
        const made = await api<{ id: string }>(
          '/v1/inventory/items',
          post({ sku: it.sku, name: it.name, nameAr: it.nameAr, uom: it.uom, openingQty: warehouseId ? it.openingQty : 0, warehouseId: warehouseId ?? null }),
        );
        await api(`/v1/inventory/items/${made.id}/cost`, put({ unitCostMinor: it.costMinor }));
        if (it.cold && conditions.cold) await api(`/v1/inventory/items/${made.id}/batching`, post({ tracks: false, conditionId: conditions.cold }));
        report.added++;
      } catch (e) {
        report.failed.push(errText(it.sku, e));
      }
    }
    onProgress?.(i + 1, SAMPLE_ITEMS.length);
  }
  return report;
}

/** Suppliers or customers (matched by name). */
export async function fillParties(api: Api, path: '/v1/purchasing/suppliers' | '/v1/sales/customers', list: SampleParty[], onProgress?: OnProgress): Promise<Report> {
  const report = empty();
  const existing = await api<{ name: string }[]>(path);
  const have = new Set(existing.map((x) => x.name.toLowerCase()));
  for (const [i, p] of list.entries()) {
    if (have.has(p.name.toLowerCase())) {
      report.skipped++;
    } else {
      try {
        await api(path, post({ name: p.name, contact: p.contact, city: p.city }));
        report.added++;
      } catch (e) {
        report.failed.push(errText(p.name, e));
      }
    }
    onProgress?.(i + 1, list.length);
  }
  return report;
}

export const fillSuppliers = (api: Api, onProgress?: OnProgress) => fillParties(api, '/v1/purchasing/suppliers', SAMPLE_SUPPLIERS, onProgress);
export const fillCustomers = (api: Api, onProgress?: OnProgress) => fillParties(api, '/v1/sales/customers', SAMPLE_CUSTOMERS, onProgress);

/** One company-wide approval rule (skipped if the same rule exists). */
export async function fillApproval(api: Api): Promise<Report> {
  const existing = await api<{ warehouseId: string | null; minTotalQty: number; requiredApprovals: number }[]>('/v1/inventory/approval-policies');
  if (existing.some((p) => p.warehouseId === null && p.minTotalQty === SAMPLE_APPROVAL.minTotalQty && p.requiredApprovals === SAMPLE_APPROVAL.requiredApprovals)) {
    return { added: 0, skipped: 1, failed: [] };
  }
  try {
    await api('/v1/inventory/approval-policies', post({ ...SAMPLE_APPROVAL, warehouseId: null }));
    return { added: 1, skipped: 0, failed: [] };
  } catch (e) {
    return { added: 0, skipped: 0, failed: [errText('Approval rule', e)] };
  }
}

export type FillStage = 'company' | 'storage' | 'warehouses' | 'items' | 'suppliers' | 'customers' | 'approval';
export const FILL_STAGES: FillStage[] = ['company', 'storage', 'warehouses', 'items', 'suppliers', 'customers', 'approval'];

/** Everything except language and team, in order, reporting each stage. Stops nothing on a failure: each stage reports its own. */
export async function fillEverything(
  api: Api,
  org: { defaultCurrency: string; timezone: string; dateFormat: string },
  onStage: (stage: FillStage, done: number, total: number) => void,
): Promise<Record<FillStage, Report>> {
  const out = {} as Record<FillStage, Report>;
  onStage('company', 0, 1);
  out.company = await fillCompany(api, org);
  const storage = await fillStorage(api, (d, t) => onStage('storage', d, t));
  out.storage = storage.report;
  const wh = await fillWarehouses(api, storage.ids, (d, t) => onStage('warehouses', d, t));
  out.warehouses = wh.report;
  out.items = await fillItems(api, wh.ids, storage.ids, (d, t) => onStage('items', d, t));
  out.suppliers = await fillSuppliers(api, (d, t) => onStage('suppliers', d, t));
  out.customers = await fillCustomers(api, (d, t) => onStage('customers', d, t));
  onStage('approval', 0, 1);
  out.approval = await fillApproval(api);
  return out;
}
