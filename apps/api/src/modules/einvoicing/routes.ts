import { Hono, type Context } from 'hono';
import { DEFAULT_ETA_MODE, ETA_MODES } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

// E-invoicing tax master data (sql/036, documentation/plans/ETA_EINVOICING_PLAN.md slice A1). Nothing here talks to ETA yet.
// Every change is one database function that checks role and module and writes its audit row itself; these routes only check
// the permission early and shape the input. Reads are filtered to the caller's organization by row level security.

export const einvoicingRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const optional = (x: unknown) => text(x) || null;

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
}

type BranchRow = {
  id: string;
  branch_code: string;
  name: string;
  country: string;
  governate: string;
  region_city: string;
  street: string;
  building_number: string;
  postal_code: string | null;
  floor: string | null;
  room: string | null;
  landmark: string | null;
  additional_information: string | null;
};
type RateRow = { id: string; tax_type: string; sub_type: string; rate: number | string; label: string; is_default: boolean };

const branchOut = (b: BranchRow) => ({
  id: b.id,
  branchCode: b.branch_code,
  name: b.name,
  country: b.country,
  governate: b.governate,
  regionCity: b.region_city,
  street: b.street,
  buildingNumber: b.building_number,
  postalCode: b.postal_code,
  floor: b.floor,
  room: b.room,
  landmark: b.landmark,
  additionalInformation: b.additional_information,
});
const rateOut = (r: RateRow) => ({
  id: r.id,
  taxType: r.tax_type,
  subType: r.sub_type,
  rate: Number(r.rate),
  label: r.label,
  isDefault: r.is_default,
});

async function loadSettings(c: Context<AppEnv>) {
  const client = userDb(c);
  const org = orgOf(c);
  const [p, b, r] = await Promise.all([
    client.from('tax_profiles').select('registration_number, legal_name, activity_code, eta_mode').eq('org_id', org).maybeSingle(),
    client
      .from('tax_branches')
      .select(
        'id, branch_code, name, country, governate, region_city, street, building_number, postal_code, floor, room, landmark, additional_information',
      )
      .eq('org_id', org)
      .is('deleted_at', null)
      .order('branch_code'),
    client
      .from('tax_rates')
      .select('id, tax_type, sub_type, rate, label, is_default')
      .eq('org_id', org)
      .is('deleted_at', null)
      .order('tax_type')
      .order('label'),
  ]);
  if (p.error) throw p.error;
  if (b.error) throw b.error;
  if (r.error) throw r.error;
  const prof = p.data as { registration_number: string; legal_name: string; activity_code: string; eta_mode: string } | null;
  return {
    profile: prof
      ? { registrationNumber: prof.registration_number, legalName: prof.legal_name, activityCode: prof.activity_code, mode: prof.eta_mode }
      : null,
    branches: ((b.data ?? []) as BranchRow[]).map(branchOut),
    rates: ((r.data ?? []) as RateRow[]).map(rateOut),
  };
}

einvoicingRoutes.get('/settings', requirePermission('einvoicing.settings.read'), async (c) => ok(c, await loadSettings(c)));

// ETA code tables: the same for every company.
einvoicingRoutes.get('/codes', requirePermission('einvoicing.settings.read'), async (c) => {
  const client = userDb(c);
  const [s, u] = await Promise.all([
    client.from('eta_tax_subtypes').select('tax_type, sub_type, description').order('tax_type').order('sub_type'),
    client.from('eta_unit_types').select('code, description').order('code'),
  ]);
  if (s.error) throw s.error;
  if (u.error) throw u.error;
  return ok(c, {
    taxSubtypes: (s.data ?? []).map((x: { tax_type: string; sub_type: string; description: string }) => ({
      taxType: x.tax_type,
      subType: x.sub_type,
      description: x.description,
    })),
    unitTypes: (u.data ?? []).map((x: { code: string; description: string }) => ({ code: x.code, description: x.description })),
  });
});

// What is still missing before a document could be built: items without an ETA code or unit, customers without a tax identity.
einvoicingRoutes.get('/readiness', requirePermission('einvoicing.settings.read'), async (c) => {
  const client = userDb(c);
  const org = orgOf(c);
  const [items, itemsMissing, customers, customersMissing, settings] = await Promise.all([
    client.from('inv_items').select('id', { count: 'exact', head: true }).eq('org_id', org).is('deleted_at', null),
    client
      .from('inv_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org)
      .is('deleted_at', null)
      .or('eta_item_code.is.null,eta_unit_code.is.null'),
    client.from('sal_customers').select('id', { count: 'exact', head: true }).eq('org_id', org).is('deleted_at', null),
    client
      .from('sal_customers')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org)
      .is('deleted_at', null)
      .is('tax_id_type', null),
    loadSettings(c),
  ]);
  for (const r of [items, itemsMissing, customers, customersMissing]) if (r.error) throw r.error;
  const missing: string[] = [];
  if (!settings.profile) missing.push('Company tax registration is not saved');
  if (settings.branches.length === 0) missing.push('No branch is saved');
  if (settings.rates.length === 0) missing.push('No tax rate is saved');
  if ((itemsMissing.count ?? 0) > 0) missing.push(`${itemsMissing.count} of ${items.count} items have no ETA item code or unit`);
  if ((customersMissing.count ?? 0) > 0) missing.push(`${customersMissing.count} of ${customers.count} customers have no tax identity`);
  return ok(c, {
    ready: missing.length === 0,
    missing,
    items: { total: items.count ?? 0, missingCodes: itemsMissing.count ?? 0 },
    customers: { total: customers.count ?? 0, missingTaxIdentity: customersMissing.count ?? 0 },
  });
});

