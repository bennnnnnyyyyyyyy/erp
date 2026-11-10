import { Hono, type Context } from 'hono';
import type { AccountLine, TreasuryAccount, TreasuryKind, TreasuryTransfer } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { csvResponse, minorToText } from '../../lib/csv';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';
import { statementRoutes } from './statements';

// Treasury (documentation/plans/TREASURY_PLAN.md; database sql/051). Cash boxes, bank accounts and clearing accounts, each on its
// own ledger account; balances and lines come from the ledger. Owners and admins only (no ".read" key); the database narrows managing
// accounts to the owner and the head accountant. Every change is one database function that checks, changes and audits.
export const treasuryRoutes = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: TreasuryKind[] = ['cash', 'bank', 'clearing'];
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const num = (x: unknown) => Number(x ?? 0);
const idParam = (c: Ctx) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};

type BalanceRow = {
  account_id: string;
  code: string;
  name: string;
  name_ar: string | null;
  kind: TreasuryKind;
  currency: string;
  branch_id: string | null;
  ledger_account_id: string;
  active: boolean;
  balance_minor: number;
};

/** Every treasury account with its balance today (from the ledger) and its bank details. */
async function loadAccounts(c: Ctx): Promise<TreasuryAccount[]> {
  const rows = await callRpc<BalanceRow[]>(userDb(c), 'trs_balances', { p_on: null });
  const { data, error } = await userDb(c).from('trs_accounts').select('id, bank_name, bank_account_no').eq('org_id', c.var.tenant.orgId);
  if (error) throw error;
  const bank = new Map((data ?? []).map((r) => [r.id as string, r as { bank_name: string | null; bank_account_no: string | null }]));
  return (rows ?? []).map((r) => ({
    id: r.account_id,
    code: r.code,
    name: r.name,
    nameAr: r.name_ar,
    kind: r.kind,
    currency: String(r.currency).trim(),
    branchId: r.branch_id,
    ledgerAccountId: r.ledger_account_id,
    bankName: bank.get(r.account_id)?.bank_name ?? null,
    bankAccountNo: bank.get(r.account_id)?.bank_account_no ?? null,
    active: r.active,
    balanceMinor: num(r.balance_minor),
  }));
}

treasuryRoutes.route('/statements', statementRoutes);
treasuryRoutes.get('/accounts', requirePermission('treasury.accounts.view'), async (c) => ok(c, await loadAccounts(c)));

// The default accounts on the role accounts (main cash box, main bank account, clearing accounts). Safe to repeat.
treasuryRoutes.post('/setup/prepare', requirePermission('treasury.accounts.manage'), async (c) => {
  return ok(c, await callRpc<{ accountsAdded: number; accounts: number }>(userDb(c), 'trs_prepare'));
});

function accountBody(b: Record<string, unknown>) {
  const code = text(b.code).toUpperCase();
  const name = text(b.name);
  const kind = text(b.kind) as TreasuryKind;
  const currency = text(b.currency).toUpperCase();
  const branchId = text(b.branchId);
  const ledgerAccountId = text(b.ledgerAccountId);
  if (!/^[A-Z0-9-]{1,20}$/.test(code) || !name) invalid('A code (letters, digits, dash; up to 20) and a name are required');
  if (!KINDS.includes(kind)) invalid('kind must be cash, bank or clearing');
  if (currency && !/^[A-Z]{3}$/.test(currency)) invalid('currency must be a three-letter code');
  if ((branchId && !UUID_RE.test(branchId)) || (ledgerAccountId && !UUID_RE.test(ledgerAccountId)))
    invalid('Invalid branch or ledger account');
  return {
    p_code: code,
    p_name: name,
    p_name_ar: text(b.nameAr) || null,
    p_kind: kind,
    p_currency: currency || null,
    p_branch_id: branchId || null,
    p_ledger_account_id: ledgerAccountId || null,
    p_create_ledger: b.createLedgerAccount === true,
    p_bank_name: text(b.bankName) || null,
    p_bank_account_no: text(b.bankAccountNo) || null,
    p_active: b.active === undefined ? true : b.active === true,
  };
}

treasuryRoutes.post('/accounts', requirePermission('treasury.accounts.manage'), async (c) => {
  const body = accountBody(await jsonBody(c));
  if (!body.p_create_ledger && !body.p_ledger_account_id) invalid('Choose a ledger account, or ask for one to be created');
  const id = await callRpc<string>(userDb(c), 'trs_save_account', { p_id: null, ...body });
  return ok(c, { id }, 201);
});

// Name, Arabic name, code, branch, bank details, active. Kind, currency and ledger account never change (the database refuses).
treasuryRoutes.patch('/accounts/:id', requirePermission('treasury.accounts.manage'), async (c) => {
  const id = idParam(c);
  const body = accountBody(await jsonBody(c));
  await callRpc<string>(userDb(c), 'trs_save_account', { p_id: id, ...body, p_create_ledger: false });
  return ok(c, { id });
});

