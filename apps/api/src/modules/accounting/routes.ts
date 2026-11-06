import { Hono, type Context } from 'hono';
import {
  ACCOUNT_KINDS,
  ACCOUNT_ROLES,
  hasPermission,
  journalProblem,
  type Account,
  type AccountKind,
  type AccountLine,
  type FiscalYear,
  type JournalLineInput,
  type LedgerEntry,
  type ManualJournal,
  type SwitchOnPreview,
  type SwitchOnResult,
  type TrialBalanceRow,
  type UncostedReceipt,
} from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { csvResponse, minorToText } from '../../lib/csv';
import { requirePermission } from '../../middleware/tenant';

// Accounting (documentation/plans/ACCOUNTING_PLAN.md sections 4 and 5; database sql/045-049). Owners and admins only: no key here ends
// in ".read", and the tables return nothing to anyone else. The database narrows further: the chart, account roles and receipt costs
// to the owner and the head accountant (acc__guard 'chart'), switch-on to the owner, direct posting and reversal to the owner and the
// head accountant. Every change is one database function that checks, changes and audits in one transaction (ADR-0003).
//
// The set-up routes (setup, accounts, roles, fiscal years, category accounts, issue reasons) work before accounting is on, so the
// company can prepare its chart and switch on (modules.ts `openBeforeEnabled`). Entries, journals and the trial balance need it on.
export const accountingRoutes = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CUR_RE = /^[A-Z]{3}$/;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const orgOf = (c: Ctx) => c.var.tenant.orgId;
const idParam = (c: Ctx) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};
const num = (x: unknown) => Number(x ?? 0);

/** A period from ?from=&to= (both required, YYYY-MM-DD) and an optional ?currency=. */
function period(c: Ctx) {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const currency = (c.req.query('currency') ?? '').toUpperCase();
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) invalid('from and to are required (YYYY-MM-DD), with to on or after from');
  if (currency && !CUR_RE.test(currency)) invalid('currency must be a three-letter code');
  return { from, to, currency: currency || null };
}

