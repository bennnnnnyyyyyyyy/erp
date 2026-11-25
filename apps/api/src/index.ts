import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { findModule } from '@erp/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Bindings } from './env';
import { runFxPass } from './jobs/fx';
import { runHrSyncPass } from './jobs/hrSync';
import { runOutboxPass } from './jobs/outbox';
import { processHrWebhook } from './lib/hr/hrWebhook';
import { processShopifyWebhook } from './lib/store/shopify';
import { processBostaWebhook } from './lib/shipping/bosta';
import { processFawryCallback, processPaymobCallback } from './lib/payments/links';
import { parseWebhook, safeEqual, verifySignature } from './lib/whatsapp';
import { processInbound } from './lib/whatsappInbound';
import { processTelegramUpdate } from './lib/telegramInbound';
import { HttpError, isMissingSchema } from './lib/errors';
import { plainDbError } from './lib/rpc';
import { fail, ok } from './lib/response';
import { requireAuth } from './middleware/auth';
import { KB, MB, limitBody } from './middleware/bodyLimit';
import { reportLinkCsv } from './lib/reportLinks';
import { invoiceLinkData } from './lib/invoiceLinks';
import { rateLimit } from './middleware/rateLimit';
import { requireModule, requireTenant } from './middleware/tenant';
import { MODULE_ROUTES } from './modules/registry';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  return cors({ origin: allowed, allowHeaders: ['Authorization', 'Content-Type', 'X-Org-Id'] })(c, next);
});

app.get('/health', (c) => ok(c, { status: 'ok', env: c.env.APP_ENV }));

// Everything under /v1 needs a signed-in user acting inside one organization.
const v1 = new Hono<AppEnv>();
// The IP limiter runs before sign-in so unauthenticated floods and token guessing are counted; the per-user one runs after.
v1.use('*', rateLimit('ip'), requireAuth, rateLimit('api'), requireTenant);
for (const [key, routes] of Object.entries(MODULE_ROUTES)) {
  v1.use(`/${key}/*`, requireModule(key, findModule(key)?.openBeforeEnabled));
  v1.route(`/${key}`, routes);
}
app.route('/v1', v1);

// WhatsApp webhook (Meta calls this; there is no user session). GET answers Meta's one-time verification handshake.
// POST is accepted only with a valid `X-Hub-Signature-256`; the text is handed to the database functions, which find the
// person by their verified number and apply the same rules as the app. Always answers 200 quickly once the signature is
// valid, because Meta retries otherwise.
app.use('/webhooks/*', rateLimit('webhook'));
// Body caps before any handler reads the body (repo audit 2026-11-06, finding 8). Shopify order payloads are larger than the rest.
for (const hook of ['whatsapp', 'telegram', 'paymob', 'fawry', 'bosta']) app.use(`/webhooks/${hook}`, limitBody(100 * KB));
app.use('/webhooks/hr-app', limitBody(64 * KB));
app.use('/webhooks/shopify', limitBody(1 * MB));
// Private report links for Google Sheets (sql/070): no user, the token in the address is the only credential. Read-only CSV. The token
// format is checked before any database call; every refusal (missing, revoked, expired, module off) is the same bare 404.
app.use('/r/*', rateLimit('webhook'));
app.get('/r/:token', async (c) => {
  const csv = await reportLinkCsv(c.env, c.req.param('token'));
  if (csv === null) return c.body(null, 404, { 'Cache-Control': 'no-store' });
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
});
// Customer invoice links (sql/103): the same rules as /r. No user; the token is the only credential; it reads with the publishable key, so
// the database treats the caller as anon (never the secret key). JSON for the public invoice page of the web app (/i/<token> there).
// Every refusal (missing, switched off, voided, module off) is the same bare 404.
app.use('/i/*', rateLimit('webhook'));
app.get('/i/:token', async (c) => {
  const data = await invoiceLinkData(c.env, c.req.param('token'));
  if (data === null) return c.body(null, 404, { 'Cache-Control': 'no-store' });
  return c.json({ success: true, data }, 200, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
});

app.get('/webhooks/whatsapp', (c) => {
  const token = c.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return fail(c, 503, 'WhatsApp is not configured on this server', 'not_configured');
  const ok =
    c.req.query('hub.mode') === 'subscribe' &&
    safeEqual(c.req.query('hub.verify_token') ?? '', token) &&
    Boolean(c.req.query('hub.challenge'));
  return ok ? c.text(c.req.query('hub.challenge') ?? '') : fail(c, 403, 'Verification failed', 'forbidden');
});

app.post('/webhooks/whatsapp', async (c) => {
  const secret = c.env.WHATSAPP_APP_SECRET;
  if (!secret) return fail(c, 503, 'WhatsApp is not configured on this server', 'not_configured');
  const raw = await c.req.text();
  if (raw.length > 100_000) return fail(c, 413, 'Too large', 'too_large');
  if (!(await verifySignature(raw, c.req.header('X-Hub-Signature-256'), secret))) return fail(c, 401, 'Bad signature', 'bad_signature');
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ success: true, data: { handled: 0 } });
  }
  const messages = parseWebhook(payload);
  if (messages.length === 0) return c.json({ success: true, data: { handled: 0 } });
  const result = await processInbound(c.env, messages);
  return c.json({ success: true, data: result });
});

