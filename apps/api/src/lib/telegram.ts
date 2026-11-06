import type { Bindings } from '../env';

// Telegram Bot API (documentation/reference/04-telegram). One bot for the whole service: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
// (sent back by Telegram in X-Telegram-Bot-Api-Secret-Token on every webhook call) and TELEGRAM_BOT_USERNAME are Worker secrets.
// Telegram only delivers; it never decides anything (messages carry an "Open in the app" button, nothing else).

export type TelegramStart = { chatId: string; code: string | null; text: string };

/** The app's address for the "Open in the app" button: APP_URL, or the first allowed origin. */
export function appUrl(env: Bindings): string | null {
  const url = env.APP_URL ?? env.ALLOWED_ORIGINS.split(',')[0]?.trim();
  return url && /^https:\/\//.test(url) ? url : null;
}

/** A deep link that opens our bot and sends "/start <code>". */
export function startLink(env: Bindings, code: string): string | null {
  const bot = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  return bot && /^[A-Za-z0-9_]{5,32}$/.test(bot) ? `https://t.me/${bot}?start=${code}` : null;
}

/** Reads a private-chat text message from a Telegram update; `code` is set for "/start <code>". Anything else: null. */
export function parseUpdate(update: unknown): TelegramStart | null {
  const msg = (update as { message?: { chat?: { id?: unknown; type?: unknown }; text?: unknown } } | null)?.message;
  if (
    !msg?.chat ||
    msg.chat.type !== 'private' ||
    typeof msg.chat.id !== 'number' ||
    !Number.isSafeInteger(msg.chat.id) ||
    msg.chat.id <= 0
  )
    return null;
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const m = /^\/start(?:@\w+)?\s+([0-9a-f]{36})$/.exec(text);
  return { chatId: String(msg.chat.id), code: m ? (m[1] as string) : null, text };
}

export async function sendTelegram(
  env: Bindings,
  chatId: string,
  text: string,
  opts: { buttonUrl?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram is not configured on this server');
  const body: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
  if (opts.buttonUrl) body.reply_markup = { inline_keyboard: [[{ text: 'Open in the app / افتح التطبيق', url: opts.buttonUrl }]] };
  const res = await (opts.fetchImpl ?? fetch)(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Never put the URL (it contains the token) in an error message.
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { description?: string } | null)?.description ?? '';
    throw new Error(`Telegram returned ${res.status}${detail ? `: ${detail.slice(0, 150)}` : ''}`);
  }
}
