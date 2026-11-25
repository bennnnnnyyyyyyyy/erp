import type { Context, Hono } from 'hono';
import {
  DOC_LAYOUTS,
  DOC_LANGUAGES,
  DOC_SEND_CHANNELS,
  DOC_SEND_MODES,
  PRINT_DOC_TYPES,
  SEND_DOC_TYPES,
  looksLikeEmail,
  waPhone,
  type DocPrintData,
  type DocQueueStatus,
  type PrintDocType,
  type SendDocType,
} from '@erp/shared';
import type { AppEnv } from '../../env';
import { ISO_DAY, invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { whatsappDocReady } from '../../lib/whatsapp';
import { requirePermission } from '../../middleware/tenant';

// Invoice printing, step 1c (documentation/plans/INVOICE_PRINTING_PLAN.md; sql/103). Draft invoices (no number until issued), the print
// data of a draft, invoice or note (one builder in the database), the customer link, and the record of each send. The PDF itself is made
// in the person's browser for now. Every rule (owners and admins issue, an issued invoice never changes, a link only for an issued
// invoice or approved note) is in the database; these routes only check the permission early and shape the input.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = ISO_DAY; // a real day, years 1900-2100 (lib/body.ts)
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
}
function printType(c: Context<AppEnv>): PrintDocType {
  const t = c.req.param('type') ?? '';
  if (!(PRINT_DOC_TYPES as readonly string[]).includes(t)) throw new HttpError(404, 'Not found', 'not_found');
  return t as PrintDocType;
}
function sendType(c: Context<AppEnv>): SendDocType {
  const t = c.req.param('type') ?? '';
  if (!(SEND_DOC_TYPES as readonly string[]).includes(t)) throw new HttpError(404, 'Not found', 'not_found');
  return t as SendDocType;
}

/**
 * The web app's address for the customer link in a message sent from the company (sql/107): the calling app when it is on the allowed
 * list, else the first allowed one. Never taken from the request body.
 */
function appOrigin(c: Context<AppEnv>): string {
  const allowed = c.env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = c.req.header('Origin');
  return origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
}

/** Draft lines from a request body: [{ orderLineId, qty, taxRateId? }]. Bad lines are refused, not dropped. */
function draftLines(raw: unknown): { orderLineId: string; qty: number; taxRateId?: string }[] {
  if (!Array.isArray(raw) || raw.length === 0) invalid('Add at least one line');
  return (raw as unknown[]).map((v) => {
    const l = (v ?? {}) as Record<string, unknown>;
    const orderLineId = text(l.orderLineId);
    const qty = Number(l.qty);
    const taxRateId = text(l.taxRateId);
    if (!UUID_RE.test(orderLineId) || !Number.isFinite(qty) || qty <= 0) invalid('Each line needs an order line and a quantity above zero');
    if (taxRateId && taxRateId !== 'exempt' && !UUID_RE.test(taxRateId)) invalid('taxRateId must be a tax rate id or "exempt"');
    return { orderLineId, qty, ...(taxRateId ? { taxRateId } : {}) };
  });
}

