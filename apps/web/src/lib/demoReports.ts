import type { ReportCell, ReportDefinition, ReportResult, ReportSource, SavedReport } from '@erp/shared';

// Demo mode only (see demo.ts): two sample report sources with made-up rows, and a small in-memory "run", so the Reports & Insights
// screens can be looked at with no API and no database. The real run is in the database (sql/109, rpt_run); this is not a copy of it.

const SOURCES: ReportSource[] = [
  {
    key: 'sales_lines',
    module: 'sales',
    period: 'invoice_date',
    periodRequired: true,
    hasCurrency: true,
    columns: [
      { key: 'invoice_date', type: 'date' },
      { key: 'invoice_number', type: 'text' },
      { key: 'customer', type: 'text' },
      { key: 'item', type: 'text' },
      { key: 'item_group', type: 'text' },
      { key: 'warehouse', type: 'text' },
      { key: 'qty', type: 'number' },
      { key: 'unit_price', type: 'money' },
      { key: 'net', type: 'money' },
      { key: 'vat', type: 'money' },
      { key: 'total', type: 'money' },
    ],
  },
  {
    key: 'expenses',
    module: 'finance',
    period: 'expense_date',
    periodRequired: true,
    hasCurrency: true,
    columns: [
      { key: 'expense_date', type: 'date' },
      { key: 'expense_number', type: 'text' },
      { key: 'category', type: 'text' },
      { key: 'supplier', type: 'text' },
      { key: 'net', type: 'money' },
      { key: 'vat', type: 'money' },
      { key: 'amount', type: 'money' },
    ],
  },
];

type Row = Record<string, ReportCell> & { currency: string };
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const CUSTOMERS = ['Nile Foods', 'Delta Market', 'Cairo Kitchens', 'Alex Retail'];
const ITEMS: [string, string, number][] = [['Olive oil 1 L', 'Oils', 18500], ['Rice 5 kg', 'Grains', 21000], ['Sugar 1 kg', 'Grains', 3600], ['Tea 250 g', 'Drinks', 7400]];

const ROWS: Record<string, Row[]> = {
  sales_lines: Array.from({ length: 36 }, (_, i) => {
    const [item, group, price] = ITEMS[i % ITEMS.length] as [string, string, number];
    const qty = 2 + ((i * 7) % 11);
    const net = qty * price;
    return {
      invoice_date: day(i % 28),
      invoice_number: `INV-${String(1040 + i).padStart(5, '0')}`,
      customer: CUSTOMERS[(i * 3) % CUSTOMERS.length] as string,
      item,
      item_group: group,
      warehouse: i % 3 === 0 ? 'Giza store' : 'Main store',
      qty,
      unit_price: price,
      net,
      vat: Math.round(net * 0.14),
      total: net + Math.round(net * 0.14),
      currency: 'EGP',
    };
  }),
  expenses: Array.from({ length: 14 }, (_, i) => {
    const net = 50_000 + ((i * 37_000) % 400_000);
    return {
      expense_date: day((i * 2) % 28),
      expense_number: `EXP-${String(210 + i).padStart(5, '0')}`,
      category: ['Rent', 'Electricity', 'Transport', 'Office supplies'][i % 4] as string,
      supplier: ['Cairo Power', 'Fast Trucks', 'Paper Co.'][i % 3] as string,
      net,
      vat: Math.round(net * 0.14),
      amount: net + Math.round(net * 0.14),
      currency: 'EGP',
    };
  }),
};

const saved: SavedReport[] = [];

function matches(r: Row, def: ReportDefinition, src: ReportSource): boolean {
  if (def.period && src.period) {
    const d = String(r[src.period]);
    if (d < def.period.from || d > def.period.to) return false;
  }
  return (def.filters ?? []).every((f) => {
    const v = r[f.column];
    const x = f.value;
    switch (f.op) {
      case 'eq': return v === x;
      case 'ne': return v !== x;
      case 'contains': return String(v ?? '').toLowerCase().includes(String(x ?? '').toLowerCase());
      case 'in': return Array.isArray(x) && x.includes(v as string);
      case 'gt': return x !== null && (v as number) > (x as number);
      case 'gte': return x !== null && (v as number) >= (x as number);
      case 'lt': return x !== null && (v as number) < (x as number);
      case 'lte': return x !== null && (v as number) <= (x as number);
      case 'between': return Array.isArray(x) && (v as number) >= (x[0] as number) && (v as number) <= (x[1] as number);
      case 'is_empty': return v === null || v === '';
      default: return true;
    }
  });
}

