import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { isObj, verifyHrSignature } from './hrClient';

// The HR & payroll app's webhook (sql/102; contract section 6). Master-key exception approved by Ben, 20 Nov 2026 (agents.md): no
// person is waiting. The company is found ONLY through our own connection id (X-ERP-Connection, made by us when the HR app card was
// saved), never through the body; nothing happens before the HMAC signature and its timestamp are verified with that company's
// signing secret. A webhook only records the event (replays answer "duplicate") and asks for a read: the data itself is always read
// from the HR app's API by the sync job, so the body is never trusted as data.

export type HrWebhookHeaders = { connection: string; eventId: string; timestamp: string; signature: string };
export type HrWebhookResult = { status: 200 | 400 | 401; body: { handled: 'ok' | 'ignored' | 'duplicate' | 'bad_signature' | 'invalid' } };

const CONNECTION_RE = /^hrc_[A-Za-z0-9]{24}$/;
const EVENT_TYPES = new Set([
  'ping',
  'branch.created',
  'branch.updated',
  'branch.deleted',
  'department.created',
  'department.updated',
  'department.deleted',
  'employee.created',
  'employee.updated',
  'employee.deleted',
  'sync.requested',
  'connection.revoked',
]);

export async function processHrWebhook(
  env: Bindings,
  raw: string,
  h: HrWebhookHeaders,
  nowMs: number = Date.now(),
): Promise<HrWebhookResult> {
  // unknown or malformed connection: a plain 200 so the sender stops retrying, and nothing is revealed
  if (!CONNECTION_RE.test(h.connection)) return { status: 200, body: { handled: 'ignored' } };
  const { data, error } = await adminDb(env).rpc('hr__accept_webhook', { p_connection_id: h.connection });
  if (error) throw new Error(error.message);
  const found = data as { orgId: string; secret: string | null } | null;
  if (!found) return { status: 200, body: { handled: 'ignored' } };
  if (!found.secret || !(await verifyHrSignature(found.secret, h.timestamp, h.signature, raw, nowMs)))
    return { status: 401, body: { handled: 'bad_signature' } };
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { handled: 'invalid' } };
  }
  if (!isObj(event) || typeof event.type !== 'string' || !/^[\w.-]{1,64}$/.test(h.eventId))
    return { status: 400, body: { handled: 'invalid' } };
  if (!EVENT_TYPES.has(event.type)) return { status: 200, body: { handled: 'ignored' } };
  const { data: r, error: e2 } = await adminDb(env).rpc('hr__record_webhook', {
    p_org: found.orgId,
    p_event_id: h.eventId,
    p_type: event.type,
  });
  if (e2) throw new Error(e2.message);
  return { status: 200, body: { handled: r === 'duplicate' ? 'duplicate' : 'ok' } };
}
