import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor } from '@erp/shared';
import app from '../src/index';
import type { Bindings } from '../src/env';
import type { OutboxMessage } from '../src/lib/channels';
import {
  googleChatPayload,
  isGoogleChatWebhookUrl,
  type IntegrationDeps,
  type IntegrationState,
  makeIntegrationAdapters,
} from '../src/lib/channels/integrations';
import { groupRates } from '../src/jobs/fx';
import { checkIntegration, shopifyToken } from '../src/lib/integrationChecks';
import { parseUpdate, startLink } from '../src/lib/telegram';

// Integrations wave 1 (INTEGRATIONS_PLAN.md; sql/053, proved by sql/tests/048). Adapters run against fakes here: nothing real is sent.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings;
const msg = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: 'out-1',
  org_id: 'org-1',
  recipient_id: 'user-1',
  channel: 'email',
  kind: 'approval_request',
  subject: 'REQ-1 needs approval',
  body: 'Two items',
  entity_type: null,
  entity_id: null,
  secret_body: null,
  attempts: 1,
  ...over,
});

function fakes(state: IntegrationState | null, secret: string | null = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: IntegrationDeps = {
    state: async () => state,
    secret: async () => secret,
    email: async () => 'boss@example.com',
    telegramChat: async () => '424242',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
  };
  const [email, slack, teams, telegram, googleChat] = makeIntegrationAdapters(deps);
  return { email: email!, slack: slack!, teams: teams!, telegram: telegram!, googleChat: googleChat!, calls };
}

describe('integration adapters', () => {
  it('there is no test mode (sql/082): an integration that is on really sends', async () => {
    const f = fakes({ enabled: true }, 'https://hooks.slack.com/x');
    expect(await f.slack.send(msg({ channel: 'slack', recipient_id: null }), env)).toBe('slack-webhook');
    expect(f.calls.map((c) => c.url)).toEqual(['https://hooks.slack.com/x']);
    // a row still saying 'simulated' (082 not applied yet) is treated as on: nothing answers "simulated" any more
    const old = fakes({ enabled: true, mode: 'simulated' } as unknown as IntegrationState, 'https://hooks.slack.com/x');
    expect(await old.slack.send(msg({ channel: 'slack', recipient_id: null }), env)).toBe('slack-webhook');
  });

  it('a switched-off integration skips queued messages, but a test message still goes', async () => {
    const f = fakes({ enabled: false }, 'https://hooks.slack.com/x');
    expect(await f.slack.send(msg({ channel: 'slack', recipient_id: null }), env)).toBe('skipped (switched off)');
    expect(await f.slack.send(msg({ channel: 'slack', recipient_id: null, subject: 'Test message from the ERP' }), env)).toBe(
      'slack-webhook',
    );
  });

  it('live email refuses without our sending account, then sends once per message id', async () => {
    const f = fakes({ enabled: true });
    await expect(f.email.send(msg(), env)).rejects.toThrow(/not configured/);
    const live = { ...env, RESEND_API_KEY: 're_test', EMAIL_FROM: 'ERP <n@example.com>' };
    expect(await f.email.send(msg({ subject: '<b>x</b>' }), live)).toBe('resend');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('out-1');
    expect(headers['User-Agent']).toBeTruthy();
    const body = JSON.parse(String(call.init.body)) as { to: string[]; html: string };
    expect(body.to).toEqual(['boss@example.com']);
    expect(body.html).not.toContain('<b>');
  });

  it('live Slack and Teams post to the saved URL; no URL is a visible failure', async () => {
    const f = fakes({ enabled: true }, 'https://hooks.slack.com/services/a/b/c');
    expect(await f.slack.send(msg({ channel: 'slack', recipient_id: null }), env)).toBe('slack-webhook');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ text: 'REQ-1 needs approval\n\nTwo items' });
    expect(await f.teams.send(msg({ channel: 'teams', recipient_id: null }), env)).toBe('teams-webhook');
    expect(JSON.parse(String(f.calls[1]!.init.body)).attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    const none = fakes({ enabled: true }, null);
    await expect(none.slack.send(msg({ channel: 'slack' }), env)).rejects.toThrow(/No Slack webhook URL/);
  });

  it('never sends a one-time code to a shared channel', async () => {
    const f = fakes({ enabled: true }, 'https://hooks.slack.com/services/a/b/c');
    await f.slack.send(msg({ channel: 'slack', secret_body: 'CODE 123456' }), env);
    expect(String(f.calls[0]!.init.body)).not.toContain('123456');
  });
});