/** Every row a query returns, page by page (PostgREST caps a read at 1000 rows). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ------------------------------------------------------------------ set-up and switch-on (work before accounting is on)

// What switching on would do: chart size, missing roles, uncosted receipts, and how many documents the backfill will post.
accountingRoutes.get('/setup/preview', requirePermission('accounting.ledger.view'), async (c) => {
  return ok(c, await callRpc<SwitchOnPreview>(userDb(c), 'acc_switch_on_preview'));
});

// Add the default Egyptian chart (sql/045 acc__seed_chart). Safe to repeat: adds only what is missing.
accountingRoutes.post('/setup/prepare', requirePermission('accounting.chart.manage'), async (c) => {
  return ok(c, await callRpc<{ accountsAdded: number; accounts: number }>(userDb(c), 'acc_prepare'));
});

accountingRoutes.get('/setup/uncosted-receipts', requirePermission('accounting.ledger.view'), async (c) => {
  const rows = await callRpc<
    {
      move_id: number;
      posted_at: string;
      item_id: string;
      sku: string;
      item_name: string;
      warehouse_name: string;
      qty: number;
      ref: string | null;
      current_avg_cost_minor: number | null;
    }[]
  >(userDb(c), 'acc_uncosted_receipts');
  return ok<UncostedReceipt[]>(
    c,
    (rows ?? []).map((r) => ({
      moveId: Number(r.move_id),
      postedAt: r.posted_at,
      itemId: r.item_id,
      sku: r.sku,
      itemName: r.item_name,
      warehouseName: r.warehouse_name,
      qty: Number(r.qty),
      ref: r.ref,
      currentAvgCostMinor: r.current_avg_cost_minor === null ? null : Number(r.current_avg_cost_minor),
    })),
  );
});

// The cost of an old receipt that was recorded without one (sql/047). The database allows the owner and the head accountant.
accountingRoutes.put('/setup/receipt-costs/:moveId', requirePermission('accounting.chart.manage'), async (c) => {
  const moveId = Number(c.req.param('moveId'));
  const b = await jsonBody(c);
  const cost = Number(b.unitCostMinor);
  if (!Number.isSafeInteger(moveId) || moveId <= 0) throw new HttpError(404, 'Not found', 'not_found');
  if (!Number.isInteger(cost) || cost < 0) invalid('unitCostMinor must be a whole number of minor units, zero or more');
  await callRpc<void>(userDb(c), 'acc_set_receipt_cost', {
    p_move_id: moveId,
    p_unit_cost_minor: cost,
    p_rationale: text(b.rationale) || null,
  });
  return ok(c, { moveId, unitCostMinor: cost });
});

// Switch accounting on: posts every past document (oldest first, marked backfill) and enables the module, in one transaction.
// Owner only (database). Refused while a role is missing or a receipt has no cost. Cannot be undone.
accountingRoutes.post('/setup/switch-on', requirePermission('accounting.module.switch_on'), async (c) => {
  return ok(c, await callRpc<SwitchOnResult>(userDb(c), 'acc_switch_on'));
});

// Who may be head accountant (owners and admins), and who is. The owner sets the flag (database).
accountingRoutes.get('/setup/head-accountants', requirePermission('accounting.ledger.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('memberships')
    .select('id, user_id, role, is_head_accountant')
    .eq('org_id', orgOf(c))
    .is('disabled_at', null)
    .in('role', ['owner', 'admin'])
    .order('role');
  if (error) throw error;
  return ok(
    c,
    (data ?? []).map((m) => ({ membershipId: m.id, userId: m.user_id, role: m.role, isHeadAccountant: m.is_head_accountant === true })),
  );
});

accountingRoutes.put('/setup/head-accountants/:id', requirePermission('accounting.module.switch_on'), async (c) => {
  const id = idParam(c);
  const on = (await jsonBody(c)).on;
  if (typeof on !== 'boolean') invalid('on must be true or false');
  await callRpc<void>(userDb(c), 'acc_set_head_accountant', { p_membership_id: id, p_on: on });
  return ok(c, { membershipId: id, isHeadAccountant: on });
});

// ------------------------------------------------------------------ chart of accounts and account roles

type AccountRow = {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  parent_id: string | null;
  kind: AccountKind;
  active: boolean;
};

accountingRoutes.get('/accounts', requirePermission('accounting.ledger.view'), async (c) => {
  const rows = await fetchAll<AccountRow>((from, to) =>
    userDb(c)
      .from('acc_accounts')
      .select('id, code, name, name_ar, parent_id, kind, active')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('code')
      .range(from, to),
  );
  const parents = new Set(rows.map((r) => r.parent_id).filter(Boolean));
  return ok<Account[]>(
    c,
    rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      nameAr: r.name_ar,
      parentId: r.parent_id,
      kind: r.kind,
      active: r.active,
      isLeaf: !parents.has(r.id),
    })),
  );
});

accountingRoutes.post('/accounts', requirePermission('accounting.chart.manage'), async (c) => {
  const b = await jsonBody(c);
  const parentId = text(b.parentId);
  const code = text(b.code);
  const name = text(b.name);
  const kind = text(b.kind);
  if (parentId && !UUID_RE.test(parentId)) invalid('Invalid parent account');
  if (!/^[0-9]{1,20}$/.test(code) || !name) invalid('A numeric code and a name are required');
  if (!parentId && !ACCOUNT_KINDS.includes(kind as AccountKind)) invalid('A top-level account needs a kind');
  const id = await callRpc<string>(userDb(c), 'acc_create_account', {
    p_parent_id: parentId || null,
    p_code: code,
    p_name: name,
    p_name_ar: text(b.nameAr) || null,
    p_kind: kind || null,
  });
  return ok(c, { id }, 201);
});

accountingRoutes.patch('/accounts/:id', requirePermission('accounting.chart.manage'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const name = text(b.name);
  if (!name || typeof b.active !== 'boolean') invalid('A name and active (true or false) are required');
  await callRpc<void>(userDb(c), 'acc_update_account', { p_id: id, p_name: name, p_name_ar: text(b.nameAr) || null, p_active: b.active });
  return ok(c, { id });
});

// An account's lines in a period with a running balance; a group account includes its sub-accounts (sql/049).
accountingRoutes.get('/accounts/:id/lines', requirePermission('accounting.ledger.view'), async (c) => {
  const id = idParam(c);
  const p = period(c);
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
  >(userDb(c), 'acc_account_lines', { p_account_id: id, p_from: p.from, p_to: p.to, p_currency: p.currency });
  return ok<AccountLine[]>(
    c,
    (rows ?? []).map((r) => ({
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
    })),
  );
});

accountingRoutes.get('/roles', requirePermission('accounting.ledger.view'), async (c) => {
  const { data, error } = await userDb(c).from('acc_account_roles').select('role_key, account_id').eq('org_id', orgOf(c));
  if (error) throw error;
  const set = new Map((data ?? []).map((r) => [r.role_key as string, r.account_id as string]));
  return ok(
    c,
    ACCOUNT_ROLES.map((role) => ({ role, accountId: set.get(role) ?? null })),
  );
});

accountingRoutes.put('/roles/:role', requirePermission('accounting.chart.manage'), async (c) => {
  const role = c.req.param('role');
  const accountId = text((await jsonBody(c)).accountId);
  if (!(ACCOUNT_ROLES as readonly string[]).includes(role)) throw new HttpError(404, 'Unknown account role', 'not_found');
  if (!UUID_RE.test(accountId)) invalid('accountId is required');
  await callRpc<void>(userDb(c), 'acc_set_account_role', { p_role: role, p_account_id: accountId });
  return ok(c, { role, accountId });
});

// Expense categories and the expense account each posts to (sql/046; unset = the expense_default role).
accountingRoutes.get('/category-accounts', requirePermission('accounting.ledger.view'), async (c) => {
  const { data, error } = await userDb(c).from('fin_categories').select('id, name, account_id').eq('org_id', orgOf(c)).order('name');
  if (error) throw error;
  return ok(
    c,
    (data ?? []).map((r) => ({ categoryId: r.id, name: r.name, accountId: r.account_id ?? null })),
  );
});

accountingRoutes.put('/category-accounts/:id', requirePermission('accounting.chart.manage'), async (c) => {
  const id = idParam(c);
  const accountId = text((await jsonBody(c)).accountId);
  if (accountId && !UUID_RE.test(accountId)) invalid('Invalid account');
  await callRpc<void>(userDb(c), 'acc_set_category_account', { p_category_id: id, p_account_id: accountId || null });
  return ok(c, { categoryId: id, accountId: accountId || null });
});

// Reasons for internal use of stock, each with the expense account it posts to (sql/046).
accountingRoutes.get('/issue-reasons', requirePermission('accounting.ledger.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('acc_issue_reasons')
    .select('id, name, name_ar, account_id, active')
    .eq('org_id', orgOf(c))
    .order('name');
  if (error) throw error;
  return ok(
    c,
    (data ?? []).map((r) => ({ id: r.id, name: r.name, nameAr: r.name_ar, accountId: r.account_id, active: r.active })),
  );
});

for (const [method, path] of [
  ['post', '/issue-reasons'],
  ['put', '/issue-reasons/:id'],
] as const) {
  accountingRoutes[method](path, requirePermission('accounting.chart.manage'), async (c) => {
    const id = method === 'put' ? idParam(c) : null;
    const b = await jsonBody(c);
    const name = text(b.name);
    const accountId = text(b.accountId);
    if (!name || !UUID_RE.test(accountId)) invalid('A name and an account are required');
    const saved = await callRpc<string>(userDb(c), 'acc_save_issue_reason', {
      p_id: id,
      p_name: name,
      p_name_ar: text(b.nameAr) || null,
      p_account_id: accountId,
      p_active: b.active === undefined ? true : b.active === true,
    });
    return ok(c, { id: saved }, id ? 200 : 201);
  });
}

accountingRoutes.get('/fiscal-years', requirePermission('accounting.ledger.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('acc_fiscal_years')
    .select('id, name, starts_on, ends_on, status')
    .eq('org_id', orgOf(c))
    .order('starts_on', { ascending: false });
  if (error) throw error;
  return ok<FiscalYear[]>(
    c,
    (data ?? []).map((r) => ({ id: r.id, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on, status: r.status })),
  );
});

accountingRoutes.post('/fiscal-years', requirePermission('accounting.chart.manage'), async (c) => {
  const b = await jsonBody(c);
  const name = text(b.name);
  const startsOn = text(b.startsOn);
  const endsOn = text(b.endsOn);
  if (!name || !DATE_RE.test(startsOn) || !DATE_RE.test(endsOn) || endsOn < startsOn) invalid('A name, a start and an end on or after it');
  const id = await callRpc<string>(userDb(c), 'acc_create_fiscal_year', { p_name: name, p_starts_on: startsOn, p_ends_on: endsOn });
  return ok(c, { id }, 201);
});

// ------------------------------------------------------------------ the journal (needs accounting on)

type EntryRow = {
  id: string;
  number: string;
  entry_date: string;
  currency: string;
  source_type: string;
  source_id: string;
  event: string;
  memo: string | null;
  reverses_entry_id: string | null;
  is_backfill: boolean;
  posted_by: string | null;
  approved_by: string | null;
  created_at: string;
};
type EntryLineRow = {
  entry_id: string;
  line_no: number;
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  party_type: 'customer' | 'supplier' | null;
  party_id: string | null;
  item_id: string | null;
  warehouse_id: string | null;
  memo: string | null;
};
const ENTRY_COLS =
  'id, number, entry_date, currency, source_type, source_id, event, memo, reverses_entry_id, is_backfill, posted_by, approved_by, created_at';
const ENTRY_LINE_COLS = 'entry_id, line_no, account_id, debit_minor, credit_minor, party_type, party_id, item_id, warehouse_id, memo';

function shapeEntry(e: EntryRow, lines: EntryLineRow[], withLines: boolean): LedgerEntry {
  const own = lines.filter((l) => l.entry_id === e.id).sort((a, b) => a.line_no - b.line_no);
  return {
    id: e.id,
    number: e.number,
    entryDate: e.entry_date,
    currency: e.currency,
    sourceType: e.source_type,
    sourceId: e.source_id,
    event: e.event,
    memo: e.memo,
    reversesEntryId: e.reverses_entry_id,
    isBackfill: e.is_backfill,
    postedBy: e.posted_by,
    approvedBy: e.approved_by,
    createdAt: e.created_at,
    totalMinor: own.reduce((s, l) => s + num(l.debit_minor), 0),
    ...(withLines
      ? {
          lines: own.map((l) => ({
            lineNo: l.line_no,
            accountId: l.account_id,
            debitMinor: num(l.debit_minor),
            creditMinor: num(l.credit_minor),
            partyType: l.party_type,
            partyId: l.party_id,
            itemId: l.item_id,
            warehouseId: l.warehouse_id,
            memo: l.memo,
          })),
        }
      : {}),
  };
}

// Newest first, at most 300; optional ?from=&to= and ?source= (a source type such as sal_invoice or manual_journal).
accountingRoutes.get('/entries', requirePermission('accounting.ledger.view'), async (c) => {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const source = c.req.query('source') ?? '';
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)) || (source && !/^[a-z][a-z_]{1,40}$/.test(source)))
    invalid('Invalid filter');
  let q = userDb(c).from('acc_entries').select(ENTRY_COLS).eq('org_id', orgOf(c));
  if (from) q = q.gte('entry_date', from);
  if (to) q = q.lte('entry_date', to);
  if (source) q = q.eq('source_type', source);
  const { data, error } = await q.order('entry_date', { ascending: false }).order('number', { ascending: false }).limit(300);
  if (error) throw error;
  const entries = (data ?? []) as EntryRow[];
  const lines: EntryLineRow[] = [];
  const ids = entries.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: ls, error: le } = await userDb(c)
      .from('acc_entry_lines')
      .select('entry_id, line_no, account_id, debit_minor, credit_minor, party_type, party_id, item_id, warehouse_id, memo')
      .eq('org_id', orgOf(c))
      .in('entry_id', ids.slice(i, i + 150));
    if (le) throw le;
    lines.push(...((ls ?? []) as EntryLineRow[]));
  }
  return ok(
    c,
    entries.map((e) => shapeEntry(e, lines, false)),
  );
});

accountingRoutes.get('/entries/:id', requirePermission('accounting.ledger.view'), async (c) => {
  const id = idParam(c);
  const { data, error } = await userDb(c).from('acc_entries').select(ENTRY_COLS).eq('org_id', orgOf(c)).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Entry not found', 'not_found');
  const { data: ls, error: le } = await userDb(c).from('acc_entry_lines').select(ENTRY_LINE_COLS).eq('org_id', orgOf(c)).eq('entry_id', id);
  if (le) throw le;
  return ok(c, shapeEntry(data as EntryRow, (ls ?? []) as EntryLineRow[], true));
});

// ------------------------------------------------------------------ manual journals and opening balances (needs accounting on)

type JournalRow = {
  id: string;
  number: string;
  kind: 'manual' | 'opening';
  entry_date: string;
  currency: string;
  memo: string;
  status: ManualJournal['status'];
  direct: boolean;
  created_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  entry_id: string | null;
  created_at: string;
};
type JournalLineRow = {
  journal_id: string;
  line_no: number;
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  party_type: 'customer' | 'supplier' | null;
  party_id: string | null;
  memo: string | null;
};
const JOURNAL_COLS =
  'id, number, kind, entry_date, currency, memo, status, direct, created_by, decided_by, decided_at, decision_comment, entry_id, created_at';

async function journalLines(c: Ctx, ids: string[]): Promise<JournalLineRow[]> {
  const out: JournalLineRow[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await userDb(c)
      .from('acc_manual_journal_lines')
      .select('journal_id, line_no, account_id, debit_minor, credit_minor, party_type, party_id, memo')
      .eq('org_id', orgOf(c))
      .in('journal_id', ids.slice(i, i + 150));
    if (error) throw error;
    out.push(...((data ?? []) as JournalLineRow[]));
  }
  return out;
}

function shapeJournal(j: JournalRow, lines: JournalLineRow[], withLines: boolean): ManualJournal {
  const own = lines.filter((l) => l.journal_id === j.id).sort((a, b) => a.line_no - b.line_no);
  return {
    id: j.id,
    number: j.number,
    kind: j.kind,
    entryDate: j.entry_date,
    currency: j.currency,
    memo: j.memo,
    status: j.status,
    direct: j.direct,
    createdBy: j.created_by,
    decidedBy: j.decided_by,
    decidedAt: j.decided_at,
    decisionComment: j.decision_comment,
    entryId: j.entry_id,
    createdAt: j.created_at,
    totalMinor: own.reduce((s, l) => s + num(l.debit_minor), 0),
    ...(withLines
      ? {
          lines: own.map((l) => ({
            lineNo: l.line_no,
            accountId: l.account_id,
            debitMinor: num(l.debit_minor),
            creditMinor: num(l.credit_minor),
            ...(l.party_type && l.party_id ? { partyType: l.party_type, partyId: l.party_id } : {}),
            ...(l.memo ? { memo: l.memo } : {}),
          })),
        }
      : {}),
  };
}

// Newest first, at most 300; ?status=draft lists what is waiting for approval.
accountingRoutes.get('/journals', requirePermission('accounting.ledger.view'), async (c) => {
  const status = c.req.query('status') ?? '';
  if (status && !['draft', 'posted', 'rejected', 'cancelled'].includes(status)) invalid('Invalid status');
  let q = userDb(c).from('acc_manual_journals').select(JOURNAL_COLS).eq('org_id', orgOf(c));
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  const rows = (data ?? []) as JournalRow[];
  const lines = await journalLines(
    c,
    rows.map((r) => r.id),
  );
  return ok(
    c,
    rows.map((r) => shapeJournal(r, lines, false)),
  );
});

accountingRoutes.get('/journals/:id', requirePermission('accounting.ledger.view'), async (c) => {
  const id = idParam(c);
  const { data, error } = await userDb(c)
    .from('acc_manual_journals')
    .select(JOURNAL_COLS)
    .eq('org_id', orgOf(c))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Journal not found', 'not_found');
  return ok(c, shapeJournal(data as JournalRow, await journalLines(c, [id]), true));
});

/** Reads and checks a journal body; the database re-checks everything (sql/048 acc_save_journal). */
function journalBody(b: Record<string, unknown>) {
  const entryDate = text(b.entryDate);
  const memo = text(b.memo);
  const kind = text(b.kind) || 'manual';
  const currency = text(b.currency).toUpperCase();
  if (!DATE_RE.test(entryDate) || !memo || memo.length > 500) invalid('A date and a description are required');
  if (kind !== 'manual' && kind !== 'opening') invalid('kind must be manual or opening');
  if (currency && !CUR_RE.test(currency)) invalid('currency must be a three-letter code');
  if (!Array.isArray(b.lines) || b.lines.length > 500) invalid('lines must be a list of at most 500');
  const lines: JournalLineInput[] = (b.lines as unknown[]).map((raw) => {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const accountId = text(l.accountId);
    const partyType = text(l.partyType);
    const partyId = text(l.partyId);
    if (!UUID_RE.test(accountId)) invalid('Each line needs an account');
    if ((partyType || partyId) && (!['customer', 'supplier'].includes(partyType) || !UUID_RE.test(partyId)))
      invalid('Invalid customer or supplier on a line');
    return {
      accountId,
      debitMinor: Number(l.debitMinor ?? 0),
      creditMinor: Number(l.creditMinor ?? 0),
      ...(partyType ? { partyType: partyType as 'customer' | 'supplier', partyId } : {}),
      ...(text(l.memo) ? { memo: text(l.memo).slice(0, 500) } : {}),
    };
  });
  const problem = journalProblem(lines);
  if (problem === 'too_few_lines') invalid('A journal needs at least two lines');
  if (problem === 'bad_line') invalid('Each line needs either a debit or a credit above zero, in whole minor units');
  if (problem === 'unbalanced') throw new HttpError(400, 'Debits and credits must be equal', 'unbalanced');
  return { entryDate, memo, kind, currency: currency || null, lines, post: b.post === true };
}

