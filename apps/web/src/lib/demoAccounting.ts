import type { Account, AccountKind, AccountLine, LedgerEntry, ManualJournal, TrialBalanceRow, VatMonth, VatSummary } from '@erp/shared';
import { DemoError } from './demo';

// Sample books for the demo build (new UI only: lib/demo.ts switches accounting and finance on only when the new UI is on), so the
// accounting screens Grant signs off (journal entry, trial balance, VAT month) show real-looking numbers. Held in memory; a reload
// resets it. A small chart in the shape of the Egyptian unified chart; amounts in piastres (EGP minor units). Nothing here ships in
// a normal build.

type Acct = [code: string, name: string, nameAr: string, kind: AccountKind, parent: string | null];
const CHART: Acct[] = [
  ['1', 'Assets', 'الأصول', 'asset', null],
  ['11', 'Cash and banks', 'النقدية والبنوك', 'asset', '1'],
  ['1101', 'Cash on hand', 'النقدية بالخزينة', 'asset', '11'],
  ['1102', 'Bank, CIB current account', 'البنك التجاري الدولي، حساب جاري', 'asset', '11'],
  ['12', 'Customers', 'العملاء', 'asset', '1'],
  ['1201', 'Trade receivables', 'عملاء تجاريون', 'asset', '12'],
  ['13', 'Stock', 'المخزون', 'asset', '1'],
  ['1301', 'Goods for sale', 'بضاعة بغرض البيع', 'asset', '13'],
  ['14', 'Tax receivable', 'ضرائب مستحقة لنا', 'asset', '1'],
  ['1401', 'Input VAT', 'ضريبة القيمة المضافة على المشتريات', 'asset', '14'],
  ['2', 'Liabilities', 'الالتزامات', 'liability', null],
  ['21', 'Suppliers', 'الموردون', 'liability', '2'],
  ['2101', 'Trade payables', 'موردون تجاريون', 'liability', '21'],
  ['22', 'Taxes payable', 'ضرائب مستحقة علينا', 'liability', '2'],
  ['2201', 'Output VAT', 'ضريبة القيمة المضافة على المبيعات', 'liability', '22'],
  ['2202', 'VAT settlement', 'تسوية ضريبة القيمة المضافة', 'liability', '22'],
  ['3', 'Equity', 'حقوق الملكية', 'equity', null],
  ['3101', 'Capital', 'رأس المال', 'equity', '3'],
  ['4', 'Revenue', 'الإيرادات', 'revenue', null],
  ['4101', 'Sales', 'المبيعات', 'revenue', '4'],
  ['5', 'Expenses', 'المصروفات', 'expense', null],
  ['5101', 'Cost of goods sold', 'تكلفة البضاعة المباعة', 'expense', '5'],
  ['5201', 'Salaries', 'الرواتب والأجور', 'expense', '5'],
  ['5202', 'Rent', 'الإيجار', 'expense', '5'],
  ['5203', 'Bank charges', 'مصروفات بنكية', 'expense', '5'],
];
const accounts: Account[] = CHART.map(([code, name, nameAr, kind, parent]) => ({
  id: `a${code}`,
  code,
  name,
  nameAr,
  kind,
  parentId: parent ? `a${parent}` : null,
  active: true,
  isLeaf: !CHART.some((c) => c[4] === code),
}));
const acc = (code: string) => `a${code}`;

type Line = { accountId: string; debitMinor: number; creditMinor: number; memo?: string | null; partyType?: 'customer' | 'supplier' | null; partyId?: string | null };
type Entry = { id: string; number: string; date: string; memo: string; sourceType: string; event: string; lines: Line[]; vatClose?: string };

const year = new Date().getUTCFullYear();
const thisMonth = new Date().getUTCMonth() + 1; // 1..12
const pad = (n: number) => String(n).padStart(2, '0');
const day = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;
const lastDay = (m: number) => new Date(Date.UTC(year, m, 0)).getUTCDate();
const EGP = (pounds: number) => Math.round(pounds * 100);
const dr = (code: string, minor: number, memo?: string): Line => ({ accountId: acc(code), debitMinor: minor, creditMinor: 0, memo: memo ?? null });
const cr = (code: string, minor: number, memo?: string): Line => ({ accountId: acc(code), debitMinor: 0, creditMinor: minor, memo: memo ?? null });

