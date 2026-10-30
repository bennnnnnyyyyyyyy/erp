import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { makeWhatsAppAdapter } from './whatsapp';

// Channel adapters (neworder.md section 3). A channel only DELIVERS a message. It never approves, never changes
// stock and never decides anything: those go through the database functions with a person's identity. A failed
// `send` throws; the job records it and the database retries with backoff.

export type OutboxMessage = {
  id: string;
  org_id: string;
  recipient_id: string;
  channel: string;
  kind: string;
  subject: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  secret_body: string | null;
  attempts: number;
};

export interface ChannelAdapter {
  readonly kind: string;
  send(message: OutboxMessage, env: Bindings): Promise<void>;
}

/** In-app: the message becomes a notification in the person's inbox. Repeating a send creates nothing new. */
const inApp: ChannelAdapter = {
  kind: 'in_app',
  async send(message, env) {
    const { error } = await adminDb(env).rpc('msg_deliver_in_app', { p_outbox_id: message.id });
    if (error) throw new Error(error.message);
  },
};

/** A stand-in for a real provider, for tests and the demo: it "sends" unless the subject contains [fail]. */
const fake: ChannelAdapter = {
  kind: 'fake',
  async send(message) {
    if (message.subject.includes('[fail]')) throw new Error('The fake provider is down');
  },
};

const ADAPTERS = new Map<string, ChannelAdapter>([
  [inApp.kind, inApp],
  [fake.kind, fake],
  ['whatsapp', makeWhatsAppAdapter()],
]);

/** WhatsApp, voice and email are not connected yet: sending on them fails visibly instead of pretending. */
export function adapterFor(channel: string): ChannelAdapter {
  return (
    ADAPTERS.get(channel) ?? {
      kind: channel,
      async send() {
        throw new Error(`Channel "${channel}" is not configured`);
      },
    }
  );
}
