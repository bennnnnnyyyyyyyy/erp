import type { Bindings } from '../env';
import { adminDb } from '../lib/db.admin';
import { adapterFor, type OutboxMessage } from '../lib/channels';

// The delivery and chasing job. Runs on a schedule (wrangler.toml cron) and on demand from
// POST /v1/messaging/process. It uses the admin client because it acts for the system, not for a person, and only
// calls the service-role database functions from sql/007: queue reminders and escalations, hand out due messages,
// send each through its channel adapter, record the result. The database does the retry, backoff and expiry.

export type OutboxPassResult = { reminders: number; escalations: number; claimed: number; sent: number; failed: number };

export async function runOutboxPass(env: Bindings, opts: { orgId?: string; limit?: number } = {}): Promise<OutboxPassResult> {
  const client = adminDb(env);

  const chase = await client.rpc('msg_run_chasing', { p_org: opts.orgId ?? null });
  if (chase.error) throw chase.error;
  const chased = (chase.data ?? {}) as { reminders?: number; escalations?: number };

  const claim = await client.rpc('msg_claim_due', { p_limit: opts.limit ?? 50 });
  if (claim.error) throw claim.error;
  const messages = (claim.data ?? []) as OutboxMessage[];

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    let error: string | null = null;
    try {
      await adapterFor(message.channel).send(message, env);
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    const done = await client.rpc('msg_complete', { p_id: message.id, p_ok: error === null, p_error: error });
    if (done.error) throw done.error;
    if (error === null) sent++;
    else failed++;
  }

  return { reminders: chased.reminders ?? 0, escalations: chased.escalations ?? 0, claimed: messages.length, sent, failed };
}
