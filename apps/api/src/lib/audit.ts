import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { db } from './db';

export type AuditEvent = {
  action: string;
  entityType: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

/** Appends one row to `audit_log` for the caller's organization, as the signed-in user. */
export async function writeAudit(c: Context<AppEnv>, event: AuditEvent): Promise<void> {
  const { error } = await db(c.env)
    .from('audit_log')
    .insert({
      org_id: c.var.tenant.orgId,
      actor_user_id: c.var.user.id,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId ?? null,
      summary: event.summary ?? null,
      before: event.before ?? null,
      after: event.after ?? null,
      metadata: event.metadata ?? {},
    });
  if (error) throw error;
}