describe('google chat', () => {
  const GURL = 'https://chat.googleapis.com/v1/spaces/AAAA1234/messages?key=k&token=t';
  const gmsg = (over: Partial<OutboxMessage> = {}) => msg({ channel: 'google_chat', recipient_id: null, ...over });

  it('accepts only chat.googleapis.com space webhook URLs', () => {
    expect(isGoogleChatWebhookUrl(GURL)).toBe(true);
    for (const bad of [
      'http://chat.googleapis.com/v1/spaces/AAAA1234/messages?key=k',
      'https://chat.googleapis.com.evil.example/v1/spaces/AAAA1234/messages',
      'https://chat.googleapis.com/v1/other/AAAA1234/messages',
      'https://hooks.slack.com/services/a/b/c',
      'https://chat.googleapis.com/v1/spaces/',
      `${GURL} extra`,
      '',
    ])
      expect(isGoogleChatWebhookUrl(bad)).toBe(false);
  });

  it('builds a simple text message: bold subject, then the body', () => {
    expect(googleChatPayload({ subject: 'REQ-1 needs approval', body: 'Two items' })).toEqual({
      text: '*REQ-1 needs approval*\n\nTwo items',
    });
    expect(googleChatPayload({ subject: 'a *b* c', body: '' })).toEqual({ text: '*a b c*' });
  });

  it('posts the text to the saved URL', async () => {
    const f = fakes({ enabled: true }, GURL);
    expect(await f.googleChat.send(gmsg(), env)).toBe('google_chat-webhook');
    expect(f.calls[0]!.url).toBe(GURL);
    expect(f.calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ text: '*REQ-1 needs approval*\n\nTwo items' });
  });

  it('refuses a missing or foreign URL, never sends a one-time code, and a failed call is a visible error', async () => {
    await expect(fakes({ enabled: true }, null).googleChat.send(gmsg(), env)).rejects.toThrow(/No Google Chat webhook URL/);
    const foreign = fakes({ enabled: true }, 'https://evil.example/v1/spaces/AAAA1234/x');
    await expect(foreign.googleChat.send(gmsg(), env)).rejects.toThrow(/not valid/);
    expect(foreign.calls).toEqual([]);
    const f = fakes({ enabled: true }, GURL);
    await f.googleChat.send(gmsg({ secret_body: 'CODE 123456' }), env);
    expect(String(f.calls[0]!.init.body)).not.toContain('123456');
    const failing = makeIntegrationAdapters({
      state: async () => ({ enabled: true }),
      secret: async () => GURL,
      email: async () => null,
      telegramChat: async () => null,
      fetch: (async () => new Response('space not found', { status: 404 })) as unknown as typeof fetch,
    })[4]!;
    const err = await failing.send(gmsg(), env).catch((e: Error) => e.message);
    expect(err).toBe('Google Chat returned 404: space not found');
  });

  it('is skipped for a company that switched it off', async () => {
    expect(await fakes({ enabled: false }, GURL).googleChat.send(gmsg(), env)).toBe('skipped (switched off)');
  });
});

