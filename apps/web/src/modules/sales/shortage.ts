// Not enough stock to deliver a sales order (StockShortage.tsx): what is short, kept apart so it can be tested without a browser.

type StockRow = { itemId: string; warehouseId: string; available: number };
export type Shortage = { itemId: string; need: number; available: number; short: number; elsewhere: { warehouseId: string; available: number }[] };

/** What the order needs per item, against what is available in its warehouse. */
export function shortagesFor(lines: { itemId: string; qty: number }[], warehouseId: string, stock: StockRow[]): Shortage[] {
  const need = new Map<string, number>();
  for (const l of lines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
  const out: Shortage[] = [];
  for (const [itemId, n] of need) {
    const here = stock.filter((s) => s.itemId === itemId && s.warehouseId === warehouseId).reduce((a, s) => a + s.available, 0);
    if (here + 1e-9 >= n) continue;
    const elsewhere = stock.filter((s) => s.itemId === itemId && s.warehouseId !== warehouseId && s.available > 0).map((s) => ({ warehouseId: s.warehouseId, available: s.available }));
    out.push({ itemId, need: n, available: Math.max(0, here), short: Math.round((n - Math.max(0, here)) * 1000) / 1000, elsewhere });
  }
  return out;
}
