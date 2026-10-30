import type { Role } from '@erp/shared';

// DEMO ONLY. A pretend inventory backend that lives in the browser so the first vertical slice can be
// clicked through: item, outgoing stock request, manager approves, issue, audit entry. It copies the
// RULES we will enforce in the database (approval gate, no self-approval, reservation), but it is not
// the real implementation: the real one is built from its approved plan, in Postgres (ADR-0003).

export class DemoRuleError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type DemoWarehouse = { id: string; name: string };
export type DemoItem = { id: string; sku: string; name: string; nameAr: string; uom: string; reorderLevel: number | null };
export type StockRow = { itemId: string; warehouseId: string; onHand: number; reserved: number; available: number };
export type RequestStatus = 'submitted' | 'approved' | 'rejected' | 'issued' | 'cancelled';
export type DemoRequest = {
  id: string;
  number: string;
  requesterId: string;
  requesterName: string;
  warehouseId: string;
  reason: string;
  status: RequestStatus;
  lines: { itemId: string; qty: number }[];
  createdAt: string;
  decidedBy: string | null;
  decisionComment: string | null;
  decidedAt: string | null;
  issuedAt: string | null;
  /** Set when the request was raised from a sales order. */
  source: { type: 'sales_order'; id: string; number: string } | null;
};
export type LedgerMove = {
  id: number;
  itemId: string;
  warehouseId: string;
  qty: number;
  kind: 'receipt' | 'issue';
  requestId: string | null;
  /** Free-text origin for movements that are not a request, e.g. a purchase order number. */
  ref: string | null;
  postedBy: string;
  postedAt: string;
};
export type ApprovalPolicy = { id: string; warehouseId: string | null; minTotalQty: number; requiredApprovals: number };

/** Who is acting, and what log function to call. Supplied by lib/demo.ts. */
export type Actor = { id: string; name: string; role: Role; log: (action: string, entityType: string, entityId: string, summary: string) => void };

export const ACTOR_NAMES: Record<string, string> = { u1: 'Layla Hassan', u2: 'Karim Adel', u3: 'Mona Saeed', u4: 'Auditor (viewer)' };

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const warehouses: DemoWarehouse[] = [
  { id: 'w1', name: 'Main warehouse, Cairo' },
  { id: 'w2', name: 'Alexandria depot' },
];

const items: DemoItem[] = [
  { id: 'i1', sku: 'GLV-001', name: 'Safety gloves', nameAr: 'قفازات أمان', uom: 'pair', reorderLevel: 100 },
  { id: 'i2', sku: 'TAP-002', name: 'Packing tape', nameAr: 'شريط تغليف', uom: 'roll', reorderLevel: 20 },
  { id: 'i3', sku: 'CRT-003', name: 'Carton 40x30', nameAr: 'كرتونة 40×30', uom: 'piece', reorderLevel: null },
  { id: 'i4', sku: 'WRP-004', name: 'Pallet wrap', nameAr: 'فيلم تغليف بالتات', uom: 'roll', reorderLevel: 40 },
  { id: 'i5', sku: 'LBL-005', name: 'Barcode labels', nameAr: 'ملصقات باركود', uom: 'box', reorderLevel: null },
];

const approvalPolicies: ApprovalPolicy[] = [{ id: 'p1', warehouseId: null, minTotalQty: 50, requiredApprovals: 2 }];

const balances = new Map<string, { onHand: number; reserved: number }>();
const key = (itemId: string, warehouseId: string) => `${itemId}|${warehouseId}`;
const bal = (itemId: string, warehouseId: string) => {
  let b = balances.get(key(itemId, warehouseId));
  if (!b) balances.set(key(itemId, warehouseId), (b = { onHand: 0, reserved: 0 }));
  return b;
};