// Draft a journal; with "post": true, post it at once (owner or head accountant; everyone else's waits for a second person).
accountingRoutes.post('/journals', requirePermission('accounting.journal.create'), async (c) => {
  const j = journalBody(await jsonBody(c));
  if (j.post && !hasPermission(c.var.tenant.permissions, 'accounting.journal.post_direct'))
    throw new HttpError(403, "You don't have permission to do that", 'forbidden');
  const made = await callRpc<{ id: string; number: string; status: string; entryId: string | null }>(userDb(c), 'acc_save_journal', {
    p_id: null,
    p_entry_date: j.entryDate,
    p_memo: j.memo,
    p_lines: j.lines,
    p_kind: j.kind,
    p_currency: j.currency,
    p_post: j.post,
  });
  return ok(c, made, 201);
});

// Change one's own draft (and optionally post it, as above).
accountingRoutes.put('/journals/:id', requirePermission('accounting.journal.create'), async (c) => {
  const id = idParam(c);
  const j = journalBody(await jsonBody(c));
  if (j.post && !hasPermission(c.var.tenant.permissions, 'accounting.journal.post_direct'))
    throw new HttpError(403, "You don't have permission to do that", 'forbidden');
  const saved = await callRpc<{ id: string; number: string; status: string; entryId: string | null }>(userDb(c), 'acc_save_journal', {
    p_id: id,
    p_entry_date: j.entryDate,
    p_memo: j.memo,
    p_lines: j.lines,
    p_kind: j.kind,
    p_currency: j.currency,
    p_post: j.post,
  });
  return ok(c, saved);
});