const entries: Entry[] = [];
let entryNo = 0;
function post(date: string, memo: string, sourceType: string, event: string, lines: Line[], vatClose?: string) {
  entries.push({ id: `e${++entryNo}`, number: `JE-${pad(entryNo).padStart(5, '0')}`, date, memo, sourceType, event, lines, vatClose });
}

post(`${year - 1}-12-31`, 'Opening balances', 'manual_journal', 'post', [dr('1101', EGP(50_000)), dr('1102', EGP(400_000)), dr('1301', EGP(300_000)), cr('3101', EGP(750_000))]);
// One month of trade each month up to this one (March has a large equipment-free stock buy, so it ends with a VAT credit).
const SALES = [180, 165, 150, 205, 220, 210, 240, 230, 260, 285, 270, 300];
const BUYS = [110, 95, 260, 120, 130, 125, 140, 150, 155, 170, 165, 180];
for (let m = 1; m <= thisMonth; m++) {
  const sales = EGP(SALES[m - 1]! * 1000);
  const buys = EGP(BUYS[m - 1]! * 1000);
  const last = m === thisMonth ? Math.min(lastDay(m), new Date().getUTCDate()) : lastDay(m);
  const d = (n: number) => day(m, Math.min(n, last));
  post(d(5), 'Purchase invoices of the month', 'supplier_invoice', 'post', [dr('1301', buys), dr('1401', Math.round(buys * 0.14)), cr('2101', Math.round(buys * 1.14))]);
  post(d(12), 'Sales invoices of the month', 'customer_invoice', 'post', [dr('1201', Math.round(sales * 1.14)), cr('4101', sales), cr('2201', Math.round(sales * 0.14))]);
  post(d(12), 'Cost of goods sold', 'stock_move', 'post', [dr('5101', Math.round(sales * 0.62)), cr('1301', Math.round(sales * 0.62))]);
  post(d(25), 'Salaries', 'expense', 'post', [dr('5201', EGP(45_000)), cr('1102', EGP(45_000))]);
  post(d(1), 'Warehouse rent', 'expense', 'post', [dr('5202', EGP(15_000)), cr('1102', EGP(15_000))]);
  post(d(20), 'Customer payments received', 'payment', 'post', [dr('1102', Math.round(sales * 1.05)), cr('1201', Math.round(sales * 1.05))]);
  post(d(22), 'Supplier payments', 'payment', 'post', [dr('2101', Math.round(buys * 1.1)), cr('1102', Math.round(buys * 1.1))]);
  post(d(28), 'Bank charges', 'expense', 'post', [dr('5203', EGP(350)), cr('1102', EGP(350))]);
}

// VAT months: each ended month up to two months ago is closed and paid; last month is closed, not paid yet; this month is open.
const ym = (m: number) => `${year}-${pad(m)}`;
function vatOf(m: number) {
  let out = 0;
  let inp = 0;
  for (const e of entries) {
    if (e.vatClose || !e.date.startsWith(ym(m))) continue;
    for (const l of e.lines) {
      if (l.accountId === acc('2201')) out += l.creditMinor - l.debitMinor;
      if (l.accountId === acc('1401')) inp += l.debitMinor - l.creditMinor;
    }
  }
  return { out, inp, due: out - inp };
}
type Period = NonNullable<VatMonth['period']> & { month: string };
const periods: Period[] = [];
let carried = 0;
for (let m = 1; m < thisMonth; m++) {
  const v = vatOf(m);
  const closeDay = day(m + 1 > 12 ? 12 : m + 1, 10);
  post(closeDay, `VAT closing ${ym(m)}`, 'manual_journal', 'post', [dr('2201', v.out), cr('1401', v.inp), v.due >= 0 ? cr('2202', v.due) : dr('2202', -v.due)], ym(m));
  const payable = Math.max(0, v.due - carried);
  carried = v.due < 0 ? carried - v.due : Math.max(0, carried - v.due);
  const paid = m < thisMonth - 1 ? payable : 0;
  if (paid > 0) post(day(m + 1 > 12 ? 12 : m + 1, 28), `VAT payment ${ym(m)}`, 'manual_journal', 'post', [dr('2202', paid), cr('1102', paid)], ym(m));
  periods.push({ month: ym(m), id: `vp${m}`, journalId: `j-vat-${m}`, journalStatus: 'posted', outputMinor: v.out, inputMinor: v.inp, dueMinor: v.due, paidMinor: paid, leftMinor: Math.max(0, payable - paid) });
}

