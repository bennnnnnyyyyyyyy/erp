import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

// Prices (sql/097, documentation/plans/MASTER_DATA_PLAN.md slice C): customer groups, an item's sales price, price lists per customer
// group with a validity period, the price a customer gets, and each supplier's last cost (recorded by the database from bills and
// orders; a purchase never changes a sales price, it only suggests one). Every change is one audited database function, owners and
// admins in the database. Before sql/097 is applied these routes answer 503 not_set_up (the app's missing-schema handler).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const param = (c: Context<AppEnv>, name: string) => {
  const id = c.req.param(name) ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};
function optionalId(raw: unknown, what: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) invalid(`${what} must be an id or null`);
  return raw as string;
}
/** A price in minor units, or null to remove it. */
function priceOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) invalid('priceMinor must be a whole number of minor units, zero or more, or null');
  return n;
}
function names(body: Record<string, unknown>) {
  const name = text(body.name);
  if (!name || name.length > 120) invalid('A name (up to 120 characters) is required');
  const nameAr = text(body.nameAr);
  if (nameAr.length > 120) invalid('The Arabic name is up to 120 characters');
  return { name, nameAr: nameAr || null };
}

type GroupRow = { id: string; name: string; name_ar: string | null };
type ListRow = {
  id: string;
  name: string;
  customer_group_id: string;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  includes_vat: boolean;
};

