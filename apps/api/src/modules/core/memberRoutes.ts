import { Hono, type Context } from 'hono';
import type { User } from '@supabase/supabase-js';
import { ROLES, type InviteResult, type Member, type Role } from '@ggo/shared';
import type { AppEnv } from '../../env';
import { writeAudit } from '../../lib/audit';
import { invalid, jsonBody } from '../../lib/body';
import { db } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { refuseDisable, refuseInvite, refuseRoleChange } from './members';

type Ctx = Context<AppEnv>;

type MembershipRow = { id: string; user_id: string; role: Role; created_at: string; disabled_at: string | null };

const MEMBERSHIP_COLUMNS = 'id, user_id, role, created_at, disabled_at';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toMember(row: MembershipRow, user: User | null): Member {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
  return {
    id: row.id,
    userId: row.user_id,
    email: user?.email ?? '',
    name,
    role: row.role,
    status: row.disabled_at ? 'disabled' : user?.last_sign_in_at ? 'active' : 'invited',
    joinedAt: row.created_at,
    lastSignInAt: user?.last_sign_in_at ?? null,
  };
}

async function loadUser(c: Ctx, userId: string): Promise<User | null> {
  const { data, error } = await db(c.env).auth.admin.getUserById(userId);
  if (error) return null;
  return data.user;
}

async function loadMembership(c: Ctx, id: string): Promise<MembershipRow> {
  const { data, error } = await db(c.env)
    .from('memberships')
    .select(MEMBERSHIP_COLUMNS)
    .eq('org_id', c.var.tenant.orgId)
    .eq('id', id)
    .maybeSingle<MembershipRow>();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Member not found', 'not_found');
  return data;
}

async function countActiveOwners(c: Ctx): Promise<number> {
  const { count, error } = await db(c.env)
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', c.var.tenant.orgId)
    .eq('role', 'owner')
    .is('disabled_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Where invite and reset links send people: the calling app if it is an allowed origin. */
function appOrigin(c: Ctx): string {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const origin = c.req.header('Origin');
  return origin && allowed.includes(origin) ? origin : (allowed[0] ?? origin ?? '');
}

function actor(c: Ctx) {
  return { userId: c.var.user.id, role: c.var.tenant.role };
}

function refuse(reason: string | null) {
  if (reason) throw new HttpError(403, reason, 'not_allowed');
}

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.get('/', requirePermission('core.users.read'), async (c) => {
  const { data, error } = await db(c.env)
    .from('memberships')
    .select(MEMBERSHIP_COLUMNS)
    .eq('org_id', c.var.tenant.orgId)
    .order('created_at');
  if (error) throw error;
  const rows = (data ?? []) as MembershipRow[];
  // One Auth lookup per member. Fine for tens of members; revisit with a profiles table if orgs grow large.
  const users = await Promise.all(rows.map((r) => loadUser(c, r.user_id)));
  return ok(c, rows.map((r, i) => toMember(r, users[i] ?? null)));
});

memberRoutes.post('/', requirePermission('core.users.manage'), async (c) => {
  const body = await jsonBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) invalid('Enter a valid email address');
  const role = body.role as Role;
  if (!ROLES.includes(role)) invalid(`Role must be one of ${ROLES.join(', ')}`);
  refuse(refuseInvite(actor(c), role));

  const client = db(c.env);
  const orgId = c.var.tenant.orgId;
  const { data: existingId, error: lookupErr } = await client.rpc('find_auth_user_id', { p_email: email });
  if (lookupErr) {
    if (lookupErr.code === 'PGRST202') throw new HttpError(503, 'Run sql/002_core_user_lookup.sql first', 'migration_missing');
    throw lookupErr;
  }

  let userId: string;
  let inviteLink: string | null = null;
  if (existingId) {
    userId = existingId as string;
    const { data: already, error } = await client
      .from('memberships')
      .select('id, disabled_at')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle<{ id: string; disabled_at: string | null }>();
    if (error) throw error;
    if (already) {
      throw new HttpError(
        409,
        already.disabled_at ? 'This person is a disabled member. Re-enable them instead.' : 'This person is already a member',
        'already_member',
      );
    }
  } else {
    const { data, error } = await client.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: appOrigin(c) },
    });
    if (error) throw new HttpError(502, `Couldn't create the invite: ${error.message}`, 'invite_failed');
    userId = data.user.id;
    inviteLink = data.properties.action_link;
    // Records which org created the account, so only that org may issue it a new link later.
    const { error: metaErr } = await client.auth.admin.updateUserById(userId, { app_metadata: { invited_org_id: orgId } });
    if (metaErr) throw metaErr;
  }

  const { data: row, error: insErr } = await client
    .from('memberships')
    .insert({ org_id: orgId, user_id: userId, role, invited_by: c.var.user.id })
    .select(MEMBERSHIP_COLUMNS)
    .single<MembershipRow>();
  if (insErr) throw insErr;

  const member = toMember(row, await loadUser(c, userId));
  await writeAudit(c, {
    action: inviteLink ? 'member.invited' : 'member.added',
    entityType: 'membership',
    entityId: row.id,
    summary: `${email} ${inviteLink ? 'invited' : 'added'} as ${role}`,
    after: { email, role },
  });
  const result: InviteResult = { member, inviteLink };
  return ok(c, result, 201);
});

