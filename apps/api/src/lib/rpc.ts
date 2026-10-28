import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors';

// Reason codes raised by our Postgres functions (`raise exception 'CODE'`) and the HTTP answer for each.
const REASONS: Record<string, { status: number; message: string; code: string }> = {
  ORG_REQUIRED: { status: 400, message: 'Choose an organization first', code: 'org_required' },
  NOT_A_MEMBER: { status: 403, message: "You aren't a member of this organization", code: 'not_a_member' },
  FORBIDDEN: { status: 403, message: "You don't have permission to do that", code: 'forbidden' },
  INVALID_INPUT: { status: 400, message: 'That value is not valid', code: 'invalid_input' },
  APPROVAL_REQUIRED: { status: 409, message: 'This needs an approved request first', code: 'approval_required' },
  SELF_APPROVAL: { status: 403, message: 'You cannot approve your own request', code: 'self_approval' },
  INSUFFICIENT_AVAILABLE: { status: 409, message: 'Not enough stock available', code: 'insufficient_available' },
};

/** Calls a database function as the signed-in user and turns our reason codes into HTTP errors. */
export async function callRpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const reason = REASONS[error.message.trim()];
    if (reason) throw new HttpError(reason.status, reason.message, reason.code);
    throw error;
  }
  return data as T;
}
