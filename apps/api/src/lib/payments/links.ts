import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { callRpc } from '../rpc';

// Payment links (sql/057): Paymob and Fawry. Two jobs.
//  1. attachProviderAddress: right after a signed-in owner or admin created a link, ask the provider for the pay address (Paymob) or
//     reference number (Fawry). The keys come from fin__link_credentials, which only answers for a brand-new link of a live provider.
//  2. processPaymentCallback: the provider's signed callback is the source of truth. Verify the signature with that company's key
//     (found through our own reference), then hand the facts to fin__settle_payment_link, which re-checks amount, currency and the
//     invoice and records one payment, once. This file never records anything itself.
// Signature rules: Paymob's HMAC-SHA512 field list is from Paymob's developer page (read 6 Nov 2026). Fawry's V2 recipe matches what a
// third-party SDK states it took from Fawry's own page (Fawry's site could not be reached from here). Still unconfirmed until a provider
// test transaction runs: where Paymob puts our reference (we read order.merchant_order_id, which should hold special_reference) and
// whether the hmac arrives as a query value. Both are checked in the provider's test mode before a company goes live.

export type PaymentDeps = { fetch: typeof fetch };
export const realPaymentDeps: PaymentDeps = { fetch: (...a) => fetch(...a) };

const PAYMOB_BASE = 'https://accept.paymob.com';
const fawryBase = (env: Pick<Bindings, 'FAWRY_BASE_URL'>) => (env.FAWRY_BASE_URL || 'https://www.atfawry.com').replace(/\/+$/, '');