const ledger: LedgerMove[] = [];
let moveId = 0;
function post(itemId: string, warehouseId: string, qty: number, kind: LedgerMove["kind"], requestId: string | null, postedBy: string, postedAt = new Date().toISOString(), ref: string | null = null) {
  ledger.unshift({ id: ++moveId, itemId, warehouseId, qty, kind, requestId, ref, postedBy, postedAt });
  bal(itemId, warehouseId).onHand += qty;
}

// Opening stock.
for (const [itemId, qty1, qty2] of [['i1', 120, 40], ['i2', 60, 0], ['i3', 500, 150], ['i4', 24, 10], ['i5', 30, 5]] as const) {
  post(itemId, 'w1', qty1, 'receipt', null, 'u2', hoursAgo(500));
  if (qty2) post(itemId, 'w2', qty2, 'receipt', null, 'u2', hoursAgo(500));
}

const requests: DemoRequest[] = [];
let requestSeq = 0;
function makeRequest(requesterId: string, warehouseId: string, reason: string, lines: DemoRequest['lines'], createdAt = new Date().toISOString(), source: DemoRequest['source'] = null): DemoRequest {
  const n = ++requestSeq;
  const r: DemoRequest = {
    id: `r${n}`, number: `OUT-${String(n).padStart(4, '0')}`, requesterId, requesterName: ACTOR_NAMES[requesterId] ?? requesterId,
    warehouseId, reason, status: 'submitted', lines, createdAt, decidedBy: null, decisionComment: null, decidedAt: null, issuedAt: null, source,
  };
  requests.unshift(r);
  for (const l of lines) bal(l.itemId, warehouseId).reserved += l.qty;
  return r;
}

// Seed: one already issued, one waiting for a manager.
{
  const done = makeRequest('u3', 'w1', 'Dispatch to Giza customer, order 4471', [{ itemId: 'i3', qty: 40 }, { itemId: 'i2', qty: 6 }], hoursAgo(50));
  for (const l of done.lines) bal(l.itemId, 'w1').reserved -= l.qty;
  for (const l of done.lines) post(l.itemId, 'w1', -l.qty, 'issue', done.id, 'u3', hoursAgo(46));
  Object.assign(done, { status: 'issued', decidedBy: 'u1', decisionComment: 'OK', decidedAt: hoursAgo(48), issuedAt: hoursAgo(46) });
  makeRequest('u3', 'w1', 'Gloves for the night shift', [{ itemId: 'i1', qty: 30 }], hoursAgo(3));
}

const isManager = (role: Role) => role === 'owner' || role === 'admin';
const canWrite = (role: Role) => role !== 'viewer';
const forbid = () => new DemoRuleError(403, "You don't have permission to do that", 'forbidden');
const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? id;

function stockRows(): StockRow[] {
  return items.flatMap((i) =>
    warehouses.map((w) => {
      const b = bal(i.id, w.id);
      return { itemId: i.id, warehouseId: w.id, onHand: b.onHand, reserved: b.reserved, available: b.onHand - b.reserved };
    }),
  );
}

function findRequest(id: string | undefined): DemoRequest {
  const r = requests.find((x) => x.id === id);
  if (!r) throw new DemoRuleError(404, 'Request not found', 'not_found');
  return r;
}

function release(r: DemoRequest) {
  for (const l of r.lines) bal(l.itemId, r.warehouseId).reserved -= l.qty;
}