export function registerPriceRoutes(salesRoutes: Hono<AppEnv>) {
  // ------------------------------------------------------------------ customer groups

  salesRoutes.get('/customer-groups', requirePermission('sales.customers.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('sal_customer_groups')
      .select('id, name, name_ar')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('name');
    if (error) throw error;
    return ok(
      c,
      ((data ?? []) as GroupRow[]).map((g) => ({ id: g.id, name: g.name, nameAr: g.name_ar ?? '' })),
    );
  });

  salesRoutes.post('/customer-groups', requirePermission('sales.prices.manage'), async (c) => {
    const n = names(await jsonBody(c));
    const id = await callRpc<string>(userDb(c), 'sal_save_customer_group', { p_group_id: null, p_name: n.name, p_name_ar: n.nameAr });
    return ok(c, { id, name: n.name, nameAr: n.nameAr ?? '' }, 201);
  });

  salesRoutes.put('/customer-groups/:id', requirePermission('sales.prices.manage'), async (c) => {
    const n = names(await jsonBody(c));
    const id = param(c, 'id');
    await callRpc<string>(userDb(c), 'sal_save_customer_group', { p_group_id: id, p_name: n.name, p_name_ar: n.nameAr });
    return ok(c, { id, name: n.name, nameAr: n.nameAr ?? '' });
  });

  salesRoutes.delete('/customer-groups/:id', requirePermission('sales.prices.manage'), async (c) => {
    await callRpc<void>(userDb(c), 'sal_delete_customer_group', { p_group_id: param(c, 'id') });
    return ok(c, { removed: true });
  });

  salesRoutes.put('/customers/:id/group', requirePermission('sales.customers.manage'), async (c) => {
    const id = param(c, 'id');
    const groupId = optionalId((await jsonBody(c)).groupId, 'groupId');
    await callRpc<void>(userDb(c), 'sal_set_customer_group', { p_customer_id: id, p_group_id: groupId });
    return ok(c, { id, customerGroupId: groupId });
  });

  // ------------------------------------------------------------------ item sales price and the markup

  salesRoutes.get('/items/:id/prices', requirePermission('sales.prices.read'), async (c) => {
    return ok(c, await callRpc<Record<string, unknown>>(userDb(c), 'sal_item_price_info', { p_item_id: param(c, 'id') }));
  });

  salesRoutes.put('/items/:id/price', requirePermission('sales.prices.manage'), async (c) => {
    const id = param(c, 'id');
    const priceMinor = priceOrNull((await jsonBody(c)).priceMinor);
    await callRpc<void>(userDb(c), 'sal_set_item_price', { p_item_id: id, p_price_minor: priceMinor });
    return ok(c, { id, priceMinor });
  });

  salesRoutes.put('/price-settings', requirePermission('sales.prices.manage'), async (c) => {
    const raw = (await jsonBody(c)).markupPercent;
    const markup = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (markup !== null && (!Number.isFinite(markup) || markup < 0 || markup > 1000)) invalid('markupPercent is 0 to 1000, or null');
    await callRpc<void>(userDb(c), 'sal_set_default_markup', { p_percent: markup });
    return ok(c, { markupPercent: markup });
  });

  // ------------------------------------------------------------------ price lists

  salesRoutes.get('/price-lists', requirePermission('sales.prices.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('sal_price_lists')
      .select('id, name, customer_group_id, currency, valid_from, valid_to, includes_vat')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('valid_from', { ascending: false });
    if (error) throw error;
    return ok(
      c,
      ((data ?? []) as ListRow[]).map((l) => ({
        id: l.id,
        name: l.name,
        customerGroupId: l.customer_group_id,
        currency: l.currency,
        validFrom: l.valid_from,
        validTo: l.valid_to,
        includesVat: l.includes_vat,
      })),
    );
  });

  salesRoutes.get('/price-lists/:id/items', requirePermission('sales.prices.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('sal_price_list_items')
      .select('item_id, price_minor')
      .eq('org_id', orgOf(c))
      .eq('price_list_id', param(c, 'id'));
    if (error) throw error;
    return ok(
      c,
      ((data ?? []) as { item_id: string; price_minor: number }[]).map((r) => ({ itemId: r.item_id, priceMinor: Number(r.price_minor) })),
    );
  });

  const listFields = (body: Record<string, unknown>) => {
    const name = text(body.name);
    if (!name || name.length > 120) invalid('A name (up to 120 characters) is required');
    const groupId = optionalId(body.customerGroupId, 'customerGroupId');
    if (!groupId) invalid('A customer group is required');
    const validFrom = text(body.validFrom);
    const validTo = text(body.validTo) || null;
    if (!DATE_RE.test(validFrom) || (validTo !== null && !DATE_RE.test(validTo))) invalid('Dates are YYYY-MM-DD');
    if (validTo !== null && validTo < validFrom) invalid('The end date is on or after the start date');
    return { p_name: name, p_customer_group_id: groupId, p_valid_from: validFrom, p_valid_to: validTo };
  };

  salesRoutes.post('/price-lists', requirePermission('sales.prices.manage'), async (c) => {
    const f = listFields(await jsonBody(c));
    const id = await callRpc<string>(userDb(c), 'sal_save_price_list', { p_list_id: null, ...f });
    return ok(c, { id }, 201);
  });

  salesRoutes.put('/price-lists/:id', requirePermission('sales.prices.manage'), async (c) => {
    const f = listFields(await jsonBody(c));
    const id = param(c, 'id');
    await callRpc<string>(userDb(c), 'sal_save_price_list', { p_list_id: id, ...f });
    return ok(c, { id });
  });

  salesRoutes.delete('/price-lists/:id', requirePermission('sales.prices.manage'), async (c) => {
    await callRpc<void>(userDb(c), 'sal_delete_price_list', { p_list_id: param(c, 'id') });
    return ok(c, { removed: true });
  });

  salesRoutes.put('/price-lists/:id/items/:itemId', requirePermission('sales.prices.manage'), async (c) => {
    const id = param(c, 'id');
    const itemId = param(c, 'itemId');
    const priceMinor = priceOrNull((await jsonBody(c)).priceMinor);
    await callRpc<void>(userDb(c), 'sal_set_price_list_item', { p_list_id: id, p_item_id: itemId, p_price_minor: priceMinor });
    return ok(c, { id, itemId, priceMinor });
  });

  // ------------------------------------------------------------------ the price a customer gets (order lines take it, editable)

  salesRoutes.get('/prices', requirePermission('sales.prices.read'), async (c) => {
    const customerId = optionalId(c.req.query('customerId'), 'customerId');
    if (!customerId) invalid('customerId is required');
    const itemIds = (c.req.query('itemIds') ?? '').split(',').filter(Boolean);
    if (itemIds.length === 0 || itemIds.length > 200 || itemIds.some((i) => !UUID_RE.test(i))) invalid('itemIds is 1 to 200 item ids');
    const on = c.req.query('on') || null;
    if (on !== null && !DATE_RE.test(on)) invalid('on is a date, YYYY-MM-DD');
    const rows = await callRpc<
      {
        item_id: string;
        price_minor: number | null;
        currency: string;
        includes_vat: boolean | null;
        source: string | null;
        price_list_id: string | null;
      }[]
    >(userDb(c), 'sal_prices_for', { p_customer_id: customerId, p_item_ids: itemIds, p_on: on });
    return ok(
      c,
      (rows ?? []).map((r) => ({
        itemId: r.item_id,
        priceMinor: r.price_minor === null ? null : Number(r.price_minor),
        currency: r.currency,
        includesVat: r.includes_vat,
        source: r.source,
        priceListId: r.price_list_id,
      })),
    );
  });
}
