import { Hono, type Context } from 'hono';
import { DATE_FORMATS, type DateFormat, type OrgSettings, type OrgSettingsUpdate } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { callRpc } from '../../lib/rpc';
import { userDb } from '../../lib/db.user';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  default_currency: string;
  timezone: string;
  settings: Record<string, unknown> | null;
};

const ORG_COLUMNS = 'id, name, slug, default_currency, timezone, settings';

function toSettings(row: OrgRow): OrgSettings {
  const dateFormat = row.settings?.date_format;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    defaultCurrency: row.default_currency,
    timezone: row.timezone,
    dateFormat: DATE_FORMATS.includes(dateFormat as DateFormat) ? (dateFormat as DateFormat) : 'DD/MM/YYYY',
    language: row.settings?.language === 'ar' ? 'ar' : 'en',
    lockDate: typeof row.settings?.lock_date === 'string' ? row.settings.lock_date : null,
    defaultPaymentTermsDays: typeof row.settings?.default_payment_terms_days === 'number' ? row.settings.default_payment_terms_days : 0,
    vatRegistered: row.settings?.vat_registered === true,
    defaultVatRateId: typeof row.settings?.default_vat_rate_id === 'string' ? row.settings.default_vat_rate_id : null,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validates a PATCH body. Only the fields present are checked and returned. */
export function parseOrgUpdate(body: Record<string, unknown>): OrgSettingsUpdate {
  const update: OrgSettingsUpdate = {};
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 200) invalid('Name must be 1–200 characters');
    update.name = name;
  }
  if ('defaultCurrency' in body) {
    const cur = typeof body.defaultCurrency === 'string' ? body.defaultCurrency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(cur)) invalid('Currency must be a three-letter ISO 4217 code, such as USD');
    update.defaultCurrency = cur;
  }
  if ('timezone' in body) {
    const tz = typeof body.timezone === 'string' ? body.timezone.trim() : '';
    if (!tz || !isTimeZone(tz)) invalid('Time zone must be an IANA name, such as Africa/Cairo');
    update.timezone = tz;
  }
  if ('dateFormat' in body) {
    if (!DATE_FORMATS.includes(body.dateFormat as DateFormat)) {
      invalid(`Date format must be one of ${DATE_FORMATS.join(', ')}`);
    }
    update.dateFormat = body.dateFormat as DateFormat;
  }
  if (Object.keys(update).length === 0) invalid('Nothing to update');
  return update;
}

export const orgRoutes = new Hono<AppEnv>();

async function loadOrg(c: Context<AppEnv>): Promise<OrgRow> {
  const { data, error } = await userDb(c).from('organizations').select(ORG_COLUMNS).eq('id', c.var.tenant.orgId).single<OrgRow>();
  if (error) throw error;
  return data;
}

orgRoutes.get('/', requirePermission('core.org.read'), async (c) => ok(c, toSettings(await loadOrg(c))));

orgRoutes.patch('/', requirePermission('core.org.manage'), async (c) => {
  const update = parseOrgUpdate(await jsonBody(c));
  // One database function changes the settings and writes the audit row in the same transaction (ADR-0003).
  const after = await callRpc<OrgSettings>(userDb(c), 'core_update_org', {
    p_name: update.name ?? null,
    p_default_currency: update.defaultCurrency ?? null,
    p_timezone: update.timezone ?? null,
    p_date_format: update.dateFormat ?? null,
  });
  return ok(c, after);
});

// One language for the whole organization (sql/031). Owners and admins only; the database function checks, changes and audits.
orgRoutes.post('/language', requirePermission('core.org.manage'), async (c) => {
  const language = (await jsonBody(c)).language;
  if (language !== 'en' && language !== 'ar') invalid('Language must be en or ar');
  await callRpc<string>(userDb(c), 'core_set_language', { p_language: language });
  return ok(c, { language });
});

// Hide or show the getting-started tutorial (sql/032). Owners and admins only.
orgRoutes.post('/tutorial', requirePermission('core.org.manage'), async (c) => {
  const show = (await jsonBody(c)).show;
  if (typeof show !== 'boolean') invalid('show must be true or false');
  await callRpc<boolean>(userDb(c), 'core_set_tutorial', { p_show: show });
  return ok(c, { show });
});

