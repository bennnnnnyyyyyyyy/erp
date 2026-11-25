import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors';

// Reason codes raised by our Postgres functions (`raise exception 'CODE'`) and the HTTP answer for each.
const REASONS: Record<string, { status: number; message: string; code: string }> = {
  ORG_REQUIRED: { status: 400, message: 'Choose an organization first', code: 'org_required' },
  NOT_A_MEMBER: { status: 403, message: "You aren't a member of this organization", code: 'not_a_member' },
  FORBIDDEN: { status: 403, message: "You don't have permission to do that", code: 'forbidden' },
  INVALID_INPUT: { status: 400, message: 'That value is not valid', code: 'invalid_input' },
  APPROVAL_REQUIRED: { status: 409, message: 'This needs an approved request first', code: 'approval_required' },
  SELF_APPROVAL: {
    status: 403,
    message: 'You cannot approve your own request: another owner or manager must approve it',
    code: 'self_approval',
  },
  TOO_SOON: { status: 429, message: 'Wait 30 seconds before checking this connection again', code: 'too_soon' },
  NOT_APPROVED: {
    status: 409,
    message: 'This purchase order needs approval before goods can be received',
    code: 'not_approved',
  },
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
  // sql/109: a saved report's name is used once among the reports a person can see.
  DUPLICATE_NAME: { status: 409, message: 'A report with that name already exists', code: 'duplicate_name' },
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
  // Accounting (sql/045-049).
  UNBALANCED: { status: 400, message: 'Debits and credits must be equal', code: 'unbalanced' },
  NOT_LEAF: { status: 400, message: 'Post to a detail account, not a group account', code: 'not_leaf' },
  ACCOUNT_INACTIVE: { status: 400, message: 'That account is inactive or not part of this company', code: 'account_inactive' },
  ACCOUNT_ROLE_MISSING: { status: 409, message: 'An account role is not set up in Accounting setup', code: 'account_role_missing' },
  // sql/067 bank statements (dead-ends audit, 25 Nov 2026: both showed "Something went wrong on our side").
  DUPLICATE_FILE: { status: 409, message: 'This file was already imported for this account', code: 'duplicate_file' },
  RECONCILE_DIFFERENCE: { status: 409, message: 'The statement does not match the books yet', code: 'reconcile_difference' },
  HAS_ENTRIES: { status: 409, message: 'That account already has entries', code: 'has_entries' },
  APPEND_ONLY: { status: 409, message: 'Posted entries cannot be changed; reverse them instead', code: 'append_only' },
  UNCOSTED_RECEIPTS: {
    status: 409,
    message: 'Some stock receipts have no cost yet: enter them in Accounting setup first',
    code: 'uncosted_receipts',
  },
  RECEIPT_COST_REQUIRED: { status: 400, message: 'With accounting on, received stock needs a unit cost', code: 'receipt_cost_required' },
  NOTE_REQUIRED: { status: 400, message: 'A payment by "other" needs a note saying how it was paid', code: 'note_required' },
  USE_SWITCH_ON: {
    status: 400,
    message: 'Accounting is switched on from Accounting setup and cannot be switched off',
    code: 'use_switch_on',
  },
  DUPLICATE: { status: 409, message: 'That already exists', code: 'duplicate' },
  NOT_TRACKED: { status: 400, message: 'That item does not track batches', code: 'not_tracked' },
  EXPIRED: { status: 400, message: 'That batch has already expired', code: 'expired' },
  // Treasury (sql/051).
  TREASURY_ACCOUNT_REQUIRED: {
    status: 400,
    message: 'Choose the cash box or bank account the money went through',
    code: 'treasury_account_required',
  },
  TREASURY_MISMATCH: { status: 400, message: 'That cash box or bank account does not fit this payment', code: 'treasury_mismatch' },
  SAME_ACCOUNT: { status: 400, message: 'Choose two different accounts', code: 'same_account' },
  CURRENCY_MISMATCH: { status: 400, message: 'Both accounts must hold the same currency', code: 'currency_mismatch' },
  HAS_BALANCE: { status: 409, message: 'That account still holds money: transfer it out first', code: 'has_balance' },
  RATE_LIMITED: { status: 429, message: 'Too many tries; wait a while and try again', code: 'rate_limited' },
  OVERPAYMENT: { status: 409, message: 'That is more than is still owed', code: 'overpayment' },
  // UX audit 9 Nov 2026: codes the database raised that had no message, so people saw "Something went wrong on our side".
  HAS_PAYMENTS: { status: 409, message: 'This expense has payments: void its payments first', code: 'has_payments' },
  NOT_DELIVERED: { status: 409, message: 'Only delivered orders can be invoiced', code: 'not_delivered' },
  INVOICE_QTY_EXCEEDS_DELIVERED: {
    status: 409,
    message: 'You cannot invoice more than was delivered',
    code: 'invoice_qty_exceeds_delivered',
  },
  // sql/086: VAT registered but no rate to use (no default chosen, or the default rate was removed).
  VAT_RATE_MISSING: {
    status: 409,
    message: 'Choose the default VAT rate in Settings, then try again',
    code: 'vat_rate_missing',
  },
  // sql/087: purchase VAT as printed, and deductible input VAT.
  VAT_MISMATCH: { status: 409, message: 'The VAT entered does not match the rates on the lines', code: 'vat_mismatch' },
  VAT_NOT_DEDUCTIBLE: { status: 409, message: 'This VAT cannot be deducted', code: 'vat_not_deductible' },
  // sql/088: Shopify prices include VAT, which is not supported yet (VAT plan part 5).
  VAT_SHOPIFY_NOT_SUPPORTED: { status: 409, message: 'VAT and Shopify cannot be used together yet', code: 'vat_shopify_not_supported' },
  EMAIL_NOT_CONFIRMED: { status: 403, message: 'Confirm your email address first, then try again', code: 'email_not_confirmed' },
  LIMIT_REACHED: { status: 409, message: 'You have reached the limit of companies you can create', code: 'limit_reached' },
  NOT_SIGNED_IN: { status: 401, message: 'Your session has ended: sign in again', code: 'not_signed_in' },
};

