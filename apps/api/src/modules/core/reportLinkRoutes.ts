import { Hono } from 'hono';
import { REPORT_LINK_KINDS, type ReportLink, type ReportLinkKind } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Private read-only report links for Google Sheets (sql/070). Owners and admins only: the same key as the rest of Settings > Integrations,
// and the database checks the role again. The list never carries a token (only a hash is stored); the token and the full address come back
// once, when the link is made.
export const reportLinkRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

reportLinkRoutes.get('/', requirePermission('core.integrations.manage'), async (c) => {
  const { data, error } = await userDb(c)
    .from('core_report_links')
    .select('id, report, label, created_at, expires_at, revoked_at, last_read_at, read_count')
    .eq('org_id', c.var.tenant.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ok<ReportLink[]>(
    c,
    (data ?? []).map((r) => ({
      id: r.id,
      report: r.report as ReportLinkKind,
      label: r.label,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      lastReadAt: r.last_read_at,
      readCount: Number(r.read_count),
    })),
  );
});

reportLinkRoutes.post('/', requirePermission('core.integrations.manage'), async (c) => {
  const b = await jsonBody(c);
  const report = typeof b.report === 'string' ? b.report : '';
  if (!(REPORT_LINK_KINDS as readonly string[]).includes(report)) invalid('Choose a report');
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (label.length > 100) invalid('The label is too long');
  const days = b.expiresDays === undefined || b.expiresDays === null || b.expiresDays === '' ? null : Number(b.expiresDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) invalid('Expiry is a number of days from 1 to 3650');
  const r = await callRpc<{ id: string; token: string }>(userDb(c), 'core_create_report_link', {
    p_report: report,
    p_label: label || null,
    p_expires_days: days,
  });
  // The API's own address, so the link works wherever the API is deployed. Shown once.
  const url = `${new URL(c.req.url).origin}/r/${r.token}`;
  return ok(c, { id: r.id, token: r.token, url, formula: `=IMPORTDATA("${url}")` }, 201);
});

reportLinkRoutes.post('/:id/revoke', requirePermission('core.integrations.manage'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  await callRpc<null>(userDb(c), 'core_revoke_report_link', { p_id: id });
  return ok(c, { id });
});
