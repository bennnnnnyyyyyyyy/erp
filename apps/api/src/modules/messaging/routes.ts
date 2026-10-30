import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { runOutboxPass } from '../../jobs/outbox';
import { requirePermission } from '../../middleware/tenant';

// Notifications (each person's own inbox) and the outbox (delivery status, owners and admins only; the database
// enforces both, these permission keys only give an early, clear refusal).

export const messagingRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

messagingRoutes.get('/notifications', requirePermission('messaging.notifications.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('msg_notifications')
    .select('id, title, body, entity_type, entity_id, read_at, created_at')
    .eq('org_id', c.var.tenant.orgId)
    .eq('user_id', c.var.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const items = ((data ?? []) as { id: string; title: string; body: string; entity_type: string | null; entity_id: string | null; read_at: string | null; created_at: string }[]).map((n) => ({
    id: n.id, title: n.title, body: n.body, entityType: n.entity_type, entityId: n.entity_id, readAt: n.read_at, createdAt: n.created_at,
  }));
  return ok(c, { items, unread: items.filter((n) => !n.readAt).length });
});

messagingRoutes.post('/notifications/read', requirePermission('messaging.notifications.read'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null;
  const changed = await callRpc<number>(userDb(c), 'msg_mark_read', { p_notification_id: id });
  return ok(c, { changed });
});

messagingRoutes.get('/outbox', requirePermission('messaging.outbox.manage'), async (c) => {
  const { data, error } = await userDb(c)
    .from('msg_outbox')
    .select('id, recipient_id, channel, kind, subject, status, attempts, max_attempts, next_attempt_at, expires_at, last_error, sent_at, created_at')
    .eq('org_id', c.var.tenant.orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  type Row = { id: string; recipient_id: string; channel: string; kind: string; subject: string; status: string; attempts: number; max_attempts: number; next_attempt_at: string; expires_at: string; last_error: string | null; sent_at: string | null; created_at: string };
  return ok(c, ((data ?? []) as Row[]).map((m) => ({
    id: m.id, recipientId: m.recipient_id, channel: m.channel, kind: m.kind, subject: m.subject, status: m.status, attempts: m.attempts,
    maxAttempts: m.max_attempts, nextAttemptAt: m.next_attempt_at, expiresAt: m.expires_at, lastError: m.last_error, sentAt: m.sent_at, createdAt: m.created_at,
  })));
});

// Runs one delivery and chasing pass now (the scheduled job does the same every five minutes). Owners and admins only.
messagingRoutes.post('/process', requirePermission('messaging.outbox.manage'), async (c) => ok(c, await runOutboxPass(c.env, { orgId: c.var.tenant.orgId })));

// ---- connect a phone (sql/008): the person starts binding, a one-time code is sent to that number through the outbox,
// they type it back. Only the person's own bindings are visible. The code itself is never readable by anyone.
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

messagingRoutes.get('/identities', requirePermission('messaging.notifications.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('msg_identities')
    .select('id, channel, address, status, verified_at, created_at')
    .eq('org_id', c.var.tenant.orgId)
    .eq('user_id', c.var.user.id)
    .neq('status', 'revoked')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ok(c, (data ?? []).map((i) => ({ id: i.id, channel: i.channel, address: i.address, status: i.status, verifiedAt: i.verified_at, createdAt: i.created_at })));
});

messagingRoutes.post('/identities', requirePermission('messaging.notifications.read'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { channel?: unknown; address?: unknown };
  const channel = typeof body.channel === 'string' ? body.channel : 'whatsapp';
  const address = typeof body.address === 'string' ? body.address.replace(/[\s()-]/g, '') : '';
  if (channel !== 'whatsapp' || !PHONE_RE.test(address)) throw new HttpError(400, 'Enter the number with its country code, for example +201001234567', 'invalid_input');
  const id = await callRpc<string>(userDb(c), 'msg_identity_start', { p_channel: channel, p_address: address });
  return ok(c, { id }, 201);
});

messagingRoutes.post('/identities/:id/confirm', requirePermission('messaging.notifications.read'), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!UUID_RE.test(id) || !/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code', 'invalid_input');
  const confirmed = await callRpc<boolean>(userDb(c), 'msg_identity_confirm', { p_identity_id: id, p_code: code });
  return ok(c, { confirmed });
});

messagingRoutes.post('/identities/:id/revoke', requirePermission('messaging.notifications.read'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  await callRpc(userDb(c), 'msg_identity_revoke', { p_identity_id: id });
  return ok(c, { id });
});