/** Submits a stock request and reserves the stock. Also used by sales orders ("request stock"). */
export function createRequest(actor: Actor, warehouseId: string, reason: string, rawLines: { itemId: string; qty: number }[], source: DemoRequest['source'] = null): DemoRequest {
  if (!canWrite(actor.role)) throw forbid();
  const lines = rawLines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) }));
  if (!warehouses.some((w) => w.id === warehouseId)) throw new DemoRuleError(400, 'Choose a warehouse', 'invalid_input');
  if (lines.length === 0) throw new DemoRuleError(400, 'Add at least one item with a quantity', 'invalid_input');
  // Reservation: the same item twice is summed, then checked against what is still available.
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.qty);
  for (const [itemId, qty] of wanted) {
    const b = bal(itemId, warehouseId);
    if (b.onHand - b.reserved < qty) {
      throw new DemoRuleError(409, `Not enough stock available for ${itemName(itemId)}: ${b.onHand - b.reserved} available, ${qty} requested`, 'insufficient_available');
    }
  }
  const r = makeRequest(actor.id, warehouseId, reason, lines, undefined, source);
  actor.log('inventory.request.submitted', 'stock_request', r.id, `${r.number} submitted by ${actor.name}${source ? ` for ${source.number}` : ''}: ${lines.map((l) => `${l.qty} x ${itemName(l.itemId)}`).join(', ')}`);
  return r;
}

/** Adds received goods to stock as a ledger receipt (purchasing). */
export function receiveGoods(actor: Actor, warehouseId: string, lines: { itemId: string; qty: number }[], ref: string) {
  if (!canWrite(actor.role)) throw forbid();
  for (const l of lines) post(l.itemId, warehouseId, l.qty, 'receipt', null, actor.id, undefined, ref);
}

export function getRequest(id: string): DemoRequest | undefined {
  return requests.find((x) => x.id === id);
}

export const catalog = { items: () => items, warehouses: () => warehouses, itemName };

