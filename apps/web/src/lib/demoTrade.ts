import { catalog, createRequest, getRequest, receiveGoods, DemoRuleError, type Actor, type RequestStatus } from './demoInventory';

// DEMO ONLY: sample purchasing and sales on top of the inventory demo, to show how the product grows
// past the first slice (see TECHNICAL_PLAN.md section 3.5, waves 2 and 3). Receiving a purchase order adds
// stock to the ledger; a sales order raises a stock request that still needs a manager's approval.
// Money is held as integer minor units (piastres), as the real product will.

export type Party = { id: string; kind: 'supplier' | 'customer'; name: string; contact: string; city: string; phone: string };
export type POStatus = 'ordered' | 'received' | 'cancelled';
export type PurchaseOrder = {
  id: string;
  number: string;
  supplierId: string;
  warehouseId: string;
  status: POStatus;
  lines: { itemId: string; qty: number; unitCostMinor: number }[];
  totalMinor: number;
  currency: string;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
};
export type SOStatus = 'open' | 'stock_requested' | 'approved' | 'delivered' | 'cancelled';
export type SalesOrder = {
  id: string;
  number: string;
  customerId: string;
  warehouseId: string;
  status: SOStatus;
  lines: { itemId: string; qty: number; unitPriceMinor: number }[];
  totalMinor: number;
  currency: string;
  requestId: string | null;
  requestStatus: RequestStatus | null;
  createdBy: string;
  createdAt: string;
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const forbid = () => new DemoRuleError(403, "You don't have permission to do that", 'forbidden');
const canWrite = (a: Actor) => a.role !== 'viewer';

const parties: Party[] = [
  { id: 's1', kind: 'supplier', name: 'Delta Packaging Supplies', contact: 'Hesham Nour', city: 'Cairo', phone: '+20 100 555 0141' },
  { id: 's2', kind: 'supplier', name: 'Nile Industrial Trading', contact: 'Dalia Wahba', city: 'Alexandria', phone: '+20 103 555 0188' },
  { id: 's3', kind: 'supplier', name: 'Gulf Pallet Co.', contact: 'Tariq Mansour', city: 'Dubai', phone: '+971 4 555 0102' },
  { id: 'c1', kind: 'customer', name: 'Al-Ahram Distribution', contact: 'Sherif Bakr', city: 'Giza', phone: '+20 112 555 0123' },
  { id: 'c2', kind: 'customer', name: 'Sphinx Retail Group', contact: 'Nadine Fouad', city: 'Cairo', phone: '+20 109 555 0177' },
  { id: 'c3', kind: 'customer', name: 'Red Sea Logistics', contact: 'Amr Ghoneim', city: 'Hurghada', phone: '+20 122 555 0155' },
];

const purchaseOrders: PurchaseOrder[] = [];
const salesOrders: SalesOrder[] = [];
let poSeq = 0;
let soSeq = 0;
const sum = (lines: { qty: number; unitCostMinor?: number; unitPriceMinor?: number }[]) => lines.reduce((a, l) => a + l.qty * (l.unitCostMinor ?? l.unitPriceMinor ?? 0), 0);

function addPO(supplierId: string, warehouseId: string, lines: PurchaseOrder['lines'], createdBy: string, createdAt: string): PurchaseOrder {
  const n = ++poSeq;
  const po: PurchaseOrder = { id: `p${n}`, number: `PO-${String(n).padStart(4, '0')}`, supplierId, warehouseId, status: 'ordered', lines, totalMinor: sum(lines), currency: 'EGP', createdBy, createdAt, receivedAt: null };
  purchaseOrders.unshift(po);
  return po;
}
function addSO(customerId: string, warehouseId: string, lines: SalesOrder['lines'], createdBy: string, createdAt: string): SalesOrder {
  const n = ++soSeq;
  const so: SalesOrder = { id: `o${n}`, number: `SO-${String(n).padStart(4, '0')}`, customerId, warehouseId, status: 'open', lines, totalMinor: sum(lines), currency: 'EGP', requestId: null, requestStatus: null, createdBy, createdAt };
  salesOrders.unshift(so);
  return so;
}

// Seed: one purchase order waiting for goods, two sales orders (one already linked to the pending stock request).
addPO('s1', 'w1', [{ itemId: 'i3', qty: 300, unitCostMinor: 1850 }, { itemId: 'i2', qty: 48, unitCostMinor: 3200 }], 'u2', hoursAgo(20));
const seeded = addSO('c1', 'w1', [{ itemId: 'i1', qty: 30, unitPriceMinor: 5500 }], 'u3', hoursAgo(4));
seeded.requestId = 'r2';
const seededRequest = getRequest('r2');
if (seededRequest) seededRequest.source = { type: 'sales_order', id: seeded.id, number: seeded.number };
addSO('c2', 'w1', [{ itemId: 'i4', qty: 6, unitPriceMinor: 24000 }, { itemId: 'i5', qty: 4, unitPriceMinor: 9500 }], 'u3', hoursAgo(2));

/** Order status follows its stock request: issued means delivered. */
function view(so: SalesOrder): SalesOrder {
  const req = so.requestId ? getRequest(so.requestId) : undefined;
  const requestStatus = req?.status ?? null;
  let status: SOStatus = so.status;
  if (status !== 'cancelled') {
    if (!req || requestStatus === 'rejected' || requestStatus === 'cancelled') status = 'open';
    else if (requestStatus === 'issued') status = 'delivered';
    else if (requestStatus === 'approved') status = 'approved';
    else status = 'stock_requested';
  }
  return { ...so, status, requestStatus };
}

function validLines<T extends { itemId: string; qty: number }>(raw: T[] | undefined): T[] {
  const lines = (raw ?? []).filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ ...l, qty: Number(l.qty) }));
  if (lines.length === 0) throw new DemoRuleError(400, 'Add at least one item with a quantity', 'invalid_input');
  return lines;
}

