import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env';
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

app.notFound((c) => fail(c, 404, 'Not found'));

app.onError((err, c) => {
  if (err instanceof HttpError) return fail(c, err.status as ContentfulStatusCode, err.message, err.code);
  if (err.name === 'NotConfiguredError') return fail(c, 503, err.message, 'not_configured');
  console.error(err);
  return fail(c, 500, 'Something went wrong on our side');
});

export default app;