// Manual journals: the opening one, two posted corrections, one waiting for approval (written by Karim, so the owner may approve it).
const journals: ManualJournal[] = [];
function journal(j: Partial<ManualJournal> & Pick<ManualJournal, 'memo' | 'entryDate' | 'status'>, lines: Line[]) {
  const n = journals.length + 1;
  const total = lines.reduce((s, l) => s + l.debitMinor, 0);
  journals.unshift({
    id: `j${n}`, number: `MJ-${pad(n).padStart(4, '0')}`, kind: 'manual', currency: 'EGP', direct: false, createdBy: 'u2', decidedBy: null, decidedAt: null,
    decisionComment: null, entryId: null, totalMinor: total, createdAt: `${j.entryDate}T09:00:00Z`,
    lines: lines.map((l, i) => ({ ...l, lineNo: i + 1, memo: l.memo ?? undefined, partyType: undefined, partyId: undefined })),
    ...j,
  } as ManualJournal);
}
journal({ kind: 'opening', memo: 'Opening balances', entryDate: `${year - 1}-12-31`, status: 'posted', createdBy: 'u1', direct: true, entryId: 'e1' }, entries[0]!.lines);
journal({ memo: 'Correct the rent posted to salaries', entryDate: day(Math.max(1, thisMonth - 2), 18), status: 'posted', decidedBy: 'u1', decisionComment: 'OK' }, [dr('5202', EGP(4_500)), cr('5201', EGP(4_500))]);
journal({ memo: 'Owner put money into the bank', entryDate: day(Math.max(1, thisMonth - 1), 9), status: 'posted', createdBy: 'u1', direct: true }, [dr('1102', EGP(100_000)), cr('3101', EGP(100_000))]);
journal({ memo: 'Accrued electricity for the month', entryDate: day(thisMonth, Math.min(20, new Date().getUTCDate())), status: 'draft' }, [dr('5202', EGP(3_200), 'Electricity'), cr('2101', EGP(3_200))]);

// ------------------------------------------------------------------ answers

function balances(from: string, to: string) {
  const open = new Map<string, number>();
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const e of entries) {
    for (const l of e.lines) {
      if (e.date < from) add(open, l.accountId, l.debitMinor - l.creditMinor);
      else if (e.date <= to) {
        add(debit, l.accountId, l.debitMinor);
        add(credit, l.accountId, l.creditMinor);
      }
    }
  }
  return { open, debit, credit };
}
const leavesUnder = (id: string): string[] => {
  const a = accounts.find((x) => x.id === id);
  if (!a) return [];
  return a.isLeaf ? [id] : accounts.filter((x) => x.parentId === id).flatMap((x) => leavesUnder(x.id));
};

function trialBalance(from: string, to: string): TrialBalanceRow[] {
  const b = balances(from, to);
  const sum = (m: Map<string, number>, id: string) => leavesUnder(id).reduce((s, k) => s + (m.get(k) ?? 0), 0);
  return [...accounts]
    .sort((x, y) => x.code.localeCompare(y.code))
    .map((a) => {
      const opening = sum(b.open, a.id);
      const d = sum(b.debit, a.id);
      const c = sum(b.credit, a.id);
      return { accountId: a.id, code: a.code, name: a.name, nameAr: a.nameAr, kind: a.kind, parentId: a.parentId, isLeaf: a.isLeaf, currency: 'EGP', openingMinor: opening, debitMinor: d, creditMinor: c, closingMinor: opening + d - c };
    });
}

