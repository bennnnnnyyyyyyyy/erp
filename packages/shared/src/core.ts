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

/** `inviteLink` is null when the person already had an account and was simply added. */
export type InviteResult = { member: Member; inviteLink: string | null };

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
