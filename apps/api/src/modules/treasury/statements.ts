import { Hono, type Context } from 'hono';
import { type LedgerCandidate, suggestGroups, suggestMatches } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Bank statement import and reconciliation (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md; database sql/067). The browser reads the
// file with the shared readers (bankStatements.ts, mt940.ts) and sends lines; the database re-checks, stores and audits. Matches are
// suggested here with the shared engine and confirmed by a person; the database checks every match and who may make it.
export const statementRoutes = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORMATS = ['csv', 'xlsx', 'docx', 'mt940', 'pdf'] as const;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const orgOf = (c: Ctx) => c.var.tenant.orgId;
const param = (c: Ctx, name: string) => {
  const id = c.req.param(name) ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};

type LineRow = {
  id: string;
  import_id: string;
  account_id: string;
  line_no: number;
  booking_date: string;
  value_date: string | null;
  description: string;
  reference: string;
  amount_minor: number;
  balance_minor: number | null;
  status: 'open' | 'matched' | 'ignored';
  ignore_reason: string | null;
};

/** Ledger lines on the bank account's ledger account that no bank line has matched yet, with the document numbers a bank text may
 *  carry (entry number, payment number and the invoice it paid, transfer number). */
async function candidates(c: Ctx, accountId: string): Promise<(LedgerCandidate & { memo: string; entryNumber: string })[]> {
  const db = userDb(c);
  const org = orgOf(c);
  const { data: acct, error: ae } = await db
    .from('trs_accounts')
    .select('ledger_account_id, currency')
    .eq('org_id', org)
    .eq('id', accountId)
    .maybeSingle();
  if (ae) throw ae;
  if (!acct) throw new HttpError(404, 'Bank account not found', 'not_found');
  const { data: lines, error: le } = await db
    .from('acc_entry_lines')
    .select('id, debit_minor, credit_minor, entry_id, acc_entries!inner(number, entry_date, currency, source_type, source_id, memo)')
    .eq('org_id', org)
    .eq('account_id', acct.ledger_account_id)
    .order('id', { ascending: false })
    .limit(2000);
  if (le) throw le;
  const { data: matched, error: me } = await db
    .from('trs_statement_matches')
    .select('entry_line_id')
    .eq('org_id', org)
    .is('undone_at', null);
  if (me) throw me;
  const taken = new Set((matched ?? []).map((m) => Number(m.entry_line_id)));
  type Entry = { number: string; entry_date: string; currency: string; source_type: string; source_id: string; memo: string | null };
  const rows = ((lines ?? []) as unknown as { id: number; debit_minor: number; credit_minor: number; acc_entries: Entry | Entry[] }[])
    .map((l) => ({ ...l, e: Array.isArray(l.acc_entries) ? l.acc_entries[0] : l.acc_entries }))
    .filter((l) => l.e && l.e.currency === acct.currency && !taken.has(Number(l.id)));
  // Document numbers of payments and transfers behind these lines.
  const paymentIds = rows.filter((r) => r.e?.source_type === 'payment').map((r) => r.e?.source_id ?? '');
  const transferIds = rows.filter((r) => r.e?.source_type === 'treasury_transfer').map((r) => r.e?.source_id ?? '');
  const numbers = new Map<string, string[]>();
  if (paymentIds.length) {
    const { data: pays, error } = await db
      .from('fin_payments')
      .select('id, number, customer_invoice_id, supplier_invoice_id')
      .eq('org_id', org)
      .in('id', paymentIds);
    if (error) throw error;
    type Pay = { id: string; number: string; customer_invoice_id: string | null; supplier_invoice_id: string | null };
    const ps = (pays ?? []) as Pay[];
    const invNo = new Map<string, string>();
    const cust = ps.map((p) => p.customer_invoice_id).filter((x): x is string => Boolean(x));
    const supp = ps.map((p) => p.supplier_invoice_id).filter((x): x is string => Boolean(x));
    if (cust.length) {
      const { data: inv, error: ie } = await db.from('sal_invoices').select('id, number').eq('org_id', org).in('id', cust);
      if (ie) throw ie;
      for (const i of (inv ?? []) as { id: string; number: string }[]) invNo.set(i.id, i.number);
    }
    if (supp.length) {
      const { data: inv, error: ie } = await db.from('pur_supplier_invoices').select('id, number').eq('org_id', org).in('id', supp);
      if (ie) throw ie;
      for (const i of (inv ?? []) as { id: string; number: string }[]) invNo.set(i.id, i.number);
    }
    for (const p of ps) {
      numbers.set(
        p.id,
        [
          p.number,
          p.customer_invoice_id ? invNo.get(p.customer_invoice_id) : undefined,
          p.supplier_invoice_id ? invNo.get(p.supplier_invoice_id) : undefined,
        ].filter((x): x is string => Boolean(x)),
      );
    }
  }
  if (transferIds.length) {
    const { data: trs, error } = await db.from('trs_transfers').select('id, number').eq('org_id', org).in('id', transferIds);
    if (error) throw error;
    for (const t of (trs ?? []) as { id: string; number: string }[]) numbers.set(t.id, [t.number]);
  }
  return rows.map((r) => ({
    id: String(r.id),
    date: r.e?.entry_date ?? '',
    amountMinor: Number(r.debit_minor) - Number(r.credit_minor),
    documentNumbers: [r.e?.number ?? '', ...(numbers.get(r.e?.source_id ?? '') ?? [])].filter(Boolean),
    memo: r.e?.memo ?? '',
    entryNumber: r.e?.number ?? '',
  }));
}