export const major = (minor: number) => (minor / 100).toFixed(2);
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
export async function hmacSha512Hex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
function equalText(a: string, b: string): boolean {
  const x = enc.encode(a.toLowerCase());
  const y = enc.encode(b.toLowerCase());
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ------------------------------------------------------------------ Paymob

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const dig = (o: Obj, path: string): unknown => path.split('.').reduce<unknown>((acc, k) => (isObj(acc) ? acc[k] : undefined), o);
const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// The 20 fields, in Paymob's order, joined with no separator.
export const PAYMOB_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

export const paymobHmacText = (obj: Obj) => PAYMOB_HMAC_FIELDS.map((f) => asText(dig(obj, f))).join('');

export type ParsedCallback = { ref: string; txn: string; amountMinor: number; currency: string; success: boolean; pending: boolean };

export function parsePaymobCallback(body: unknown): { obj: Obj; parsed: ParsedCallback } | null {
  if (!isObj(body) || !isObj(body.obj)) return null;
  const obj = body.obj;
  const ref = asText(dig(obj, 'order.merchant_order_id') || dig(obj, 'merchant_order_id'));
  const amount = Number(obj.amount_cents);
  if (!ref || !Number.isInteger(amount) || obj.id === undefined) return null;
  const refunded = obj.is_refunded === true || obj.is_voided === true;
  return {
    obj,
    parsed: {
      ref,
      txn: asText(obj.id),
      amountMinor: amount,
      currency: asText(obj.currency).toUpperCase(),
      success: obj.success === true && !refunded,
      pending: obj.pending === true,
    },
  };
}

// ------------------------------------------------------------------ Fawry

export async function fawryChargeSignature(p: {
  merchantCode: string;
  merchantRefNum: string;
  customerProfileId: string;
  paymentMethod: string;
  amount: string;
  itemId: string;
  quantity: number;
  price: string;
  secureKey: string;
}) {
  return sha256Hex(
    `${p.merchantCode}${p.merchantRefNum}${p.customerProfileId}${p.paymentMethod}${p.amount}${p.itemId}${p.quantity}${p.price}${p.secureKey}`,
  );
}

export async function fawryNotificationSignature(n: Obj, secureKey: string) {
  const amt = (v: unknown) => Number(v).toFixed(2);
  return sha256Hex(
    `${asText(n.fawryRefNumber)}${asText(n.merchantRefNumber)}${amt(n.paymentAmount)}${amt(n.orderAmount)}${asText(n.orderStatus)}${asText(n.paymentMethod)}${asText(n.paymentRefrenceNumber)}${secureKey}`,
  );
}

export function parseFawryCallback(body: unknown): ParsedCallback | null {
  if (!isObj(body)) return null;
  const ref = asText(body.merchantRefNumber);
  const txn = asText(body.fawryRefNumber);
  const amount = Math.round(Number(body.paymentAmount) * 100);
  if (!ref || !txn || !Number.isFinite(amount)) return null;
  const status = asText(body.orderStatus).toUpperCase();
  return {
    ref,
    txn,
    amountMinor: amount,
    currency: 'EGP',
    success: status === 'PAID',
    // anything that is not final (new, unpaid, partial) waits for the next notification
    pending: !['PAID', 'FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(status),
  };
}

// ------------------------------------------------------------------ creating the address

export type LinkInfo = {
  id: string;
  providerRef: string;
  simulated: boolean;
  amountMinor: number;
  currency: string;
  invoiceNumber: string;
};
export type Payer = { name: string; phone: string | null; email: string | null };

type Creds = Record<string, string>;
const split = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

async function readJson(res: Response): Promise<Obj> {
  try {
    const j = await res.json();
    return isObj(j) ? j : {};
  } catch {
    return {};
  }
}

/** Ask the provider for the pay address (Paymob) or reference number (Fawry) and save it on the link. Throws a short, secret-free message. */
export async function attachProviderAddress(
  env: Bindings,
  db: SupabaseClient,
  provider: 'paymob' | 'fawry',
  link: LinkInfo,
  payer: Payer,
  apiBase: string,
  deps: PaymentDeps = realPaymentDeps,
): Promise<{ url: string | null; reference: string | null }> {
  const { data, error } = await adminDb(env).rpc('fin__link_credentials', { p_link_id: link.id });
  if (error) throw new Error('Could not read the provider settings');
  const row = data as { credentials?: Creds } | null;
  const c = row?.credentials;
  if (!c) throw new Error('The provider is not ready: save its details first');

  if (provider === 'paymob') {
    const methods = split(c.integration_ids)
      .map(Number)
      .filter((n) => Number.isInteger(n));
    if (!c.secret_key || !c.public_key || !methods.length)
      throw new Error('Paymob needs the secret key, public key and payment method IDs');
    const [first, ...rest] = payer.name.split(' ');
    const res = await deps.fetch(`${PAYMOB_BASE}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${c.secret_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: link.amountMinor,
        currency: link.currency,
        payment_methods: methods,
        items: [
          { name: `Invoice ${link.invoiceNumber}`, amount: link.amountMinor, description: `Invoice ${link.invoiceNumber}`, quantity: 1 },
        ],
        billing_data: {
          first_name: first || 'NA',
          last_name: rest.join(' ') || 'NA',
          email: payer.email || 'NA',
          phone_number: payer.phone || 'NA',
        },
        special_reference: link.providerRef,
        notification_url: `${apiBase}/webhooks/paymob`,
      }),
    });
    const j = await readJson(res);
    const secret = typeof j.client_secret === 'string' ? j.client_secret : '';
    if (!res.ok || !secret) throw new Error(`Paymob refused the request (${res.status})`);
    const url = `${PAYMOB_BASE}/unifiedcheckout/?publicKey=${encodeURIComponent(c.public_key)}&clientSecret=${encodeURIComponent(secret)}`;
    await callRpc<void>(db, 'fin_payment_link_set_url', { p_link_id: link.id, p_url: url, p_provider_txn: null });
    return { url, reference: null };
  }

  if (!c.merchant_code || !c.secure_key) throw new Error('Fawry needs the merchant code and security key');
  if (!payer.phone && !payer.email) throw new Error("Fawry needs the customer's phone number or email on the customer record");
  const amount = major(link.amountMinor);
  const signature = await fawryChargeSignature({
    merchantCode: c.merchant_code,
    merchantRefNum: link.providerRef,
    customerProfileId: '',
    paymentMethod: 'PAYATFAWRY',
    amount,
    itemId: link.invoiceNumber,
    quantity: 1,
    price: amount,
    secureKey: c.secure_key,
  });
  const res = await deps.fetch(`${fawryBase(env)}/ECommerceWeb/Fawry/payments/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantCode: c.merchant_code,
      merchantRefNum: link.providerRef,
      customerName: payer.name,
      customerMobile: payer.phone ?? undefined,
      customerEmail: payer.email ?? undefined,
      paymentMethod: 'PAYATFAWRY',
      amount: Number(amount),
      currencyCode: link.currency,
      description: `Invoice ${link.invoiceNumber}`,
      chargeItems: [{ itemId: link.invoiceNumber, description: `Invoice ${link.invoiceNumber}`, price: Number(amount), quantity: 1 }],
      signature,
    }),
  });
  const j = await readJson(res);
  const ref = j.referenceNumber === undefined ? '' : String(j.referenceNumber);
  if (!res.ok || !ref || (j.statusCode !== undefined && Number(j.statusCode) !== 200))
    throw new Error(`Fawry refused the request (${res.status})`);
  await callRpc<void>(db, 'fin_payment_link_set_url', { p_link_id: link.id, p_url: null, p_provider_txn: ref });
  return { url: null, reference: ref };
}

