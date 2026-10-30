import type { Bindings } from '../../env';
import { adminDb } from '../db.admin';
import { sendText } from '../whatsapp';
import type { ChannelAdapter, OutboxMessage } from './index';

// The real WhatsApp channel. It only DELIVERS a message to the recipient's number; it decides nothing.
// The number comes from the identity table: the verified number of the recipient, or for a verification code the
// pending number the code is for. A person with no number gets a visible failure, not a silent skip.

export type AddressLookup = (env: Bindings, message: OutboxMessage) => Promise<string | null>;

const lookupFromDatabase: AddressLookup = async (env, message) => {
  const client = adminDb(env);
  const query = client.from('msg_identities').select('address').eq('org_id', message.org_id).eq('channel', 'whatsapp');
  const { data, error } =
    message.kind === 'verification' && message.entity_id
      ? await query.eq('id', message.entity_id).maybeSingle<{ address: string }>()
      : await query.eq('user_id', message.recipient_id).eq('status', 'verified').maybeSingle<{ address: string }>();
  if (error) throw new Error(error.message);
  return data?.address ?? null;
};

export function makeWhatsAppAdapter(lookup: AddressLookup = lookupFromDatabase): ChannelAdapter {
  return {
    kind: 'whatsapp',
    async send(message, env) {
      const address = await lookup(env, message);
      if (!address) throw new Error('The recipient has no verified WhatsApp number');
      // The secret part (a code or a one-time decision token) is only ever sent, never stored in readable form.
      const text = message.secret_body ?? [message.subject, message.body].filter(Boolean).join('\n');
      await sendText(env, address, text);
    },
  };
}