describe('telegram', () => {
  const tgEnv = { ...env, TELEGRAM_BOT_TOKEN: '123:abc', APP_URL: 'https://erp-live.pages.dev' } as Bindings;

  it('sends to the linked chat with an "Open in the app" button, and never puts the token in an error', async () => {
    const f = fakes({ enabled: true });
    expect(await f.telegram.send(msg({ channel: 'telegram' }), tgEnv)).toBe('telegram-bot');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    const body = JSON.parse(String(call.init.body)) as { chat_id: string; reply_markup: { inline_keyboard: { url: string }[][] } };
    expect(body.chat_id).toBe('424242');
    expect(body.reply_markup.inline_keyboard[0]![0]!.url).toBe('https://erp-live.pages.dev');
    const failing = makeIntegrationAdapters({
      state: async () => ({ enabled: true }),
      secret: async () => null,
      email: async () => null,
      telegramChat: async () => '1',
      fetch: (async () => new Response(JSON.stringify({ description: 'chat not found' }), { status: 400 })) as unknown as typeof fetch,
    })[3]!;
    await expect(failing.send(msg({ channel: 'telegram' }), tgEnv)).rejects.toThrow(/^Telegram returned 400: chat not found$/);
  });

  it('a person who never linked is a visible failure', async () => {
    const unlinked = makeIntegrationAdapters({
      state: async () => ({ enabled: true }),
      secret: async () => null,
      email: async () => null,
      telegramChat: async () => null,
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
    })[3]!;
    await expect(unlinked.send(msg({ channel: 'telegram' }), tgEnv)).rejects.toThrow(/not linked/);
  });

  it('reads only private "/start <code>" messages', () => {
    const code = 'a'.repeat(36);
    expect(parseUpdate({ message: { chat: { id: 77, type: 'private' }, text: `/start ${code}` } })).toEqual({
      chatId: '77',
      code,
      text: `/start ${code}`,
    });
    expect(parseUpdate({ message: { chat: { id: 77, type: 'private' }, text: 'hello' } })?.code).toBeNull();
    expect(parseUpdate({ message: { chat: { id: -100, type: 'group' }, text: `/start ${code}` } })).toBeNull();
    expect(parseUpdate({ edited_message: {} })).toBeNull();
    expect(startLink({ ...env, TELEGRAM_BOT_USERNAME: '@erp_bot' } as Bindings, code)).toBe(`https://t.me/erp_bot?start=${code}`);
    expect(startLink(env, code)).toBeNull();
  });

  it("the webhook refuses calls without Telegram's secret header", async () => {
    const live = { ...env, TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_WEBHOOK_SECRET: 's3cret' };
    expect((await app.request('/webhooks/telegram', { method: 'POST', body: '{}' }, live)).status).toBe(401);
    expect(
      (
        await app.request(
          '/webhooks/telegram',
          { method: 'POST', body: '{}', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' } },
          live,
        )
      ).status,
    ).toBe(401);
    expect((await app.request('/webhooks/telegram', { method: 'POST', body: '{}' }, env)).status).toBe(503);
  });
});

describe('exchange rates', () => {
  it('groups records by date, USD base only, and drops bad values', () => {
    const g = groupRates([
      { date: '2026-11-07', base: 'USD', quote: 'EGP', rate: 54.177 },
      { date: '2026-11-07', base: 'USD', quote: 'EUR', rate: 0.89035 },
      { date: '2026-11-06', base: 'USD', quote: 'SAR', rate: 3.75 },
      { date: '2026-11-07', base: 'EUR', quote: 'EGP', rate: 60 },
      { date: '2026-11-07', base: 'USD', quote: 'BAD', rate: -1 },
      { date: 'yesterday', base: 'USD', quote: 'AED', rate: 3.67 },
    ]);
    expect(Object.fromEntries(g)).toEqual({ '2026-11-07': { EGP: 54.177, EUR: 0.89035 }, '2026-11-06': { SAR: 3.75 } });
    expect(groupRates({ not: 'an array' }).size).toBe(0);
  });
});

describe('Central Bank of Egypt rates', () => {
  it('the simulated buy and sell table is gone (sql/082: no test mode); only stored daily rates remain', () => {
    const route = readFileSync(join(__dirname, '../src/modules/core/integrationRoutes.ts'), 'utf8');
    expect(route).not.toMatch(/fxRoutes\.get\('\/cbe'/);
    expect(route).not.toMatch(/simulat/i);
  });
});

describe('check connection (lib/integrationChecks.ts)', () => {
  const who = { orgId: 'org-1', email: 'owner@example.com', apiBase: 'https://api.example.com' };
  const recorder = (status = 200, body: unknown = {}) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const deps = {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch,
    };
    return { calls, deps };
  };

  it('email: says plainly when our account is missing, otherwise sends a real test email to the person checking', async () => {
    const none = recorder();
    expect(await checkIntegration(env, 'email', who, none.deps)).toEqual({
      ok: false,
      message: expect.stringMatching(/not set up on this server/),
    });
    expect(none.calls).toEqual([]);
    const r = recorder(200, { id: 'e-1' });
    const mailEnv = { ...env, RESEND_API_KEY: 're_test', EMAIL_FROM: 'ERP <a@example.com>' } as Bindings;
    expect(await checkIntegration(mailEnv, 'email', who, r.deps)).toEqual({ ok: true, message: 'Sent a test email to owner@example.com.' });
    expect(r.calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(r.calls[0]!.init.body)).to).toEqual(['owner@example.com']);
  });

  it("email: the provider's refusal is shown, with anything that looks like a key masked", async () => {
    const r = recorder(401, { message: 'API key is invalid: re_abc sk_live_123456789' });
    const mailEnv = { ...env, RESEND_API_KEY: 're_test', EMAIL_FROM: 'a@example.com' } as Bindings;
    const out = await checkIntegration(mailEnv, 'email', who, r.deps);
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/^Resend refused: HTTP 401: API key is invalid/);
    expect(out.message).not.toMatch(/sk_live_123456789/);
  });

  it('telegram: asks Telegram whether our bot is valid', async () => {
    const r = recorder(200, { ok: true, result: { username: 'erp_bot' } });
    const out = await checkIntegration({ ...env, TELEGRAM_BOT_TOKEN: '1:abc' } as Bindings, 'telegram', who, r.deps);
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/@erp_bot/);
    expect(r.calls[0]!.url).toBe('https://api.telegram.org/bot1:abc/getMe');
    expect(
      (await checkIntegration({ ...env, TELEGRAM_BOT_TOKEN: '1:abc' } as Bindings, 'telegram', who, recorder(401, { ok: false }).deps)).ok,
    ).toBe(false);
  });

  it('a provider that does not answer in time is a plain failure, not a crash', async () => {
    const deps = {
      fetch: (async () => {
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      }) as unknown as typeof fetch,
    };
    expect(await checkIntegration({ ...env, TELEGRAM_BOT_TOKEN: '1:abc' } as Bindings, 'telegram', who, deps)).toEqual({
      ok: false,
      message: 'No answer within 10 seconds.',
    });
  });

  it("shopify (2026 apps): an older app's token is used as it is; otherwise the client ID and secret are exchanged for one", async () => {
    expect(await shopifyToken({ access_token: 'shpat_old' }, recorder().deps)).toEqual({ token: 'shpat_old' });
    expect(await shopifyToken({ shop_domain: 's.myshopify.com' }, recorder().deps)).toEqual({ error: expect.stringMatching(/client ID/) });
    const r = recorder(200, { access_token: 'tok-24h', expires_in: 86399 });
    expect(await shopifyToken({ shop_domain: 's.myshopify.com', client_id: 'cid', webhook_secret: 'csec' }, r.deps)).toEqual({
      token: 'tok-24h',
    });
    expect(r.calls[0]!.url).toBe('https://s.myshopify.com/admin/oauth/access_token');
    expect(JSON.parse(String(r.calls[0]!.init.body))).toEqual({
      client_id: 'cid',
      client_secret: 'csec',
      grant_type: 'client_credentials',
    });
    const bad = await shopifyToken(
      { shop_domain: 's.myshopify.com', client_id: 'cid', webhook_secret: 'x' },
      recorder(400, { error: 'invalid_client' }).deps,
    );
    expect(bad).toEqual({ error: expect.stringMatching(/^Shopify refused the client ID or secret: HTTP 400/) });
  });
});