export function handleInventory(method: string, parts: string[], body: Record<string, unknown>, actor: Actor): unknown {
  const [area, id, action] = parts;

  if (area === 'warehouses') return warehouses;
  if (area === 'stock') return stockRows();
  if (area === 'ledger') return ledger;

  if (area === 'items') {
    if (method === 'GET') return items;
    if (id && action === 'reorder-level') {
      if (!isManager(actor.role)) throw forbid();
      const item = items.find((x) => x.id === id);
      if (!item) throw new DemoRuleError(404, 'Item not found', 'not_found');
      const level = body.level === null ? null : Number(body.level);
      if (body.level === undefined || (level !== null && (!Number.isFinite(level) || level < 0))) throw new DemoRuleError(400, 'Reorder level must be zero or more, or empty', 'invalid_input');
      item.reorderLevel = level;
      actor.log('inventory.reorder_level.set', 'item', item.id, level === null ? `Reorder level of ${item.sku} removed` : `Reorder level of ${item.sku} set to ${level}`);
      return item;
    }
    if (!canWrite(actor.role)) throw forbid();
    const sku = String(body.sku ?? '').trim().toUpperCase();
    const name = String(body.name ?? '').trim();
    if (!sku || !name) throw new DemoRuleError(400, 'SKU and name are required', 'invalid_input');
    if (items.some((i) => i.sku === sku)) throw new DemoRuleError(409, `SKU ${sku} already exists`, 'conflict');
    const item: DemoItem = { id: `i${items.length + 1}`, sku, name, nameAr: String(body.nameAr ?? '').trim(), uom: String(body.uom ?? 'piece').trim() || 'piece', reorderLevel: null };
    items.push(item);
    const opening = Number(body.openingQty ?? 0);
    if (opening > 0) post(item.id, String(body.warehouseId ?? 'w1'), opening, 'receipt', null, actor.id);
    actor.log('inventory.item.created', 'item', item.id, `Item ${sku} ${name} created${opening > 0 ? ` with opening stock ${opening}` : ''}`);
    return item;
  }

  if (area === 'approval-policies') {
    if (method === 'GET') return approvalPolicies;
    if (!isManager(actor.role)) throw forbid();
    if (method === 'DELETE' && id) {
      const index = approvalPolicies.findIndex((p) => p.id === id);
      if (index < 0) throw new DemoRuleError(404, 'Policy not found', 'not_found');
      approvalPolicies.splice(index, 1);
      actor.log('inventory.policy.removed', 'approval_policy', id, 'Approval policy removed');
      return { removed: true };
    }
    if (method === 'POST') {
      const minTotalQty = Number(body.minTotalQty);
      const requiredApprovals = Number(body.requiredApprovals);
      if (!Number.isFinite(minTotalQty) || minTotalQty < 0 || !Number.isInteger(requiredApprovals) || requiredApprovals < 1 || requiredApprovals > 3) throw new DemoRuleError(400, 'Enter a quantity threshold and between 1 and 3 approvals', 'invalid_input');
      const policy: ApprovalPolicy = { id: `p${Date.now()}`, warehouseId: body.warehouseId ? String(body.warehouseId) : null, minTotalQty, requiredApprovals };
      const existing = approvalPolicies.find((p) => p.warehouseId === policy.warehouseId && p.minTotalQty === policy.minTotalQty);
      if (existing) existing.requiredApprovals = policy.requiredApprovals;
      else approvalPolicies.push(policy);
      actor.log('inventory.policy.set', 'approval_policy', existing?.id ?? policy.id, `From ${minTotalQty} units, ${requiredApprovals} approval(s) required`);
      return approvalPolicies;
    }
  }

  if (area !== 'requests') throw new DemoRuleError(404, 'Not available in demo mode', 'not_found');

  if (!id) {
    if (method === 'GET') return requests;
    return createRequest(actor, String(body.warehouseId ?? ''), String(body.reason ?? '').trim(), (body.lines as { itemId: string; qty: number }[] | undefined) ?? []);
  }

  const r = findRequest(id);
  if (method === 'GET') return r;

  if (action === 'approve' || action === 'reject') {
    if (!isManager(actor.role)) throw forbid();
    if (r.requesterId === actor.id) throw new DemoRuleError(403, 'You cannot approve your own request', 'self_approval');
    if (r.status !== 'submitted') throw new DemoRuleError(409, `This request is already ${r.status}`, 'invalid_state');
    r.decidedBy = actor.id;
    r.decidedAt = new Date().toISOString();
    r.decisionComment = String(body.comment ?? '').trim() || null;
    if (action === 'approve') {
      r.status = 'approved';
      actor.log('inventory.request.approved', 'stock_request', r.id, `${r.number} approved by ${actor.name} (channel: app)`);
    } else {
      r.status = 'rejected';
      release(r);
      actor.log('inventory.request.rejected', 'stock_request', r.id, `${r.number} rejected by ${actor.name}; reserved stock released`);
    }
    return r;
  }

  if (action === 'issue') {
    // The gate. In the real product this check is in the database function, not in the screen.
    if (r.status !== 'approved') {
      actor.log('inventory.issue.refused', 'stock_request', r.id, `Issue of ${r.number} refused: request is ${r.status}, not approved`);
      throw new DemoRuleError(409, `Blocked: ${r.number} is ${r.status}. Stock can only be issued once a manager has approved the request.`, 'approval_required');
    }
    if (!canWrite(actor.role)) throw forbid();
    release(r);
    for (const l of r.lines) post(l.itemId, r.warehouseId, -l.qty, 'issue', r.id, actor.id);
    r.status = 'issued';
    r.issuedAt = new Date().toISOString();
    actor.log('inventory.stock.issued', 'stock_request', r.id, `${r.number} issued by ${actor.name}: ${r.lines.map((l) => `${l.qty} x ${itemName(l.itemId)}`).join(', ')}`);
    return r;
  }

  if (action === 'cancel') {
    if (r.requesterId !== actor.id && !isManager(actor.role)) throw forbid();
    if (r.status !== 'submitted' && r.status !== 'approved') throw new DemoRuleError(409, `This request is already ${r.status}`, 'invalid_state');
    release(r);
    r.status = 'cancelled';
    actor.log('inventory.request.cancelled', 'stock_request', r.id, `${r.number} cancelled by ${actor.name}; reserved stock released`);
    return r;
  }

  throw new DemoRuleError(404, 'Not available in demo mode', 'not_found');
}