// ------------------------------------------------------------------ callbacks

export type CallbackResult = { status: 200 | 400 | 401; body: Record<string, unknown> };

async function settle(env: Bindings, provider: 'paymob' | 'fawry', p: ParsedCallback, simulated: boolean): Promise<CallbackResult> {
  if (p.pending) return { status: 200, body: { handled: 'ignored' } };
  const { data, error } = await adminDb(env).rpc('fin__settle_payment_link', {
    p_provider: provider,
    p_ref: p.ref,
    p_txn: p.txn,
    p_amount_minor: p.amountMinor,
    p_currency: p.currency,
    p_success: p.success,
    p_simulated: simulated,
  });
  if (error) throw new Error(error.message);
  return { status: 200, body: { handled: (data as { result?: string } | null)?.result ?? 'ok' } };
}

async function credentialsFor(
  env: Bindings,
  provider: 'paymob' | 'fawry',
  ref: string,
): Promise<{ simulated: boolean; credentials: Creds } | null> {
  const { data, error } = await adminDb(env).rpc('fin__callback_credentials', { p_provider: provider, p_ref: ref });
  if (error) throw new Error(error.message);
  return (data as { simulated: boolean; credentials: Creds } | null) ?? null;
}

/** Paymob "transaction processed" callback: JSON body, signature in the hmac query value. */
export async function processPaymobCallback(env: Bindings, raw: string, hmac: string): Promise<CallbackResult> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, body: { handled: 'invalid' } };
  }
  const found = parsePaymobCallback(body);
  if (!found) return { status: 200, body: { handled: 'ignored' } };
  const creds = await credentialsFor(env, 'paymob', found.parsed.ref);
  // An unknown reference gets a plain 200 so the provider stops retrying, and tells a stranger nothing.
  if (!creds) return { status: 200, body: { handled: 'ignored' } };
  const secret = creds.credentials.hmac_secret;
  if (!secret || !hmac || !equalText(await hmacSha512Hex(secret, paymobHmacText(found.obj)), hmac))
    return { status: 401, body: { handled: 'bad_signature' } };
  return settle(env, 'paymob', found.parsed, creds.simulated);
}

/** Fawry server notification V2: JSON body carrying its own messageSignature. */
export async function processFawryCallback(env: Bindings, raw: string): Promise<CallbackResult> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, body: { handled: 'invalid' } };
  }
  const parsed = parseFawryCallback(body);
  if (!parsed || !isObj(body)) return { status: 200, body: { handled: 'ignored' } };
  const creds = await credentialsFor(env, 'fawry', parsed.ref);
  if (!creds) return { status: 200, body: { handled: 'ignored' } };
  const key = creds.credentials.secure_key;
  const sent = asText(body.messageSignature);
  if (!key || !sent || !equalText(await fawryNotificationSignature(body, key), sent))
    return { status: 401, body: { handled: 'bad_signature' } };
  return settle(env, 'fawry', parsed, creds.simulated);
}