describe('integration routes', () => {
  const ID = 'email';
  const routes: [string, string][] = [
    ['GET', '/v1/core/integrations'],
    ['PUT', `/v1/core/integrations/${ID}`],
    ['PUT', '/v1/core/integrations/slack/secret'],
    ['PUT', '/v1/core/integrations/google_chat'],
    ['PUT', '/v1/core/integrations/google_chat/secret'],
    ['DELETE', '/v1/core/integrations/google_chat/secret'],
    ['POST', '/v1/core/integrations/google_chat/test'],
    ['DELETE', '/v1/core/integrations/slack/secret'],
    ['POST', `/v1/core/integrations/${ID}/test`],
    ['GET', '/v1/core/integrations/providers'],
    ['PUT', '/v1/core/integrations/providers/paymob/fields'],
    ['PUT', '/v1/core/integrations/providers/paymob'],
    ['GET', '/v1/core/integrations/ai'],
    ['PUT', '/v1/core/integrations/ai/consent'],
    ['GET', '/v1/core/fx/rate?from=USD&to=EGP'],
    ['GET', '/v1/core/fx/today'],
    ['POST', '/v1/core/integrations/check/paymob'],
  ];
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, env)).status).toBe(401);
  });

  const src = readFileSync(join(__dirname, '../src/modules/core/integrationRoutes.ts'), 'utf8');
  it('reads need the view key, changes the manage key; no direct writes; the URL is never returned', () => {
    const declared = src.match(/integrationRoutes\.(get|post|put|delete)\(/g) ?? [];
    const guarded =
      src.match(/integrationRoutes\.(get|post|put|delete)\([^\n]*requirePermission\('core\.integrations\.(view|manage)'\)/g) ?? [];
    // 11 since sql/082 added POST /check/:kind ("Check connection"); every one of them is guarded
    expect(declared.length).toBe(11);
    expect(guarded.length).toBe(11);
    expect(src).not.toMatch(/(?<!Routes)\.(insert|update|upsert)\(/);
    expect(src).not.toContain('secret_id');
  });

  it('members and viewers cannot see or change integrations', () => {
    for (const role of ['member', 'viewer'] as const)
      expect(defaultPermissionsFor(role).filter((k) => k.startsWith('core.integrations.'))).toEqual([]);
  });
});