memberRoutes.patch('/:id', requirePermission('core.users.manage'), async (c) => {
  const body = await jsonBody(c);
  const role = body.role as Role;
  if (!ROLES.includes(role)) invalid(`Role must be one of ${ROLES.join(', ')}`);
  const target = await loadMembership(c, c.req.param('id'));
  if (target.role === role) return ok(c, toMember(target, await loadUser(c, target.user_id)));
  refuse(
    refuseRoleChange(actor(c), { userId: target.user_id, role: target.role, disabled: !!target.disabled_at }, role, await countActiveOwners(c)),
  );

  const { data, error } = await db(c.env)
    .from('memberships')
    .update({ role })
    .eq('org_id', c.var.tenant.orgId)
    .eq('id', target.id)
    .select(MEMBERSHIP_COLUMNS)
    .single<MembershipRow>();
  if (error) throw error;
  const member = toMember(data, await loadUser(c, data.user_id));
  await writeAudit(c, {
    action: 'member.role_changed',
    entityType: 'membership',
    entityId: target.id,
    summary: `${member.email} changed from ${target.role} to ${role}`,
    before: { role: target.role },
    after: { role },
  });
  return ok(c, member);
});

for (const action of ['disable', 'enable'] as const) {
  memberRoutes.post(`/:id/${action}`, requirePermission('core.users.manage'), async (c) => {
    const target = await loadMembership(c, c.req.param('id'));
    if (action === 'disable') {
      if (target.disabled_at) invalid('This member is already disabled');
      refuse(refuseDisable(actor(c), { userId: target.user_id, role: target.role, disabled: false }, await countActiveOwners(c)));
    } else {
      if (!target.disabled_at) invalid('This member is already active');
      if (target.role === 'owner' && c.var.tenant.role !== 'owner') refuse('Only an owner can re-enable an owner');
    }

    const { data, error } = await db(c.env)
      .from('memberships')
      .update({ disabled_at: action === 'disable' ? new Date().toISOString() : null })
      .eq('org_id', c.var.tenant.orgId)
      .eq('id', target.id)
      .select(MEMBERSHIP_COLUMNS)
      .single<MembershipRow>();
    if (error) throw error;
    const member = toMember(data, await loadUser(c, data.user_id));
    await writeAudit(c, {
      action: `member.${action}d`,
      entityType: 'membership',
      entityId: target.id,
      summary: `${member.email} ${action}d`,
    });
    return ok(c, member);
  });
}

memberRoutes.post('/:id/invite-link', requirePermission('core.users.manage'), async (c) => {
  const target = await loadMembership(c, c.req.param('id'));
  const user = await loadUser(c, target.user_id);
  // A sign-in link is a credential. Only issue one for an account this org created that has
  // never been used; anyone else resets their own password.
  if (!user?.email || user.last_sign_in_at || user.app_metadata?.invited_org_id !== c.var.tenant.orgId) {
    refuse('A new link can only be made for someone this organization invited who has not signed in yet');
  }
  const { data, error } = await db(c.env).auth.admin.generateLink({
    type: 'recovery',
    email: user!.email!,
    options: { redirectTo: appOrigin(c) },
  });
  if (error) throw new HttpError(502, `Couldn't create the link: ${error.message}`, 'invite_failed');
  await writeAudit(c, {
    action: 'member.invite_link_created',
    entityType: 'membership',
    entityId: target.id,
    summary: `New invite link made for ${user!.email}`,
  });
  return ok(c, { inviteLink: data.properties.action_link });
});
