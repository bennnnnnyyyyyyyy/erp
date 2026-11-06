import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { safeEqual } from '../whatsapp';

// Shopify orders in (sql/059). Shopify signs every webhook with HMAC-SHA256 (base64) of the raw body, using the app's API secret key,
// in X-Shopify-Hmac-SHA256 (documented in Shopify's webhook pages, read in research on 6 Nov 2026). The company is found from
// X-Shopify-Shop-Domain, its secret is checked, and only then is the order handed to sal__ingest_shopify_order, which creates one open
// sales order (or holds the order for review) once per Shopify order. Nothing here moves stock or money.

const enc = new TextEncoder();

export async function shopifyHmacBase64(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

export type ShopifyHeaders = { shop: string; hmac: string; topic: string; webhookId: string };
export type ShopifyResult = { status: 200 | 400 | 401; body: Record<string, unknown> };

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const TOPICS = new Set(['orders/create', 'orders/paid']);

export async function processShopifyWebhook(env: Bindings, raw: string, h: ShopifyHeaders): Promise<ShopifyResult> {
  if (!SHOP_RE.test(h.shop)) return { status: 400, body: { handled: 'invalid' } };
  const { data, error } = await adminDb(env).rpc('sal__shopify_callback_credentials', { p_shop: h.shop });
  if (error) throw new Error(error.message);
  const found = data as { orgId: string; simulated: boolean; credentials: Record<string, string> } | null;
  // unknown shop: plain 200 so Shopify stops retrying, and nothing is revealed
  if (!found) return { status: 200, body: { handled: 'ignored' } };
  const secret = found.credentials.webhook_secret;
  if (!secret || !h.hmac || !safeEqual(await shopifyHmacBase64(secret, raw), h.hmac))
    return { status: 401, body: { handled: 'bad_signature' } };
  if (!TOPICS.has(h.topic)) return { status: 200, body: { handled: 'ignored' } };
  let order: unknown;
  try {
    order = JSON.parse(raw);
  } catch {
    return { status: 400, body: { handled: 'invalid' } };
  }
  if (typeof order !== 'object' || order === null || Array.isArray(order)) return { status: 400, body: { handled: 'invalid' } };
  // Shopify's numeric id arrives as a number; the database wants text
  const o = order as Record<string, unknown>;
  const withId = { ...o, id: o.id === undefined ? undefined : String(o.id) };
  const { data: r, error: e2 } = await adminDb(env).rpc('sal__ingest_shopify_order', {
    p_org: found.orgId,
    p_order: withId,
    p_webhook_id: h.webhookId || null,
    p_simulated: found.simulated,
  });
  if (e2) throw new Error(e2.message);
  return { status: 200, body: { handled: (r as { result?: string } | null)?.result ?? 'ok' } };
}
