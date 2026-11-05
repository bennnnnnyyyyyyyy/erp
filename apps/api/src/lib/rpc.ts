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
  STORAGE_MISMATCH: {
    status: 409,
    message: "This item's storage condition does not match the destination warehouse",
    code: 'storage_mismatch',
  },
  BATCH_STOCK_SHORT: {
    status: 409,
    message: 'Not enough usable batch stock (quarantined and expired batches cannot move)',
    code: 'batch_stock_short',
  },
  INVALID_STATE: { status: 409, message: 'That is not possible in the current state', code: 'invalid_state' },
  NOT_FOUND: { status: 404, message: 'Not found', code: 'not_found' },
  MODULE_DISABLED: { status: 403, message: 'This module is not enabled for your organization', code: 'module_disabled' },
  BILL_QTY_EXCEEDS_RECEIVED: { status: 409, message: 'Billed quantity cannot exceed received quantity', code: 'bill_qty_exceeds_received' },
  DUPLICATE_INVOICE: { status: 409, message: 'That supplier invoice number is already recorded', code: 'duplicate_invoice' },
  SELF_CHANGE: { status: 403, message: "You can't change or disable yourself", code: 'not_allowed' },
  OWNER_ONLY: { status: 403, message: 'Only an owner can invite, change or disable an owner', code: 'not_allowed' },
  LAST_OWNER: { status: 403, message: 'An organization needs at least one owner', code: 'not_allowed' },
  ALREADY_MEMBER: { status: 409, message: 'This person is already a member (re-enable them if they are disabled)', code: 'already_member' },
  IN_USE: { status: 409, message: 'That is still in use', code: 'in_use' },
  NOTE_EXCEEDS_INVOICE: { status: 409, message: 'A credit note cannot credit more than was invoiced', code: 'note_exceeds_invoice' },
  PRODUCTION_NOT_READY: {
    status: 409,
    message: 'Production mode needs stored ETA credentials and a real signer, which are not set up',
    code: 'production_not_ready',
  },
  PERIOD_LOCKED: { status: 409, message: 'That date is in a locked period', code: 'period_locked' },
  DUE_BEFORE_INVOICE: { status: 400, message: 'The due date cannot be before the invoice date', code: 'invalid_input' },
  COUNT_INCOMPLETE: { status: 409, message: 'Every line of the count needs a counted quantity first', code: 'count_incomplete' },
  RETURN_EXCEEDS_ISSUED: {
    status: 409,
    message: 'Cannot return more than was delivered and not yet returned',
    code: 'return_exceeds_issued',
  },
  UNKNOWN_UNIT: { status: 400, message: 'That unit is not set up for this item', code: 'unknown_unit' },
  ACTIVE_NOTES: {
    status: 409,
    message: 'Credit or debit notes still refer to this invoice: cancel or reject them first',
    code: 'active_notes',
  },
};

/** Calls a database function as the signed-in user and turns our reason codes into HTTP errors. */
export async function callRpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    // A unique index refused a duplicate (for example two branches with the same code): a plain 409, not a server error.
    if (error.code === '23505') throw new HttpError(409, 'That already exists', 'duplicate');
    const reason = REASONS[error.message.trim()];
    // The database puts the specifics (for example "30 available, 80 requested") in `details`.
    if (reason) throw new HttpError(reason.status, error.details ? `${reason.message}: ${error.details}` : reason.message, reason.code);
    throw error;
  }
  return data as T;
}