const names = (lines: { itemId: string; qty: number }[]) => lines.map((l) => `${l.qty} x ${catalog.itemName(l.itemId)}`).join(', ');

export function handleTrade(domain: 'purchasing' | 'sales', method: string, parts: string[], body: Record<string, unknown>, actor: Actor): unknown {
  const [area, id, action] = parts;
  const kind = domain === 'purchasing' ? 'supplier' : 'customer';

  if (area === (domain === 'purchasing' ? 'suppliers' : 'customers')) {
    if (method === 'GET') return parties.filter((p) => p.kind === kind);
    if (!canWrite(actor)) throw forbid();
    const name = String(body.name ?? '').trim();
    if (!name) throw new DemoRuleError(400, 'Name is required', 'invalid_input');
    const party: Party = { id: `${kind[0]}${parties.length + 1}`, kind, name, contact: String(body.contact ?? '').trim(), city: String(body.city ?? '').trim(), phone: String(body.phone ?? '').trim() };
    parties.push(party);
    actor.log(`${domain}.${kind}.created`, kind, party.id, `${kind === 'supplier' ? 'Supplier' : 'Customer'} ${name} added`);
    return party;
  }

  if (area !== 'orders') throw new DemoRuleError(404, 'Not available in demo mode', 'not_found');

  if (domain === 'purchasing') {
    if (!id) {
      if (method === 'GET') return purchaseOrders;
      if (!canWrite(actor)) throw forbid();
      const supplierId = String(body.supplierId ?? '');
      if (!parties.some((p) => p.id === supplierId && p.kind === 'supplier')) throw new DemoRuleError(400, 'Choose a supplier', 'invalid_input');
      const lines = validLines(body.lines as PurchaseOrder['lines'] | undefined).map((l) => ({ itemId: l.itemId, qty: l.qty, unitCostMinor: Math.round(Number(l.unitCostMinor) || 0) }));
      const po = addPO(supplierId, String(body.warehouseId ?? 'w1'), lines, actor.id, new Date().toISOString());
      actor.log('purchasing.order.created', 'purchase_order', po.id, `${po.number} created for ${parties.find((p) => p.id === supplierId)?.name}: ${names(lines)}`);
      return po;
    }
    const po = purchaseOrders.find((p) => p.id === id);
    if (!po) throw new DemoRuleError(404, 'Purchase order not found', 'not_found');
    if (method === 'GET') return po;
    if (!canWrite(actor)) throw forbid();
    if (action === 'receive') {
      if (po.status !== 'ordered') throw new DemoRuleError(409, `${po.number} is already ${po.status}`, 'invalid_state');
      receiveGoods(actor, po.warehouseId, po.lines, po.number);
      po.status = 'received';
      po.receivedAt = new Date().toISOString();
      actor.log('purchasing.order.received', 'purchase_order', po.id, `${po.number} received into stock by ${actor.name}: ${names(po.lines)}`);
      return po;
    }
    if (action === 'cancel') {
      if (po.status !== 'ordered') throw new DemoRuleError(409, `${po.number} is already ${po.status}`, 'invalid_state');
      po.status = 'cancelled';
      actor.log('purchasing.order.cancelled', 'purchase_order', po.id, `${po.number} cancelled by ${actor.name}`);
      return po;
    }
    throw new DemoRuleError(404, 'Not available in demo mode', 'not_found');
  }

  // sales
  if (!id) {
    if (method === 'GET') return salesOrders.map(view);
    if (!canWrite(actor)) throw forbid();
    const customerId = String(body.customerId ?? '');
    if (!parties.some((p) => p.id === customerId && p.kind === 'customer')) throw new DemoRuleError(400, 'Choose a customer', 'invalid_input');
    const lines = validLines(body.lines as SalesOrder['lines'] | undefined).map((l) => ({ itemId: l.itemId, qty: l.qty, unitPriceMinor: Math.round(Number(l.unitPriceMinor) || 0) }));
    const so = addSO(customerId, String(body.warehouseId ?? 'w1'), lines, actor.id, new Date().toISOString());
    actor.log('sales.order.created', 'sales_order', so.id, `${so.number} created for ${parties.find((p) => p.id === customerId)?.name}: ${names(lines)}`);
    return view(so);
  }
  const so = salesOrders.find((o) => o.id === id);
  if (!so) throw new DemoRuleError(404, 'Sales order not found', 'not_found');
  if (method === 'GET') return view(so);
  if (!canWrite(actor)) throw forbid();
  if (action === 'request-stock') {
    const current = view(so);
    if (current.status !== 'open') throw new DemoRuleError(409, `${so.number} is already ${current.status.replace('_', ' ')}`, 'invalid_state');
    const customer = parties.find((p) => p.id === so.customerId);
    const request = createRequest(actor, so.warehouseId, `${so.number} for ${customer?.name ?? 'customer'}`, so.lines, { type: 'sales_order', id: so.id, number: so.number });
    so.requestId = request.id;
    actor.log('sales.order.stock_requested', 'sales_order', so.id, `${so.number}: stock requested as ${request.number}, waiting for approval`);
    return view(so);
  }
  if (action === 'cancel') {
    const current = view(so);
    if (current.status === 'delivered') throw new DemoRuleError(409, `${so.number} is already delivered`, 'invalid_state');
    so.status = 'cancelled';
    actor.log('sales.order.cancelled', 'sales_order', so.id, `${so.number} cancelled by ${actor.name}`);
    return view(so);
  }
  throw new DemoRuleError(404, 'Not available in demo mode', 'not_found');
}
