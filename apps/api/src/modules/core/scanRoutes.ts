import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// The phone as a barcode scanner for the computer (sql/115; .temp/2026-11-25-phone-scanner-plan.md, Ben's answers 25 Nov 2026).
// The computer's order form starts a session and shows a QR with a random code; the phone, signed in as the same person in the same
// company, sends barcodes; the computer polls them every 1.5 s and adds the items to the form. Every call uses the person's own
// sign-in (no master key); the database checks the person, the company and the expiry. Before sql/115: 503 not_set_up.
export const scanRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[0-9a-f]{64}$/;
const BARCODE_RE = /^[ -~]{1,64}$/;

const code = (v: unknown): string => {
  if (typeof v !== 'string' || !CODE_RE.test(v)) invalid('This scanner link is not valid');
  return v as string;
};
const sessionId = (v: string | undefined): string => {
  if (!v || !UUID_RE.test(v)) invalid('Unknown scanner session');
  return v as string;
};

// Start (computer): { form: 'sales_order' | 'purchase_order' } -> { sessionId, code, form, expiresAt }
scanRoutes.post('/', requirePermission('core.scanner.use'), async (c) => {
  const b = await jsonBody(c);
  if (b.form !== 'sales_order' && b.form !== 'purchase_order') invalid('Unknown form');
  return ok(c, await callRpc<Record<string, unknown>>(userDb(c), 'core_scan_start', { p_form: b.form }), 201);
});

// Join (phone): { code } -> { sessionId, form, expiresAt, scans }
scanRoutes.post('/join', requirePermission('core.scanner.use'), async (c) => {
  const b = await jsonBody(c);
  return ok(c, await callRpc<Record<string, unknown>>(userDb(c), 'core_scan_join', { p_code: code(b.code) }));
});

// One barcode (phone): { code, barcode }
scanRoutes.post('/scans', requirePermission('core.scanner.use'), async (c) => {
  const b = await jsonBody(c);
  const barcode = typeof b.barcode === 'string' ? b.barcode.trim() : '';
  if (!BARCODE_RE.test(barcode)) invalid('Not a barcode');
  return ok(c, await callRpc<Record<string, unknown>>(userDb(c), 'core_scan_add', { p_code: code(b.code), p_barcode: barcode }), 201);
});

// New scans (computer): ?after=<last id> -> { open, expiresAt, scans: [{ id, barcode }] }
scanRoutes.get('/:id/scans', requirePermission('core.scanner.use'), async (c) => {
  const after = Number(c.req.query('after') ?? 0);
  return ok(
    c,
    await callRpc<Record<string, unknown>>(userDb(c), 'core_scan_poll', {
      p_session_id: sessionId(c.req.param('id')),
      p_after: Number.isSafeInteger(after) && after > 0 ? after : 0,
    }),
  );
});

// Stop (computer).
scanRoutes.post('/:id/end', requirePermission('core.scanner.use'), async (c) => {
  const id = sessionId(c.req.param('id'));
  await callRpc<void>(userDb(c), 'core_scan_end', { p_session_id: id });
  return ok(c, { ended: id });
});