// The account's lines in a period with a running balance (its ledger account's lines, sql/049). ?format=csv downloads them.
treasuryRoutes.get('/accounts/:id/lines', requirePermission('treasury.accounts.view'), async (c) => {
  const id = idParam(c);
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) invalid('from and to are required (YYYY-MM-DD), with to on or after from');
  const { data: acc, error } = await userDb(c)
    .from('trs_accounts')
    .select('code, ledger_account_id, currency')
    .eq('org_id', c.var.tenant.orgId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!acc) throw new HttpError(404, 'Treasury account not found', 'not_found');
  const currency = String(acc.currency).trim();
  const rows = await callRpc<
    {
      line_id: number | null;
      entry_id: string | null;
      entry_number: string | null;
      entry_date: string;
      source_type: string | null;
      source_id: string | null;
      event: string | null;
      memo: string | null;
      account_code: string | null;
      party_type: 'customer' | 'supplier' | null;
      party_id: string | null;
      debit_minor: number;
      credit_minor: number;
      balance_minor: number;
      is_opening: boolean;
    }[]
  >(userDb(c), 'acc_account_lines', { p_account_id: acc.ledger_account_id, p_from: from, p_to: to, p_currency: currency });
  const lines: AccountLine[] = (rows ?? []).map((r) => ({
    isOpening: r.is_opening,
    lineId: r.line_id === null ? null : Number(r.line_id),
    entryId: r.entry_id,
    entryNumber: r.entry_number,
    entryDate: r.entry_date,
    sourceType: r.source_type,
    sourceId: r.source_id,
    event: r.event,
    memo: r.memo,
    accountCode: r.account_code,
    partyType: r.party_type,
    partyId: r.party_id,
    debitMinor: num(r.debit_minor),
    creditMinor: num(r.credit_minor),
    balanceMinor: num(r.balance_minor),
  }));
  if (c.req.query('format') !== 'csv') return ok(c, { currency, lines });
  return csvResponse(
    c,
    `${acc.code}-${from}-to-${to}.csv`,
    ['date', 'entry', 'description', 'in', 'out', 'balance', 'currency'],
    lines.map((l) => [
      l.entryDate,
      l.entryNumber,
      l.isOpening ? 'Opening balance' : l.memo,
      minorToText(l.debitMinor, currency),
      minorToText(l.creditMinor, currency),
      minorToText(l.balanceMinor, currency),
      currency,
    ]),
  );
});

// ------------------------------------------------------------------ transfers

type TransferRow = {
  id: string;
  number: string;
  from_account_id: string;
  to_account_id: string;
  amount_minor: number;
  currency: string;
  transfer_date: string;
  note: string | null;
  status: 'recorded' | 'void';
  entry_id: string | null;
  created_by: string;
  created_at: string;
};

treasuryRoutes.get('/transfers', requirePermission('treasury.accounts.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('trs_transfers')
    .select(
      'id, number, from_account_id, to_account_id, amount_minor, currency, transfer_date, note, status, entry_id, created_by, created_at',
    )
    .eq('org_id', c.var.tenant.orgId)
    .order('transfer_date', { ascending: false })
    .order('number', { ascending: false })
    .limit(300);
  if (error) throw error;
  return ok<TreasuryTransfer[]>(
    c,
    ((data ?? []) as TransferRow[]).map((t) => ({
      id: t.id,
      number: t.number,
      fromAccountId: t.from_account_id,
      toAccountId: t.to_account_id,
      amountMinor: num(t.amount_minor),
      currency: String(t.currency).trim(),
      transferDate: t.transfer_date,
      note: t.note,
      status: t.status,
      entryId: t.entry_id,
      createdBy: t.created_by,
      createdAt: t.created_at,
    })),
  );
});

treasuryRoutes.post('/transfers', requirePermission('treasury.transfers.create'), async (c) => {
  const b = await jsonBody(c);
  const from = text(b.fromAccountId);
  const to = text(b.toAccountId);
  const amount = Number(b.amountMinor);
  const date = text(b.date);
  if (!UUID_RE.test(from) || !UUID_RE.test(to) || !Number.isInteger(amount) || amount <= 0 || !DATE_RE.test(date))
    invalid('From, to, an amount above zero and a date are required');
  if (from === to) throw new HttpError(400, 'Choose two different accounts', 'same_account');
  const made = await callRpc<{ id: string; number: string; entryId: string }>(userDb(c), 'trs_record_transfer', {
    p_from: from,
    p_to: to,
    p_amount_minor: amount,
    p_date: date,
    p_note: text(b.note).slice(0, 500) || null,
  });
  return ok(c, made, 201);
});

treasuryRoutes.post('/transfers/:id/void', requirePermission('treasury.transfers.create'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'trs_void_transfer', { p_id: id });
  return ok(c, { id, status: 'void' });
});