// ------------------------------------------------------------------ settings and formats

statementRoutes.put('/reconcile-roles', requirePermission('treasury.statements.reconcile'), async (c) => {
  const roles = (await jsonBody(c)).roles;
  if (!Array.isArray(roles) || roles.some((r) => !['owner', 'admin', 'head_accountant'].includes(String(r))))
    invalid('roles: owner, admin, head_accountant');
  return ok(c, { roles: await callRpc<string[]>(userDb(c), 'trs_set_reconcile_roles', { p_roles: roles }) });
});

statementRoutes.get('/accounts/:id/format', requirePermission('treasury.statements.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('trs_statement_formats')
    .select('mapping, updated_at')
    .eq('org_id', orgOf(c))
    .eq('account_id', param(c, 'id'))
    .maybeSingle();
  if (error) throw error;
  return ok(c, data ? { mapping: data.mapping, updatedAt: data.updated_at } : null);
});

statementRoutes.put('/accounts/:id/format', requirePermission('treasury.statements.import'), async (c) => {
  const mapping = (await jsonBody(c)).mapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) invalid('mapping must be an object');
  await callRpc<void>(userDb(c), 'trs_save_statement_format', { p_account_id: param(c, 'id'), p_mapping: mapping });
  return ok(c, { saved: true });
});

// ------------------------------------------------------------------ imports

statementRoutes.post('/accounts/:id/imports', requirePermission('treasury.statements.import'), async (c) => {
  const b = await jsonBody(c);
  const format = text(b.format);
  if (!(FORMATS as readonly string[]).includes(format)) invalid('format: csv, xlsx, docx, mt940 or pdf');
  if (!/^[0-9a-f]{64}$/.test(text(b.fileHash))) invalid('fileHash must be the SHA-256 of the file');
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 5000) invalid('between 1 and 5000 lines');
  const lines = (b.lines as Record<string, unknown>[]).map((l, i) => {
    const amount = Number(l.amountMinor);
    if (!DATE_RE.test(text(l.bookingDate)) || !Number.isSafeInteger(amount) || amount === 0 || !text(l.fingerprint))
      invalid(`line ${i + 1}: date, amount and fingerprint`);
    return {
      bookingDate: text(l.bookingDate),
      valueDate: DATE_RE.test(text(l.valueDate)) ? text(l.valueDate) : null,
      description: text(l.description).slice(0, 500),
      reference: text(l.reference).slice(0, 140),
      amountMinor: amount,
      balanceMinor:
        Number.isSafeInteger(Number(l.balanceMinor)) && l.balanceMinor !== null && l.balanceMinor !== undefined
          ? Number(l.balanceMinor)
          : null,
      fingerprint: text(l.fingerprint).slice(0, 800),
    };
  });
  const big = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number.isSafeInteger(Number(x)) ? Number(x) : null);
  const res = await callRpc<{ id: string; added: number; skipped: number }>(userDb(c), 'trs_import_statement', {
    p_account_id: param(c, 'id'),
    p_file_name: text(b.fileName) || 'statement',
    p_file_hash: text(b.fileHash),
    p_file_format: format,
    p_opening_minor: big(b.openingMinor),
    p_closing_minor: big(b.closingMinor),
    p_lines: lines,
  });
  return ok(c, res, 201);
});

