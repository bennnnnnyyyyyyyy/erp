import type { IntegrationCheck } from '@erp/shared';
import type { Bindings } from '../env';
import { assertSafeOllamaUrl } from './aiProviders';
import { adminDb } from './db.admin';
import { sha256Hex } from './payments/links';
import { appUrl } from './telegram';

// "Check connection" (sql/082; plan https://claude.ai/artifact/Bhoasn4YNGrEb4jsWQJtZi). There is no test mode any more, so this is how
// an owner finds out whether an integration really works: ONE real, harmless call with the saved details, and the provider's answer.
// Nothing here changes data in our database (the route records the result with the caller's own sign-in) and nothing charges money:
//   email        sends a test email to the person checking (our Resend account)
//   Slack, Teams, Google Chat   posts a test message to the channel
//   Telegram     asks Telegram whether our bot token is valid (getMe)
//   Paymob       creates a 1 EGP payment request nobody has to pay, and returns its checkout page (with test keys: pay it with
//                Paymob's test card to try the whole path)
//   Fawry        asks the status of a reference that does not exist: Fawry only answers "not found" when the code and key are right
//   Bosta        reads the company's pickup locations (GET; the path is from Bosta's own SDK, not yet confirmed on v2 with a real key)
//   Shopify      gets a token (client ID + secret, Shopify's 2026 rule) or uses an older app's token, reads the shop's name, and checks
//                that order webhooks point at us
//   OpenAI, ElevenLabs, Ollama   list models or the account; no prompt, no cost
// On the secret-key allowlist (test/boundaries.test.ts), like lib/aiService.ts: it reads the company's saved keys through the
// service-role functions core__provider_credentials and core__integration_secret. Keys never leave this file and are never returned.

export type CheckDeps = { fetch: typeof fetch };
export const realCheckDeps: CheckDeps = { fetch: (...a) => fetch(...a) };

export type CheckCaller = { orgId: string; email: string; apiBase: string };

/** Shopify Admin API version used by the check (a stable version; Shopify supports each for 12 months). */
export const SHOPIFY_API_VERSION = '2026-07';
const TIMEOUT_MS = 10_000;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const pass = (message: string, url?: string): IntegrationCheck => ({ ok: true, message, ...(url ? { url } : {}) });
const fail = (message: string): IntegrationCheck => ({ ok: false, message: message.slice(0, 280) });

async function call(deps: CheckDeps, url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; text: string }> {
  const res = await deps.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

/** The provider's own short reason, without anything that looks like a key. */
function reason(r: { status: number; body: unknown; text: string }): string {
  const b = isObj(r.body) ? r.body : {};
  const nested = isObj(b.error) ? b.error : {};
  const raw =
    [b.message, b.detail, b.statusDescription, b.description, b.errors, nested.message, b.error]
      .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? JSON.stringify(v) : ''))
      .find((v) => v.length > 0) ?? r.text;
  const clean = raw
    .replace(/\b(sk|pk|egy_sk|egy_pk|shpat|shpss|xi)[-_][A-Za-z0-9_-]{6,}/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim();
  return `HTTP ${r.status}${clean ? `: ${clean.slice(0, 200)}` : ''}`;
}

/** Plain settings and secret fields together (core__provider_credentials merges them); service role only. */
async function credentials(env: Bindings, orgId: string, kind: string): Promise<Record<string, string>> {
  const { data, error } = await adminDb(env).rpc('core__provider_credentials', { p_org: orgId, p_kind: kind });
  if (error) throw new Error('Could not read the saved details');
  return (isObj(data) ? data : {}) as Record<string, string>;
}

async function webhookUrl(env: Bindings, orgId: string, kind: string): Promise<string | null> {
  const { data, error } = await adminDb(env).rpc('core__integration_secret', { p_org: orgId, p_kind: kind });
  if (error) throw new Error('Could not read the saved webhook URL');
  return (data as string | null) ?? null;
}

