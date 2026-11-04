import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

// Credit and debit notes with approval (sql/037, documentation/plans/ETA_EINVOICING_PLAN.md slice A2). The rules (never credit more
// than was invoiced, a different person approves, no voiding an invoice with active notes) live in the database functions; these
// routes only check the permission early, shape the input and read the result back.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
}

type NoteRow = {
  id: string;
  number: string;
  kind: string;
  invoice_id: string;
  customer_id: string;
  currency: string;
  reason: string;
  status: string;
  total_minor: number;
  requester_id: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
};

async function loadNotes(c: Context<AppEnv>, id?: string) {
  const client = userDb(c);
  const org = orgOf(c);
  let q = client
    .from('sal_notes')
    .select(
      'id, number, kind, invoice_id, customer_id, currency, reason, status, total_minor, requester_id, decided_by, decided_at, decision_comment, created_at',
    )
    .eq('org_id', org)
    .order('created_at', { ascending: false })
    .limit(200);
  if (id) q = q.eq('id', id);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as NoteRow[];
  const ids = rows.map((r) => r.id);
  const lines = new Map<string, { invoiceLineId: string; qty: number; unitPriceMinor: number }[]>();
  const approvals = new Map<
    string,
    { approverId: string; decision: string; comment: string | null; channel: string; decidedAt: string }[]
  >();
  if (ids.length > 0) {
    const [l, a] = await Promise.all([
      client.from('sal_note_lines').select('note_id, invoice_line_id, qty, unit_price_minor').eq('org_id', org).in('note_id', ids),
      client
        .from('sal_note_approvals')
        .select('note_id, approver_id, decision, comment, channel, decided_at')
        .eq('org_id', org)
        .in('note_id', ids)
        .order('decided_at'),
    ]);
    if (l.error) throw l.error;
    if (a.error) throw a.error;
    for (const x of (l.data ?? []) as { note_id: string; invoice_line_id: string; qty: number; unit_price_minor: number }[]) {
      lines.set(x.note_id, [
        ...(lines.get(x.note_id) ?? []),
        { invoiceLineId: x.invoice_line_id, qty: Number(x.qty), unitPriceMinor: Number(x.unit_price_minor) },
      ]);
    }
    for (const x of (a.data ?? []) as {
      note_id: string;
      approver_id: string;
      decision: string;
      comment: string | null;
      channel: string;
      decided_at: string;
    }[]) {
      approvals.set(x.note_id, [
        ...(approvals.get(x.note_id) ?? []),
        { approverId: x.approver_id, decision: x.decision, comment: x.comment, channel: x.channel, decidedAt: x.decided_at },
      ]);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    invoiceId: r.invoice_id,
    customerId: r.customer_id,
    currency: r.currency,
    reason: r.reason,
    status: r.status,
    totalMinor: Number(r.total_minor),
    requesterId: r.requester_id,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionComment: r.decision_comment,
    createdAt: r.created_at,
    lines: lines.get(r.id) ?? [],
    approvals: approvals.get(r.id) ?? [],
  }));
}

async function oneNote(c: Context<AppEnv>, id: string) {
  const [note] = await loadNotes(c, id);
  if (!note) throw new HttpError(404, 'Note not found', 'not_found');
  return note;
}

export function registerNoteRoutes(routes: Hono<AppEnv>): void {
  routes.get('/notes', requirePermission('sales.notes.read'), async (c) => ok(c, await loadNotes(c)));
  routes.get('/notes/:id', requirePermission('sales.notes.read'), async (c) => ok(c, await oneNote(c, idParam(c))));

  routes.post('/invoices/:id/notes', requirePermission('sales.notes.create'), async (c) => {
    const invoiceId = idParam(c);
    const body = await jsonBody(c);
    const kind = text(body.kind);
    if (kind !== 'credit' && kind !== 'debit') invalid('Kind must be credit or debit');
    if (!text(body.reason)) invalid('A reason is required');
    const raw = Array.isArray(body.lines) ? body.lines : [];
    const lines = raw.map((v) => {
      const l = (v ?? {}) as Record<string, unknown>;
      const price = l.unitPriceMinor === undefined || l.unitPriceMinor === null ? undefined : Number(l.unitPriceMinor);
      return { invoiceLineId: text(l.invoiceLineId), qty: Number(l.qty), unitPriceMinor: price };
    });
    const bad = (l: { invoiceLineId: string; qty: number; unitPriceMinor: number | undefined }) =>
      !UUID_RE.test(l.invoiceLineId) ||
      !Number.isFinite(l.qty) ||
      l.qty <= 0 ||
      (l.unitPriceMinor !== undefined && (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0));
    if (lines.length === 0 || lines.some(bad))
      invalid('Add at least one line, each with an invoice line, a quantity above zero and (optionally) a whole-number price');
    const made = await callRpc<{ id: string; number: string }>(userDb(c), 'sal_submit_note', {
      p_invoice_id: invoiceId,
      p_kind: kind,
      p_reason: text(body.reason),
      p_lines: lines,
    });
    return ok(c, await oneNote(c, made.id), 201);
  });

  for (const [action, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    routes.post(`/notes/:id/${action}`, requirePermission('sales.notes.approve'), async (c) => {
      const id = idParam(c);
      const body = await c.req.json().catch(() => ({}));
      await callRpc<void>(userDb(c), 'sal_decide_note', {
        p_note_id: id,
        p_decision: decision,
        p_comment: text((body as Record<string, unknown>).comment) || null,
        p_channel: 'app',
      });
      return ok(c, await oneNote(c, id));
    });
  }

  routes.post('/notes/:id/cancel', requirePermission('sales.notes.create'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'sal_cancel_note', { p_note_id: id });
    return ok(c, await oneNote(c, id));
  });
}