for (const [action, decision] of [
  ['approve', 'approved'],
  ['reject', 'rejected'],
] as const) {
  // Someone else's draft only (SELF_APPROVAL in the function and a check constraint).
  accountingRoutes.post(`/journals/:id/${action}`, requirePermission('accounting.journal.approve'), async (c) => {
    const id = idParam(c);
    const comment = text(((await c.req.json().catch(() => ({}))) as { comment?: unknown }).comment);
    const res = await callRpc<{ id: string; number: string; status: string; entryId: string | null }>(userDb(c), 'acc_decide_journal', {
      p_id: id,
      p_decision: decision,
      p_comment: comment.slice(0, 500) || null,
    });
    return ok(c, res);
  });
}

// The author withdraws their own draft.
accountingRoutes.post('/journals/:id/cancel', requirePermission('accounting.journal.create'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'acc_cancel_journal', { p_id: id });
  return ok(c, { id, status: 'cancelled' });
});

// Reverse a posted manual journal (owner or head accountant, once). Documents are corrected by voiding them, not here.
accountingRoutes.post('/journals/:id/reverse', requirePermission('accounting.journal.post_direct'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const date = text(b.date);
  const memo = text(b.memo);
  if (!DATE_RE.test(date) || !memo) invalid('A date and a reason are required');
  const entryId = await callRpc<string>(userDb(c), 'acc_reverse_journal', { p_id: id, p_date: date, p_memo: memo.slice(0, 500) });
  return ok(c, { id, entryId });
});