const TEST_TEXT = 'Test from the ERP: if you can read this, the connection works.';

/** Error text without any web address: a webhook URL is a secret and must never reach the screen, `last_error` or the audit log. */
export const withoutUrls = (text: string): string => text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[address]');

// ------------------------------------------------------------------ messages

async function checkEmail(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return fail('Email is not set up on this server yet (our Resend key and sender address).');
  if (!who.email) return fail('Your account has no email address to send the test to.');
  const r = await call(deps, 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'erp-worker' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [who.email], subject: 'Test from the ERP', text: TEST_TEXT }),
  });
  return r.status >= 200 && r.status < 300 ? pass(`Sent a test email to ${who.email}.`) : fail(`Resend refused: ${reason(r)}`);
}

async function checkWebhook(env: Bindings, who: CheckCaller, kind: 'slack' | 'teams' | 'google_chat', deps: CheckDeps) {
  const name = { slack: 'Slack', teams: 'Teams', google_chat: 'Google Chat' }[kind];
  const url = await webhookUrl(env, who.orgId, kind);
  if (!url) return fail(`Save the ${name} webhook URL first.`);
  const payload =
    kind === 'teams'
      ? {
          type: 'message',
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: TEST_TEXT, wrap: true }] },
            },
          ],
        }
      : { text: TEST_TEXT };
  const r = await call(deps, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  // Only the status, never the reply body: a webhook host's answer is not shown or stored (security review, 11 Nov 2026).
  return r.status >= 200 && r.status < 300
    ? pass(`Posted a test message to the ${name} channel.`)
    : fail(`${name} refused: HTTP ${r.status}`);
}

