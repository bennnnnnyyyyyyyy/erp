import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { appUrl, sendTelegram } from '../telegram';
import type { ChannelAdapter, OutboxMessage } from './index';

// Email, Slack, Teams and Google Chat (documentation/plans/INTEGRATIONS_PLAN.md wave 1; sql/053). Like every channel, these only DELIVER a
// message; they never decide anything. There is no test mode (sql/082): a company's integration is off or on, and on means real:
// email through our sending account (Resend; RESEND_API_KEY and EMAIL_FROM are Worker secrets), Slack, Teams or Google Chat through the
// company's own webhook URL, read from Vault by the job only (core__integration_secret), Telegram through our bot.
// A company that switched an integration off after a message was queued gets "skipped", not a send. Tests replace the deps below, so a
// test run never reaches a provider.

export type IntegrationKind = 'email' | 'slack' | 'teams' | 'telegram' | 'google_chat';

/** Google Chat incoming webhooks (sql/071): the URL must point at the Chat API's spaces endpoint. */
export const GOOGLE_CHAT_URL_PREFIX = 'https://chat.googleapis.com/v1/spaces/';
export const isGoogleChatWebhookUrl = (url: string): boolean =>
  url.length <= 2000 && url.startsWith(GOOGLE_CHAT_URL_PREFIX) && url.length > GOOGLE_CHAT_URL_PREFIX.length + 10 && !/\s/.test(url);

/** Simple text message: the subject in bold (Chat's *bold*), then the body. Never a one-time code. */
export const googleChatPayload = (m: Pick<OutboxMessage, 'subject' | 'body'>) => ({
  text: [`*${m.subject.replace(/\*/g, '')}*`, m.body].filter(Boolean).join('\n\n'),
});

const WEBHOOK_LABEL = { slack: 'Slack', teams: 'Teams', google_chat: 'Google Chat' } as const;
export type IntegrationState = { enabled: boolean };

/** What the adapters need from the outside world; replaced in tests so nothing real is called. */
export type IntegrationDeps = {
  state(env: Bindings, orgId: string, kind: IntegrationKind): Promise<IntegrationState | null>;
  secret(env: Bindings, orgId: string, kind: IntegrationKind): Promise<string | null>;
  /** The recipient's email, only while they are an active member (sql/053 msg__recipient_email). */
  email(env: Bindings, outboxId: string): Promise<string | null>;
  /** The recipient's linked Telegram chat, only while they are an active member (sql/054 msg__recipient_telegram). */
  telegramChat(env: Bindings, outboxId: string): Promise<string | null>;
  fetch: typeof fetch;
};

const realDeps: IntegrationDeps = {
  async state(env, orgId, kind) {
    const { data, error } = await adminDb(env)
      .from('core_integrations')
      .select('enabled')
      .eq('org_id', orgId)
      .eq('kind', kind)
      .maybeSingle<IntegrationState>();
    if (error) throw new Error(error.message);
    return data;
  },
  async secret(env, orgId, kind) {
    const { data, error } = await adminDb(env).rpc('core__integration_secret', { p_org: orgId, p_kind: kind });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  },
  async email(env, outboxId) {
    const { data, error } = await adminDb(env).rpc('msg__recipient_email', { p_outbox_id: outboxId });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  },
  async telegramChat(env, outboxId) {
    const { data, error } = await adminDb(env).rpc('msg__recipient_telegram', { p_outbox_id: outboxId });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  },
  fetch: (input, init) => fetch(input, init),
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The text a person sees: subject and body; a secret part (a one-time code) is never sent to a shared channel. */
const plainText = (m: OutboxMessage) => [m.subject, m.body].filter(Boolean).join('\n\n');

async function check(res: Response, what: string) {
  if (res.ok) return;
  const detail = (await res.text().catch(() => '')).slice(0, 200);
  throw new Error(`${what} returned ${res.status}${detail ? `: ${detail}` : ''}`);
}

/** Decides skipped or sent; returns how the message was delivered (recorded as delivered_via). */
async function deliver(
  kind: IntegrationKind,
  message: OutboxMessage,
  env: Bindings,
  deps: IntegrationDeps,
  live: () => Promise<string>,
): Promise<string> {
  const state = await deps.state(env, message.org_id, kind);
  // A test message is sent whether or not the integration is switched on (that is what testing is for).
  const isTest = message.subject === 'Test message from the ERP';
  if (!state || (!state.enabled && !isTest)) return 'skipped (switched off)';
  return live();
}

export function makeIntegrationAdapters(deps: IntegrationDeps = realDeps): ChannelAdapter[] {
  const email: ChannelAdapter = {
    kind: 'email',
    send: (message, env) =>
      deliver('email', message, env, deps, async () => {
        if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error('Email sending is not configured on this server');
        if (!message.recipient_id) throw new Error('An email needs a recipient');
        const to = await deps.email(env, message.id);
        if (!to) throw new Error('The recipient has no email address');
        const text = message.secret_body ?? plainText(message);
        const res = await deps.fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'erp-worker',
            // The outbox retries; the same message id never sends twice (Resend keeps the key for 24 hours).
            'Idempotency-Key': message.id,
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [to],
            subject: message.subject,
            text,
            html: `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>`,
          }),
        });
        await check(res, 'Resend');
        return 'resend';
      }),
  };

  const webhook = (kind: 'slack' | 'teams' | 'google_chat'): ChannelAdapter => ({
    kind,
    send: (message, env) =>
      deliver(kind, message, env, deps, async () => {
        const url = await deps.secret(env, message.org_id, kind);
        if (!url) throw new Error(`No ${WEBHOOK_LABEL[kind]} webhook URL is saved`);
        if (kind === 'google_chat' && !isGoogleChatWebhookUrl(url)) throw new Error('The saved Google Chat webhook URL is not valid');
        const text = plainText(message);
        const payload =
          kind === 'slack'
            ? { text }
            : kind === 'google_chat'
              ? googleChatPayload(message)
              : {
                  // Teams Workflows webhook (Office 365 connectors were retired in May 2026): an Adaptive Card message.
                  type: 'message',
                  attachments: [
                    {
                      contentType: 'application/vnd.microsoft.card.adaptive',
                      content: {
                        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                        type: 'AdaptiveCard',
                        version: '1.4',
                        body: [
                          { type: 'TextBlock', text: message.subject, weight: 'Bolder', wrap: true },
                          ...(message.body ? [{ type: 'TextBlock', text: message.body, wrap: true }] : []),
                        ],
                      },
                    },
                  ],
                };
        const res = await deps.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'manual', // a webhook host must not bounce our post elsewhere (security review, 11 Nov 2026)
        });
        await check(res, WEBHOOK_LABEL[kind]);
        return `${kind}-webhook`;
      }),
  });

  // Telegram (sql/054): our one bot, to people who linked their Telegram; an "Open in the app" button, never a decision.
  const telegram: ChannelAdapter = {
    kind: 'telegram',
    send: (message, env) =>
      deliver('telegram', message, env, deps, async () => {
        const chat = await deps.telegramChat(env, message.id);
        if (!chat) throw new Error('The recipient has not linked Telegram');
        await sendTelegram(env, chat, message.secret_body ?? plainText(message), { buttonUrl: appUrl(env), fetchImpl: deps.fetch });
        return 'telegram-bot';
      }),
  };

  return [email, webhook('slack'), webhook('teams'), telegram, webhook('google_chat')];
}