// ------------------------------------------------------------------ stock value check and revaluation (sql/055, needs accounting on)

// Per item: quantity on hand, average cost, value in the books, value at average cost, and the difference.
accountingRoutes.get('/stock-value', requirePermission('accounting.ledger.view'), async (c) => {
  const rows = await callRpc<
    {
      item_id: string;
      sku: string;
      item_name: string;
      on_hand: number;
      avg_cost_minor: number | null;
      book_minor: number;
      target_minor: number;
      difference_minor: number;
    }[]
  >(userDb(c), 'acc_stock_value_check');
  return ok(
    c,
    (rows ?? []).map((r) => ({
      itemId: r.item_id,
      sku: r.sku,
      name: r.item_name,
      onHand: Number(r.on_hand),
      avgCostMinor: r.avg_cost_minor === null ? null : Number(r.avg_cost_minor),
      bookMinor: num(r.book_minor),
      targetMinor: num(r.target_minor),
      differenceMinor: num(r.difference_minor),
    })),
  );
});

// One correcting entry, item by item, bringing the books to quantity × average cost. Owner or head accountant (database).
accountingRoutes.post('/stock-value/revalue', requirePermission('accounting.chart.manage'), async (c) => {
  const b = await jsonBody(c);
  const date = text(b.date);
  const note = text(b.note);
  if (!DATE_RE.test(date) || !note || note.length > 300) invalid('A date and a reason are required');
  return ok(
    c,
    await callRpc<{ items: number; netMinor: number; entryId: string | null }>(userDb(c), 'acc_revalue_stock', {
      p_date: date,
      p_note: note,
    }),
  );
});