// Set or remove the closed-period lock date (sql/040). The database allows owners only; the route check is the early rejection.
orgRoutes.put('/lock-date', requirePermission('core.org.manage'), async (c) => {
  const date = (await jsonBody(c)).date;
  if (date !== null && (typeof date !== 'string' || !ISO_DATE.test(date))) invalid('date must be YYYY-MM-DD or null');
  const lockDate = await callRpc<string | null>(userDb(c), 'core_set_lock_date', { p_date: date });
  return ok(c, { lockDate });
});

// Payment terms used when a customer or supplier has none (sql/041). Owners and admins.
orgRoutes.put('/payment-terms', requirePermission('core.org.manage'), async (c) => {
  const days = (await jsonBody(c)).days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365) invalid('days must be a whole number from 0 to 365');
  const saved = await callRpc<number>(userDb(c), 'core_set_default_payment_terms', { p_days: days });
  return ok(c, { defaultPaymentTermsDays: saved });
});

// The VAT setting and the company's VAT (T1) rates, for the invoice form and Settings. Any member may read them (a sales clerk choosing
// a line's rate must not need the e-invoicing permission); the rates are company data under row level security. subTypes: the ETA VAT
// sub-types a rate can carry (the same for every company).
orgRoutes.get('/vat', requirePermission('core.org.read'), async (c) => {
  const org = await loadOrg(c);
  const [rates, subs] = await Promise.all([
    userDb(c)
      .from('tax_rates')
      .select('id, sub_type, rate, label, is_default')
      .eq('org_id', c.var.tenant.orgId)
      .eq('tax_type', 'T1')
      .is('deleted_at', null)
      .order('label'),
    userDb(c).from('eta_tax_subtypes').select('sub_type, description').eq('tax_type', 'T1').order('sub_type'),
  ]);
  if (rates.error) throw rates.error;
  if (subs.error) throw subs.error;
  const s = toSettings(org);
  return ok(c, {
    vatRegistered: s.vatRegistered ?? false,
    defaultVatRateId: s.defaultVatRateId ?? null,
    /** The first day VAT applies (sql/087, sql/088), or null. */
    vatFrom: typeof org.settings?.vat_from === 'string' ? org.settings.vat_from : null,
    /** sql/091: days after the month that the return is due (null = end of the following month), the small-enterprise flag, and
     *  whether an opening VAT balance was entered. */
    returnDueDays: typeof org.settings?.vat_return_days === 'number' ? org.settings.vat_return_days : null,
    smallEnterprise: org.settings?.vat_small_enterprise === true,
    openingEntered: typeof org.settings?.vat_opening_journal_id === 'string',
    rates: ((rates.data ?? []) as { id: string; sub_type: string; rate: number | string; label: string; is_default: boolean }[]).map(
      (r) => ({
        id: r.id,
        subType: r.sub_type,
        rate: Number(r.rate),
        label: r.label,
        isDefault: r.is_default,
      }),
    ),
    subTypes: ((subs.data ?? []) as { sub_type: string; description: string }[]).map((x) => ({
      code: x.sub_type,
      description: x.description,
    })),
  });
});

// VAT registered or not, the default VAT rate and the first day VAT applies (sql/088). The database allows owners only (the route check
// is the early rejection for staff), needs an existing VAT rate, refuses while Shopify is on, and audits the change. vatFrom defaults
// to the first day of the current month; another day is accepted and reported back as vatFromMidMonth.
orgRoutes.put('/vat', requirePermission('core.org.manage'), async (c) => {
  const b = await jsonBody(c);
  if (typeof b.registered !== 'boolean') invalid('registered must be true or false');
  const rateId = b.defaultRateId === null || b.defaultRateId === undefined ? null : b.defaultRateId;
  if (rateId !== null && (typeof rateId !== 'string' || !UUID_RE.test(rateId))) invalid('defaultRateId must be a tax rate id or null');
  const vatFrom = b.vatFrom === null || b.vatFrom === undefined || b.vatFrom === '' ? null : b.vatFrom;
  if (vatFrom !== null && (typeof vatFrom !== 'string' || !ISO_DATE.test(vatFrom))) invalid('vatFrom must be YYYY-MM-DD');
  const saved = await callRpc<{
    vatRegistered: boolean;
    defaultVatRateId: string | null;
    vatFrom: string | null;
    vatFromMidMonth?: boolean;
  }>(userDb(c), 'core_set_vat', { p_registered: b.registered, p_default_rate_id: rateId, ...(vatFrom ? { p_vat_from: vatFrom } : {}) });
  return ok(c, saved);
});