statementRoutes.get('/imports', requirePermission('treasury.statements.view'), async (c) => {
  let q = userDb(c)
    .from('trs_statement_imports')
    .select(
      'id, account_id, file_name, file_format, period_from, period_to, opening_minor, closing_minor, lines_added, lines_skipped, imported_by, imported_at',
    )
    .eq('org_id', orgOf(c))
    .order('imported_at', { ascending: false })
    .limit(200);
  const accountId = c.req.query('accountId');
  if (accountId) {
    if (!UUID_RE.test(accountId)) invalid('accountId must be an id');
    q = q.eq('account_id', accountId);
  }
  const { data, error } = await q;
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id as string);
  const counts = new Map<string, Record<string, number>>();
  if (ids.length) {
    const { data: st, error: se } = await userDb(c)
      .from('trs_statement_lines')
      .select('import_id, status')
      .eq('org_id', orgOf(c))
      .in('import_id', ids);
    if (se) throw se;
    for (const l of (st ?? []) as { import_id: string; status: string }[]) {
      const m = counts.get(l.import_id) ?? { open: 0, matched: 0, ignored: 0 };
      m[l.status] = (m[l.status] ?? 0) + 1;
      counts.set(l.import_id, m);
    }
  }
  return ok(
    c,
    (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      fileName: r.file_name,
      format: r.file_format,
      periodFrom: r.period_from,
      periodTo: r.period_to,
      openingMinor: r.opening_minor === null ? null : Number(r.opening_minor),
      closingMinor: r.closing_minor === null ? null : Number(r.closing_minor),
      added: r.lines_added,
      skipped: r.lines_skipped,
      importedBy: r.imported_by,
      importedAt: r.imported_at,
      counts: counts.get(r.id as string) ?? { open: 0, matched: 0, ignored: 0 },
    })),
  );
});

// One import: its lines, their matches, and suggestions for the open ones.
statementRoutes.get('/imports/:id', requirePermission('treasury.statements.view'), async (c) => {
  const id = param(c, 'id');
  const db = userDb(c);
  const { data: imp, error } = await db
    .from('trs_statement_imports')
    .select('id, account_id, file_name, period_from, period_to, opening_minor, closing_minor')
    .eq('org_id', orgOf(c))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!imp) throw new HttpError(404, 'Statement not found', 'not_found');
  const { data: lines, error: le } = await db
    .from('trs_statement_lines')
    .select(
      'id, import_id, account_id, line_no, booking_date, value_date, description, reference, amount_minor, balance_minor, status, ignore_reason',
    )
    .eq('org_id', orgOf(c))
    .eq('import_id', id)
    .order('line_no');
  if (le) throw le;
  const ls = (lines ?? []) as LineRow[];
  const { data: ms, error: me } = await db
    .from('trs_statement_matches')
    .select('line_id, entry_line_id, amount_minor')
    .eq('org_id', orgOf(c))
    .is('undone_at', null)
    .in('line_id', ls.map((l) => l.id).concat(ls.length ? [] : ['00000000-0000-0000-0000-000000000000']));
  if (me) throw me;
  const cands = await candidates(c, imp.account_id as string);
  const byId = new Map(cands.map((x) => [x.id, x]));
  return ok(c, {
    id: imp.id,
    accountId: imp.account_id,
    fileName: imp.file_name,
    periodFrom: imp.period_from,
    periodTo: imp.period_to,
    openingMinor: imp.opening_minor === null ? null : Number(imp.opening_minor),
    closingMinor: imp.closing_minor === null ? null : Number(imp.closing_minor),
    lines: ls.map((l) => {
      const line = { bookingDate: l.booking_date, amountMinor: Number(l.amount_minor), reference: l.reference, description: l.description };
      const suggestions = l.status === 'open' ? suggestMatches(line, cands).slice(0, 5) : [];
      const groups = l.status === 'open' && suggestions.length === 0 ? suggestGroups(line, cands) : [];
      return {
        id: l.id,
        lineNo: l.line_no,
        bookingDate: l.booking_date,
        valueDate: l.value_date,
        description: l.description,
        reference: l.reference,
        amountMinor: Number(l.amount_minor),
        balanceMinor: l.balance_minor === null ? null : Number(l.balance_minor),
        status: l.status,
        ignoreReason: l.ignore_reason,
        matches: ((ms ?? []) as { line_id: string; entry_line_id: number; amount_minor: number }[])
          .filter((m) => m.line_id === l.id)
          .map((m) => ({ entryLineId: String(m.entry_line_id), amountMinor: Number(m.amount_minor) })),
        suggestions: [
          ...suggestions.map((s) => ({ ...s, entries: s.candidateIds.map((cid) => byId.get(cid)).filter(Boolean) })),
          ...groups.map((g) => ({
            tier: 'group' as const,
            candidateIds: g,
            days: 0,
            why: ['amount'],
            entries: g.map((cid) => byId.get(cid)).filter(Boolean),
          })),
        ],
      };
    }),
  });
});

// The account's ledger lines not matched yet (to pick one by hand when no suggestion fits).
statementRoutes.get('/accounts/:id/unmatched', requirePermission('treasury.statements.view'), async (c) =>
  ok(c, await candidates(c, param(c, 'id'))),
);

// ------------------------------------------------------------------ matching

statementRoutes.post('/lines/:id/match', requirePermission('treasury.statements.reconcile'), async (c) => {
  const ids = (await jsonBody(c)).entryLineIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20 || ids.some((x) => !/^\d+$/.test(String(x))))
    invalid('entryLineIds: 1 to 20 ledger line ids');
  await callRpc<void>(userDb(c), 'trs_match_line', { p_line_id: param(c, 'id'), p_entry_line_ids: ids.map(Number) });
  return ok(c, { matched: true });
});

