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
  };
}

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
  const { data, error } = await userDb(c)
    .from('organizations')
    .select(ORG_COLUMNS)
    .eq('id', c.var.tenant.orgId)
    .single<OrgRow>();
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