// VAT return settings (sql/091): the return's due date (days after the month; null = end of the following month) and the small-enterprise
// flag (refunds after more than 3 months). Owner only in the database.
orgRoutes.put('/vat/return', requirePermission('core.org.manage'), async (c) => {
  const b = await jsonBody(c);
  const days = b.dueDays === null || b.dueDays === undefined || b.dueDays === '' ? null : b.dueDays;
  if (days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 120))
    invalid('dueDays must be 1-120 or empty');
  if (typeof b.smallEnterprise !== 'boolean') invalid('smallEnterprise must be true or false');
  return ok(c, await callRpc<unknown>(userDb(c), 'core_set_vat_return', { p_due_days: days, p_small_enterprise: b.smallEnterprise }));
});
// VAT rates (sql/088): owners and admins add, change and remove the company's VAT rates without the e-invoicing module. The database
// checks the ETA VAT sub-type, keeps names unique, refuses to remove a rate that items use or that is the default, and audits.
function vatRateBody(b: Record<string, unknown>) {
  const subType = typeof b.subType === 'string' ? b.subType.trim().toUpperCase() : '';
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (!/^V\d{3}$/.test(subType)) invalid('subType must be an ETA VAT sub-type such as V009');
  if (typeof b.rate !== 'number' || !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 100) invalid('rate must be a number from 0 to 100');
  if (label.length < 1 || label.length > 100) invalid('A name of 1-100 characters is required');
  if (b.isDefault !== undefined && typeof b.isDefault !== 'boolean') invalid('isDefault must be true or false');
  return { p_sub_type: subType, p_rate: b.rate, p_label: label, p_is_default: b.isDefault === true };
}
orgRoutes.post('/vat/rates', requirePermission('core.org.manage'), async (c) => {
  const id = await callRpc<string>(userDb(c), 'core_save_vat_rate', { p_id: null, ...vatRateBody(await jsonBody(c)) });
  return ok(c, { id }, 201);
});
orgRoutes.put('/vat/rates/:id', requirePermission('core.org.manage'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) invalid('Unknown rate');
  await callRpc<string>(userDb(c), 'core_save_vat_rate', { p_id: id, ...vatRateBody(await jsonBody(c)) });
  return ok(c, { id });
});
orgRoutes.delete('/vat/rates/:id', requirePermission('core.org.manage'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) invalid('Unknown rate');
  await callRpc<void>(userDb(c), 'core_remove_vat_rate', { p_id: id });
  return ok(c, { id, removed: true });
});
// Switch the in-app guided tour on or off for this company (sql/039). Owners and admins only; off by default.
// Blind stock counts on or off (sql/066; MVP decision M3). Owners and admins; the database checks again and audits.
orgRoutes.post('/blind-counts', requirePermission('core.org.manage'), async (c) => {
  const on = (await jsonBody(c)).on;
  if (typeof on !== 'boolean') invalid('on must be true or false');
  await callRpc<boolean>(userDb(c), 'core_set_blind_counts', { p_on: on });
  return ok(c, { on });
});

// Owners may approve their own requests (sql/077, decision D1c). Owners only: the database refuses admins and audits the change.
orgRoutes.post('/owner-self-approval', requirePermission('core.org.manage'), async (c) => {
  const on = (await jsonBody(c)).on;
  if (typeof on !== 'boolean') invalid('on must be true or false');
  await callRpc<boolean>(userDb(c), 'core_set_owner_self_approval', { p_on: on });
  return ok(c, { on });
});

orgRoutes.post('/tour', requirePermission('core.org.manage'), async (c) => {
  const show = (await jsonBody(c)).show;
  if (typeof show !== 'boolean') invalid('show must be true or false');
  await callRpc<boolean>(userDb(c), 'core_set_tour', { p_show: show });
  return ok(c, { show });
});
