import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Bindings } from './env';
import { runOutboxPass } from './jobs/outbox';
import { parseWebhook, safeEqual, verifySignature } from './lib/whatsapp';
import { processInbound } from './lib/whatsappInbound';
import { HttpError } from './lib/errors';
import { fail, ok } from './lib/response';
import { requireAuth } from './middleware/auth';
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
v1.use('*', requireAuth, requireTenant);
for (const [key, routes] of Object.entries(MODULE_ROUTES)) {
  v1.use(`/${key}/*`, requireModule(key));
  v1.route(`/${key}`, routes);
}
app.route('/v1', v1);

// WhatsApp webhook (Meta calls this; there is no user session). GET answers Meta's one-time verification handshake.
// POST is accepted only with a valid `X-Hub-Signature-256`; the text is handed to the database functions, which find the
// person by their verified number and apply the same rules as the app. Always answers 200 quickly once the signature is
// valid, because Meta retries otherwise.
app.get('/webhooks/whatsapp', (c) => {
  const token = c.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return fail(c, 503, 'WhatsApp is not configured on this server', 'not_configured');
  const ok =
    c.req.query('hub.mode') === 'subscribe' && safeEqual(c.req.query('hub.verify_token') ?? '', token) && Boolean(c.req.query('hub.challenge'));
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

app.notFound((c) => fail(c, 404, 'Not found'));

app.onError((err, c) => {
  if (err instanceof HttpError) return fail(c, err.status as ContentfulStatusCode, err.message, err.code);
  if (err.name === 'NotConfiguredError') return fail(c, 503, err.message, 'not_configured');
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
  },
});
