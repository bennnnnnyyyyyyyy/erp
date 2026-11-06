import type { Bindings } from '../env';
import { adminDb } from './db.admin';
import { parseUpdate, sendTelegram } from './telegram';

// Our Telegram webhook's work, after index.ts has checked Telegram's secret header. The only thing a person can do from Telegram is
// finish linking ("/start <code>" from the app's link); everything else gets a short reply pointing to the app. Nothing is decided here.

const REPLIES = {
  linked: (org: string) => `Linked to ${org}. You will get your ERP messages here.\nتم الربط مع ${org}. ستصلك رسائل النظام هنا.`,
  expired:
    'This link has expired or was already used. Open the app and press "Connect Telegram" again.\nانتهت صلاحية الرابط أو استُخدم. افتح التطبيق واضغط "ربط تيليجرام" مرة أخرى.',
  taken: 'This Telegram account is already linked to someone else in that company.\nحساب تيليجرام هذا مرتبط بشخص آخر في هذه الشركة.',
  other:
    'This bot only sends notifications. Please use the app to reply or decide.\nهذا الحساب يرسل الإشعارات فقط. استخدم التطبيق للرد أو اتخاذ القرار.',
};

export async function processTelegramUpdate(env: Bindings, update: unknown): Promise<'linked' | 'refused' | 'ignored'> {
  const msg = parseUpdate(update);
  if (!msg) return 'ignored';
  if (!msg.code) {
    await sendTelegram(env, msg.chatId, REPLIES.other).catch(() => undefined);
    return 'ignored';
  }
  const { data, error } = await adminDb(env).rpc('msg__telegram_link_complete', { p_code: msg.code, p_chat_id: msg.chatId });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { ok?: boolean; reason?: string; org?: string };
  const text = r.ok ? REPLIES.linked(r.org ?? '') : r.reason === 'taken' ? REPLIES.taken : REPLIES.expired;
  await sendTelegram(env, msg.chatId, text).catch(() => undefined);
  return r.ok ? 'linked' : 'refused';
}
