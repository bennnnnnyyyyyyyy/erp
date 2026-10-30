import type { Bindings } from '../env';

// WhatsApp Business Platform (Cloud API) helpers: sending, webhook signature check and webhook parsing.
// Nothing here decides anything: inbound text is handed to the database functions in lib/whatsappInbound.ts.
// Needs, as Worker settings (see documentation/plans/FEATURE_SET_AND_TECH_STACK.md section 4.1):
//   secrets:  WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
//   plain:    WHATSAPP_PHONE_NUMBER_ID, optional WHATSAPP_GRAPH_VERSION (default below), optional WHATSAPP_TEMPLATE_NAME
//             (an approved template with one body variable, used when a free-text message is refused outside the
//             24-hour window) and WHATSAPP_TEMPLATE_LANG (default "en").

const DEFAULT_GRAPH_VERSION = 'v21.0'; // Unverified against Meta's current default: override with WHATSAPP_GRAPH_VERSION.

export function whatsappConfigured(env: Bindings): boolean {
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

/** "+201001234567" becomes "201001234567", the form the API wants. */
export const toGraphNumber = (address: string) => address.replace(/^\+/, '');

async function post(env: Bindings, payload: unknown): Promise<void> {
  const version = env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const res = await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) return;
  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: number } };
    if (body.error) detail = `${body.error.message ?? 'error'} (code ${body.error.code ?? res.status})`;
  } catch {
    // keep the status text
  }
  throw new Error(`WhatsApp refused the message: ${detail.slice(0, 300)}`);
}

/** Sends one message. Free text first; if Meta refuses it and a template is configured, sends the template instead. */
export async function sendText(env: Bindings, address: string, text: string): Promise<void> {
  if (!whatsappConfigured(env)) throw new Error('WhatsApp is not configured on this server');
  const to = toGraphNumber(address);
  try {
    await post(env, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } });
  } catch (e) {
    if (!env.WHATSAPP_TEMPLATE_NAME) throw e;
    await post(env, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: env.WHATSAPP_TEMPLATE_NAME,
        language: { code: env.WHATSAPP_TEMPLATE_LANG || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }],
      },
    });
  }
}

/** Checks Meta's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body with the app secret), in constant time. */
export async function verifySignature(rawBody: string, header: string | null | undefined, secret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=') || !secret) return false;
  const given = header.slice('sha256='.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export type InboundText = { from: string; id: string; text: string };

/** Pulls the plain text messages out of a webhook payload. Status updates, voice notes and anything else are ignored here. */
export function parseWebhook(payload: unknown): InboundText[] {
  const out: InboundText[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } } | null)?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages as { from?: unknown; id?: unknown; type?: unknown; text?: { body?: unknown } }[]) {
        if (m?.type === 'text' && typeof m.from === 'string' && typeof m.id === 'string' && typeof m.text?.body === 'string') {
          out.push({ from: m.from, id: m.id, text: m.text.body.slice(0, 500) });
        }
      }
    }
  }
  return out;
}