function accountLines(id: string, from: string, to: string): AccountLine[] {
  const ids = new Set(leavesUnder(id));
  const a = accounts.find((x) => x.id === id);
  let bal = 0;
  for (const e of entries) if (e.date < from) for (const l of e.lines) if (ids.has(l.accountId)) bal += l.debitMinor - l.creditMinor;
  const out: AccountLine[] = [{ isOpening: true, lineId: null, entryId: null, entryNumber: null, entryDate: from, sourceType: null, sourceId: null, event: null, memo: null, accountCode: null, partyType: null, partyId: null, debitMinor: 0, creditMinor: 0, balanceMinor: bal }];
  let n = 0;
  for (const e of [...entries].sort((x, y) => x.date.localeCompare(y.date))) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) {
      if (!ids.has(l.accountId)) continue;
      bal += l.debitMinor - l.creditMinor;
      out.push({
        isOpening: false, lineId: ++n, entryId: e.id, entryNumber: e.number, entryDate: e.date, sourceType: e.sourceType, sourceId: e.id, event: e.event, memo: l.memo ?? e.memo,
        accountCode: a && !a.isLeaf ? (accounts.find((x) => x.id === l.accountId)?.code ?? null) : null, partyType: null, partyId: null, debitMinor: l.debitMinor, creditMinor: l.creditMinor, balanceMinor: bal,
      });
    }
  }
  return out;
}

const toLedger = (e: Entry, withLines: boolean): LedgerEntry => ({
  id: e.id, number: e.number, entryDate: e.date, currency: 'EGP', sourceType: e.sourceType, sourceId: e.id, event: e.event, memo: e.memo, reversesEntryId: null,
  isBackfill: false, postedBy: 'u1', approvedBy: null, createdAt: `${e.date}T10:00:00Z`, totalMinor: e.lines.reduce((s, l) => s + l.debitMinor, 0),
  ...(withLines ? { lines: e.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor, partyType: null, partyId: null, itemId: null, warehouseId: null, memo: l.memo ?? null })) } : {}),
});

function vatMonth(month: string): VatMonth {
  const m = Number(month.slice(5, 7));
  const v = vatOf(m);
  const end = day(m, lastDay(m));
  const period = periods.find((p) => p.month === month) ?? null;
  const dueOn = m === 12 ? `${year + 1}-01-31` : day(m + 1, lastDay(m + 1));
  // credit months in a row up to this one
  let streak = 0;
  for (let k = m; k >= 1 && vatOf(k).due < 0; k--) streak++;
  const { id: _i, month: _m, ...p } = period ?? ({} as Period);
  return {
    month, end, currency: 'EGP', ended: m < thisMonth, ledgerOutputMinor: v.out, ledgerInputMinor: v.inp, ledgerDueMinor: v.due, summaryDueMinor: v.due, differenceMinor: 0,
    period: period ? { id: period.id, ...p } as VatMonth['period'] : null, creditStreak: streak, smallEnterprise: true, refundAvailable: streak > 3, returnDueOn: dueOn, returnDueDays: null,
  };
}

