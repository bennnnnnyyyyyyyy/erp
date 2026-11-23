import { type BillScanResult, SCANNED_BILL_INSTRUCTIONS, SCANNED_BILL_SCHEMA } from '@erp/shared';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { readWithAi } from '../../lib/aiService';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { MAX_UPLOAD, sha256Hex, sniffMime } from '../../lib/uploads';
import { KB, limitBody } from '../../middleware/bodyLimit';
import { requirePermission } from '../../middleware/tenant';
import { buildDraft, type Candidates, normalizeScannedBill, pickSupplier } from './billMatch';

// Scan a supplier bill (sql/108; SCANNING_PLAN.md step 1). Owners and admins (Ben, 23 Nov 2026). The company's own AI reads the picture
// or PDF; OUR code matches it (billMatch.ts); the answer is a draft. Nothing is saved here except the log of what the AI read: the person
// checks the draft and saves it with POST /supplier-invoices (pur_record_supplier_invoice), then attaches the file (POST /v1/core/attachments).
// No AI that reads documents → 503 not_set_up (lib/aiService.ts). Before sql/108 the database functions are missing → 503 not_set_up.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function candidates(c: Context<AppEnv>, tax: string | null, name: string | null, supplierId: string | null): Promise<Candidates> {
  const r = await callRpc<Candidates>(userDb(c), 'pur_bill_scan_candidates', { p_tax_number: tax, p_name: name, p_supplier: supplierId });
  return {
    suppliers: r.suppliers ?? [],
    supplierId: r.supplierId ?? null,
    receivedOrders: (r.receivedOrders ?? []).map((o) => ({
      ...o,
      lines: (o.lines ?? []).map((l) => ({
        ...l,
        receivedQty: Number(l.receivedQty),
        billedQty: Number(l.billedQty),
        unitCostMinor: Number(l.unitCostMinor),
        unitFactor: l.unitFactor === null ? null : Number(l.unitFactor),
        vatRate: l.vatRate === null ? null : Number(l.vatRate),
      })),
    })),
    waitingOrders: r.waitingOrders ?? [],
  };
}

/** Candidates for the supplier the bill names: by tax number (the database), else by name (here), then that supplier's orders. */
async function match(c: Context<AppEnv>, bill: ReturnType<typeof normalizeScannedBill>, supplierId: string | null, orderId: string | null) {
  let cands = await candidates(c, bill.supplierTaxNumber, bill.supplierName, supplierId);
  let supplier = supplierId ? { id: supplierId, how: 'name' as const } : pickSupplier(bill, cands);
  if (supplierId && !cands.suppliers.some((s) => s.id === supplierId)) supplier = null;
  if (supplier && cands.supplierId !== supplier.id) {
    const again = await candidates(c, bill.supplierTaxNumber, bill.supplierName, supplier.id);
    cands = { ...again, suppliers: cands.suppliers.some((s) => s.id === supplier?.id) ? cands.suppliers : again.suppliers };
  }
  if (supplier && supplierId) {
    const s = cands.suppliers.find((x) => x.id === supplierId);
    if (s?.how === 'tax') supplier = { id: supplierId, how: 'tax' };
  }
  return buildDraft(bill, cands, supplier, orderId);
}

export function registerBillScanRoutes(purchasingRoutes: Hono<AppEnv>) {
  // multipart: "file" (JPEG, PNG, WebP or PDF, at most 10 MB)
  purchasingRoutes.post('/bills/scan', requirePermission('purchasing.bills.scan'), limitBody(MAX_UPLOAD + 64 * KB), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const f = form?.get('file');
    if (!form || !(f instanceof File)) invalid('Send the picture or PDF as the form field "file"');
    const file = f as File;
    if (file.size === 0 || file.size > MAX_UPLOAD) throw new HttpError(413, 'The file must be between 1 byte and 10 MB', 'too_large');
    const bytes = await file.arrayBuffer();
    const mime = sniffMime(bytes);
    if (!mime) invalid('The file must be a JPEG, PNG or WebP picture, or a PDF');
    const sha256 = await sha256Hex(bytes);
    // Ask the database first: before sql/108 this is missing (503 not_set_up) and no AI money is spent.
    await candidates(c, null, null, null);

    // A refused or failed call is already in the AI usage log (provider, model, failed); only a reading is kept as an extraction.
    const read = await readWithAi(
      c.env,
      { orgId: c.var.tenant.orgId, userId: c.var.user.id },
      'bill_scan',
      { bytes, mime: mime as string },
      {
        instructions: SCANNED_BILL_INSTRUCTIONS,
        schemaName: 'supplier_bill',
        schema: SCANNED_BILL_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 6000,
      },
    );
    const bill = normalizeScannedBill(read.data);
    const extractionId = await callRpc<string>(userDb(c), 'pur_record_bill_scan', {
      p_provider: read.provider,
      p_model: read.model,
      p_status: 'done',
      p_result: bill,
      p_error: null,
      p_sha256: sha256,
      p_mime: mime,
      p_bytes: bytes.byteLength,
    });
    const draft = await match(c, bill, null, null);
    return ok<BillScanResult>(c, {
      extractionId,
      provider: read.provider,
      model: read.model,
      file: { sha256, mime: mime as string, bytes: bytes.byteLength },
      ...draft,
    });
  });

  // Match again after the person chose another supplier or order: no AI call, no cost. Body: { bill, supplierId?, orderId? }.
  purchasingRoutes.post('/bills/match', requirePermission('purchasing.bills.scan'), async (c) => {
    const b = await jsonBody(c);
    const supplierId = typeof b.supplierId === 'string' && UUID_RE.test(b.supplierId) ? b.supplierId : null;
    const orderId = typeof b.orderId === 'string' && UUID_RE.test(b.orderId) ? b.orderId : null;
    const bill = normalizeScannedBill(b.bill);
    return ok(c, await match(c, bill, supplierId, orderId));
  });
}
