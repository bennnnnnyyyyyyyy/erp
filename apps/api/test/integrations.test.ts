import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor } from '@erp/shared';
import app from '../src/index';
import type { Bindings } from '../src/env';
import type { OutboxMessage } from '../src/lib/channels';
import { type IntegrationDeps, type IntegrationState, makeIntegrationAdapters } from '../src/lib/channels/integrations';
import { groupRates } from '../src/jobs/fx';
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
  const [email, slack, teams, telegram] = makeIntegrationAdapters(deps);
  return { email: email!, slack: slack!, teams: teams!, telegram: telegram!, calls };
}

describe('integration adapters', () => {
  it('simulated mode sends nothing and says so', async () => {
    const f = fakes({ enabled: true, mode: 'simulated' }, 'https://hooks.slack.com/x');
    expect(await f.email.send(msg(), env)).toBe('simulated');
    expect(await f.slack.send(msg({ channel: 'slack', recipient_id: null }), env)).toBe('simulated');
    expect(f.calls).toEqual([]);
  });

  it('a switched-off integration skips queued messages, but a test message still goes', async () => {
    const f = fakes({ enabled: false, mode: 'simulated' });
    expect(await f.email.send(msg(), env)).toBe('skipped (switched off)');
    expect(await f.email.send(msg({ subject: 'Test message from the ERP' }), env)).toBe('simulated');
  });

  it('live email refuses without our sending account, then sends once per message id', async () => {
    const f = fakes({ enabled: true, mode: 'live' });
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
    const f = fakes({ enabled: true, mode: 'live' }, 'https://hooks.slack.com/services/a/b/c');
    expect(await f.slack.send(msg({ channel: 'slack', recipient_id: null }), env)).toBe('slack-webhook');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ text: 'REQ-1 needs approval\n\nTwo items' });
    expect(await f.teams.send(msg({ channel: 'teams', recipient_id: null }), env)).toBe('teams-webhook');
    expect(JSON.parse(String(f.calls[1]!.init.body)).attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    const none = fakes({ enabled: true, mode: 'live' }, null);
    await expect(none.slack.send(msg({ channel: 'slack' }), env)).rejects.toThrow(/No Slack webhook URL/);
  });

  it('never sends a one-time code to a shared channel', async () => {
    const f = fakes({ enabled: true, mode: 'live' }, 'https://hooks.slack.com/services/a/b/c');
    await f.slack.send(msg({ channel: 'slack', secret_body: 'CODE 123456' }), env);
    expect(String(f.calls[0]!.init.body)).not.toContain('123456');
  });
});

describe('telegram', () => {
  const tgEnv = { ...env, TELEGRAM_BOT_TOKEN: '123:abc', APP_URL: 'https://erp-live.pages.dev' } as Bindings;

  it('sends to the linked chat with an "Open in the app" button, and never puts the token in an error', async () => {
    const f = fakes({ enabled: true, mode: 'live' });
    expect(await f.telegram.send(msg({ channel: 'telegram' }), tgEnv)).toBe('telegram-bot');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    const body = JSON.parse(String(call.init.body)) as { chat_id: string; reply_markup: { inline_keyboard: { url: string }[][] } };
    expect(body.chat_id).toBe('424242');
    expect(body.reply_markup.inline_keyboard[0]![0]!.url).toBe('https://erp-live.pages.dev');
    const failing = makeIntegrationAdapters({
      state: async () => ({ enabled: true, mode: 'live' }),
      secret: async () => null,
      email: async () => null,
      telegramChat: async () => '1',
      fetch: (async () => new Response(JSON.stringify({ description: 'chat not found' }), { status: 400 })) as unknown as typeof fetch,
    })[3]!;
    await expect(failing.send(msg({ channel: 'telegram' }), tgEnv)).rejects.toThrow(/^Telegram returned 400: chat not found$/);
  });

  it('simulated mode sends nothing; a person who never linked is a visible failure in live mode', async () => {
    expect(await fakes({ enabled: true, mode: 'simulated' }).telegram.send(msg({ channel: 'telegram' }), tgEnv)).toBe('simulated');
    const unlinked = makeIntegrationAdapters({
      state: async () => ({ enabled: true, mode: 'live' }),
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

describe('integration routes', () => {
  const ID = 'email';
  const routes: [string, string][] = [
    ['GET', '/v1/core/integrations'],
    ['PUT', `/v1/core/integrations/${ID}`],
    ['PUT', '/v1/core/integrations/slack/secret'],
    ['DELETE', '/v1/core/integrations/slack/secret'],
    ['POST', `/v1/core/integrations/${ID}/test`],
    ['GET', '/v1/core/integrations/providers'],
    ['PUT', '/v1/core/integrations/providers/paymob/fields'],
    ['PUT', '/v1/core/integrations/providers/paymob'],
    ['GET', '/v1/core/integrations/ai'],
    ['PUT', '/v1/core/integrations/ai/consent'],
    ['GET', '/v1/core/fx/rate?from=USD&to=EGP'],
    ['GET', '/v1/core/fx/today'],
  ];
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, env)).status).toBe(401);
  });

  const src = readFileSync(join(__dirname, '../src/modules/core/integrationRoutes.ts'), 'utf8');
  it('reads need the view key, changes the manage key; no direct writes; the URL is never returned', () => {
    const declared = src.match(/integrationRoutes\.(get|post|put|delete)\(/g) ?? [];
    const guarded =
      src.match(/integrationRoutes\.(get|post|put|delete)\([^\n]*requirePermission\('core\.integrations\.(view|manage)'\)/g) ?? [];
    expect(declared.length).toBe(10);
    expect(guarded.length).toBe(10);
    expect(src).not.toMatch(/(?<!Routes)\.(insert|update|upsert)\(/);
    expect(src).not.toContain('secret_id');
  });

  it('members and viewers cannot see or change integrations', () => {
    for (const role of ['member', 'viewer'] as const)
      expect(defaultPermissionsFor(role).filter((k) => k.startsWith('core.integrations.'))).toEqual([]);
  });
});