async function checkTelegram(env: Bindings, deps: CheckDeps): Promise<IntegrationCheck> {
  if (!env.TELEGRAM_BOT_TOKEN) return fail('Telegram is not set up on this server yet (our bot token).');
  const r = await call(deps, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  const b = isObj(r.body) ? r.body : {};
  const bot = isObj(b.result) ? String(b.result.username ?? '') : '';
  if (r.status !== 200 || b.ok !== true) return fail(`Telegram refused our bot: HTTP ${r.status}`);
  return pass(
    `Our bot @${bot} is working.${appUrl(env) ? '' : ' (APP_URL is not set, so messages have no "Open in the app" button.)'} Use "Send a test" to get a message.`,
  );
}

// ------------------------------------------------------------------ payments

async function checkPaymob(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'paymob');
  const methods = String(c.integration_ids ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!c.secret_key || !c.public_key || !methods.length) return fail('Save the secret key, public key and payment method IDs first.');
  const r = await call(deps, 'https://accept.paymob.com/v1/intention/', {
    method: 'POST',
    headers: { Authorization: `Token ${c.secret_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 100,
      currency: 'EGP',
      payment_methods: methods,
      items: [{ name: 'Connection check', amount: 100, description: 'ERP connection check, nothing to pay', quantity: 1 }],
      billing_data: { first_name: 'Connection', last_name: 'Check', email: who.email || 'NA', phone_number: 'NA' },
      special_reference: `CHECK-${crypto.randomUUID()}`,
      notification_url: `${who.apiBase}/webhooks/paymob`,
    }),
  });
  const b = isObj(r.body) ? r.body : {};
  const secret = typeof b.client_secret === 'string' ? b.client_secret : '';
  if (r.status < 200 || r.status >= 300 || !secret) return fail(`Paymob refused: ${reason(r)}`);
  const url = `https://accept.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(c.public_key)}&clientSecret=${encodeURIComponent(secret)}`;
  return pass(
    'Paymob accepted the keys and made a 1 EGP payment request. Nobody has to pay it; with test keys you can pay it with the test card.',
    url,
  );
}

async function checkFawry(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'fawry');
  if (!c.merchant_code || !c.secure_key) return fail('Save the merchant code and security key first.');
  const ref = `CHECK${Date.now()}`;
  const signature = await sha256Hex(`${c.merchant_code}${ref}${c.secure_key}`);
  const base = (env.FAWRY_BASE_URL || 'https://www.atfawry.com').replace(/\/+$/, '');
  const q = new URLSearchParams({ merchantCode: c.merchant_code, merchantRefNumber: ref, signature });
  const r = await call(deps, `${base}/ECommerceWeb/Fawry/payments/status/v2?${q}`);
  const b = isObj(r.body) ? r.body : {};
  const desc = String(b.statusDescription ?? b.description ?? '');
  // Unconfirmed until a real merchant account answers: Fawry is expected to say the reference is unknown when the code and key are
  // right, and to name the signature or merchant when they are not. The provider's words are shown either way.
  if (/signature|merchant|unauthori[sz]ed|forbidden/i.test(desc) || r.status === 401 || r.status === 403)
    return fail(`Fawry refused the merchant code or key: ${reason(r)}`);
  if (r.status >= 500 || r.status === 0) return fail(`Fawry could not be reached: ${reason(r)}`);
  return pass(`Fawry answered with the saved code and key${desc ? ` ("${desc.slice(0, 120)}")` : ''}.`);
}

// ------------------------------------------------------------------ shipping and store

async function checkBosta(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'bosta');
  if (!c.api_key) return fail('Save the API key first.');
  const r = await call(deps, 'https://app.bosta.co/api/v2/pickup-locations', { headers: { Authorization: c.api_key } });
  if (r.status === 401 || r.status === 403) return fail(`Bosta refused the API key: ${reason(r)}`);
  if (r.status < 200 || r.status >= 300) return fail(`Bosta answered: ${reason(r)}`);
  const b = isObj(r.body) ? r.body : {};
  const list = Array.isArray(b.data) ? b.data : isObj(b.data) && Array.isArray(b.data.list) ? b.data.list : null;
  return pass(`Bosta accepted the API key${list ? ` (${list.length} pickup location${list.length === 1 ? '' : 's'})` : ''}.`);
}

/** A Shopify Admin API token: an older app's saved token, else a new one from the client ID and secret (24 hours, Shopify 2026). */
export async function shopifyToken(c: Record<string, string>, deps: CheckDeps): Promise<{ token: string } | { error: string }> {
  if (c.access_token) return { token: c.access_token };
  if (!c.client_id || !c.webhook_secret) return { error: 'Save the client ID and client secret first.' };
  const r = await call(deps, `https://${c.shop_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: c.client_id, client_secret: c.webhook_secret, grant_type: 'client_credentials' }),
  });
  const b = isObj(r.body) ? r.body : {};
  if (r.status !== 200 || typeof b.access_token !== 'string') return { error: `Shopify refused the client ID or secret: ${reason(r)}` };
  return { token: b.access_token };
}

async function checkShopify(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'shopify');
  if (!c.shop_domain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(c.shop_domain)) return fail('Save the shop domain first.');
  const t = await shopifyToken(c, deps);
  if ('error' in t) return fail(t.error);
  const headers = { 'X-Shopify-Access-Token': t.token, Accept: 'application/json' };
  const shop = await call(deps, `https://${c.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { headers });
  if (shop.status !== 200) return fail(`Shopify refused: ${reason(shop)}`);
  const name = isObj(shop.body) && isObj(shop.body.shop) ? String(shop.body.shop.name ?? c.shop_domain) : c.shop_domain;
  const hooks = await call(deps, `https://${c.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, { headers });
  const list = isObj(hooks.body) && Array.isArray(hooks.body.webhooks) ? (hooks.body.webhooks as Obj[]) : [];
  const ours = `${who.apiBase}/webhooks/shopify`;
  const orders = list.some((h) => h.topic === 'orders/create' && h.address === ours);
  if (hooks.status !== 200)
    return pass(`Connected to "${name}". The order webhooks could not be read (${reason(hooks)}); check they go to ${ours}.`);
  return orders
    ? pass(`Connected to "${name}". New orders are sent to us.`)
    : pass(`Connected to "${name}", but no "orders/create" webhook points at ${ours} yet: add it in the app, or orders will not arrive.`);
}

// ------------------------------------------------------------------ AI (no prompt is sent: nothing is charged)

async function checkOpenAI(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'openai');
  const key = c.api_key || env.OPENAI_API_KEY;
  if (!key) return fail('No OpenAI key: add your own, or ask us to set up ours.');
  const r = await call(deps, 'https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  return r.status === 200
    ? pass(`OpenAI accepted ${c.api_key ? 'your' : 'our'} key.`)
    : fail(`OpenAI refused ${c.api_key ? 'your' : 'our'} key: ${reason(r)}`);
}

async function checkElevenLabs(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'elevenlabs');
  const key = c.api_key || env.ELEVENLABS_API_KEY;
  if (!key) return fail('No ElevenLabs key: add your own, or ask us to set up ours.');
  const r = await call(deps, 'https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
  return r.status === 200
    ? pass(`ElevenLabs accepted ${c.api_key ? 'your' : 'our'} key.`)
    : fail(`ElevenLabs refused the key: ${reason(r)}`);
}

async function checkOllama(env: Bindings, who: CheckCaller, deps: CheckDeps): Promise<IntegrationCheck> {
  const c = await credentials(env, who.orgId, 'ollama');
  if (!c.base_url || !c.model) return fail('Save the Ollama address and model first.');
  let base: URL;
  try {
    base = assertSafeOllamaUrl(c.base_url);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The Ollama address is not allowed');
  }
  const r = await call(deps, new URL('/api/tags', base).toString(), { headers: c.api_key ? { Authorization: `Bearer ${c.api_key}` } : {} });
  if (r.status >= 300 && r.status < 400) return fail('The Ollama address redirects. Save the final https address instead.');
  if (r.status !== 200) return fail(`Your Ollama server answered: ${reason(r)}`);
  const models = isObj(r.body) && Array.isArray(r.body.models) ? (r.body.models as Obj[]).map((m) => String(m.name ?? '')) : [];
  return models.some((m) => m === c.model || m.split(':')[0] === c.model)
    ? pass(`Your Ollama server answered and has the model ${c.model}.`)
    : fail(`Your Ollama server answered, but it does not have the model ${c.model} (it has: ${models.slice(0, 5).join(', ') || 'none'}).`);
}

// ------------------------------------------------------------------ one door

export const CHECKABLE = [
  'email',
  'slack',
  'teams',
  'google_chat',
  'telegram',
  'paymob',
  'fawry',
  'bosta',
  'shopify',
  'openai',
  'elevenlabs',
  'ollama',
] as const;
export type CheckableKind = (typeof CHECKABLE)[number];

export async function checkIntegration(
  env: Bindings,
  kind: CheckableKind,
  who: CheckCaller,
  deps: CheckDeps = realCheckDeps,
): Promise<IntegrationCheck> {
  try {
    switch (kind) {
      case 'email':
        return await checkEmail(env, who, deps);
      case 'slack':
      case 'teams':
      case 'google_chat':
        return await checkWebhook(env, who, kind, deps);
      case 'telegram':
        return await checkTelegram(env, deps);
      case 'paymob':
        return await checkPaymob(env, who, deps);
      case 'fawry':
        return await checkFawry(env, who, deps);
      case 'bosta':
        return await checkBosta(env, who, deps);
      case 'shopify':
        return await checkShopify(env, who, deps);
      case 'openai':
        return await checkOpenAI(env, who, deps);
      case 'elevenlabs':
        return await checkElevenLabs(env, who, deps);
      case 'ollama':
        return await checkOllama(env, who, deps);
    }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return fail(
      timeout
        ? 'No answer within 10 seconds.'
        : `Could not reach the provider: ${e instanceof Error ? withoutUrls(e.message).slice(0, 150) : 'unknown error'}`,
    );
  }
}
