import { Hono } from 'hono';
import {
  AI_NOTICE_VERSION,
  findProvider,
  INTEGRATION_KINDS,
  INTEGRATION_MESSAGE_KINDS,
  PROVIDER_KINDS,
  PROVIDERS,
  type AiStatus,
  type FxRate,
  type IntegrationCheck,
  type IntegrationKind,
  type IntegrationSettings,
  type ProviderKind,
  type ProviderSettings,
} from '@erp/shared';
import { aiCapUsd } from '../../lib/ai';
import { GOOGLE_CHAT_URL_PREFIX, isGoogleChatWebhookUrl } from '../../lib/channels/integrations';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError, isMissingSchema } from '../../lib/errors';
import { ok } from '../../lib/response';
import { CHECKABLE, type CheckableKind, checkIntegration } from '../../lib/integrationChecks';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Settings > Integrations (INTEGRATIONS_PLAN.md wave 1; sql/053). Owners and admins (no ".read" key). Every change is one database
// function that checks the role again and audits; webhook URLs are write-only (stored in Vault, shown as a hint).
// sql/082: there is no test mode. An integration is off or on, on means the real provider, and it can only be switched on once its
// details are saved (the database checks; email and Telegram also need our server account, checked here). "Check connection" makes
// one real, harmless call and records the answer.
export const integrationRoutes = new Hono<AppEnv>();
export const fxRoutes = new Hono<AppEnv>();

/** Teams webhooks only on Microsoft's hosts (sql/083; same pattern as the database check). */
export const TEAMS_WEBHOOK_URL = /^https:\/\/([A-Za-z0-9-]+\.)+(webhook\.office\.com|logic\.azure\.com|api\.powerplatform\.com)(:443)?\//;

const kindParam = (k: string | undefined): IntegrationKind => {
  if (!k || !(INTEGRATION_KINDS as readonly string[]).includes(k)) throw new HttpError(404, 'Unknown integration', 'not_found');
  return k as IntegrationKind;
};

type Row = {
  kind: IntegrationKind;
  enabled: boolean;
  settings: { kinds?: string[] } | null;
  secret_hint: string | null;
  last_status: 'sent' | 'failed' | null;
  last_error: string | null;
  last_delivery_at: string | null;
};

integrationRoutes.get('/', requirePermission('core.integrations.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('core_integrations')
    .select('kind, enabled, settings, secret_hint, last_status, last_error, last_delivery_at')
    .eq('org_id', c.var.tenant.orgId);
  if (error) throw error;
  const rows = new Map(((data ?? []) as Row[]).map((r) => [r.kind, r]));
  // Email and Telegram need our own account on this server; the screen says so instead of letting a company switch on something that fails.
  const emailReady = Boolean(c.env.RESEND_API_KEY && c.env.EMAIL_FROM);
  const telegramReady = Boolean(c.env.TELEGRAM_BOT_TOKEN);
  return ok<IntegrationSettings[]>(
    c,
    INTEGRATION_KINDS.map((kind) => {
      const r = rows.get(kind);
      return {
        kind,
        enabled: r?.enabled ?? false,
        messageKinds: r?.settings?.kinds ?? [],
        secretHint: r?.secret_hint ?? null,
        needsSecret: kind === 'slack' || kind === 'teams' || kind === 'google_chat',
        ready: kind === 'email' ? emailReady : kind === 'telegram' ? telegramReady : Boolean(r?.secret_hint),
        lastStatus: r?.last_status ?? null,
        lastError: r?.last_error ?? null,
        lastDeliveryAt: r?.last_delivery_at ?? null,
      };
    }),
  );
});

integrationRoutes.put('/:kind', requirePermission('core.integrations.manage'), async (c) => {
  const kind = kindParam(c.req.param('kind'));
  const b = await jsonBody(c);
  const kinds = Array.isArray(b.messageKinds) ? b.messageKinds.filter((k): k is string => typeof k === 'string') : null;
  if (typeof b.enabled !== 'boolean' || !kinds) invalid('enabled and messageKinds are required');
  if (kinds.some((k) => !(INTEGRATION_MESSAGE_KINDS as readonly string[]).includes(k))) invalid('Unknown message kind');
  if (kind === 'email' && b.enabled && !(c.env.RESEND_API_KEY && c.env.EMAIL_FROM))
    throw new HttpError(
      409,
      'Email is not set up on this server yet (our Resend account). It cannot be switched on until it is.',
      'not_configured',
    );
  if (kind === 'telegram' && b.enabled && !c.env.TELEGRAM_BOT_TOKEN)
    throw new HttpError(
      409,
      'Telegram is not set up on this server yet (our bot). It cannot be switched on until it is.',
      'not_configured',
    );
  await callRpc<string>(userDb(c), 'core_save_integration', { p_kind: kind, p_enabled: b.enabled, p_mode: 'live', p_kinds: kinds });
  return ok(c, { kind });
});

