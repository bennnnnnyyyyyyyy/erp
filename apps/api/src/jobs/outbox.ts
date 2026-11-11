import type { Bindings } from '../env';
import { adminDb } from '../lib/db.admin';
import { adapterFor, type OutboxMessage } from '../lib/channels';

// The delivery and chasing job. Runs on a schedule (wrangler.toml cron) and on demand from
// POST /v1/messaging/process. It uses the admin client because it acts for the system, not for a person, and only
// calls the service-role database functions from sql/007: queue reminders and escalations, hand out due messages,
// send each through its channel adapter, record the result. The database does the retry, backoff and expiry.

export type OutboxPassResult = {
  reminders: number;
  escalations: number;
  lowStock: number;
  alerts: number;
  claimed: number;
  sent: number;
  failed: number;
  auditCheck: 'skipped' | 'clean' | 'BROKEN' | 'error';
  /** Set when a result could not be recorded: sending stopped there, and the rest of the batch waits for the next pass. */
  stoppedOnError: string | null;
};

type RpcResult = { error: { message: string } | null };
export type CompletionDeps = {
  complete: () => PromiseLike<RpcResult>;
  /** The message's current status, or null when it cannot be read. */
  status: () => PromiseLike<string | null>;
  wait: (ms: number) => Promise<void>;
};

/**
 * Records one delivery result, retrying a failed write (repo audit 2026-11-06, N1). A failed call is ambiguous: the write may have
 * committed and only the answer was lost. msg_complete then refuses a retry with INVALID_STATE (the row is no longer `sending`), so
 * INVALID_STATE is checked against the row: anything but `sending` means the result is already recorded. Returns the error text
 * when it still cannot be recorded, so the caller stops sending instead of delivering more messages it cannot record.
 */
export async function recordDelivery(deps: CompletionDeps, attempts = 3): Promise<string | null> {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await deps.wait(250 * i);
    const r = await deps.complete();
    if (!r.error) return null;
    last = r.error.message;
    if (/INVALID_STATE/.test(last)) {
      const status = await deps.status();
      if (status !== null && status !== 'sending') return null;
    }
  }
  return last.slice(0, 300) || 'could not record the delivery result';
}

export async function runOutboxPass(env: Bindings, opts: { orgId?: string; limit?: number } = {}): Promise<OutboxPassResult> {
  const client = adminDb(env);

  const chase = await client.rpc('msg_run_chasing', { p_org: opts.orgId ?? null });
  if (chase.error) throw chase.error;
  const chased = (chase.data ?? {}) as { reminders?: number; escalations?: number; low_stock?: number };

  // At most once an hour (the database skips the rest): verify every organization's audit chain; a break queues an alert to the owners.
  // Only the scheduled pass does this: an on-demand pass for one organization must not act for, or report on, the others.
  let auditCheck: OutboxPassResult['auditCheck'] = 'skipped';
  if (!opts.orgId) {
    const audit = await client.rpc('audit_check_all', { p_force: false });
    if (audit.error) {
      auditCheck = 'error';
      console.error('audit check failed', audit.error.message);
    } else {
      const a = (audit.data ?? {}) as { skipped?: boolean; broken?: unknown[] };
      auditCheck = a.skipped ? 'skipped' : (a.broken?.length ?? 0) > 0 ? 'BROKEN' : 'clean';
      if (auditCheck === 'BROKEN') console.error('AUDIT CHAIN BROKEN', JSON.stringify(a.broken));
    }
  }

  // Alert rules (sql/028): evaluate every enabled rule and queue messages. A failure here must not stop delivery.
  let alerts = 0;
  const rules = await client.rpc('alr_run', { p_org: opts.orgId ?? null });
  if (rules.error) console.error('alert rules failed', rules.error.message);
  else alerts = ((rules.data ?? {}) as { alerts?: number }).alerts ?? 0;

  const claim = opts.orgId
    ? await client.rpc('msg_claim_due_for_org', { p_org: opts.orgId, p_limit: opts.limit ?? 50 })
    : await client.rpc('msg_claim_due', { p_limit: opts.limit ?? 50 });
  if (claim.error) throw claim.error;
  const messages = (claim.data ?? []) as OutboxMessage[];

  let sent = 0;
  let failed = 0;
  let stoppedOnError: string | null = null;
  for (const message of messages) {
    let error: string | null = null;
    let via: string | null = null;
    try {
      via = (await adapterFor(message.channel).send(message, env)) ?? message.channel;
    } catch (e) {
      // Never store a web address: a channel's webhook URL is a secret (security review, 11 Nov 2026).
      error = (e instanceof Error ? e.message : String(e)).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[address]').slice(0, 300);
    }
    if (error === null) sent++;
    else failed++;
    // sql/053: records the result, how it was delivered (simulated, resend, slack-webhook …) and the integration's last outcome.
    // If it cannot be recorded, stop: sending more while the database is unreachable only multiplies the duplicates that the
    // five-minute recovery in msg_claim_due will resend. Delivery is at-least-once; the unsent rest of the batch is retried next pass.
    stoppedOnError = await recordDelivery({
      complete: () => client.rpc('msg_complete_delivery', { p_id: message.id, p_ok: error === null, p_error: error, p_via: via }),
      status: async () => {
        const row = await client.from('msg_outbox').select('status').eq('id', message.id).maybeSingle();
        return row.error || !row.data ? null : (row.data as { status: string }).status;
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    if (stoppedOnError) {
      console.error('outbox: delivery result not recorded, stopping this pass', message.id, stoppedOnError);
      break;
    }
  }

  return {
    reminders: chased.reminders ?? 0,
    escalations: chased.escalations ?? 0,
    lowStock: chased.low_stock ?? 0,
    alerts,
    claimed: messages.length,
    sent,
    failed,
    auditCheck,
    stoppedOnError,
  };
}
