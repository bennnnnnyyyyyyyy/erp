import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_CONDITIONS, SAMPLE_CUSTOMERS, SAMPLE_ITEMS, SAMPLE_SUPPLIERS, SAMPLE_WAREHOUSES } from './sampleCompany';
import { type Api, canFillSample, fillEverything, fillItems, fillStorage, fillWarehouses } from './sampleFill';

// The sample company must stay a faithful copy of Demo Cosmetics Factory's master data (sql/seed/004), so the demo's "switch to the
// cosmetics company" shows the same business. The seed file is read as text.
const seed = readFileSync(join(__dirname, '../../../../../sql/seed/004_cosmetics_factory_demo.sql'), 'utf8');

describe('sample company matches the cosmetics seed', () => {
  it('has every item with the same code, name, Arabic name, unit and cost', () => {
    for (const it of SAMPLE_ITEMS) {
      expect(seed, it.sku).toContain(`('${it.sku}','${it.name}','${it.nameAr}','${it.uom}',`);
      const row = seed.slice(seed.indexOf(`('${it.sku}',`)).split('\n')[0] as string;
      expect(row.split(',')[5], `${it.sku} cost`).toBe(String(it.costMinor));
    }
  });

  it('puts cold items only in the cold warehouse, and every item in a sample warehouse', () => {
    const codes = SAMPLE_WAREHOUSES.map((w) => w.code);
    for (const it of SAMPLE_ITEMS) {
      expect(codes).toContain(it.warehouse);
      expect(it.cold).toBe(it.warehouse === 'COLD');
      expect(it.openingQty).toBeGreaterThan(0);
    }
  });

  it('has the same warehouses, conditions, suppliers and customers', () => {
    for (const w of SAMPLE_WAREHOUSES) expect(seed).toMatch(new RegExp(`'${w.code}',\\s*'${w.name}',\\s*'${w.nameAr}'`));
    for (const c of SAMPLE_CONDITIONS) expect(seed).toContain(`'${c.name}', ${c.minTempC}, ${c.maxTempC}`);
    for (const p of [...SAMPLE_SUPPLIERS, ...SAMPLE_CUSTOMERS]) expect(seed).toContain(`'${p.name}','${p.contact}','${p.city}'`);
    expect(SAMPLE_SUPPLIERS).toHaveLength(12);
    expect(SAMPLE_CUSTOMERS).toHaveLength(10);
  });
});

describe('who sees the fill buttons', () => {
  it('is only the accounts in the build setting, case-insensitive', () => {
    const setting = 'chris.johnson.wiz@gmail.com, other@x.test';
    expect(canFillSample('Chris.Johnson.Wiz@gmail.com', setting)).toBe(true);
    expect(canFillSample('grant.holden.wiz@gmail.com', setting)).toBe(false);
    expect(canFillSample('chris.johnson.wiz@gmail.com', '')).toBe(false);
    expect(canFillSample('chris.johnson.wiz@gmail.com', undefined)).toBe(false);
    expect(canFillSample(null, setting)).toBe(false);
  });
});

/** An in-memory API: lists per path, created rows get ids; every call is recorded. */
function fakeApi() {
  const lists: Record<string, Record<string, unknown>[]> = {
    '/v1/inventory/storage-conditions': [],
    '/v1/inventory/warehouses': [],
    '/v1/inventory/items': [],
    '/v1/purchasing/suppliers': [],
    '/v1/sales/customers': [],
    '/v1/inventory/approval-policies': [],
  };
  const calls: string[] = [];
  let n = 0;
  const api = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method === 'GET') return lists[path] ?? [];
    if (method === 'POST' && lists[path]) {
      const row = { id: `id-${++n}`, ...body };
      lists[path].push(row);
      return row;
    }
    return { ok: true };
  }) as Api;
  return { api, calls, lists };
}

describe('filling', () => {
  it('creates conditions, warehouses with their condition, and items with stock, cost and the cold condition', async () => {
    const { api, calls, lists } = fakeApi();
    const s = await fillStorage(api);
    const w = await fillWarehouses(api, s.ids);
    const r = await fillItems(api, w.ids, s.ids);
    expect(s.report.added).toBe(2);
    expect(w.report.added).toBe(5);
    expect(r).toEqual({ added: SAMPLE_ITEMS.length, skipped: 0, failed: [] });
    expect(calls.filter((x) => x.startsWith('POST /v1/inventory/warehouses/') && x.endsWith('/storage'))).toHaveLength(5);
    expect(calls.filter((x) => x.startsWith('PUT /v1/inventory/items/') && x.endsWith('/cost'))).toHaveLength(SAMPLE_ITEMS.length);
    expect(calls.filter((x) => x.endsWith('/batching'))).toHaveLength(SAMPLE_ITEMS.filter((i) => i.cold).length);
    const cold = lists['/v1/inventory/items']?.find((i) => i.sku === 'R-ALO');
    expect(cold?.warehouseId).toBe(w.ids.COLD);
  });

  it('never duplicates: a second run adds nothing', async () => {
    const { api, lists } = fakeApi();
    const org = { defaultCurrency: 'USD', timezone: 'UTC', dateFormat: 'MM/DD/YYYY' };
    const first = await fillEverything(api, org, () => {});
    expect(first.items.added).toBe(SAMPLE_ITEMS.length);
    expect(first.suppliers.added).toBe(12);
    expect(first.customers.added).toBe(10);
    expect(first.approval.added).toBe(1);
    const second = await fillEverything(api, org, () => {});
    for (const stage of ['storage', 'warehouses', 'items', 'suppliers', 'customers'] as const) expect(second[stage].added, stage).toBe(0);
    expect(lists['/v1/inventory/items']).toHaveLength(SAMPLE_ITEMS.length);
  });

  it('reports a failing row and carries on with the rest', async () => {
    const { api } = fakeApi();
    const failing = (async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST' && path === '/v1/inventory/items' && String(init.body).includes('"F-SHA"')) throw new Error('That already exists');
      return api(path, init);
    }) as Api;
    const s = await fillStorage(failing);
    const w = await fillWarehouses(failing, s.ids);
    const r = await fillItems(failing, w.ids, s.ids);
    expect(r.added).toBe(SAMPLE_ITEMS.length - 1);
    expect(r.failed).toEqual(['F-SHA: That already exists']);
  });
});
