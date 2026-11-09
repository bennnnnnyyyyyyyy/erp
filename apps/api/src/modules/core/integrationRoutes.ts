import { Hono } from 'hono';
import {
  AI_NOTICE_VERSION,
  findProvider,
  INTEGRATION_KINDS,
  INTEGRATION_MESSAGE_KINDS,
  PROVIDER_KINDS,
  PROVIDERS,
  type AiStatus,
  type CbeRate,
  type FxRate,
  type IntegrationKind,
  type IntegrationSettings,
  type ProviderKind,
  type ProviderSettings,
} from '@erp/shared';
import { aiCapUsd } from '../../lib/ai';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { CBE_CURRENCIES, cbeRates, type MidRate } from '../../lib/rates/cbe';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Settings > Integrations (INTEGRATIONS_PLAN.md wave 1; sql/053). Owners and admins (no ".read" key). Every change is one database
// function that checks the role again and audits; webhook URLs are write-only (stored in Vault, shown as a hint).
export const integrationRoutes = new Hono<AppEnv>();
export const fxRoutes = new Hono<AppEnv>();

const kindParam = (k: string | undefined): IntegrationKind => {
  if (!k || !(INTEGRATION_KINDS as readonly string[]).includes(k)) throw new HttpError(404, 'Unknown integration', 'not_found');
  return k as IntegrationKind;
};

type Row = {
  kind: IntegrationKind;
  mode: 'simulated' | 'live';
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
    .select('kind, mode, enabled, settings, secret_hint, last_status, last_error, last_delivery_at')
    .eq('org_id', c.var.tenant.orgId);
  if (error) throw error;
  const rows = new Map(((data ?? []) as Row[]).map((r) => [r.kind, r]));
  // Live email needs our sending account on this server; the screen says so instead of letting a company pick a mode that fails.
  const emailReady = Boolean(c.env.RESEND_API_KEY && c.env.EMAIL_FROM);
  const telegramReady = Boolean(c.env.TELEGRAM_BOT_TOKEN);
  return ok<IntegrationSettings[]>(
    c,
    INTEGRATION_KINDS.map((kind) => {
      const r = rows.get(kind);
      return {
        kind,
        enabled: r?.enabled ?? false,
        mode: r?.mode ?? 'simulated',
        messageKinds: r?.settings?.kinds ?? [],
        secretHint: r?.secret_hint ?? null,
        needsSecret: kind === 'slack' || kind === 'teams',
        liveAvailable: kind === 'email' ? emailReady : kind === 'telegram' ? telegramReady : Boolean(r?.secret_hint),
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
  const mode = b.mode === 'live' ? 'live' : b.mode === 'simulated' ? 'simulated' : null;
  const kinds = Array.isArray(b.messageKinds) ? b.messageKinds.filter((k): k is string => typeof k === 'string') : null;
  if (typeof b.enabled !== 'boolean' || !mode || !kinds) invalid('enabled, mode (simulated or live) and messageKinds are required');
  if (kinds.some((k) => !(INTEGRATION_MESSAGE_KINDS as readonly string[]).includes(k))) invalid('Unknown message kind');
  if (kind === 'email' && mode === 'live' && !(c.env.RESEND_API_KEY && c.env.EMAIL_FROM))
    throw new HttpError(409, 'Live email is not set up on this server yet; keep it simulated', 'not_configured');
  if (kind === 'telegram' && mode === 'live' && !c.env.TELEGRAM_BOT_TOKEN)
    throw new HttpError(409, 'Telegram is not set up on this server yet; keep it simulated', 'not_configured');
  await callRpc<string>(userDb(c), 'core_save_integration', { p_kind: kind, p_enabled: b.enabled, p_mode: mode, p_kinds: kinds });
  return ok(c, { kind });
});

// Write-only: the URL is never returned, only a short hint.
integrationRoutes.put('/:kind/secret', requirePermission('core.integrations.manage'), async (c) => {
  const kind = kindParam(c.req.param('kind'));
  if (kind === 'email' || kind === 'telegram') invalid('Only Slack and Teams take a webhook URL');
  const url = (await jsonBody(c)).url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url.trim()) || url.length > 2000) invalid('Paste the full https webhook URL');
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

// ------------------------------------------------------------------ providers (sql/056): payments, shipping, store, AI

const providerParam = (k: string | undefined): ProviderKind => {
  if (!k || !findProvider(k)) throw new HttpError(404, 'Unknown provider', 'not_found');
  return k as ProviderKind;
};

integrationRoutes.get('/providers', requirePermission('core.integrations.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('core_integrations')
    .select('kind, mode, enabled, settings, last_status, last_error, last_delivery_at')
    .eq('org_id', c.var.tenant.orgId)
    .in('kind', PROVIDER_KINDS as unknown as string[]);
  if (error) throw error;
  type PRow = {
    kind: ProviderKind;
    mode: 'simulated' | 'live';
    enabled: boolean;
    settings: { config?: Record<string, string>; saved_fields?: string[] } | null;
    last_status: 'sent' | 'failed' | null;
    last_error: string | null;
    last_delivery_at: string | null;
  };
  const rows = new Map(((data ?? []) as PRow[]).map((r) => [r.kind, r]));
  return ok<ProviderSettings[]>(
    c,
    PROVIDERS.map((p) => {
      const r = rows.get(p.kind);
      return {
        kind: p.kind,
        enabled: r?.enabled ?? false,
        mode: r?.mode ?? 'simulated',
        savedFields: r?.settings?.saved_fields ?? [],
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
  const mode = b.mode === 'live' ? 'live' : b.mode === 'simulated' ? 'simulated' : null;
  if (typeof b.enabled !== 'boolean' || !mode) invalid('enabled and mode (simulated or live) are required');
  await callRpc<string>(userDb(c), 'core_save_integration', { p_kind: kind, p_enabled: b.enabled, p_mode: mode, p_kinds: [] });
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

// Central Bank of Egypt rates, SIMULATED (lib/rates/cbe.ts): Egyptian pounds per unit, buy and sell, worked out from the stored daily
// mid rate. Not saved and never used to convert anything.
fxRoutes.get('/cbe', requirePermission('core.org.read'), async (c) => {
  const date = new Date().toISOString().slice(0, 10);
  const mids: MidRate[] = [];
  for (const currency of CBE_CURRENCIES) {
    const rows = await callRpc<{ rate: number; rate_date: string; source: string }[]>(userDb(c), 'core_fx_rate', {
      p_on: date,
      p_from: currency,
      p_to: 'EGP',
    });
    if (rows?.[0]) mids.push({ currency, mid: Number(rows[0].rate), rateDate: rows[0].rate_date });
  }
  return ok<CbeRate[]>(c, cbeRates('simulated', mids));
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