function aggregate(rows: Row[], fn: string, column: string): number | null {
  const nums = rows.map((r) => r[column]).filter((v): v is number => typeof v === 'number');
  if (fn === 'count') return rows.length;
  if (nums.length === 0) return null;
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (fn === 'avg') return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  if (fn === 'min') return Math.min(...nums);
  return Math.max(...nums);
}

function run(def: ReportDefinition): ReportResult {
  const src = SOURCES.find((s) => s.key === def.source);
  if (!src) throw new Error('Unknown source');
  const typeOf = (k: string) => src.columns.find((c) => c.key === k)?.type ?? 'text';
  const rows = (ROWS[src.key] ?? []).filter((r) => matches(r, def, src));
  const totals = (def.totals ?? []).map((t) => ({ key: `${t.fn}_${t.column}`, fn: t.fn, column: t.column, type: t.fn === 'count' ? ('number' as const) : typeOf(t.column) }));
  const groups = def.groupBy ?? [];
  let columns: ReportResult['columns'];
  let out: ReportCell[][];
  if (groups.length > 0) {
    const buckets = new Map<string, Row[]>();
    for (const r of rows) {
      const k = JSON.stringify([...groups.map((g) => r[g]), r.currency]);
      buckets.set(k, [...(buckets.get(k) ?? []), r]);
    }
    columns = [...groups.map((g) => ({ key: g, type: typeOf(g) })), { key: 'currency', type: 'currency' as const }, ...totals.map((t) => ({ key: t.key, type: t.type }))];
    out = [...buckets.values()].map((b) => {
      const first = b[0] as Row;
      return [...groups.map((g) => first[g] ?? null), first.currency, ...totals.map((t) => aggregate(b, t.fn, t.column))];
    });
  } else {
    const cols = def.columns ?? [];
    const money = cols.some((c) => typeOf(c) === 'money');
    columns = [...cols.map((c) => ({ key: c, type: typeOf(c) })), ...(money ? [{ key: 'currency', type: 'currency' as const }] : [])];
    out = rows.map((r) => [...cols.map((c) => r[c] ?? null), ...(money ? [r.currency] : [])]);
  }
  const sort = def.sort?.[0];
  if (sort) {
    const i = columns.findIndex((c) => c.key === sort.column);
    out.sort((a, b) => {
      const x = a[i] ?? '';
      const y = b[i] ?? '';
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
  }
  const limit = Math.min(def.limit ?? 5000, 5000);
  const money = totals.some((t) => t.type === 'money');
  const totalRows = totals.length === 0 ? [] : [{ currency: money ? 'EGP' : null, values: totals.map((t) => aggregate(rows, t.fn, t.column)) }];
  return { columns, rows: out.slice(0, limit), totals, totalRows, truncated: out.length > limit };
}

/** `/v1/reports/...` in demo mode. */
export function handleReports(method: string, rest: string[], data: Record<string, unknown>): unknown {
  const [area, id] = rest;
  if (area === 'sources') return SOURCES;
  if (area === 'run') return run(data.definition as ReportDefinition);
  if (area === 'saved') {
    if (!id && method === 'GET') return saved;
    if (!id && method === 'POST') {
      const r: SavedReport = {
        id: `demo-report-${saved.length + 1}`,
        name: String(data.name ?? ''),
        description: (data.description as string | null) ?? null,
        definition: data.definition as ReportDefinition,
        templateKey: (data.templateKey as string | null) ?? null,
        visibility: (data.visibility as SavedReport['visibility']) ?? 'private',
        mine: true,
        updatedAt: new Date().toISOString(),
      };
      saved.push(r);
      return { id: r.id };
    }
    const r = saved.find((x) => x.id === id);
    if (!r) throw new Error('Not found');
    if (method === 'PATCH') Object.assign(r, data, { updatedAt: new Date().toISOString() });
    if (method === 'DELETE') saved.splice(saved.indexOf(r), 1);
    return r;
  }
  throw new Error('Not in the demo');
}
