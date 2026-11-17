import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

// Item groups and the item code rule (sql/095, documentation/plans/MASTER_DATA_PLAN.md slice A). Every change is one audited database
// function; the database re-checks the role (groups and the rule: owners and admins; placing an item in a group: also members). Before
// sql/095 is applied these routes answer 503 not_set_up (the app's missing-schema handler).

const GROUP_CODE_RE = /^[A-Z0-9]{1,10}$/;
export type CodeRule = { rule: 'typed' | 'prefix' | 'group'; separator: '-' | '.' | '/'; digits: number };

type GroupRow = { id: string; parent_id: string | null; code: string; name: string; name_ar: string | null; active: boolean };
const toGroup = (g: GroupRow) => ({
  id: g.id,
  parentId: g.parent_id,
  code: g.code,
  name: g.name,
  nameAr: g.name_ar ?? '',
  active: g.active,
});

function optionalId(raw: unknown, what: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) invalid(`${what} must be an id or null`);
  return raw as string;
}

function groupFields(body: Record<string, unknown>) {
  const code = text(body.code).toUpperCase();
  const name = text(body.name);
  if (!GROUP_CODE_RE.test(code)) invalid('A group code is letters and digits, up to 10');
  if (!name || name.length > 120) invalid('A group name (up to 120 characters) is required');
  const nameAr = text(body.nameAr);
  if (nameAr.length > 120) invalid('The Arabic name is up to 120 characters');
  return { code, name, nameAr: nameAr || null };
}

export function registerGroupRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/item-groups', requirePermission('inventory.items.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_item_groups')
      .select('id, parent_id, code, name, name_ar, active')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('code');
    if (error) throw error;
    return ok(c, ((data ?? []) as GroupRow[]).map(toGroup));
  });

  inventoryRoutes.post('/item-groups', requirePermission('inventory.groups.manage'), async (c) => {
    const body = await jsonBody(c);
    const f = groupFields(body);
    const parentId = optionalId(body.parentId, 'parentId');
    const id = await callRpc<string>(userDb(c), 'inv_create_item_group', {
      p_parent_id: parentId,
      p_code: f.code,
      p_name: f.name,
      p_name_ar: f.nameAr,
    });
    return ok(c, { id, parentId, code: f.code, name: f.name, nameAr: f.nameAr ?? '', active: true }, 201);
  });

  // Change the code, names or whether the group takes new items. Items already coded keep their codes.
  inventoryRoutes.put('/item-groups/:id', requirePermission('inventory.groups.manage'), async (c) => {
    const body = await jsonBody(c);
    const f = groupFields(body);
    const active = body.active !== false;
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_update_item_group', {
      p_group_id: id,
      p_code: f.code,
      p_name: f.name,
      p_name_ar: f.nameAr,
      p_active: active,
    });
    return ok(c, { id, code: f.code, name: f.name, nameAr: f.nameAr ?? '', active });
  });

  inventoryRoutes.put('/item-groups/:id/parent', requirePermission('inventory.groups.manage'), async (c) => {
    const id = idParam(c);
    const parentId = optionalId((await jsonBody(c)).parentId, 'parentId');
    await callRpc<void>(userDb(c), 'inv_move_item_group', { p_group_id: id, p_parent_id: parentId });
    return ok(c, { id, parentId });
  });

  inventoryRoutes.delete('/item-groups/:id', requirePermission('inventory.groups.manage'), async (c) => {
    await callRpc<void>(userDb(c), 'inv_delete_item_group', { p_group_id: idParam(c) });
    return ok(c, { removed: true });
  });

  // Put an item in a group (or none). The item keeps its code.
  inventoryRoutes.put('/items/:id/group', requirePermission('inventory.items.manage'), async (c) => {
    const id = idParam(c);
    const groupId = optionalId((await jsonBody(c)).groupId, 'groupId');
    await callRpc<void>(userDb(c), 'inv_set_item_group', { p_item_id: id, p_group_id: groupId });
    return ok(c, { id, groupId });
  });

  // The rule in force and the next code (?groupId= for the group rule). A viewer sees the rule without a next code.
  inventoryRoutes.get('/item-code-rule', requirePermission('inventory.items.read'), async (c) => {
    const groupId = optionalId(c.req.query('groupId'), 'groupId');
    const rule = await callRpc<CodeRule & { format: { prefix: string; digits: number } | null }>(userDb(c), 'inv_item_code_rule', {});
    let next: string | null = null;
    try {
      next = await callRpc<string | null>(userDb(c), 'inv_next_item_code', { p_group_id: groupId });
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 403) throw err;
    }
    return ok(c, {
      rule: rule.rule,
      separator: rule.separator,
      digits: Number(rule.digits),
      format: rule.format ?? null,
      next,
    });
  });

  // Choose the rule: typed, prefix (the format from /sku-format) or group codes. Owners and admins; audited.
  inventoryRoutes.put('/item-code-rule', requirePermission('inventory.groups.manage'), async (c) => {
    const body = await jsonBody(c);
    const rule = text(body.rule);
    const separator = body.separator === undefined ? '-' : text(body.separator);
    const digits = body.digits === undefined ? 3 : Number(body.digits);
    if (!['typed', 'prefix', 'group'].includes(rule)) invalid('The rule is typed, prefix or group');
    if (!['-', '.', '/'].includes(separator)) invalid('The separator is - . or /');
    if (!Number.isInteger(digits) || digits < 1 || digits > 8) invalid('Digits must be a whole number from 1 to 8');
    const saved = await callRpc<CodeRule>(userDb(c), 'inv_set_item_code_rule', {
      p_rule: rule,
      p_separator: separator,
      p_digits: digits,
    });
    return ok(c, { rule: saved.rule, separator: saved.separator, digits: Number(saved.digits) });
  });
}
