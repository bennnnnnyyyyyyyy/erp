import {
  type BillScanLine,
  type BillScanOrderLine,
  type BillScanResult,
  type BillWarning,
  formatMoney,
  minorUnitsFor,
  type ScannedBill,
  type ScannedBillLine,
} from '@erp/shared';

// Scanning supplier bills (sql/108, SCANNING_PLAN.md step 1): OUR matching, never the AI's. Pure functions, no database: the route reads
// the candidates (pur_bill_scan_candidates) and gives them here. The supplier: by tax number, then by name. The order: the one the bill
// names, else the one most lines match. Each line: the supplier's own item code (sql/099), our item code, then the name. Every
// difference becomes a warning; numbers are never changed without one.

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

// ------------------------------------------------------------------ cleaning what the AI answered

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const westernDigits = (s: string) =>
  s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)) % 10));

function str(x: unknown, max = 200): string | null {
  if (typeof x !== 'string' && typeof x !== 'number') return null;
  const s = String(x).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** A number as printed: 1,140.50 or ١٬١٤٠٫٥٠ or "1140.5". Null when it is not a plain number. */
export function num(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const s = westernDigits(x)
    .replace(/[٬,\s]/g, '')
    .replace('٫', '.')
    .replace(/[^\d.-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function day(x: unknown): string | null {
  const s = str(x, 30);
  if (!s) return null;
  const m = westernDigits(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** The AI's answer in our shape, whatever it sent. Anything unusable becomes null; at most 200 lines. */
export function normalizeScannedBill(raw: unknown): ScannedBill {
  const r = isObj(raw) ? raw : {};
  const currency = str(r.currency, 10)?.toUpperCase() ?? null;
  const lines: ScannedBillLine[] = (Array.isArray(r.lines) ? r.lines : []).slice(0, 200).flatMap((x) => {
    if (!isObj(x)) return [];
    const line = {
      description: str(x.description) ?? '',
      itemCode: str(x.itemCode, 64),
      qty: num(x.qty),
      unitPrice: num(x.unitPrice),
      vatRate: num(x.vatRate),
      lineTotal: num(x.lineTotal),
    };
    return line.description || line.itemCode || line.qty !== null ? [line] : [];
  });
  return {
    supplierName: str(r.supplierName),
    supplierTaxNumber: str(r.supplierTaxNumber, 40),
    billNumber: str(r.billNumber, 60),
    billDate: day(r.billDate),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    orderRef: str(r.orderRef, 60),
    lines,
    netTotal: num(r.netTotal),
    vatTotal: num(r.vatTotal),
    grandTotal: num(r.grandTotal),
  };
}

// ------------------------------------------------------------------ comparing names and codes

/** Lower case, Arabic letter forms joined (أ إ آ → ا, ة → ه, ى → ي), no diacritics, digits in Western form, only letters and digits. */
export function normText(s: string | null | undefined): string {
  return westernDigits(s ?? '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export const normCode = (s: string | null | undefined) => normText(s).replace(/\s+/g, '');

const NOISE = new Set(['co', 'company', 'ltd', 'llc', 'inc', 'sae', 'for', 'and', 'the', 'شركه', 'لل', 'و', 'ش', 'م', 'مصر']);
const words = (s: string | null | undefined) =>
  new Set(
    normText(s)
      .split(' ')
      .filter((w) => w.length > 1 && !NOISE.has(w)),
  );

/** 0..1: how many words the two names share (Dice). The same text, without spaces, is 1. */
export function nameScore(a: string | null | undefined, b: string | null | undefined): number {
  if (normCode(a) && normCode(a) === normCode(b)) return 1;
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return (2 * shared) / (x.size + y.size);
}

// ------------------------------------------------------------------ the candidates from the database

export type Candidates = {
  suppliers: { id: string; name: string; taxNumber: string | null; how: 'tax' | 'name' }[];
  supplierId: string | null;
  receivedOrders: { id: string; number: string; currency: string; lines: BillScanOrderLine[] | null }[];
  waitingOrders: { id: string; number: string }[];
};

/** The supplier: the one the database found by tax number, else the best name above 0.6. */
export function pickSupplier(bill: ScannedBill, c: Candidates): { id: string; how: 'tax' | 'name' } | null {
  const byTax = c.suppliers.find((s) => s.how === 'tax');
  if (byTax) return { id: byTax.id, how: 'tax' };
  let best: { id: string; score: number } | null = null;
  for (const s of c.suppliers) {
    const score = nameScore(bill.supplierName, s.name);
    if (score >= 0.6 && (!best || score > best.score)) best = { id: s.id, score };
  }
  return best ? { id: best.id, how: 'name' } : null;
}

const W = (code: string, text: string, values?: BillWarning['values']): BillWarning => ({ code, text, ...(values ? { values } : {}) });
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type LineMatch = { orderLineId: string | null; how: BillScanLine['how'] };

/** Each bill line to at most one order line: supplier's code, our code, then the name (0.5 or more). */
export function matchLines(billLines: ScannedBillLine[], orderLines: BillScanOrderLine[]): LineMatch[] {
  const used = new Set<string>();
  const out: LineMatch[] = billLines.map(() => ({ orderLineId: null, how: null }));
  billLines.forEach((l, i) => {
    const code = normCode(l.itemCode);
    if (!code) return;
    const bySupplier = orderLines.find((o) => !used.has(o.orderLineId) && o.supplierCode && normCode(o.supplierCode) === code);
    const byOurs = bySupplier ? null : orderLines.find((o) => !used.has(o.orderLineId) && normCode(o.sku) === code);
    const hit = bySupplier ?? byOurs;
    if (hit) {
      used.add(hit.orderLineId);
      out[i] = { orderLineId: hit.orderLineId, how: bySupplier ? 'supplier_code' : 'item_code' };
    }
  });
  billLines.forEach((l, i) => {
    if (out[i]?.orderLineId) return;
    let best: { id: string; score: number } | null = null;
    for (const o of orderLines) {
      if (used.has(o.orderLineId)) continue;
      const score = Math.max(
        nameScore(l.description, o.name),
        nameScore(l.description, o.nameAr),
        nameScore(l.description, o.supplierCode),
      );
      if (score >= 0.5 && (!best || score > best.score)) best = { id: o.orderLineId, score };
    }
    if (best) {
      used.add(best.id);
      out[i] = { orderLineId: best.id, how: 'name' };
    }
  });
  return out;
}

/** The order: the one the bill names, else the one with most matched lines (the newest when equal). */
export function pickOrder(bill: ScannedBill, orders: Candidates['receivedOrders']) {
  const ref = normCode(bill.orderRef);
  const named = ref
    ? orders.find((o) => normCode(o.number) === ref || normCode(o.number).replace(/^\D+0*/, '') === ref.replace(/^\D+0*/, ''))
    : null;
  if (named) return named;
  let best: { o: Candidates['receivedOrders'][number]; n: number } | null = null;
  for (const o of orders) {
    const n = matchLines(bill.lines, o.lines ?? []).filter((m) => m.orderLineId).length;
    if (!best || n > best.n) best = { o, n };
  }
  return best?.o ?? null;
}

// ------------------------------------------------------------------ the draft

const today = () => new Date().toISOString().slice(0, 10);

/** Everything the screen shows, from what the AI read and the candidates. */
export function buildDraft(
  bill: ScannedBill,
  c: Candidates,
  supplier: { id: string; how: 'tax' | 'name' } | null,
  /** The order the person chose, instead of ours. */
  orderId?: string | null,
): Omit<BillScanResult, 'extractionId' | 'provider' | 'model' | 'file'> {
  const warnings: BillWarning[] = [];
  const sup = supplier ? c.suppliers.find((s) => s.id === supplier.id) : undefined;
  if (!supplier)
    warnings.push(
      W('supplier_not_found', 'No supplier matches "{name}" (tax number {tax}). Choose the supplier.', {
        name: bill.supplierName ?? '—',
        tax: bill.supplierTaxNumber ?? '—',
      }),
    );
  else if (
    supplier.how === 'name' &&
    sup?.taxNumber &&
    bill.supplierTaxNumber &&
    normCode(sup.taxNumber) !== normCode(bill.supplierTaxNumber)
  )
    warnings.push(
      W('tax_number_differs', 'The tax number on the bill ({bill}) is not the one saved for {supplier} ({saved}).', {
        bill: bill.supplierTaxNumber,
        supplier: sup.name,
        saved: sup.taxNumber,
      }),
    );
  if (!bill.billNumber) warnings.push(W('no_number', 'The bill number could not be read. Type it.'));
  if (!bill.billDate) warnings.push(W('no_date', 'The bill date could not be read. Check it.'));

  const chosen = orderId ? c.receivedOrders.find((o) => o.id === orderId) : undefined;
  const order = supplier ? (chosen ?? pickOrder(bill, c.receivedOrders)) : null;
  if (supplier && !order)
    warnings.push(
      W('no_received_order', 'No goods from this supplier are waiting for a bill. Receive the goods first, then scan the bill again.'),
    );
  const orderLines = order?.lines ?? [];
  const currency = order?.currency ?? bill.currency ?? 'EGP';
  const scale = 10 ** minorUnitsFor(currency);
  const money = (minor: number) => formatMoney({ amountMinor: Math.round(minor), currency });
  if (order && bill.currency && bill.currency !== order.currency)
    warnings.push(W('currency_differs', 'The bill is in {bill}; the order is in {order}.', { bill: bill.currency, order: order.currency }));

  const matches = order ? matchLines(bill.lines, orderLines) : bill.lines.map(() => ({ orderLineId: null, how: null }));
  const lines: BillScanLine[] = bill.lines.map((l, index) => {
    const m = matches[index] ?? { orderLineId: null, how: null };
    const ol = orderLines.find((o) => o.orderLineId === m.orderLineId);
    const lw: BillWarning[] = [];
    if (!ol) {
      if (order) lw.push(W('line_not_on_order', 'This line is not on the order.'));
      return { index, line: l, orderLineId: null, how: null, qty: null, warnings: lw };
    }
    const factor = ol.unitFactor && ol.unitFactor > 0 ? ol.unitFactor : 1;
    const left = round3(Number(ol.receivedQty) - Number(ol.billedQty));
    let qty = l.qty === null ? null : round3(l.qty * factor);
    if (qty === null) lw.push(W('no_qty', 'The quantity could not be read.'));
    else if (qty > left) {
      lw.push(
        W('qty_over', 'The bill says {bill}, but only {left} were received and not yet billed. The draft uses {left}.', {
          bill: qty,
          left,
        }),
      );
      qty = left;
    } else if (qty < left) lw.push(W('qty_less', 'The bill says {bill}; {left} were received and not yet billed.', { bill: qty, left }));
    if (l.unitPrice !== null) {
      const billMinor = (l.unitPrice * scale) / factor;
      if (Math.abs(billMinor - ol.unitCostMinor) >= 0.5)
        lw.push(
          W(
            'price_differs',
            'Price is not the same as the order: the bill says {bill}, the order says {order} ({diff} for each unit). The bill is saved at the order price: correct the order or ask the supplier for a credit note.',
            {
              bill: money(billMinor),
              order: money(ol.unitCostMinor),
              diff: `${billMinor > ol.unitCostMinor ? '+' : '−'}${money(Math.abs(billMinor - ol.unitCostMinor))}`,
            },
          ),
        );
    }
    if (l.vatRate !== null && ol.vatRate !== null && Math.abs(l.vatRate - Number(ol.vatRate)) > 0.001)
      lw.push(
        W('vat_differs', 'VAT is not the same: the bill says {bill}%, the item has {item}%.', {
          bill: l.vatRate,
          item: Number(ol.vatRate),
        }),
      );
    return { index, line: l, orderLineId: ol.orderLineId, how: m.how, qty, warnings: lw };
  });

  for (const ol of orderLines) {
    const left = round3(Number(ol.receivedQty) - Number(ol.billedQty));
    if (left > 0 && !lines.some((l) => l.orderLineId === ol.orderLineId))
      warnings.push(
        W('not_on_bill', '{item}: {left} received and not yet billed, but not on this bill.', { item: `${ol.sku} · ${ol.name}`, left }),
      );
  }

  // The printed totals against the printed lines (a hundredth for each line and a little more for rounding).
  const lineSum = bill.lines.reduce((s, l) => s + (l.lineTotal ?? (l.qty !== null && l.unitPrice !== null ? l.qty * l.unitPrice : 0)), 0);
  const tol = 0.01 * Math.max(1, bill.lines.length) + 0.05;
  if (bill.netTotal !== null && bill.lines.length && Math.abs(lineSum - bill.netTotal) > tol)
    warnings.push(
      W('lines_not_net', 'The lines add up to {sum}, but the bill prints {net} before VAT.', {
        sum: money(lineSum * scale),
        net: money(bill.netTotal * scale),
      }),
    );
  const net = bill.netTotal ?? (bill.lines.length ? lineSum : null);
  if (net !== null && bill.vatTotal !== null && bill.grandTotal !== null && Math.abs(net + bill.vatTotal - bill.grandTotal) > tol)
    warnings.push(
      W('total_mismatch', 'The total before VAT plus VAT ({sum}) is not the printed total ({total}).', {
        sum: money((net + bill.vatTotal) * scale),
        total: money(bill.grandTotal * scale),
      }),
    );

  return {
    bill,
    supplier: sup && supplier ? { id: sup.id, name: sup.name, how: supplier.how } : null,
    suppliers: c.suppliers.map((s) => ({ id: s.id, name: s.name, taxNumber: s.taxNumber })),
    order: order ? { id: order.id, number: order.number, currency: order.currency } : null,
    orders: c.receivedOrders.map((o) => ({ id: o.id, number: o.number })),
    waitingOrders: c.waitingOrders,
    orderLines,
    lines,
    warnings,
    draft: {
      supplierId: sup?.id ?? null,
      orderId: order?.id ?? null,
      number: bill.billNumber ?? '',
      invoiceDate: bill.billDate ?? today(),
      taxMinor: bill.vatTotal === null ? null : Math.round(bill.vatTotal * scale),
      lines: lines.flatMap((l) => (l.orderLineId && l.qty && l.qty > 0 ? [{ orderLineId: l.orderLineId, qty: l.qty }] : [])),
    },
  };
}
