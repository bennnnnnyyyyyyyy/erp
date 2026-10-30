import type { Bindings } from '../env';
import { adminDb } from './db.admin';
import { sendText, type InboundText } from './whatsapp';

// Inbound WhatsApp text. The webhook has already checked Meta's signature. Here the text is handed to the database
// functions (sql/009 and sql/010), which find the person by their VERIFIED number and apply the same rules as the app.
// This code never decides anything itself and never says whether an unknown number exists: it stays silent for them.

type Outcome = { ok: boolean; code: string; decision?: string; status?: string; tasks?: { ref: string; title: string }[] };

const REFUSAL: Record<string, string> = {
  TOKEN_INVALID: 'That code is not valid for this number.',
  TOKEN_USED: 'That code was already used.',
  TOKEN_EXPIRED: 'That code has expired. Please open the app to decide.',
  INVALID_STATE: 'That request or task has already been dealt with.',
  FORBIDDEN: 'You do not have permission to do that. Please open the app.',
  SELF_APPROVAL: 'You cannot approve your own request.',
  NO_OPEN_TASK: 'You have no open task to update.',
};

export function replyFor(o: Outcome, kind: 'decision' | 'task'): string | null {
  if (o.ok) return kind === 'decision' ? `Done. You ${o.decision}. Thank you.` : o.status === 'done' ? 'Done. The task is marked as completed.' : 'Thanks. The task is marked as acknowledged.';
  if (o.code === 'AMBIGUOUS' && o.tasks) return `You have several open tasks. Reply with the reference, for example "DONE ${o.tasks[0]?.ref}":\n${o.tasks.map((t) => `${t.ref}: ${t.title}`).join('\n')}`;
  if (o.code === 'UNKNOWN_IDENTITY' || o.code === 'NOT_A_DECISION' || o.code === 'NOT_A_TASK_REPLY') return null;
  return REFUSAL[o.code] ?? 'That was not accepted. Please open the app.';
}

export async function processInbound(env: Bindings, messages: InboundText[]): Promise<{ handled: number; replied: number }> {
  const client = adminDb(env);
  let handled = 0;
  let replied = 0;
  for (const m of messages) {
    const address = `+${m.from}`;
    let reply: string | null = null;

    const decided = await client.rpc('msg_decide_by_token', { p_channel: 'whatsapp', p_address: address, p_text: m.text });
    if (decided.error) {
      console.error('inbound decision failed', decided.error.message);
      continue;
    }
    const d = decided.data as Outcome;
    if (d.code !== 'NOT_A_DECISION') {
      handled++;
      reply = replyFor(d, 'decision');
    } else {
      const task = await client.rpc('msg_task_reply', { p_channel: 'whatsapp', p_address: address, p_text: m.text });
      if (task.error) {
        console.error('inbound task reply failed', task.error.message);
        continue;
      }
      const t = task.data as Outcome;
      if (t.code !== 'NOT_A_TASK_REPLY') handled++;
      reply = replyFor(t, 'task');
    }

    if (reply) {
      try {
        await sendText(env, address, reply);
        replied++;
      } catch (e) {
        console.error('inbound reply not sent', e instanceof Error ? e.message : String(e));
      }
    }
  }
  return { handled, replied };
}
