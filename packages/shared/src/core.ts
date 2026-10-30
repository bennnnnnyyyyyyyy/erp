import type { Role } from './api';

// Types for the core module's API (/v1/core/...), shared by the API and the web app.

export const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type OrgSettings = {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
  dateFormat: DateFormat;
};

export type OrgSettingsUpdate = Partial<Pick<OrgSettings, 'name' | 'defaultCurrency' | 'timezone' | 'dateFormat'>>;

export type MemberStatus = 'active' | 'invited' | 'disabled';

export type Member = {
  /** Membership id; the path parameter for member routes. */
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  status: MemberStatus;
  joinedAt: string;
  lastSignInAt: string | null;
};

export type InviteRequest = { email: string; role: Role };

/** A pending invitation for someone who already has an account. They become a member only when they accept it. */
export type Invitation = { id: string; userId: string; email: string; role: Role; invitedBy: string; createdAt: string };

/** The invited person's own view of a pending invitation (read with `core_my_invitations`, sql/025). */
export type MyInvitation = { id: string; orgId: string; orgName: string; role: Role; invitedByName: string | null; createdAt: string };

/**
 * `added`: a new account was created and added; send them `inviteLink`.
 * `invited`: the email already had an account; they see the invitation after signing in and must accept it.
 */
export type InviteResult = { kind: 'added'; member: Member; inviteLink: string } | { kind: 'invited'; invitation: Invitation };

export type ModuleStatus = { key: string; name: string; description: string; suite: string; core: boolean; enabled: boolean };

export type AuditEntry = {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
};
