import { useState, type FormEvent } from 'react';
import { hasPermission, type AuditEntry } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { DemoTransfer, InTransitRow, StockRow, TransferStatus } from '../../lib/demoInventory';
import { formatDateTime } from '../../lib/format';
import { usePeople } from '../../lib/people';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { useCatalog } from './Inventory';

// Transfers between warehouses (sql/033, documentation/plans/INVENTORY_TRANSFERS_PLAN.md). A person requests, a manager approves,
// the source warehouse dispatches (stock is in transit, in no warehouse), the destination warehouse receives. The database refuses
// every step that skips the approval; these screens only show the buttons that make sense.

const STATUS_LABEL: Record<TransferStatus, string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved, ready to dispatch',
  dispatched: 'In transit',
  received: 'Received',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const STATUS_CLASS: Record<TransferStatus, string> = {
  submitted: 'st-submitted', approved: 'st-approved', dispatched: 'st-ordered', received: 'st-received', rejected: 'st-rejected', cancelled: 'st-cancelled',
};

function StatusPill({ status }: { status: TransferStatus }) {
  return <span className={`pill ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

// Requested, approved, in transit, received: where this transfer is on its way.
function Steps({ status }: { status: TransferStatus }) {
  const order: TransferStatus[] = ['submitted', 'approved', 'dispatched', 'received'];
  const ended = status === 'rejected' || status === 'cancelled';
  const at = order.indexOf(status);
  const labels = ['Requested', ended ? (status === 'rejected' ? 'Rejected' : 'Cancelled') : 'Approved', 'In transit', 'Received'];
  return (
    <ol className="steps" aria-label="Transfer progress">
      {labels.map((text, i) => {
        const cls = ended ? (i === 0 ? 'done' : i === 1 ? 'bad' : '') : i < at || (i === at && status === 'received') ? 'done' : i === at ? 'current' : '';
        return (
          <li key={text} className={`step ${cls}`} data-n={i + 1}>
            {text}
          </li>
        );
      })}
    </ol>
  );
}

export function TransfersList() {
  const cat = useCatalog();
  const who = usePeople();
  const session = useSession();
  const transfers = useLoad(() => api<DemoTransfer[]>('/v1/inventory/transfers'));
  const transit = useLoad(() => api<InTransitRow[]>('/v1/inventory/in-transit'));
  const [filter, setFilter] = useState<'all' | 'submitted' | 'dispatched'>('all');
  const canCreate = hasPermission(session.permissions, 'inventory.transfers.create');
  const rows = (transfers.data ?? []).filter((t) => filter === 'all' || t.status === filter);

  const columns: Column<DemoTransfer>[] = [
    { key: 'number', label: 'Transfer', value: (t) => t.number, render: (t) => <Link to={`/inventory/transfers/${t.id}`}><code>{t.number}</code></Link> },
    { key: 'route', label: 'From → to', value: (t) => `${cat.warehouseName(t.fromWarehouseId)} → ${cat.warehouseName(t.toWarehouseId)}` },
    { key: 'items', label: 'Items', value: (t) => t.lines.map((l) => `${l.qty} x ${cat.itemName(l.itemId)}`).join(', ') },
    { key: 'by', label: 'Requested by', value: (t) => who(t.requesterId) },
    { key: 'status', label: 'Status', value: (t) => t.status, render: (t) => <StatusPill status={t.status} /> },
    { key: 'when', label: 'Requested', value: (t) => t.createdAt, render: (t) => <span className="nowrap">{formatDateTime(t.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page wide">
      <h1>Stock transfers</h1>
      <p className="muted">Move stock between warehouses. A manager approves first; stock then leaves the source, sits in transit, and enters the destination when received.</p>
      {transit.data && transit.data.length > 0 && (
        <div className="form-card stack">
          <strong>In transit now</strong>
          <p className="muted small">Dispatched and not yet received. This stock belongs to no warehouse, so nobody can sell it meanwhile.</p>
          <ul className="plain-list">
            {transit.data.map((r) => <li key={r.itemId}><code>{r.sku}</code> {r.name}: <strong>{r.qty}</strong> {r.uom} in {r.transfers} transfer{r.transfers === 1 ? '' : 's'}</li>)}
          </ul>
        </div>
      )}
      {transfers.error && <p className="error notice">{transfers.error}</p>}
      {transfers.data && cat.ready ? (
        <ListView
          title="Stock transfers"
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          empty="No transfers yet."
          toolbar={
            <>
              <select className="narrow-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
                <option value="all">All transfers</option>
                <option value="submitted">Waiting for approval</option>
                <option value="dispatched">In transit</option>
              </select>
              {canCreate && <button onClick={() => navigate('/inventory/transfers/new')}>New transfer</button>}
            </>
          }
        />
      ) : (
        !transfers.error && <p className="muted">Loading…</p>
      )}
    </section>
  );
}

export function NewTransfer() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([{ itemId: '', qty: '1' }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const warehouses = cat.warehouses.data ?? [];
  const fromId = from || warehouses[0]?.id || '';
  const toId = to || warehouses.find((w) => w.id !== fromId)?.id || '';
  const available = (itemId: string) => stock.data?.find((s) => s.itemId === itemId && s.warehouseId === fromId)?.available ?? 0;
  const setLine = (i: number, patch: Partial<{ itemId: string; qty: string }>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api<DemoTransfer>('/v1/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify({ fromWarehouseId: fromId, toWarehouseId: toId, reason, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) }),
      });
      navigate(`/inventory/transfers/${made.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!cat.ready || !stock.data) return <section className="page"><p className="muted">Loading…</p></section>;
  const same = fromId === toId;

  return (
    <section className="page">
      <Link to="/inventory/transfers" className="back-link">← Stock transfers</Link>
      <h1>New transfer</h1>
      <p className="muted">The stock is reserved at the source as soon as you submit, and a manager must approve before anything moves.</p>
      {error && <p className="error notice">{error}</p>}
      <form className="form-card stack" onSubmit={submit}>
        <div className="form-row">
          <label>From warehouse<select required value={fromId} onChange={(e) => setFrom(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>To warehouse<select required value={toId} onChange={(e) => setTo(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        </div>
        {same && <p className="error small">Choose two different warehouses.</p>}
        <strong>Items</strong>
        {lines.map((l, i) => (
          <div className="form-row" key={i}>
            <label>Item<select required value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}><option value="">Choose an item…</option>{cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}</select></label>
            <label>Quantity<input required type="number" min="0.001" step="0.001" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />{l.itemId && <span className="muted small">Available here: {available(l.itemId)}</span>}</label>
            {lines.length > 1 && <button type="button" className="secondary" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>Remove</button>}
          </div>
        ))}
        <div><button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>Add another item</button></div>
        <label>Reason<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Restock the branch, move to the cold room…" /></label>
        <div className="form-actions"><button type="submit" disabled={busy || same}>{busy ? 'Submitting…' : 'Submit transfer'}</button></div>
      </form>
    </section>
  );
}

export function TransferPage() {
  const who = usePeople();
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const transfer = useLoad(() => api<DemoTransfer>(`/v1/inventory/transfers/${id}`));
  const audit = useLoad(() => api<AuditEntry[]>('/v1/core/audit?limit=200'));
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const t = transfer.data;
  const can = (key: string) => hasPermission(session.permissions, key);

  async function act(action: 'approve' | 'reject' | 'dispatch' | 'receive' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/inventory/transfers/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) });
      setResult({ ok: true, text: done });
      setComment('');
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      transfer.reload();
      audit.reload();
    }
  }

  if (transfer.error) return <section className="page"><p className="error">{transfer.error}</p></section>;
  if (!t || !cat.ready) return <section className="page"><p className="muted">Loading…</p></section>;

  const history = (audit.data ?? []).filter((a) => a.entity_id === t.id);
  const open = t.status === 'submitted' || t.status === 'approved';
  const mine = t.requesterId === session.userId;

  return (
    <section className="page">
      <Link to="/inventory/transfers" className="back-link">← Stock transfers</Link>
      <div className="page-head">
        <h1 className="mono">{t.number}</h1>
        <StatusPill status={t.status} />
      </div>
      <Steps status={t.status} />
      <p className="muted">
        {cat.warehouseName(t.fromWarehouseId)} → {cat.warehouseName(t.toWarehouseId)}. Requested by {who(t.requesterId)} on {formatDateTime(t.createdAt, session.org)}. Reason: {t.reason || 'none given'}.
        {t.decidedBy && <> Approved or decided by {who(t.decidedBy)}{t.decisionComment ? `: "${t.decisionComment}"` : ''}.</>}
        {t.dispatchedBy && <> Dispatched by {who(t.dispatchedBy)}.</>}
        {t.receivedBy && <> Received by {who(t.receivedBy)}.</>}
      </p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th className="right">Quantity</th></tr></thead>
          <tbody>{t.lines.map((l, i) => <tr key={i}><td>{cat.itemName(l.itemId)}</td><td className="right">{l.qty}</td></tr>)}</tbody>
        </table>
      </div>

      {t.batches.length > 0 && (
        <>
          <h2 className="related">Batches moved</h2>
          <p className="muted small">The first batches to expire go first. The destination receives the same batches with the same expiry dates.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th>Batch</th><th>Expires</th><th className="right">Quantity</th></tr></thead>
              <tbody>{t.batches.map((b) => <tr key={b.batchId}><td>{cat.itemName(b.itemId)}</td><td><code>{b.batchNo}</code></td><td>{b.expiryDate ?? 'No expiry'}</td><td className="right">{b.qty}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {t.approvals.length > 0 && (
        <>
          <h2 className="related">Approvals</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Who</th><th>Decision</th><th>Via</th><th>When</th><th>Comment</th></tr></thead>
              <tbody>{t.approvals.map((a, i) => <tr key={i}><td>{who(a.approverId)}</td><td>{a.decision}</td><td>{a.channel}</td><td className="nowrap">{formatDateTime(a.decidedAt, session.org)}</td><td>{a.comment ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {t.status === 'submitted' && can('inventory.transfers.approve') && (
        <div className="form-card stack">
          <strong>Manager decision</strong>
          <label>Comment (optional)<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-actions">
            <button disabled={busy} onClick={() => act('approve', 'Approval recorded.')}>Approve</button>
            <button className="secondary" disabled={busy} onClick={() => act('reject', 'Rejected. The reserved stock was released.')}>Reject</button>
          </div>
          {demoMode && <p className="hint muted small">Try approving a transfer you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else.</p>}
        </div>
      )}
      {t.status === 'submitted' && !can('inventory.transfers.approve') && <p className="notice">Waiting for a manager to approve.{demoMode && ' Switch to Layla Hassan or Karim Adel in the yellow bar to approve it.'}</p>}

      <div className="form-actions">
        {t.status === 'approved' && can('inventory.transfers.dispatch') && <button disabled={busy} onClick={() => act('dispatch', 'Dispatched. The stock left the source and is now in transit.')}>Dispatch</button>}
        {t.status === 'dispatched' && can('inventory.transfers.receive') && <button disabled={busy} onClick={() => act('receive', 'Received. The stock is now in the destination warehouse.')}>Receive at destination</button>}
        {open && (mine || can('inventory.transfers.approve')) && can('inventory.transfers.create') && (
          <button className="secondary" disabled={busy} onClick={() => act('cancel', 'Transfer cancelled. The reserved stock was released.')}>Cancel transfer</button>
        )}
      </div>
      {t.status === 'approved' && !can('inventory.transfers.dispatch') && <p className="notice">Approved. Waiting for the source warehouse to dispatch it.</p>}
      {t.status === 'dispatched' && !can('inventory.transfers.receive') && <p className="notice">In transit. Waiting for the destination warehouse to receive it.</p>}

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
