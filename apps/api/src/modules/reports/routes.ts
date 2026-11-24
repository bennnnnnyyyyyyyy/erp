import { Hono } from 'hono';
import {
  SALES_FORECAST_HORIZONS,
  hasPermission,
  reportDefinitionProblem,
  type SalesForecast,
  type ReportDefinition,
  type ReportResult,
  type ReportSource,
  type ReportVisibility,
  type SavedReport,
} from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Reports & Insights, step 2: the report builder and saved reports (sql/109; documentation/plans/REPORTS_INSIGHTS_PLAN.md).
// Every call uses the caller's own sign-in. A report is a definition chosen from the database's fixed list of sources (never SQL);
// the shared check gives an early, plain answer and the database checks it again, runs it for the caller's company only, and audits
// saves and deletes. Before sql/109 is applied every route here answers 503 not_set_up (the app's error handler).
export const reportsRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATE_RE = /^[a-z][a-z0-9_]{1,60}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A definition is small; anything larger is not one of ours. */
const MAX_DEFINITION_CHARS = 20_000;

const uuidParam = (v: string | undefined): string => {
  if (!v || !UUID_RE.test(v)) invalid('Invalid id');
  return v;
};

function definitionFrom(v: unknown): ReportDefinition {
  if (JSON.stringify(v ?? null).length > MAX_DEFINITION_CHARS) invalid('The report settings are too large');
  const problem = reportDefinitionProblem(v);
  if (problem) invalid(problem);
  return v as ReportDefinition;
}

type Row = {
  id: string;
  name: string;
  description: string | null;
  definition: ReportDefinition;
  template_key: string | null;
  visibility: ReportVisibility;
  owner_id: string;
  updated_at: string;
};
const COLUMNS = 'id, name, description, definition, template_key, visibility, owner_id, updated_at';
const toSaved = (r: Row, me: string): SavedReport => ({
  id: r.id,
  name: r.name,
  description: r.description,
  definition: r.definition,
  templateKey: r.template_key,
  visibility: r.visibility,
  mine: r.owner_id === me,
  updatedAt: r.updated_at,
});

async function loadSaved(c: Parameters<typeof userDb>[0], id: string): Promise<Row> {
  const { data, error } = await userDb(c)
    .from('rpt_reports')
    .select(COLUMNS)
    .eq('org_id', c.var.tenant.orgId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Not found', 'not_found');
  return data as Row;
}

/** The sources this person may use (their role, and the modules switched on). */
reportsRoutes.get('/sources', requirePermission('reports.custom.read'), async (c) => {
  return ok<ReportSource[]>(c, await callRpc<ReportSource[]>(userDb(c), 'rpt_sources'));
});

/** Runs a definition (the builder's Run button). */
reportsRoutes.post('/run', requirePermission('reports.custom.read'), async (c) => {
  const body = await jsonBody(c);
  const definition = definitionFrom(body.definition);
  return ok<ReportResult>(c, await callRpc<ReportResult>(userDb(c), 'rpt_run', { p_definition: definition }));
});

/** The saved reports this person can see and run: company reports and their own private ones, on sources they may use. */
reportsRoutes.get('/saved', requirePermission('reports.custom.read'), async (c) => {
  const db = userDb(c);
  const [{ data, error }, sources] = await Promise.all([
    db.from('rpt_reports').select(COLUMNS).eq('org_id', c.var.tenant.orgId).is('deleted_at', null).order('name'),
    callRpc<ReportSource[]>(db, 'rpt_sources'),
  ]);
  if (error) throw error;
  const usable = new Set(sources.map((s) => s.key));
  const me = c.var.user.id;
  return ok<SavedReport[]>(
    c,
    ((data ?? []) as Row[]).filter((r) => usable.has(r.definition?.source)).map((r) => toSaved(r, me)),
  );
});

reportsRoutes.get('/saved/:id', requirePermission('reports.custom.read'), async (c) => {
  return ok<SavedReport>(c, toSaved(await loadSaved(c, uuidParam(c.req.param('id'))), c.var.user.id));
});

/** Runs a saved report, optionally for another period (`{ period: { from, to } }`). */
reportsRoutes.post('/saved/:id/run', requirePermission('reports.custom.read'), async (c) => {
  const row = await loadSaved(c, uuidParam(c.req.param('id')));
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const p = (body as { period?: { from?: unknown; to?: unknown } | null }).period;
  let definition = row.definition;
  if (p) {
    if (typeof p.from !== 'string' || typeof p.to !== 'string' || !DATE_RE.test(p.from) || !DATE_RE.test(p.to))
      invalid('The period needs a from and a to date');
    definition = definitionFrom({ ...row.definition, period: { from: p.from, to: p.to } });
  }
  return ok<ReportResult>(c, await callRpc<ReportResult>(userDb(c), 'rpt_run', { p_definition: definition }));
});

function saveArgs(c: Parameters<typeof userDb>[0], body: Record<string, unknown>, id: string | null) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) invalid('Give the report a name (up to 100 characters)');
  const description = body.description === undefined || body.description === null ? null : String(body.description);
  if (description && description.length > 500) invalid('The description is at most 500 characters');
  const visibility = body.visibility;
  if (visibility !== 'company' && visibility !== 'private') invalid('Choose who sees the report: the company or only you');
  // Saving for the whole company needs the manage key; a private report the create key (the route checked it). The database checks
  // the role again.
  if (visibility === 'company' && !hasPermission(c.var.tenant.permissions, 'reports.custom.manage')) {
    throw new HttpError(403, "You don't have permission to do that", 'forbidden');
  }
  const templateKey = body.templateKey === undefined || body.templateKey === null ? null : String(body.templateKey);
  if (templateKey && !TEMPLATE_RE.test(templateKey)) invalid('Unknown template');
  return {
    p_id: id,
    p_name: name,
    p_description: description,
    p_definition: definitionFrom(body.definition),
    p_visibility: visibility,
    p_template_key: templateKey,
  };
}

