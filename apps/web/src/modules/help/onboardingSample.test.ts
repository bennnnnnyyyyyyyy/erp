import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_CONDITIONS, SAMPLE_CUSTOMERS, SAMPLE_ITEMS, SAMPLE_SUPPLIERS, SAMPLE_WAREHOUSES } from './sampleCompany';
import { type Api, canFillSample, fillEverything, saveConditions, saveItems, saveWarehouses } from './sampleFill';

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

  it('puts cold items only in the cold warehouse, and every item in a sample warehouse with stock', () => {
    const codes = SAMPLE_WAREHOUSES.map((w) => w.code);
    const condNames = SAMPLE_CONDITIONS.map((x) => x.name);
    for (const it of SAMPLE_ITEMS) {
      expect(codes).toContain(it.warehouse);
      expect(it.condition === 'Cold room').toBe(it.warehouse === 'COLD');
      if (it.condition) expect(condNames).toContain(it.condition);
      expect(it.openingQty).toBeGreaterThan(0);
    }
    for (const w of SAMPLE_WAREHOUSES) expect(condNames).toContain(w.condition);
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

describe('saving', () => {
  it('creates conditions, warehouses with their condition, and items with stock, cost and the cold condition', async () => {
    const { api, calls, lists } = fakeApi();
    expect((await saveConditions(api)).added).toBe(2);
    expect((await saveWarehouses(api)).added).toBe(5);
    expect(await saveItems(api)).toEqual({ added: SAMPLE_ITEMS.length, skipped: 0, failed: [] });
    expect(calls.filter((x) => x.startsWith('POST /v1/inventory/warehouses/') && x.endsWith('/storage'))).toHaveLength(5);
    // The cost travels with the create request (one request per item), so there is no separate cost call.
    expect(calls.filter((x) => x.endsWith('/cost'))).toHaveLength(0);
    for (const it of SAMPLE_ITEMS) expect(lists['/v1/inventory/items']?.find((i) => i.sku === it.sku)?.unitCostMinor).toBe(it.costMinor);
    expect(calls.filter((x) => x.endsWith('/batching'))).toHaveLength(SAMPLE_ITEMS.filter((i) => i.condition).length);
    const coldWh = lists['/v1/inventory/warehouses']?.find((w) => w.code === 'COLD');
    expect(lists['/v1/inventory/items']?.find((i) => i.sku === 'R-ALO')?.warehouseId).toBe(coldWh?.id);
  });

  it('saves a row the presenter typed exactly like a sample row', async () => {
    const { api, lists } = fakeApi();
    await saveWarehouses(api, [{ code: 'main', name: ' Main store ', nameAr: '', condition: '' }]);
    await saveItems(api, [{ sku: 'x-1', name: 'Typed item', nameAr: '', uom: '', warehouse: 'MAIN', condition: '', openingQty: 5, costMinor: 1234 }]);
    expect(lists['/v1/inventory/warehouses']?.[0]).toMatchObject({ code: 'MAIN', name: 'Main store' });
    expect(lists['/v1/inventory/items']?.[0]).toMatchObject({ sku: 'X-1', uom: 'piece', openingQty: 5 });
  });

  it('saves at most 4 rows at once, and two identical rows in one table create only one', async () => {
    const { api, lists } = fakeApi();
    let inFlight = 0;
    let peak = 0;
    const slow = (async (path: string, init?: RequestInit) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await api(path, init);
      } finally {
        inFlight--;
      }
    }) as Api;
    const progress: number[] = [];
    await saveWarehouses(slow, [...SAMPLE_WAREHOUSES, SAMPLE_WAREHOUSES[0] as (typeof SAMPLE_WAREHOUSES)[number]], (d) => progress.push(d));
    expect(peak).toBeLessThanOrEqual(4);
    expect(lists['/v1/inventory/warehouses']).toHaveLength(SAMPLE_WAREHOUSES.length);
    expect(progress.at(-1)).toBe(SAMPLE_WAREHOUSES.length + 1);
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
    await saveConditions(failing);
    await saveWarehouses(failing);
    const r = await saveItems(failing);
    expect(r.added).toBe(SAMPLE_ITEMS.length - 1);
    expect(r.failed).toEqual(['F-SHA: That already exists']);
  });
});