// Write-only: the URL is never returned, only a short hint.
integrationRoutes.put('/:kind/secret', requirePermission('core.integrations.manage'), async (c) => {
  const kind = kindParam(c.req.param('kind'));
  if (kind === 'email' || kind === 'telegram') invalid('Only Slack, Teams and Google Chat take a webhook URL');
  const url = (await jsonBody(c)).url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url.trim()) || url.length > 2000) invalid('Paste the full https webhook URL');
  if (kind === 'google_chat' && !isGoogleChatWebhookUrl(url.trim()))
    invalid(`A Google Chat webhook URL starts with ${GOOGLE_CHAT_URL_PREFIX}`);
  // sql/083: Teams only on Microsoft's own hosts (the database checks the same).
  if (kind === 'teams' && !TEAMS_WEBHOOK_URL.test(url.trim()))
    invalid('A Teams webhook URL is on webhook.office.com, logic.azure.com or api.powerplatform.com');
  const hint = await callRpc<string>(userDb(c), 'core_set_integration_secret', { p_kind: kind, p_secret: url.trim() });
  return ok(c, { kind, secretHint: hint });
});

integrationRoutes.delete('/:kind/secret', requirePermission('core.integrations.manage'), async (c) => {
  const kind = kindParam(c.req.param('kind'));
  await callRpc<void>(userDb(c), 'core_clear_integration_secret', { p_kind: kind });
  return ok(c, { kind, secretHint: null });
});

integrationRoutes.post('/:kind/test', requirePermission('core.integrations.manage'), async (c) => {
  const kind = kindParam(c.req.param('kind'));
  const id = await callRpc<string>(userDb(c), 'core_test_integration', { p_kind: kind });
  return ok(c, { kind, outboxId: id }, 201);
});

// "Check connection" for any integration or provider: one real, harmless call (lib/integrationChecks.ts), answered now and recorded on
// the integration with the caller's own sign-in (core_record_integration_check, sql/082; owner or admin, audited).
integrationRoutes.post('/check/:kind', requirePermission('core.integrations.manage'), async (c) => {
  const kind = c.req.param('kind');
  if (!(CHECKABLE as readonly string[]).includes(kind)) throw new HttpError(404, 'Unknown integration', 'not_found');
  // sql/083: the database checks the role (owner or admin) BEFORE any key is read, and allows one check every 30 seconds.
  try {
    await callRpc<void>(userDb(c), 'core_begin_integration_check', { p_kind: kind });
  } catch (e) {
    if (!isMissingSchema(e)) throw e; // 083 not applied yet: the route permission above still applies
  }
  const result = await checkIntegration(c.env, kind as CheckableKind, {
    orgId: c.var.tenant.orgId,
    email: c.var.user.email,
    apiBase: new URL(c.req.url).origin,
  });
  try {
    await callRpc<void>(userDb(c), 'core_record_integration_check', {
      p_kind: kind,
      p_ok: result.ok,
      p_message: result.message.slice(0, 300),
    });
  } catch (e) {
    // Not saved yet (no row), or sql/082 not applied: the answer still stands; only the "last check" line is not updated.
    if (!(e instanceof HttpError)) throw e;
  }
  return ok<IntegrationCheck>(c, result);
});

// ------------------------------------------------------------------ providers (sql/056): payments, shipping, store, AI

const providerParam = (k: string | undefined): ProviderKind => {
  if (!k || !findProvider(k)) throw new HttpError(404, 'Unknown provider', 'not_found');
  return k as ProviderKind;
};

integrationRoutes.get('/providers', requirePermission('core.integrations.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('core_integrations')
    .select('kind, enabled, settings, last_status, last_error, last_delivery_at')
    .eq('org_id', c.var.tenant.orgId)
    .in('kind', PROVIDER_KINDS as unknown as string[]);
  if (error) throw error;
  type PRow = {
    kind: ProviderKind;
    enabled: boolean;
    settings: { config?: Record<string, string>; saved_fields?: string[] } | null;
    last_status: 'sent' | 'failed' | null;
    last_error: string | null;
    last_delivery_at: string | null;
  };
  const rows = new Map(((data ?? []) as PRow[]).map((r) => [r.kind, r]));
  const apiBase = new URL(c.req.url).origin;
  return ok<ProviderSettings[]>(
    c,
    PROVIDERS.map((p) => {
      const r = rows.get(p.kind);
      const saved = r?.settings?.saved_fields ?? [];
      return {
        kind: p.kind,
        enabled: r?.enabled ?? false,
        ready: p.fields.every((f) => !f.required || saved.includes(f.key)),
        callbackUrl: p.webhookPath ? `${apiBase}${p.webhookPath}` : null,
        savedFields: saved,
        config: r?.settings?.config ?? {},
        lastStatus: r?.last_status ?? null,
        lastError: r?.last_error ?? null,
        lastDeliveryAt: r?.last_delivery_at ?? null,
      };
    }),
  );
});