function vatSummary(from: string, to: string): VatSummary {
  let out = 0;
  let inp = 0;
  let salesNet = 0;
  let buyNet = 0;
  const documents: VatSummary['documents'] = [];
  for (const e of entries) {
    if (e.vatClose || e.date < from || e.date > to) continue;
    const o = e.lines.find((l) => l.accountId === acc('2201'));
    const i = e.lines.find((l) => l.accountId === acc('1401'));
    if (o) {
      out += o.creditMinor;
      salesNet += Math.round(o.creditMinor / 0.14);
      documents.push({ type: 'customer_invoice', id: e.id, number: `INV-${e.date.slice(5, 7)}12`, date: e.date, side: 'sales', kind: 'taxable', rate: 14, netMinor: Math.round(o.creditMinor / 0.14), taxMinor: o.creditMinor, nonDeductibleTaxMinor: 0 } as VatSummary['documents'][number]);
    }
    if (i) {
      inp += i.debitMinor;
      buyNet += Math.round(i.debitMinor / 0.14);
      documents.push({ type: 'supplier_invoice', id: e.id, number: `PINV-${e.date.slice(5, 7)}05`, date: e.date, side: 'purchases', kind: 'local', rate: 14, netMinor: Math.round(i.debitMinor / 0.14), taxMinor: i.debitMinor, nonDeductibleTaxMinor: 0 } as VatSummary['documents'][number]);
    }
  }
  return {
    from, to, currency: 'EGP', vatRegistered: true, vatFrom: `${year - 2}-07-01`,
    sales: salesNet ? [{ kind: 'taxable', rate: 14, invoicesNetMinor: salesNet, invoicesTaxMinor: out, notesNetMinor: 0, notesTaxMinor: 0, netMinor: salesNet, taxMinor: out }] : [],
    purchases: buyNet ? [{ kind: 'local', netMinor: buyNet, deductibleTaxMinor: inp, nonDeductibleTaxMinor: 0 }] : [],
    outputTaxMinor: out, inputTaxMinor: inp, dueMinor: out - inp, warnings: [], otherCurrencyDocuments: 0, documents,
  };
}

type Body = Record<string, unknown>;
export function handleAccounting(method: string, pathname: string, query: URLSearchParams, data: Body, actorId: string): unknown {
  const from = query.get('from') || `${year}-01-01`;
  const to = query.get('to') || day(12, 31);
  if (pathname === '/v1/finance/vat-summary') return vatSummary(from, to);
  const rest = pathname.replace(/^\/v1\/accounting\/?/, '').split('/').filter(Boolean);
  const [area, id, action] = rest;
  if (area === 'accounts' && !id) return accounts;
  if (area === 'accounts' && action === 'lines') return accountLines(id!, from, to);
  if (area === 'trial-balance') return trialBalance(from, to);
  if (area === 'setup' && id === 'head-accountants') return [];
  if (area === 'entries' && !id) return [...entries].sort((x, y) => y.date.localeCompare(x.date)).map((e) => toLedger(e, false));
  if (area === 'entries') {
    const e = entries.find((x) => x.id === id);
    if (!e) throw new DemoError(404, 'Entry not found', 'not_found');
    return toLedger(e, true);
  }
  if (area === 'vat-months' && id) return vatMonth(id);
  if (area === 'journals') {
    if (!id && method === 'GET') {
      const status = query.get('status');
      return journals.filter((j) => !status || j.status === status);
    }
    if (!id && method === 'POST') {
      const n = journals.length + 1;
      const lines = (data.lines as Line[]) ?? [];
      const total = lines.reduce((s, l) => s + (l.debitMinor ?? 0), 0);
      const post = data.post === true;
      const j = { id: `j${n}`, number: `MJ-${pad(n).padStart(4, '0')}`, kind: (data.kind as 'manual' | 'opening') ?? 'manual', entryDate: String(data.entryDate), currency: String(data.currency ?? 'EGP'), memo: String(data.memo ?? ''), status: post ? 'posted' : 'draft', direct: post, createdBy: actorId, decidedBy: null, decidedAt: null, decisionComment: null, entryId: null, totalMinor: total, createdAt: new Date().toISOString(), lines: lines.map((l, i) => ({ ...l, lineNo: i + 1, debitMinor: l.debitMinor ?? 0, creditMinor: l.creditMinor ?? 0 })) } as ManualJournal;
      journals.unshift(j);
      return { id: j.id, number: j.number, status: j.status };
    }
    const j = journals.find((x) => x.id === id);
    if (!j) throw new DemoError(404, 'Journal not found', 'not_found');
    if (method === 'GET') return j;
    throw new DemoError(400, 'Not available in demo mode', 'not_found');
  }
  throw new DemoError(404, 'Not available in demo mode', 'not_found');
}
