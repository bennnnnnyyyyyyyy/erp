import type { ReportSource, SalesForecast, SalesForecastRow, SavedReport } from '@erp/shared';
import { DemoError } from './demo';

// Sample answers for the reports screens in the new UI's demo build (lib/demo.ts asks this only when the new UI is on): two saved
// reports, the report sources (so the ready-made reports show in the library), and a sales forecast. Nothing here ships in a normal
// build; the old UI's demo is unchanged.

const SOURCES = ['sales_lines', 'purchase_lines', 'stock_moves', 'stock_on_hand', 'receivables', 'expenses', 'payments'];
const saved: SavedReport[] = [
  { id: 'r1', name: 'Gloves sold by month', description: 'Safety gloves, quantity and value per month.', definition: { source: 'sales_lines', columns: [], period: null } as unknown as SavedReport['definition'], templateKey: null, visibility: 'private', mine: true, updatedAt: new Date().toISOString() },
  { id: 'r2', name: 'Overdue customers (weekly)', description: 'Customers with invoices more than 30 days late.', definition: { source: 'receivables', columns: [], period: null } as unknown as SavedReport['definition'], templateKey: null, visibility: 'company', mine: false, updatedAt: new Date().toISOString() },
];

type P = [id: string, code: string, name: string, nameAr: string, uom: string, last30: number, prev30: number, oldest30: number, price: number, invoices: number];
const PRODUCTS: P[] = [
  ['i1', 'GLV-001', 'Safety gloves', 'قفازات أمان', 'pair', 420, 360, 300, 55, 24],
  ['i2', 'TAP-002', 'Packing tape', 'شريط تغليف', 'roll', 310, 320, 315, 32, 19],
  ['i3', 'CRT-003', 'Carton 40x30', 'كرتونة 40×30', 'piece', 900, 1050, 1200, 12, 15],
  ['i4', 'WRP-004', 'Pallet wrap', 'غلاف بالتات', 'roll', 64, 52, 40, 240, 11],
  ['i5', 'LBL-005', 'Barcode labels', 'ملصقات باركود', 'box', 18, 9, 0, 95, 4],
];
type C = [id: string, code: string, name: string, last30: number, prev30: number, oldest30: number, invoices: number];
const CUSTOMERS: C[] = [
  ['c1', 'C-001', 'Al-Ahram Distribution', 61_000, 52_000, 47_000, 14],
  ['c2', 'C-002', 'Sphinx Retail Group', 38_500, 40_000, 41_000, 11],
  ['c3', 'C-003', 'Delta Pharma Stores', 22_000, 27_000, 33_000, 9],
  ['c4', 'C-004', 'Nile Cosmetics', 9_500, 4_000, 0, 3],
];
const trendOf = (last: number, oldest: number): SalesForecastRow['trend'] => (oldest === 0 ? 'up' : last > oldest * 1.1 ? 'up' : last < oldest * 0.9 ? 'down' : 'flat');
const daily = (a: number, b: number, c: number) => (a * 0.5 + b * 0.3 + c * 0.2) / 30;

function forecast(by: string, horizon: number): SalesForecast {
  const asOf = new Date().toISOString().slice(0, 10);
  if (by === 'customer') {
    return {
      asOf, by: 'customer', horizon: horizon as SalesForecast['horizon'],
      rows: CUSTOMERS.map(([id, code, name, a, b, c, inv]) => ({
        id, code, name, nameAr: null, uom: null, qtyLast30: null, qtyPrev30: null, qtyOldest30: null, dailyQty: null, forecastQty: null, invoices: inv,
        historyDays: c ? 90 : 45, trend: trendOf(a, c), confidence: inv >= 8 && c ? 'good' : 'thin',
        values: [{ currency: 'EGP', last30Minor: a * 100, forecastMinor: Math.round(daily(a, b, c) * horizon * 100) }],
      })) as SalesForecastRow[],
    };
  }
  return {
    asOf, by: 'item', horizon: horizon as SalesForecast['horizon'],
    rows: PRODUCTS.map(([id, code, name, nameAr, uom, a, b, c, price, inv]) => {
      const d = daily(a, b, c);
      return {
        id, code, name, nameAr, uom, qtyLast30: a, qtyPrev30: b, qtyOldest30: c, dailyQty: d, forecastQty: Math.round(d * horizon), invoices: inv,
        historyDays: c ? 90 : 45, trend: trendOf(a, c), confidence: inv >= 8 && c ? 'good' : 'thin',
        values: [{ currency: 'EGP', last30Minor: a * price * 100, forecastMinor: Math.round(d * horizon * price * 100) }],
      };
    }) as SalesForecastRow[],
  };
}

export function handleReports(method: string, pathname: string, query: URLSearchParams): unknown {
  const rest = pathname.replace(/^\/v1\/reports\/?/, '').split('/').filter(Boolean);
  if (method !== 'GET') throw new DemoError(400, 'Not available in demo mode', 'not_found');
  if (rest[0] === 'saved' && !rest[1]) return saved;
  if (rest[0] === 'sources') return SOURCES.map((key) => ({ key, module: 'core', period: null, periodRequired: false, hasCurrency: true, columns: [] }) as ReportSource);
  if (rest[0] === 'forecast' && rest[1] === 'sales') return forecast(query.get('by') ?? 'item', Number(query.get('horizon') ?? 30));
  throw new DemoError(404, 'Not available in demo mode', 'not_found');
}