reportsRoutes.post('/saved', requirePermission('reports.custom.create'), async (c) => {
  const id = await callRpc<string>(userDb(c), 'rpt_save_report', saveArgs(c, await jsonBody(c), null));
  return ok<{ id: string }>(c, { id }, 201);
});

reportsRoutes.patch('/saved/:id', requirePermission('reports.custom.create'), async (c) => {
  const id = uuidParam(c.req.param('id'));
  const current = await loadSaved(c, id);
  const body = await jsonBody(c);
  // Only the fields sent change; the rest keep their saved values.
  const merged = {
    name: body.name ?? current.name,
    description: 'description' in body ? body.description : current.description,
    definition: body.definition ?? current.definition,
    visibility: body.visibility ?? current.visibility,
  };
  if (current.visibility === 'company' && !hasPermission(c.var.tenant.permissions, 'reports.custom.manage')) {
    throw new HttpError(403, "You don't have permission to do that", 'forbidden');
  }
  await callRpc<string>(userDb(c), 'rpt_save_report', saveArgs(c, merged, id));
  return ok<{ id: string }>(c, { id });
});

/**
 * "Alert me when" (step 5, sql/111): a new alert rule on a saved company report. Owners and admins (the alerts key). The database checks
 * the report, the total, the period, and that every recipient may see the report's data; the five-minute alert job does the rest.
 */
const ALERT_PERIODS = ['today', 'last_7', 'this_month', 'last_30'];
reportsRoutes.post('/saved/:id/alert', requirePermission('alerts.rules.manage'), async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = await jsonBody(c);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 120) invalid('Give the alert a name (up to 120 characters)');
  const total = typeof b.total === 'string' ? b.total : '';
  if (!/^(sum|count|avg|min|max)_[a-z][a-z0-9_]{0,60}$/.test(total)) invalid('Choose one of the report’s totals');
  if (b.compare !== 'above' && b.compare !== 'below') invalid('Choose above or below');
  const threshold = Number(b.threshold);
  if (b.threshold === null || b.threshold === undefined || b.threshold === '' || !Number.isFinite(threshold)) invalid('Give the limit');
  const currency = b.currency === null || b.currency === undefined || b.currency === '' ? null : String(b.currency);
  if (currency && !/^[A-Z]{3}$/.test(currency)) invalid('The currency is a three-letter code, for example EGP');
  const period = b.period === null || b.period === undefined || b.period === '' ? null : String(b.period);
  if (period && !ALERT_PERIODS.includes(period)) invalid('Unknown period');
  const repeatHours = b.repeatHours === undefined ? 24 : Number(b.repeatHours);
  if (!Number.isInteger(repeatHours) || repeatHours < 1 || repeatHours > 720) invalid('Repeat every 1 to 720 hours');
  if (!Array.isArray(b.recipients) || b.recipients.length === 0 || b.recipients.length > 20) invalid('Choose who is told');
  const ruleId = await callRpc<string>(userDb(c), 'alr_create_report_rule', {
    p_name: name,
    p_report_id: id,
    p_total: total,
    p_compare: b.compare,
    p_threshold: threshold,
    p_currency: currency,
    p_period: period,
    p_repeat_hours: repeatHours,
    p_recipients: b.recipients,
  });
  return ok<{ id: string }>(c, { id: ruleId }, 201);
});

/** The sales forecast (step 4, sql/110): by product or by customer, for the next 30, 60 or 90 days. Read-only. */
reportsRoutes.get('/forecast/sales', requirePermission('reports.forecast.read'), async (c) => {
  const by = c.req.query('by') ?? 'item';
  const horizon = Number(c.req.query('horizon') ?? 30);
  if (by !== 'item' && by !== 'customer') invalid('Forecast by product or by customer');
  if (!(SALES_FORECAST_HORIZONS as readonly number[]).includes(horizon)) invalid('Forecast the next 30, 60 or 90 days');
  return ok<SalesForecast>(c, await callRpc<SalesForecast>(userDb(c), 'rpt_sales_forecast', { p_by: by, p_horizon: horizon }));
});

reportsRoutes.delete('/saved/:id', requirePermission('reports.custom.create'), async (c) => {
  const id = uuidParam(c.req.param('id'));
  await callRpc<null>(userDb(c), 'rpt_delete_report', { p_id: id });
  return ok<{ id: string }>(c, { id });
});
