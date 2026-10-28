import { useState, type CSSProperties, type FormEvent } from 'react';
import type { AuditEntry } from '@erp/shared';
import { Modal } from '../../components/Modal';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { DemoItem, DemoRequest, DemoWarehouse, LedgerMove, RequestStatus, StockRow } from '../../lib/demoInventory';
import { ACTOR_NAMES } from '../../lib/demoInventory';
import { formatDateTime } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// DEMO ONLY: these screens run on sample data (lib/demoInventory.ts) so the first vertical slice can be
// tried before the real inventory module exists. The real module is built from its approved plan.

const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  issued: 'Issued',
  cancelled: 'Cancelled',
};

function StatusPill({ status }: { status: RequestStatus }) {
  return <span className={`pill st-${status}`}>{STATUS_LABEL[status]}</span>;
}

// Submitted, approved, issued: where this request is on the way out of the warehouse.
function Steps({ status }: { status: RequestStatus }) {
  const order: RequestStatus[] = ['submitted', 'approved', 'issued'];
  const ended = status === 'rejected' || status === 'cancelled';
  const at = order.indexOf(status);
  const label = ['Submitted', ended ? (status === 'rejected' ? 'Rejected' : 'Cancelled') : 'Approved', 'Issued'];
  return (
    <ol className="steps" aria-label="Request progress">
      {label.map((text, i) => {
        const cls = ended ? (i === 0 ? 'done' : i === 1 ? 'bad' : '') : i < at ? 'done' : i === at ? (status === 'issued' ? 'done' : 'current') : '';
        return (
          <li key={text} className={`step ${cls}`} data-n={i + 1}>
            {text}
          </li>
        );
      })}
    </ol>
  );
}

