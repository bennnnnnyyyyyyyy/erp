import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { adminDb } from './db.admin';

export type AuditEvent = {
  action: string;
  entityType: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  channel?: string;
};

// ADR-0003: changes to business data are audited by the database function that makes the change,
// in the same transaction (see sql/003). This helper is only for events that are not a database
// change made by a user-scoped function: Auth-admin paths such as member invites. It goes through
// the service-role-only `audit_append_admin` function, never a bare insert into audit_log.
export async function writeAudit(c: Context<AppEnv>, event: AuditEvent): Promise<void> {
  const { error } = await adminDb(c.env).rpc('audit_append_admin', {
    p_org_id: c.var.tenant.orgId,
    p_actor: c.var.user.id,
    p_action: event.action,
    p_entity_type: event.entityType,
    p_entity_id: event.entityId ?? null,
    p_summary: event.summary ?? null,
    p_before: event.before ?? null,
    p_after: event.after ?? null,
    p_metadata: event.metadata ?? {},
    p_channel: event.channel ?? 'api',
    p_request_id: c.req.header('X-Request-Id') ?? null,
  });
  if (error) throw error;
}
