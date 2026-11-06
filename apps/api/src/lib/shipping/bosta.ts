import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { callRpc } from '../rpc';
import { safeEqual } from '../whatsapp';

// Bosta shipments (sql/058). Two jobs, like lib/payments/links.ts:
//  1. createBostaDelivery: right after a signed-in person started a shipment for an order, ask Bosta to create the delivery and save
//     the tracking number. Keys come from sal__shipment_credentials (new real shipments only, within five minutes).
//  2. processBostaWebhook: Bosta's status webhook is unsigned, so the only protection is the secret header we told Bosta to send
//     (the company's saved webhook secret, found through our own reference). A valid update is handed to sal__apply_shipment_status,
//     which is idempotent and never touches stock or money.
// Unconfirmed until a Bosta test delivery: the exact body field names below (city code, receiver, webhook header setting). Documented
// by Bosta's pages (read in research): base address, the key in the Authorization header, delivery type send (10), state numbers.

export type BostaDeps = { fetch: typeof fetch };
export const realBostaDeps: BostaDeps = { fetch: (...a) => fetch(...a) };

const BOSTA_BASE = 'https://app.bosta.co/api/v2';

export type ShipmentInfo = {
  id: string;
  reference: string;
  simulated: boolean;
  orderNumber: string;
  codMinor: number;
  currency: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  address: string;
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

export async function createBostaDelivery(
  env: Bindings,
  db: SupabaseClient,
  s: ShipmentInfo,
  apiBase: string,
  deps: BostaDeps = realBostaDeps,
): Promise<{ tracking: string }> {
  const { data, error } = await adminDb(env).rpc('sal__shipment_credentials', { p_shipment_id: s.id });
  if (error) throw new Error('Could not read the Bosta settings');
  const c = (data as { credentials?: Record<string, string> } | null)?.credentials;
  if (!c?.api_key || !c.webhook_secret) throw new Error('Bosta is not ready: save its API key and webhook secret first');
  const [first, ...rest] = s.recipientName.trim().split(/\s+/);
  const res = await deps.fetch(`${BOSTA_BASE}/deliveries?apiVersion=1`, {
    method: 'POST',
    headers: { Authorization: c.api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 10,
      specs: { packageDetails: { description: `Order ${s.orderNumber}` } },
      dropOffAddress: { city: s.city, firstLine: s.address },
      receiver: { firstName: first || 'NA', lastName: rest.join(' ') || 'NA', phone: s.recipientPhone },
      cod: s.codMinor / 100,
      businessReference: s.reference,
      webhookUrl: `${apiBase}/webhooks/bosta`,
      webhookCustomHeaders: { Authorization: c.webhook_secret },
    }),
  });
  let j: Obj = {};
  try {
    const parsed = await res.json();
    if (isObj(parsed)) j = parsed;
  } catch {
    // keep the empty object; the status below decides
  }
  const tracking = typeof j.trackingNumber === 'string' ? j.trackingNumber : j.trackingNumber !== undefined ? String(j.trackingNumber) : '';
  if (!res.ok || !tracking) throw new Error(`Bosta refused the request (${res.status})`);
  await callRpc<void>(db, 'sal_shipment_set_tracking', { p_shipment_id: s.id, p_tracking: tracking });
  return { tracking };
}

export type BostaWebhookResult = { status: 200 | 400 | 401; body: Record<string, unknown> };

export async function processBostaWebhook(env: Bindings, raw: string, authHeader: string): Promise<BostaWebhookResult> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, body: { handled: 'invalid' } };
  }
  if (!isObj(body)) return { status: 400, body: { handled: 'invalid' } };
  const ref = typeof body.businessReference === 'string' ? body.businessReference : '';
  const state = Number(body.state);
  if (!ref || !Number.isInteger(state)) return { status: 200, body: { handled: 'ignored' } };
  const { data, error } = await adminDb(env).rpc('sal__shipment_callback_credentials', { p_reference: ref });
  if (error) throw new Error(error.message);
  const found = data as { simulated: boolean; credentials: Record<string, string> } | null;
  // unknown reference: plain 200 so Bosta stops retrying, and nothing is revealed
  if (!found) return { status: 200, body: { handled: 'ignored' } };
  const secret = found.credentials.webhook_secret;
  if (!secret || !authHeader || !safeEqual(authHeader, secret)) return { status: 401, body: { handled: 'bad_secret' } };
  const stamp = String(body.timeStamp ?? body.timestamp ?? body.updatedAt ?? '');
  const key = `${state}:${stamp || String(body.attemptsCount ?? '')}`;
  const { data: r, error: e2 } = await adminDb(env).rpc('sal__apply_shipment_status', {
    p_reference: ref,
    p_state_code: state,
    p_event_key: key,
    p_cod_minor: null,
    p_simulated: found.simulated,
  });
  if (e2) throw new Error(e2.message);
  return { status: 200, body: { handled: (r as { result?: string } | null)?.result ?? 'ok' } };
}