function useCatalog() {
  const items = useLoad(() => api<DemoItem[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<DemoWarehouse[]>('/v1/inventory/warehouses'));
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? id;
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  return { items, warehouses, itemName, warehouseName, ready: Boolean(items.data && warehouses.data) };
}

const who = (id: string | null) => (id ? (ACTOR_NAMES[id] ?? id) : 'System');

// ------------------------------------------------------------------ stock on hand and items

type StockLine = DemoItem & { onHand: number; reserved: number; available: number };

function AddItemModal({ warehouses, onClose, onDone }: { warehouses: DemoWarehouse[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ sku: '', name: '', nameAr: '', uom: 'piece', openingQty: '0', warehouseId: warehouses[0]?.id ?? 'w1' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/v1/inventory/items', { method: 'POST', body: JSON.stringify({ ...form, openingQty: Number(form.openingQty) }) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Add item" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-row">
          <label>SKU<input required value={form.sku} onChange={set('sku')} /></label>
          <label>Unit<input required value={form.uom} onChange={set('uom')} /></label>
        </div>
        <label>Name<input required value={form.name} onChange={set('name')} /></label>
        <label>Name in Arabic<input dir="rtl" value={form.nameAr} onChange={set('nameAr')} /></label>
        <div className="form-row">
          <label>Opening stock<input type="number" min="0" value={form.openingQty} onChange={set('openingQty')} /></label>
          <label>
            Warehouse
            <select value={form.warehouseId} onChange={set('warehouseId')}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><button type="submit">Add item</button></div>
      </form>
    </Modal>
  );
}

export function StockPage() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const [warehouseId, setWarehouseId] = useState('all');
  const [adding, setAdding] = useState(false);
  const session = useSession();
  const canAdd = session.role !== 'viewer';

  const rows: StockLine[] = (cat.items.data ?? []).map((i) => {
    const mine = (stock.data ?? []).filter((s) => s.itemId === i.id && (warehouseId === 'all' || s.warehouseId === warehouseId));
    const sum = (f: (s: StockRow) => number) => mine.reduce((a, s) => a + f(s), 0);
    return { ...i, onHand: sum((s) => s.onHand), reserved: sum((s) => s.reserved), available: sum((s) => s.available) };
  });

  const columns: Column<StockLine>[] = [
    { key: 'sku', label: 'SKU', value: (r) => r.sku, render: (r) => <code>{r.sku}</code> },
    { key: 'name', label: 'Item', value: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
    { key: 'ar', label: 'Arabic name', value: (r) => r.nameAr, render: (r) => <span dir="rtl">{r.nameAr}</span> },
    { key: 'uom', label: 'Unit', value: (r) => r.uom },
    {
      key: 'level',
      label: 'Stock level',
      value: (r) => r.available,
      render: (r) => {
        const total = Math.max(r.onHand, 1);
        const low = r.available / total < 0.2;
        return (
          <span className={low ? 'bar low' : 'bar'} title={`${r.available} available, ${r.reserved} reserved, ${r.onHand} on hand`}>
            <i className="fill-avail" style={{ width: `${(r.available / total) * 100}%` }} />
            <i className="fill-resv" style={{ width: `${(r.reserved / total) * 100}%` }} />
          </span>
        );
      },
    },
    { key: 'onHand', label: 'On hand', value: (r) => r.onHand, align: 'right' },
    { key: 'reserved', label: 'Reserved', value: (r) => r.reserved, align: 'right' },
    { key: 'available', label: 'Available', value: (r) => r.available, align: 'right', render: (r) => <strong>{r.available}</strong> },
  ];

  const totalOnHand = rows.reduce((a, r) => a + r.onHand, 0);
  const totalReserved = rows.reduce((a, r) => a + r.reserved, 0);
  const waiting = (requests.data ?? []).filter((r) => r.status === 'submitted').length;

  return (
    <section className="page">
      <h1>Stock on hand</h1>
      <p className="muted">Reserved stock is promised to a request that is waiting for approval or not yet issued. Available = on hand minus reserved.</p>
      {cat.ready && stock.data && (
        <div className="stats">
          <div className="stat" style={{ '--i': 0 } as CSSProperties}>
            <div className="stat-label">Items</div>
            <div className="stat-value">{rows.length}</div>
            <div className="stat-note">in {warehouseId === 'all' ? `${cat.warehouses.data?.length ?? 0} warehouses` : cat.warehouseName(warehouseId)}</div>
          </div>
          <div className="stat" style={{ '--i': 1 } as CSSProperties}>
            <div className="stat-label">Units on hand</div>
            <div className="stat-value">{totalOnHand.toLocaleString('en-US')}</div>
            <div className="stat-note">{(totalOnHand - totalReserved).toLocaleString('en-US')} available</div>
          </div>
          <div className="stat" style={{ '--i': 2 } as CSSProperties}>
            <div className="stat-label">Reserved</div>
            <div className="stat-value">{totalReserved.toLocaleString('en-US')}</div>
            <div className="stat-note">held for open requests</div>
          </div>
          <Link to="/inventory/requests" className={waiting > 0 ? 'stat warn' : 'stat'} style={{ '--i': 3, textDecoration: 'none', color: 'inherit' } as CSSProperties}>
            <div className="stat-label">Waiting for approval</div>
            <div className="stat-value">{waiting}</div>
            <div className="stat-note">{waiting > 0 ? 'a manager needs to decide' : 'nothing pending'}</div>
          </Link>
        </div>
      )}
      {cat.ready && stock.data ? (
        <ListView
          title="Stock on hand"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          toolbar={
            <>
              <select className="narrow-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
                <option value="all">All warehouses</option>
                {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {canAdd && <button onClick={() => setAdding(true)}>Add item</button>}
            </>
          }
        />
      ) : (
        <p className="muted">Loading…</p>
      )}
      {adding && cat.warehouses.data && (
        <AddItemModal warehouses={cat.warehouses.data} onClose={() => setAdding(false)} onDone={() => { setAdding(false); cat.items.reload(); stock.reload(); }} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ requests

export function RequestsList() {
  const cat = useCatalog();
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const session = useSession();
  const [filter, setFilter] = useState<'all' | 'submitted'>('all');
  const rows = (requests.data ?? []).filter((r) => filter === 'all' || r.status === 'submitted');

  const columns: Column<DemoRequest>[] = [
    { key: 'number', label: 'Request', value: (r) => r.number, render: (r) => <Link to={`/inventory/requests/${r.id}`}><code>{r.number}</code></Link> },
    { key: 'by', label: 'Requested by', value: (r) => r.requesterName },
    { key: 'wh', label: 'Warehouse', value: (r) => cat.warehouseName(r.warehouseId) },
    { key: 'items', label: 'Items', value: (r) => r.lines.map((l) => `${l.qty} x ${cat.itemName(l.itemId)}`).join(', ') },
    { key: 'status', label: 'Status', value: (r) => r.status, render: (r) => <StatusPill status={r.status} /> },
    { key: 'when', label: 'Requested', value: (r) => r.createdAt, render: (r) => <span className="nowrap">{formatDateTime(r.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>Stock requests</h1>
      <p className="muted">Stock only leaves the warehouse through an approved request.</p>
      {requests.data && cat.ready ? (
        <ListView
          title="Stock requests"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          empty="No requests yet."
          toolbar={
            <>
              <select className="narrow-select" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'submitted')} aria-label="Filter">
                <option value="all">All requests</option>
                <option value="submitted">Waiting for approval</option>
              </select>
              {session.role !== 'viewer' && <button onClick={() => navigate('/inventory/requests/new')}>New request</button>}
            </>
          }
        />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}

export function NewRequest() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const [warehouseId, setWarehouseId] = useState('w1');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([{ itemId: '', qty: '1' }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = (itemId: string) => stock.data?.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.available ?? 0;
  const setLine = (i: number, patch: Partial<{ itemId: string; qty: string }>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<DemoRequest>('/v1/inventory/requests', {
        method: 'POST',
        body: JSON.stringify({ warehouseId, reason, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) }),
      });
      navigate(`/inventory/requests/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!cat.ready || !stock.data) return <section className="page"><p className="muted">Loading…</p></section>;

  return (
    <section className="page">
      <Link to="/inventory/requests" className="back-link">← Stock requests</Link>
      <h1>New stock request</h1>
      <p className="muted">The quantity is reserved as soon as you submit, so nobody else can take it while a manager decides.</p>
      <form className="form-card stack" onSubmit={submit}>
        <div className="form-row">
          <label>
            Take stock from
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>Reason<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer order, internal use…" /></label>
        </div>
        <strong>Items</strong>
        {lines.map((l, i) => (
          <div className="form-row" key={i}>
            <label>
              Item
              <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                <option value="">Choose an item…</option>
                {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
              </select>
            </label>
            <label>
              Quantity {l.itemId && <span className="muted small">({available(l.itemId)} available)</span>}
              <input type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            </label>
          </div>
        ))}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>Add another item</button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
        </div>
      </form>
    </section>
  );
}

export function RequestPage() {
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const request = useLoad(() => api<DemoRequest>(`/v1/inventory/requests/${id}`));
  const audit = useLoad(() => api<AuditEntry[]>('/v1/core/audit?limit=200'));
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const r = request.data;
  const isManager = session.role === 'owner' || session.role === 'admin';

  async function act(action: 'approve' | 'reject' | 'issue' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/inventory/requests/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) });
      setResult({ ok: true, text: done });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      request.reload();
      audit.reload();
    }
  }

  if (request.error) return <section className="page"><p className="error">{request.error}</p></section>;
  if (!r || !cat.ready) return <section className="page"><p className="muted">Loading…</p></section>;

  const history = (audit.data ?? []).filter((a) => a.entity_id === r.id);
  const open = r.status === 'submitted' || r.status === 'approved';

  return (
    <section className="page">
      <Link to="/inventory/requests" className="back-link">← Stock requests</Link>
      <div className="page-head">
        <h1 className="mono">{r.number}</h1>
        <StatusPill status={r.status} />
      </div>
      <Steps status={r.status} />
      <p className="muted">
        Requested by {r.requesterName} on {formatDateTime(r.createdAt, session.org)} from {cat.warehouseName(r.warehouseId)}. Reason: {r.reason || 'none given'}.
        {r.decidedBy && <> Decision by {who(r.decidedBy)}{r.decisionComment ? `: "${r.decisionComment}"` : ''}.</>}
      </p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th className="right">Quantity</th></tr></thead>
          <tbody>
            {r.lines.map((l, i) => <tr key={i}><td>{cat.itemName(l.itemId)}</td><td className="right">{l.qty}</td></tr>)}
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {r.status === 'submitted' && isManager && (
        <div className="form-card stack">
          <strong>Manager decision</strong>
          <label>Comment (optional)<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-actions">
            <button disabled={busy} onClick={() => act('approve', 'Approved. The stock can now be issued.')}>Approve</button>
            <button className="secondary" disabled={busy} onClick={() => act('reject', 'Rejected. The reserved stock was released.')}>Reject</button>
          </div>
          <p className="hint muted small">Try approving a request you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else.</p>
        </div>
      )}
      {r.status === 'submitted' && !isManager && <p className="notice">Waiting for a manager to approve. Switch to Layla Hassan or Karim Adel in the yellow bar to approve it.</p>}

      {open && session.role !== 'viewer' && (
        <div className="form-actions">
          <button disabled={busy} onClick={() => act('issue', 'Stock issued and recorded in the ledger.')}>
            {r.status === 'approved' ? 'Issue stock' : 'Try to issue without approval'}
          </button>
          <button className="secondary" disabled={busy} onClick={() => act('cancel', 'Request cancelled. The reserved stock was released.')}>Cancel request</button>
        </div>
      )}

      <h2 className="related">History</h2>
      <p className="muted small">Written by the system in the same step as each change.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{formatDateTime(a.occurred_at, session.org)}</td>
                <td>{who(a.actor_user_id)}</td>
                <td><code>{a.action}</code></td>
                <td>{a.summary}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={4} className="muted empty">No history yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ ledger

export function LedgerPage() {
  const cat = useCatalog();
  const moves = useLoad(() => api<LedgerMove[]>('/v1/inventory/ledger'));
  const session = useSession();

  const columns: Column<LedgerMove>[] = [
    { key: 'when', label: 'When', value: (m) => m.postedAt, render: (m) => <span className="nowrap">{formatDateTime(m.postedAt, session.org)}</span> },
    { key: 'item', label: 'Item', value: (m) => cat.itemName(m.itemId) },
    { key: 'wh', label: 'Warehouse', value: (m) => cat.warehouseName(m.warehouseId) },
    { key: 'kind', label: 'Type', value: (m) => m.kind },
    { key: 'qty', label: 'Quantity', value: (m) => m.qty, align: 'right', render: (m) => <strong className={m.qty < 0 ? 'overdue' : undefined}>{m.qty > 0 ? `+${m.qty}` : m.qty}</strong> },
    { key: 'req', label: 'Request', value: (m) => m.requestId ?? '', render: (m) => (m.requestId ? <Link to={`/inventory/requests/${m.requestId}`}>{`OUT-${m.requestId.slice(1).padStart(4, '0')}`}</Link> : <span className="muted">none</span>) },
    { key: 'by', label: 'Posted by', value: (m) => who(m.postedBy) },
  ];

  return (
    <section className="page">
      <h1>Stock ledger</h1>
      <p className="muted">Every movement, newest first. Entries are only ever added, never edited. An outgoing movement always points at an approved request.</p>
      {moves.data && cat.ready ? <ListView title="Stock ledger" rows={moves.data} columns={columns} rowKey={(m) => String(m.id)} /> : <p className="muted">Loading…</p>}
    </section>
  );
}
