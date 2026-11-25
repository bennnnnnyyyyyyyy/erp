// A new order or stock request filled in from a link (the low stock pop-up, sql/106): ?item=<id>&qty=<n>&supplier=<id>.
// Kept apart from the forms so it can be tested without a browser. Bad values are ignored, never shown as an error: the form then
// simply starts empty, as before.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderLink = { itemId: string; qty: string; partyId: string };

export function readOrderLink(search: string): OrderLink {
  const q = new URLSearchParams(search);
  const item = q.get('item') ?? '';
  const party = q.get('supplier') ?? q.get('customer') ?? '';
  const n = Number(q.get('qty') ?? '');
  return {
    itemId: UUID.test(item) ? item : '',
    qty: Number.isFinite(n) && n > 0 && n < 1e9 ? String(Math.round(n * 1000) / 1000) : '',
    partyId: UUID.test(party) ? party : '',
  };
}

/** The link the pop-up opens: a new purchase order (or stock request) for one item. */
export function orderLink(base: string, itemId: string, qty: number, supplierId?: string | null): string {
  const q = new URLSearchParams({ item: itemId });
  if (qty > 0) q.set('qty', String(Math.round(qty * 1000) / 1000));
  if (supplierId) q.set('supplier', supplierId);
  return `${base}?${q}`;
}

/** A new transfer filled in from a link (a sales order's stock shortage, Ben 25 Nov 2026): ?item=<id>&qty=<n>&from=<id>&to=<id>. */
export type TransferLink = { itemId: string; qty: string; fromId: string; toId: string };

export function readTransferLink(search: string): TransferLink {
  const q = new URLSearchParams(search);
  const base = readOrderLink(search);
  const id = (k: string) => {
    const v = q.get(k) ?? '';
    return UUID.test(v) ? v : '';
  };
  return { itemId: base.itemId, qty: base.qty, fromId: id('from'), toId: id('to') };
}

export function transferLink(itemId: string, qty: number, fromId: string, toId: string): string {
  const q = new URLSearchParams({ item: itemId, from: fromId, to: toId });
  if (qty > 0) q.set('qty', String(Math.round(qty * 1000) / 1000));
  return `/inventory/transfers/new?${q}`;
}