// Telegram webhook (sql/054). Accepted only with Telegram's secret header (set with setWebhook's secret_token). The only action is
// finishing a link from the app; it always answers 200 quickly once the header is right, because Telegram retries otherwise.
app.post('/webhooks/telegram', async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !c.env.TELEGRAM_BOT_TOKEN) return fail(c, 503, 'Telegram is not configured on this server', 'not_configured');
  if (!safeEqual(c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '', secret)) return fail(c, 401, 'Bad secret', 'bad_signature');
  const raw = await c.req.text();
  if (raw.length > 100_000) return fail(c, 413, 'Too large', 'too_large');
  let update: unknown = null;
  try {
    update = JSON.parse(raw);
  } catch {
    return c.json({ success: true, data: { handled: 'ignored' } });
  }
  const handled = await processTelegramUpdate(c.env, update);
  return c.json({ success: true, data: { handled } });
});

// Payment provider callbacks (sql/057). Public, so each is verified with that company's own key (found through our reference) before
// anything happens; the database re-checks amount, currency and invoice and records once per provider transaction.
const MAX_CALLBACK = 100_000;
app.post('/webhooks/paymob', async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_CALLBACK) return fail(c, 413, 'Too large', 'too_large');
  const r = await processPaymobCallback(c.env, raw, c.req.query('hmac') ?? '');
  return r.status === 200 ? c.json({ success: true, data: r.body }) : fail(c, r.status, 'Rejected', String(r.body.handled));
});
app.post('/webhooks/fawry', async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_CALLBACK) return fail(c, 413, 'Too large', 'too_large');
  const r = await processFawryCallback(c.env, raw);
  return r.status === 200 ? c.json({ success: true, data: r.body }) : fail(c, r.status, 'Rejected', String(r.body.handled));
});

// Bosta status webhook (sql/058): unsigned by Bosta, so it must carry the secret header we set when creating the delivery.
app.post('/webhooks/bosta', async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_CALLBACK) return fail(c, 413, 'Too large', 'too_large');
  const r = await processBostaWebhook(c.env, raw, c.req.header('Authorization') ?? '');
  return r.status === 200 ? c.json({ success: true, data: r.body }) : fail(c, r.status, 'Rejected', String(r.body.handled));
});

// Shopify orders (sql/059): signed by Shopify with the company's API secret; verified before anything is created.
app.post('/webhooks/shopify', async (c) => {
  const raw = await c.req.text();
  if (raw.length > 1_000_000) return fail(c, 413, 'Too large', 'too_large');
  const r = await processShopifyWebhook(c.env, raw, {
    shop: c.req.header('X-Shopify-Shop-Domain') ?? '',
    hmac: c.req.header('X-Shopify-Hmac-SHA256') ?? '',
    topic: c.req.header('X-Shopify-Topic') ?? '',
    webhookId: c.req.header('X-Shopify-Webhook-Id') ?? '',
  });
  return r.status === 200 ? c.json({ success: true, data: r.body }) : fail(c, r.status, 'Rejected', String(r.body.handled));
});

// HR & payroll app (sql/102; contract section 6). Signed with the company's signing secret (HMAC-SHA256 over timestamp and body),
// found by our own connection id; the event only asks for a read, which the sync job does from the HR app's API.
app.post('/webhooks/hr-app', async (c) => {
  const raw = await c.req.text();
  if (raw.length > 64 * 1024) return fail(c, 413, 'Too large', 'too_large');
  const r = await processHrWebhook(c.env, raw, {
    connection: c.req.header('X-ERP-Connection') ?? '',
    eventId: c.req.header('X-HR-Event-Id') ?? '',
    timestamp: c.req.header('X-HR-Timestamp') ?? '',
    signature: c.req.header('X-HR-Signature') ?? '',
  });
  return r.status === 200 ? c.json({ success: true, data: r.body }) : fail(c, r.status, 'Rejected', r.body.handled);
});

app.notFound((c) => fail(c, 404, 'Not found'));

app.onError((err, c) => {
  if (err instanceof HttpError) return fail(c, err.status as ContentfulStatusCode, err.message, err.code);
  if (err.name === 'NotConfiguredError') return fail(c, 503, err.message, 'not_configured');
  // Code deployed before its database update: say so, instead of "something went wrong".
  if (isMissingSchema(err)) {
    console.error('missing database object (migration not applied?)', (err as { message?: string }).message);
    return fail(c, 503, 'This feature is not set up yet: its database update has not been applied', 'not_set_up');
  }
  // A timeout, a database rule or a busy server: a plain message, the raw text only in the log (input and speed audit, 25 Nov 2026).
  const plain = plainDbError(err);
  if (plain) {
    console.error('database error', (err as { code?: string }).code, (err as { message?: string }).message);
    return fail(c, plain.status as ContentfulStatusCode, plain.message, plain.code);
  }
  console.error(err);
  return fail(c, 500, 'Something went wrong on our side');
});

// `fetch` is the Hono app (tests call `app.request`); `scheduled` is the cron trigger from wrangler.toml, which
// delivers queued messages and sends reminders and escalations.
export default Object.assign(app, {
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      runOutboxPass(env).then(
        (r) => console.log('outbox pass', JSON.stringify(r)),
        (e) => console.error('outbox pass failed', e instanceof Error ? e.message : String(e)),
      ),
    );
    // HR & payroll app (sql/102): each company's read is due every 15 minutes, or sooner after "Sync now" or a webhook.
    ctx.waitUntil(
      runHrSyncPass(env).then(
        (r) => r.companies > 0 && console.log('hr sync pass', JSON.stringify(r)),
        (e) => console.error('hr sync pass failed', e instanceof Error ? e.message : String(e)),
      ),
    );
    // Daily exchange rates (sql/053); fetches at most every 6 hours, so most runs only check.
    ctx.waitUntil(
      runFxPass(env).then(
        (r) => !r.skipped && console.log('fx pass', JSON.stringify(r)),
        (e) => console.error('fx pass failed', e instanceof Error ? e.message : String(e)),
      ),
    );
  },
});