// ------------------------------------------------------------------ trial balance (needs accounting on)

type TbRow = {
  account_id: string;
  code: string;
  name: string;
  name_ar: string | null;
  kind: AccountKind;
  parent_id: string | null;
  is_leaf: boolean;
  currency: string;
  opening_minor: number;
  debit_minor: number;
  credit_minor: number;
  closing_minor: number;
};

// One currency at a time (the company's own by default). ?format=csv downloads it.
accountingRoutes.get('/trial-balance', requirePermission('accounting.ledger.view'), async (c) => {
  const p = period(c);
  const rows = await callRpc<TbRow[]>(userDb(c), 'acc_trial_balance', { p_from: p.from, p_to: p.to, p_currency: p.currency });
  const out: TrialBalanceRow[] = (rows ?? []).map((r) => ({
    accountId: r.account_id,
    code: r.code,
    name: r.name,
    nameAr: r.name_ar,
    kind: r.kind,
    parentId: r.parent_id,
    isLeaf: r.is_leaf,
    currency: String(r.currency).trim(),
    openingMinor: num(r.opening_minor),
    debitMinor: num(r.debit_minor),
    creditMinor: num(r.credit_minor),
    closingMinor: num(r.closing_minor),
  }));
  if (c.req.query('format') !== 'csv') return ok(c, out);
  return csvResponse(
    c,
    `trial-balance-${p.from}-to-${p.to}.csv`,
    ['code', 'name', 'name_ar', 'kind', 'detail_account', 'currency', 'opening', 'debit', 'credit', 'closing'],
    out.map((r) => [
      r.code,
      r.name,
      r.nameAr,
      r.kind,
      r.isLeaf ? 'yes' : 'no',
      r.currency,
      minorToText(r.openingMinor, r.currency),
      minorToText(r.debitMinor, r.currency),
      minorToText(r.creditMinor, r.currency),
      minorToText(r.closingMinor, r.currency),
    ]),
  );
});
