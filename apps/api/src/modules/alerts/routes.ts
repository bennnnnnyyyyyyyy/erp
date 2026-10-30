import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Alert rules and teams (sql/028). Owner/admin only. A rule only ever makes messages; it never changes stock or approves anything.
export const alertsRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['stock_below', 'expiry_within', 'receivable_overdue', 'profit_negative'];
const ROLES = ['owner', 'admin', 'member', 'viewer'];
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const idParam = (c: Context<AppEnv>) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};

type Recipient = { type: 'team' | 'role' | 'user'; id?: string; role?: string };
function parseRecipients(v: unknown): Recipient[] {
  const list = Array.isArray(v) ? v : [];
  const out: Recipient[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const type = text(r.type);
    if ((type === 'team' || type === 'user') && UUID_RE.test(text(r.id))) out.push({ type, id: text(r.id) });
    else if (type === 'role' && ROLES.includes(text(r.role))) out.push({ type: 'role', role: text(r.role) });
  }
  if (out.length === 0) invalid('Choose at least one person, role or team to tell');
  return out;
}

alertsRoutes.post('/defaults', requirePermission('alerts.rules.manage'), async (c) => {
  const created = await callRpc<number>(userDb(c), 'alr_ensure_default_teams', {});
  return ok(c, { created }, 201);
});

alertsRoutes.get('/teams', requirePermission('alerts.rules.view'), async (c) => {
  const db = userDb(c);
  const [teams, members] = await Promise.all([
    db.from('alr_teams').select('id, name').eq('org_id', orgOf(c)).order('name'),
    db.from('alr_team_members').select('team_id, user_id').eq('org_id', orgOf(c)),
  ]);
  if (teams.error) throw teams.error;
  if (members.error) throw members.error;
  return ok(c, (teams.data ?? []).map((t) => ({ id: t.id, name: t.name, userIds: (members.data ?? []).filter((m) => m.team_id === t.id).map((m) => m.user_id) })));
});

alertsRoutes.post('/teams', requirePermission('alerts.rules.manage'), async (c) => {
  const name = text((await jsonBody(c)).name);
  if (!name) invalid('A team name is required');
  const id = await callRpc<string>(userDb(c), 'alr_create_team', { p_name: name });
  return ok(c, { id, name, userIds: [] }, 201);
});

alertsRoutes.put('/teams/:id/members', requirePermission('alerts.rules.manage'), async (c) => {
  const id = idParam(c);
  const ids = ((await jsonBody(c)).userIds as unknown[] | undefined) ?? [];
  if (!Array.isArray(ids) || ids.some((x) => !UUID_RE.test(text(x)))) invalid('userIds must be a list of ids');
  await callRpc(userDb(c), 'alr_set_team_members', { p_team_id: id, p_user_ids: ids.map((x) => text(x)) });
  return ok(c, { id });
});

alertsRoutes.get('/rules', requirePermission('alerts.rules.view'), async (c) => {
  const db = userDb(c);
  const [rules, recipients, firings] = await Promise.all([
    db.from('alr_rules').select('id, name, kind, item_id, threshold, repeat_hours, enabled, created_at').eq('org_id', orgOf(c)).is('deleted_at', null).order('created_at'),
    db.from('alr_rule_recipients').select('rule_id, team_id, role, user_id').eq('org_id', orgOf(c)),
    db.from('alr_firings').select('rule_id, last_fired_at, times').eq('org_id', orgOf(c)),
  ]);
  if (rules.error) throw rules.error;
  if (recipients.error) throw recipients.error;
  if (firings.error) throw firings.error;
  return ok(c, (rules.data ?? []).map((r) => {
    const fired = (firings.data ?? []).filter((f) => f.rule_id === r.id);
    return {
      id: r.id, name: r.name, kind: r.kind, itemId: r.item_id, threshold: r.threshold === null ? null : Number(r.threshold), repeatHours: r.repeat_hours, enabled: r.enabled, createdAt: r.created_at,
      recipients: (recipients.data ?? []).filter((x) => x.rule_id === r.id).map((x) => (x.team_id ? { type: 'team', id: x.team_id } : x.user_id ? { type: 'user', id: x.user_id } : { type: 'role', role: x.role })),
      timesFired: fired.reduce((n, f) => n + f.times, 0),
      lastFiredAt: fired.map((f) => f.last_fired_at).sort().pop() ?? null,
    };
  }));
});

alertsRoutes.post('/rules', requirePermission('alerts.rules.manage'), async (c) => {
  const b = await jsonBody(c);
  const name = text(b.name);
  const kind = text(b.kind);
  const itemId = text(b.itemId);
  const threshold = b.threshold === null || b.threshold === undefined || b.threshold === '' ? null : Number(b.threshold);
  const repeatHours = b.repeatHours === undefined ? 24 : Number(b.repeatHours);
  if (!name || !KINDS.includes(kind) || (itemId && !UUID_RE.test(itemId)) || (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) || !Number.isInteger(repeatHours) || repeatHours < 1 || repeatHours > 720) {
    invalid('A name, a rule type, and valid numbers are required');
  }
  if ((kind === 'expiry_within' || kind === 'receivable_overdue') && threshold === null) invalid('This rule needs a number of days');
  const id = await callRpc<string>(userDb(c), 'alr_create_rule', { p_name: name, p_kind: kind, p_item_id: itemId || null, p_threshold: threshold, p_repeat_hours: repeatHours, p_recipients: parseRecipients(b.recipients) });
  return ok(c, { id }, 201);
});

alertsRoutes.put('/rules/:id/recipients', requirePermission('alerts.rules.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'alr_set_rule_recipients', { p_rule_id: id, p_recipients: parseRecipients((await jsonBody(c)).recipients) });
  return ok(c, { id });
});

alertsRoutes.post('/rules/:id/enabled', requirePermission('alerts.rules.manage'), async (c) => {
  const id = idParam(c);
  const enabled = (await jsonBody(c)).enabled;
  if (typeof enabled !== 'boolean') invalid('enabled must be true or false');
  await callRpc(userDb(c), 'alr_set_rule_enabled', { p_rule_id: id, p_enabled: enabled });
  return ok(c, { id, enabled });
});

alertsRoutes.post('/rules/:id/retire', requirePermission('alerts.rules.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'alr_retire_rule', { p_rule_id: id });
  return ok(c, { id });
});

alertsRoutes.post('/rules/:id/test', requirePermission('alerts.rules.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'alr_send_test', { p_rule_id: id });
  return ok(c, { id });
});
