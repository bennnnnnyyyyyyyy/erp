import { Hono } from 'hono';
import { DATE_FORMATS, type DateFormat, type OrgSettings, type OrgSettingsUpdate } from '@ggo/shared';
import type { AppEnv } from '../../env';
import { writeAudit } from '../../lib/audit';
import { invalid, jsonBody } from '../../lib/body';
import { db } from '../../lib/db';
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
    if (!tz || !isTimeZone(tz)) invalid('Time zone must be an IANA name, such as Asia/Dubai');
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

async function loadOrg(c: Parameters<typeof writeAudit>[0]): Promise<OrgRow> {
  const { data, error } = await db(c.env)
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
  const current = await loadOrg(c);

  const row: Record<string, unknown> = {};
  if (update.name !== undefined) row.name = update.name;
  if (update.defaultCurrency !== undefined) row.default_currency = update.defaultCurrency;
  if (update.timezone !== undefined) row.timezone = update.timezone;
  if (update.dateFormat !== undefined) row.settings = { ...(current.settings ?? {}), date_format: update.dateFormat };

  const { data, error } = await db(c.env)
    .from('organizations')
    .update(row)
    .eq('id', c.var.tenant.orgId)
    .select(ORG_COLUMNS)
    .single<OrgRow>();
  if (error) throw error;

  const after = toSettings(data);
  await writeAudit(c, {
    action: 'organization.updated',
    entityType: 'organization',
    entityId: after.id,
    summary: `Organization settings changed: ${Object.keys(update).join(', ')}`,
    before: toSettings(current),
    after,
  });
  return ok(c, after);
});