type DraftRow = {
  id: string;
  order_id: string;
  customer_id: string;
  invoice_date: string;
  currency: string;
  status: string;
  invoice_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type DraftLineRow = { draft_id: string; order_line_id: string; qty: number | string; tax_choice: string | null };

export function registerPrintRoutes(r: Hono<AppEnv>) {
  // ---- drafts
  // Open drafts (newest first), optionally for one order. Issued and discarded drafts are history, not listed.
  r.get('/invoice-drafts', requirePermission('sales.invoices.read'), async (c) => {
    const orderId = c.req.query('orderId') ?? '';
    let q = userDb(c).from('sal_invoice_drafts').select('*').eq('org_id', orgOf(c)).eq('status', 'draft').is('deleted_at', null);
    if (orderId) {
      if (!UUID_RE.test(orderId)) invalid('orderId must be an id');
      q = q.eq('order_id', orderId);
    }
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const rows = (data ?? []) as DraftRow[];
    const byDraft = new Map<string, { orderLineId: string; qty: number; taxRateId: string | null }[]>();
    if (rows.length) {
      const { data: ls, error: le } = await userDb(c)
        .from('sal_invoice_draft_lines')
        .select('draft_id, order_line_id, qty, tax_choice')
        .eq('org_id', orgOf(c))
        .in(
          'draft_id',
          rows.map((d) => d.id),
        );
      if (le) throw le;
      for (const l of (ls ?? []) as DraftLineRow[]) {
        const a = byDraft.get(l.draft_id) ?? [];
        a.push({ orderLineId: l.order_line_id, qty: Number(l.qty), taxRateId: l.tax_choice });
        byDraft.set(l.draft_id, a);
      }
    }
    return ok(
      c,
      rows.map((d) => ({
        id: d.id,
        orderId: d.order_id,
        customerId: d.customer_id,
        invoiceDate: d.invoice_date,
        currency: d.currency,
        status: d.status,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        lines: byDraft.get(d.id) ?? [],
      })),
    );
  });

  // Save a draft: a new one, or the same draft again with { draftId } (its lines are replaced).
  r.post('/invoice-drafts', requirePermission('sales.invoices.manage'), async (c) => {
    const b = await jsonBody(c);
    const draftId = text(b.draftId);
    const orderId = text(b.orderId);
    const date = text(b.invoiceDate);
    if (draftId && !UUID_RE.test(draftId)) invalid('draftId must be an id');
    if (!UUID_RE.test(orderId)) invalid('Choose a delivered sales order');
    if (!DATE_RE.test(date)) invalid('An invoice date is required');
    const saved = await callRpc<{ id: string; status: string }>(userDb(c), 'sal_save_invoice_draft', {
      p_draft_id: draftId || null,
      p_order_id: orderId,
      p_invoice_date: date,
      p_lines: draftLines(b.lines),
    });
    return ok(c, saved, draftId ? 200 : 201);
  });

  r.post('/invoice-drafts/:id/issue', requirePermission('sales.invoices.manage'), async (c) => {
    const made = await callRpc<{ id: string; number: string; draftId: string }>(userDb(c), 'sal_issue_invoice_draft', {
      p_draft_id: idParam(c),
    });
    return ok(c, made, 201);
  });

  r.post('/invoice-drafts/:id/discard', requirePermission('sales.invoices.manage'), async (c) => {
    const id = idParam(c);
    await callRpc(userDb(c), 'sal_discard_invoice_draft', { p_draft_id: id });
    return ok(c, { id, status: 'discarded' });
  });

  // ---- print data (draft, invoice or note), from the one builder in the database
  r.get('/print/:type/:id', requirePermission('sales.invoices.read'), async (c) => {
    const data = await callRpc<DocPrintData>(userDb(c), 'sal_doc_print_data', { p_type: printType(c), p_id: idParam(c) });
    c.header('Cache-Control', 'no-store');
    return ok(c, data);
  });

  // ---- the customer link
  r.get('/documents/:type/:id/link', requirePermission('sales.invoices.read'), async (c) => {
    const status = await callRpc<{ active: boolean; createdAt?: string; readCount?: number; lastReadAt?: string | null }>(
      userDb(c),
      'sal_doc_link_status',
      { p_doc_type: sendType(c), p_doc_id: idParam(c) },
    );
    return ok(c, status);
  });

  // The working link, or a new one with { new: true } (the old one then stops working). The token comes back; the web app builds the
  // address on its own origin (/i/<token>), where the public page reads GET /i/<token> from this API.
  r.post('/documents/:type/:id/link', requirePermission('sales.invoices.send'), async (c) => {
    const b = await jsonBody(c);
    const link = await callRpc<{ token: string; createdAt: string; readCount: number; lastReadAt: string | null }>(
      userDb(c),
      'sal_doc_link',
      {
        p_doc_type: sendType(c),
        p_doc_id: idParam(c),
        p_new: b.new === true,
      },
    );
    c.header('Cache-Control', 'no-store');
    return ok(c, link);
  });

  r.post('/documents/:type/:id/link/revoke', requirePermission('sales.invoices.send'), async (c) => {
    await callRpc(userDb(c), 'sal_revoke_doc_link', { p_doc_type: sendType(c), p_doc_id: idParam(c) });
    return ok(c, { active: false });
  });

  // ---- send records
  r.get('/documents/:type/:id/sends', requirePermission('sales.invoices.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('core_doc_sends')
      .select('id, channel, mode, recipient, layout, language, sent_by, sent_at')
      .eq('org_id', orgOf(c))
      .eq('doc_type', sendType(c))
      .eq('doc_id', idParam(c))
      .order('sent_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok(
      c,
      (data ?? []).map((s) => ({
        id: s.id,
        channel: s.channel,
        mode: s.mode,
        recipient: s.recipient,
        layout: s.layout,
        language: s.language,
        sentBy: s.sent_by,
        sentAt: s.sent_at,
      })),
    );
  });

  // ---- sending from the company (sql/107): the message goes into the queue and the delivery job sends it (within about five minutes)
  r.get('/documents/:type/:id/queue', requirePermission('sales.invoices.read'), async (c) => {
    const status = await callRpc<Omit<DocQueueStatus, 'whatsappReady'>>(userDb(c), 'sal_doc_queue_status', {
      p_doc_type: sendType(c),
      p_doc_id: idParam(c),
    });
    c.header('Cache-Control', 'no-store');
    return ok(c, { ...status, whatsappReady: whatsappDocReady(c.env) } satisfies DocQueueStatus);
  });

  r.post('/documents/:type/:id/queue', requirePermission('sales.invoices.send'), async (c) => {
    const b = await jsonBody(c);
    const channel = text(b.channel);
    const layout = text(b.layout);
    const language = text(b.language);
    if (channel !== 'email' && channel !== 'whatsapp') invalid('Choose email or WhatsApp');
    if (layout && !(DOC_LAYOUTS as readonly string[]).includes(layout)) invalid('Unknown layout');
    if (language && !(DOC_LANGUAGES as readonly string[]).includes(language)) invalid('Unknown language');
    let to: string;
    if (channel === 'email') {
      to = text(b.to).toLowerCase();
      if (!looksLikeEmail(to) || to.length > 200) invalid("Type the customer's email address");
    } else {
      // WhatsApp needs the server set up and Meta's approved invoice template; until then the person sends from their own phone.
      if (!whatsappDocReady(c.env)) {
        throw new HttpError(409, 'WhatsApp sending from the company is not set up yet. Send from your own phone instead.', 'not_connected');
      }
      to = waPhone(text(b.to)) ?? '';
      if (!to) invalid("Type the customer's WhatsApp number");
    }
    const appUrl = appOrigin(c);
    if (!appUrl) throw new HttpError(503, 'The app address is not set on this server', 'not_set_up');
    const queued = await callRpc<{ outboxId: string; sendId?: string; duplicate: boolean }>(userDb(c), 'sal_queue_doc_send', {
      p_doc_type: sendType(c),
      p_doc_id: idParam(c),
      p_channel: channel,
      p_to: to,
      p_layout: layout || null,
      p_language: language || null,
      p_app_url: appUrl,
    });
    return ok(c, queued, queued.duplicate ? 200 : 201);
  });

  // Record that the person printed, downloaded, copied the link of, or sent an issued invoice or approved note from their own device.
  r.post('/documents/:type/:id/sends', requirePermission('sales.invoices.send'), async (c) => {
    const b = await jsonBody(c);
    const channel = text(b.channel);
    const mode = text(b.mode) || 'device';
    const recipient = text(b.recipient);
    const layout = text(b.layout);
    const language = text(b.language);
    if (!(DOC_SEND_CHANNELS as readonly string[]).includes(channel)) invalid('Choose how it was sent');
    if (!(DOC_SEND_MODES as readonly string[]).includes(mode)) invalid('mode must be device or queue');
    // A send from the company is recorded only by POST .../queue (sql/107), together with its message.
    if (mode !== 'device') invalid('Use the send from the company for that');
    if (recipient.length > 200) invalid('The recipient is too long');
    if (layout && !(DOC_LAYOUTS as readonly string[]).includes(layout)) invalid('Unknown layout');
    if (language && !(DOC_LANGUAGES as readonly string[]).includes(language)) invalid('Unknown language');
    const id = await callRpc<string>(userDb(c), 'sal_record_doc_send', {
      p_doc_type: sendType(c),
      p_doc_id: idParam(c),
      p_channel: channel,
      p_mode: mode,
      p_recipient: recipient || null,
      p_layout: layout || null,
      p_language: language || null,
    });
    return ok(c, { id }, 201);
  });
}