// Write-only for secret fields; an empty string removes a field. Field names are checked here and again in the database.
integrationRoutes.put('/providers/:kind/fields', requirePermission('core.integrations.manage'), async (c) => {
  const kind = providerParam(c.req.param('kind'));
  const values = (await jsonBody(c)).values;
  const allowed = new Set(findProvider(kind)!.fields.map((f) => f.key));
  if (!values || typeof values !== 'object' || Array.isArray(values)) invalid('values must be an object');
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    if (!allowed.has(k) || typeof v !== 'string' || v.length > 4000) invalid(`Invalid field ${k}`);
    clean[k] = v;
  }
  return ok(
    c,
    await callRpc<{ kind: string; savedFields: string[] }>(userDb(c), 'core_save_provider_fields', { p_kind: kind, p_values: clean }),
  );
});

integrationRoutes.put('/providers/:kind', requirePermission('core.integrations.manage'), async (c) => {
  const kind = providerParam(c.req.param('kind'));
  const b = await jsonBody(c);
  if (typeof b.enabled !== 'boolean') invalid('enabled is required');
  await callRpc<string>(userDb(c), 'core_save_integration', { p_kind: kind, p_enabled: b.enabled, p_mode: 'live', p_kinds: [] });
  return ok(c, { kind });
});

// AI: consent (owner only, in the database), this month's use, our cap.
integrationRoutes.get('/ai', requirePermission('core.integrations.view'), async (c) => {
  const s = await callRpc<{ consent: AiStatus['consent']; monthCalls: number; monthSpendMicroUsd: number }>(userDb(c), 'core_ai_status');
  return ok<AiStatus>(c, {
    consent: s.consent,
    monthCalls: Number(s.monthCalls),
    monthSpendMicroUsd: Number(s.monthSpendMicroUsd),
    serviceCapUsd: aiCapUsd(c.env),
    ownProviderReady: { openai: Boolean(c.env.OPENAI_API_KEY), elevenlabs: Boolean(c.env.ELEVENLABS_API_KEY) },
  });
});

integrationRoutes.put('/ai/consent', requirePermission('core.integrations.manage'), async (c) => {
  const accept = (await jsonBody(c)).accept;
  if (typeof accept !== 'boolean') invalid('accept must be true or false');
  await callRpc<void>(userDb(c), 'core_set_ai_consent', { p_accept: accept, p_notice_version: AI_NOTICE_VERSION });
  return ok(c, { accepted: accept });
});

// ------------------------------------------------------------------ exchange rates (shared reference data, sql/053)

const CUR_RE = /^[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// One pair on or before a date: ?from=USD&to=EGP&date=2026-11-06 (date defaults to today). Empty when no rate is known.
fxRoutes.get('/rate', requirePermission('core.org.read'), async (c) => {
  const from = (c.req.query('from') ?? '').toUpperCase();
  const to = (c.req.query('to') ?? c.var.tenant.defaultCurrency).toUpperCase();
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  if (!CUR_RE.test(from) || !CUR_RE.test(to) || !DATE_RE.test(date)) invalid('from, to (three letters) and date (YYYY-MM-DD)');
  const rows = await callRpc<{ rate: number; rate_date: string; source: string }[]>(userDb(c), 'core_fx_rate', {
    p_on: date,
    p_from: from,
    p_to: to,
  });
  const r = rows?.[0];
  return ok<FxRate | null>(c, r ? { from, to, rate: Number(r.rate), rateDate: r.rate_date, source: r.source } : null);
});

// Today's rates of the usual currencies into the company's currency, for the settings screen.
fxRoutes.get('/today', requirePermission('core.org.read'), async (c) => {
  const to = c.var.tenant.defaultCurrency;
  const date = new Date().toISOString().slice(0, 10);
  const out: FxRate[] = [];
  for (const from of ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'EGP'].filter((x) => x !== to)) {
    const rows = await callRpc<{ rate: number; rate_date: string; source: string }[]>(userDb(c), 'core_fx_rate', {
      p_on: date,
      p_from: from,
      p_to: to,
    });
    if (rows?.[0]) out.push({ from, to, rate: Number(rows[0].rate), rateDate: rows[0].rate_date, source: rows[0].source });
  }
  return ok(c, out);
});
