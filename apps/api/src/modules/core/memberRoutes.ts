import { Hono, type Context } from 'hono';
import { ROLES, type Invitation, type InviteResult, type Member, type Role } from '@erp/shared';
import type { AppEnv } from '../../env';
import { createInvitedAccount, recoveryLink } from '../../lib/authAdmin';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Members and invitations (sql/025). Every check and audit row is in the database functions, called as the signed-in user;
// the secret key is used only for Supabase Auth account calls (lib/authAdmin.ts), after the database has said yes.

type Ctx = Context<AppEnv>;

type MemberRow = {
  id: string; user_id: string; role: Role; created_at: string; disabled_at: string | null;
  email: string; name: string | null; last_sign_in_at: string | null;
};
type InvitationRow = { id: string; user_id: string; email: string; role: Role; invited_by: string; created_at: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toMember(r: MemberRow): Member {
  return {
    id: r.id,
    userId: r.user_id,
    email: r.email ?? '',
    name: r.name,
    role: r.role,
    status: r.disabled_at ? 'disabled' : r.last_sign_in_at ? 'active' : 'invited',
    joinedAt: r.created_at,
    lastSignInAt: r.last_sign_in_at,
  };
}

const toInvitation = (r: InvitationRow): Invitation => ({ id: r.id, userId: r.user_id, email: r.email, role: r.role, invitedBy: r.invited_by, createdAt: r.created_at });

const idParam = (c: Ctx) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Member not found', 'not_found');
  return id;
};

async function loadMember(c: Ctx, id: string): Promise<Member> {
  const rows = await callRpc<MemberRow[]>(userDb(c), 'core_list_members');
  const row = rows.find((r) => r.id === id);
  if (!row) throw new HttpError(404, 'Member not found', 'not_found');
  return toMember(row);
}

/** Where invite and reset links send people: the calling app if it is an allowed origin. */
function appOrigin(c: Ctx): string {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const origin = c.req.header('Origin');
  return origin && allowed.includes(origin) ? origin : (allowed[0] ?? origin ?? '');
}

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.get('/', requirePermission('core.users.read'), async (c) => {
  const rows = await callRpc<MemberRow[]>(userDb(c), 'core_list_members');
  return ok(c, rows.map(toMember));
});

memberRoutes.get('/invitations', requirePermission('core.users.manage'), async (c) => {
  const rows = await callRpc<InvitationRow[]>(userDb(c), 'core_list_invitations');
  return ok(c, rows.map(toInvitation));
});

memberRoutes.post('/', requirePermission('core.users.manage'), async (c) => {
  const body = await jsonBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) invalid('Enter a valid email address');
  const role = body.role as Role;
  if (!ROLES.includes(role)) invalid(`Role must be one of ${ROLES.join(', ')}`);

  // An existing account only gets an invitation they must accept (it never becomes a member without consent).
  const step = await callRpc<{ kind: 'invitation' | 'needs_account'; id?: string }>(userDb(c), 'core_invite_member', { p_email: email, p_role: role });
  if (step.kind === 'invitation') {
    const rows = await callRpc<InvitationRow[]>(userDb(c), 'core_list_invitations');
    const row = rows.find((r) => r.id === step.id);
    if (!row) throw new HttpError(500, 'The invitation was not found after creating it');
    const result: InviteResult = { kind: 'invited', invitation: toInvitation(row) };
    return ok(c, result, 201);
  }

  // A new email: create the account (Auth admin), then the database checks it is this org's fresh account and adds it.
  const account = await createInvitedAccount(c.env, email, c.var.tenant.orgId, appOrigin(c));
  const membershipId = await callRpc<string>(userDb(c), 'core_add_invited_account', { p_user_id: account.userId, p_role: role });
  const result: InviteResult = { kind: 'added', member: await loadMember(c, membershipId), inviteLink: account.link };
  return ok(c, result, 201);
});

memberRoutes.delete('/invitations/:id', requirePermission('core.users.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'core_revoke_invitation', { p_invitation_id: id });
  return ok(c, { id, status: 'revoked' });
});

memberRoutes.patch('/:id', requirePermission('core.users.manage'), async (c) => {
  const id = idParam(c);
  const role = (await jsonBody(c)).role as Role;
  if (!ROLES.includes(role)) invalid(`Role must be one of ${ROLES.join(', ')}`);
  await callRpc<void>(userDb(c), 'core_set_member_role', { p_membership_id: id, p_role: role });
  return ok(c, await loadMember(c, id));
});

for (const action of ['disable', 'enable'] as const) {
  memberRoutes.post(`/:id/${action}`, requirePermission('core.users.manage'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'core_set_member_disabled', { p_membership_id: id, p_disabled: action === 'disable' });
    return ok(c, await loadMember(c, id));
  });
}

memberRoutes.post('/:id/invite-link', requirePermission('core.users.manage'), async (c) => {
  // A sign-in link is a credential. The database allows it only for an account this org created, that has never signed in
  // and belongs to no other organization, and audits the request.
  const target = await callRpc<{ user_id: string; email: string }>(userDb(c), 'core_invite_link_target', { p_membership_id: idParam(c) });
  return ok(c, { inviteLink: await recoveryLink(c.env, target.email, appOrigin(c)) });
});