statementRoutes.post('/lines/:id/unmatch', requirePermission('treasury.statements.reconcile'), async (c) => {
  await callRpc<void>(userDb(c), 'trs_unmatch_line', { p_line_id: param(c, 'id') });
  return ok(c, { open: true });
});

statementRoutes.post('/lines/:id/ignore', requirePermission('treasury.statements.reconcile'), async (c) => {
  const reason = text((await jsonBody(c)).reason);
  if (!reason) invalid('A reason is required');
  await callRpc<void>(userDb(c), 'trs_ignore_line', { p_line_id: param(c, 'id'), p_reason: reason });
  return ok(c, { ignored: true });
});

// Confirm every "exact" suggestion of an import at once (Q3). Each is still one database call that checks it; the ones refused are
// reported, not hidden.
statementRoutes.post('/imports/:id/confirm-exact', requirePermission('treasury.statements.reconcile'), async (c) => {
  const id = param(c, 'id');
  const db = userDb(c);
  const { data: imp, error } = await db
    .from('trs_statement_imports')
    .select('account_id')
    .eq('org_id', orgOf(c))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!imp) throw new HttpError(404, 'Statement not found', 'not_found');
  const { data: lines, error: le } = await db
    .from('trs_statement_lines')
    .select('id, booking_date, amount_minor, reference, description')
    .eq('org_id', orgOf(c))
    .eq('import_id', id)
    .eq('status', 'open');
  if (le) throw le;
  let cands = await candidates(c, imp.account_id as string);
  let confirmed = 0;
  const refused: { lineId: string; reason: string }[] = [];
  for (const l of (lines ?? []) as { id: string; booking_date: string; amount_minor: number; reference: string; description: string }[]) {
    const exact = suggestMatches(
      { bookingDate: l.booking_date, amountMinor: Number(l.amount_minor), reference: l.reference, description: l.description },
      cands,
    ).filter((s) => s.tier === 'exact');
    if (exact.length !== 1) continue; // only an exact match with no rival
    const pick = exact[0]?.candidateIds ?? [];
    try {
      await callRpc<void>(db, 'trs_match_line', { p_line_id: l.id, p_entry_line_ids: pick.map(Number) });
      confirmed++;
      cands = cands.filter((x) => !pick.includes(x.id));
    } catch (e) {
      refused.push({ lineId: l.id, reason: (e as Error).message });
    }
  }
  return ok(c, { confirmed, refused });
});

// ------------------------------------------------------------------ closing a period

statementRoutes.get('/accounts/:id/reconciliations', requirePermission('treasury.statements.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('trs_reconciliations')
    .select(
      'id, to_date, bank_closing_minor, ledger_balance_minor, unmatched_ledger_minor, ignored_bank_minor, status, closed_by, closed_at, reopened_by, reopened_at, reopen_reason',
    )
    .eq('org_id', orgOf(c))
    .eq('account_id', param(c, 'id'))
    .order('to_date', { ascending: false });
  if (error) throw error;
  return ok(
    c,
    (data ?? []).map((r) => ({
      id: r.id,
      toDate: r.to_date,
      bankClosingMinor: Number(r.bank_closing_minor),
      ledgerBalanceMinor: Number(r.ledger_balance_minor),
      unmatchedLedgerMinor: Number(r.unmatched_ledger_minor),
      ignoredBankMinor: Number(r.ignored_bank_minor),
      status: r.status,
      closedBy: r.closed_by,
      closedAt: r.closed_at,
      reopenedBy: r.reopened_by,
      reopenedAt: r.reopened_at,
      reopenReason: r.reopen_reason,
    })),
  );
});

statementRoutes.post('/accounts/:id/reconcile', requirePermission('treasury.statements.reconcile'), async (c) => {
  const b = await jsonBody(c);
  const closing = Number(b.bankClosingMinor);
  if (!DATE_RE.test(text(b.toDate)) || !Number.isSafeInteger(closing)) invalid('toDate (YYYY-MM-DD) and bankClosingMinor are required');
  const res = await callRpc<unknown>(userDb(c), 'trs_close_reconciliation', {
    p_account_id: param(c, 'id'),
    p_to_date: text(b.toDate),
    p_bank_closing_minor: closing,
  });
  return ok(c, res, 201);
});

statementRoutes.post('/reconciliations/:id/reopen', requirePermission('treasury.statements.reconcile'), async (c) => {
  const reason = text((await jsonBody(c)).reason);
  if (!reason) invalid('A reason is required');
  await callRpc<void>(userDb(c), 'trs_reopen_reconciliation', { p_id: param(c, 'id'), p_reason: reason });
  return ok(c, { reopened: true });
});