einvoicingRoutes.put('/profile', requirePermission('einvoicing.settings.manage'), async (c) => {
  const b = await jsonBody(c);
  const mode = text(b.mode) || DEFAULT_ETA_MODE;
  if (!text(b.registrationNumber) || !text(b.legalName) || !text(b.activityCode))
    invalid('Registration number, legal name and activity code are required');
  if (!(ETA_MODES as readonly string[]).includes(mode)) invalid('Mode must be preprod or production');
  await callRpc<void>(userDb(c), 'eta_save_profile', {
    p_registration_number: text(b.registrationNumber),
    p_legal_name: text(b.legalName),
    p_activity_code: text(b.activityCode),
    p_mode: mode,
  });
  return ok(c, (await loadSettings(c)).profile);
});

function branchArgs(b: Record<string, unknown>, id: string | null) {
  if (!text(b.branchCode) || !text(b.name) || !text(b.governate) || !text(b.regionCity) || !text(b.street) || !text(b.buildingNumber)) {
    invalid('Branch code, name, governate, region or city, street and building number are required');
  }
  return {
    p_id: id,
    p_branch_code: text(b.branchCode),
    p_name: text(b.name),
    p_governate: text(b.governate),
    p_region_city: text(b.regionCity),
    p_street: text(b.street),
    p_building_number: text(b.buildingNumber),
    p_postal_code: optional(b.postalCode),
    p_floor: optional(b.floor),
    p_room: optional(b.room),
    p_landmark: optional(b.landmark),
    p_additional: optional(b.additionalInformation),
    p_country: text(b.country) || 'EG',
  };
}

einvoicingRoutes.post('/branches', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = await callRpc<string>(userDb(c), 'eta_save_branch', branchArgs(await jsonBody(c), null));
  return ok(c, (await loadSettings(c)).branches.find((x) => x.id === id) ?? { id }, 201);
});
einvoicingRoutes.put('/branches/:id', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<string>(userDb(c), 'eta_save_branch', branchArgs(await jsonBody(c), id));
  return ok(c, (await loadSettings(c)).branches.find((x) => x.id === id) ?? { id });
});
einvoicingRoutes.delete('/branches/:id', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'eta_remove_branch', { p_id: id });
  return ok(c, { id, removed: true });
});

function rateArgs(b: Record<string, unknown>, id: string | null) {
  const rate = Number(b.rate);
  if (!text(b.taxType) || !text(b.subType) || !text(b.label) || !Number.isFinite(rate) || rate < 0 || rate > 999) {
    invalid('Tax type, subtype, a label and a rate from 0 to 999 are required');
  }
  return {
    p_id: id,
    p_tax_type: text(b.taxType),
    p_sub_type: text(b.subType),
    p_rate: rate,
    p_label: text(b.label),
    p_is_default: b.isDefault === true,
  };
}

einvoicingRoutes.post('/rates', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = await callRpc<string>(userDb(c), 'eta_save_tax_rate', rateArgs(await jsonBody(c), null));
  return ok(c, (await loadSettings(c)).rates.find((x) => x.id === id) ?? { id }, 201);
});
einvoicingRoutes.put('/rates/:id', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<string>(userDb(c), 'eta_save_tax_rate', rateArgs(await jsonBody(c), id));
  return ok(c, (await loadSettings(c)).rates.find((x) => x.id === id) ?? { id });
});
einvoicingRoutes.delete('/rates/:id', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'eta_remove_tax_rate', { p_id: id });
  return ok(c, { id, removed: true });
});

einvoicingRoutes.put('/customers/:id/tax', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const type = text(b.taxIdType);
  if (type !== 'B' && type !== 'P' && type !== 'F') invalid('Tax identity type must be B (business), P (person) or F (foreign)');
  await callRpc<void>(userDb(c), 'eta_set_customer_tax', {
    p_customer_id: id,
    p_tax_id_type: type,
    p_tax_id: optional(b.taxId),
    p_country: optional(b.country),
    p_governate: optional(b.governate),
    p_region_city: optional(b.regionCity),
    p_street: optional(b.street),
    p_building_number: optional(b.buildingNumber),
  });
  return ok(c, { id, taxIdType: type });
});

einvoicingRoutes.put('/items/:id/codes', requirePermission('einvoicing.settings.manage'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const type = text(b.itemType);
  const taxRateId = optional(b.taxRateId);
  if ((type !== 'GS1' && type !== 'EGS') || !text(b.itemCode) || !text(b.unitCode))
    invalid('Item type (GS1 or EGS), item code and unit code are required');
  if (taxRateId && !UUID_RE.test(taxRateId)) invalid('The tax rate is not valid');
  await callRpc<void>(userDb(c), 'eta_set_item_codes', {
    p_item_id: id,
    p_item_type: type,
    p_item_code: text(b.itemCode),
    p_unit_code: text(b.unitCode),
    p_tax_rate_id: taxRateId,
  });
  return ok(c, { id, itemType: type, itemCode: text(b.itemCode), unitCode: text(b.unitCode), taxRateId });
});