/** "1.000" -> "1", "2.500" -> "2.5": quantities are stored with three decimals but people should not read them. */
export const trimQty = (text: string): string =>
  text.replace(/(\d+)\.(\d*?)0+(?!\d)/g, (_m, i: string, d: string) => (d ? `${i}.${d}` : i));

/**
 * The plain sentence for a stock shortage, from the database's detail: "0.000 available, 1.000 requested", or since sql/112 with the
 * item first, "RS-1 Cream: 0.000 available, 1.000 requested" (so a form with many lines says which one).
 */
export function stockShortMessage(details: string): string | null {
  const m = /^(?:(.{1,260}): )?(-?[\d.]+) available, (-?[\d.]+) requested$/.exec(details.trim());
  if (!m) return null;
  const item = m[1]?.trim();
  const available = trimQty(m[2] as string);
  const asked = trimQty(m[3] as string);
  const verb = available === '1' ? 'is' : 'are';
  return item
    ? `Not enough stock of ${item}: you asked for ${asked}, but only ${available} ${verb} available in this warehouse.`
    : `Not enough stock: you asked for ${asked}, but only ${available} ${verb} available in this warehouse.`;
}

export const VAT_MISMATCH_MESSAGE =
  "The VAT entered is too far from the VAT worked out from the line rates: check the VAT you typed against the supplier's invoice, and the rate on each line";

/** Calls a database function as the signed-in user and turns our reason codes into HTTP errors. */
export async function callRpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    // A unique index refused a duplicate (for example two branches with the same code): a plain 409, not a server error.
    if (error.code === '23505') throw new HttpError(409, 'That already exists', 'duplicate');
    const reason = REASONS[error.message.trim()];
    // The database puts the specifics (for example "30 available, 80 requested") in `details`.
    if (reason) {
      const short = reason.code === 'insufficient_available' && error.details ? stockShortMessage(error.details) : null;
      if (short) throw new HttpError(reason.status, short, reason.code);
      // VAT_MISMATCH's detail gives both amounts in minor units ("(250) … (168)"), which read as 250 pounds (walkthrough 19 Nov).
      if (reason.code === 'vat_mismatch') throw new HttpError(reason.status, VAT_MISMATCH_MESSAGE, reason.code);
      // A detail that only repeats the message (e.g. NOT_APPROVED: "this purchase order needs approval…") is left out, so the person
      // does not read the same sentence twice (Ben's walkthrough, 10 Nov 2026).
      // People read the detail: no raw record ids ("stock receipt 3f2a… has no cost"), and an account role key reads as words
      // ("inventory_asset" -> "inventory asset"; dead-ends audit, 25 Nov 2026).
      let detail = error.details
        ? trimQty(error.details)
            .replace(/\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
            .trim()
        : '';
      if (reason.code === 'account_role_missing') detail = detail.replace(/_/g, ' ');
      const repeats = detail && reason.message.toLowerCase().includes(detail.toLowerCase().replace(/\.$/, ''));
      throw new HttpError(reason.status, detail && !repeats ? `${reason.message}: ${detail}` : reason.message, reason.code);
    }
    throw error;
  }
  return data as T;
}

/**
 * A plain message for a Postgres error that is not one of our own reasons (input and speed audit, 25 Nov 2026): a statement timeout,
 * a database rule (check, length, date, number) or a busy server all showed "Something went wrong on our side". Null when the code
 * is not one of these (the caller keeps its generic 500). The raw text is logged, never shown.
 */
export function plainDbError(err: unknown): HttpError | null {
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case '57014':
      return new HttpError(503, 'This took too long. Try a shorter period or fewer rows, or try again in a moment', 'timeout');
    case '40P01':
    case '40001':
    case '53300':
    case '55P03':
      return new HttpError(503, 'The server is busy. Try again in a moment', 'busy');
    case '42501':
      return new HttpError(403, 'You are not allowed to do that', 'forbidden');
    case '23505':
      return new HttpError(409, 'That already exists', 'duplicate');
    case '23503':
      return new HttpError(409, 'That is still linked to other records', 'in_use');
    case '23514':
    case '23502':
      return new HttpError(400, 'A value is missing or outside what is allowed', 'invalid_input');
    case '22007':
    case '22008':
      return new HttpError(400, 'That date is not valid', 'invalid_input');
    case '22003':
      return new HttpError(400, 'A number is too large', 'invalid_input');
    case '22001':
      return new HttpError(400, 'A text is too long', 'invalid_input');
    case '22P02':
      return new HttpError(400, 'A value is not in the right form', 'invalid_input');
    default:
      return null;
  }
}
