import { useState, type FormEvent } from 'react';
import { RecordHistory } from '../../components/RecordHistory';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { hasPermission, type AuditEntry } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { DemoTransfer, InTransitRow, StockRow, TransferStatus } from '../../lib/demoInventory';
import { formatDateTime, ltrIsolate, qtyLine } from '../../lib/format';
import { usePeople } from '../../lib/people';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { useCatalog } from './Inventory';

import { tr, trf } from '../../lib/i18n';
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
  return <span className={`pill ${STATUS_CLASS[status]}`}>{tr(STATUS_LABEL[status])}</span>;
}

// Requested, approved, in transit, received: where this transfer is on its way.
function Steps({ status }: { status: TransferStatus }) {
  const order: TransferStatus[] = ['submitted', 'approved', 'dispatched', 'received'];
  const ended = status === 'rejected' || status === 'cancelled';
  const at = order.indexOf(status);
  const labels = ['Requested', ended ? (status === 'rejected' ? 'Rejected' : 'Cancelled') : 'Approved', 'In transit', 'Received'];
  return (
    <ol className="steps" aria-label={tr('Transfer progress')}>
      {labels.map((text, i) => {
        const cls = ended ? (i === 0 ? 'done' : i === 1 ? 'bad' : '') : i < at || (i === at && status === 'received') ? 'done' : i === at ? 'current' : '';
        return (
          <li key={text} className={`step ${cls}`} data-n={i + 1}>
            {tr(text)}
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
    { key: 'number', label: tr('Transfer'), value: (t) => t.number, render: (t) => <Link to={`/inventory/transfers/${t.id}`}><code>{t.number}</code></Link> },
    { key: 'route', label: tr('From → to'), value: (t) => `${cat.warehouseName(t.fromWarehouseId)} → ${cat.warehouseName(t.toWarehouseId)}` },
    { key: 'items', label: tr('Items'), value: (t) => t.lines.map((l) => qtyLine(l.qty, cat.itemName(l.itemId))).join(', '), render: (t) => <span>{t.lines.map((l) => ltrIsolate(qtyLine(l.qty, cat.itemName(l.itemId)))).join(', ')}</span> },
    { key: 'by', label: tr('Requested by'), value: (t) => who(t.requesterId) },
    { key: 'status', label: tr('Status'), value: (t) => t.status, render: (t) => <StatusPill status={t.status} /> },
    { key: 'when', label: tr('Requested'), value: (t) => t.createdAt, render: (t) => <span className="nowrap">{formatDateTime(t.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page wide">
      <h1>{tr('Stock transfers')}</h1>
      <p className="muted">{tr('Inter-warehouse transfers, approved before dispatch.')}</p>
      {transit.data && transit.data.length > 0 && (
        <div className="form-card stack">
          <strong>{tr('In transit now')}</strong>
          <p className="muted small">{tr('Dispatched, not yet received. Stock in transit is not available in any warehouse.')}</p>
          <ul className="plain-list">
            {transit.data.map((r) => <li key={r.itemId}><code>{r.sku}</code> {r.name}: <strong>{r.qty}</strong> {r.uom} {trf(r.transfers === 1 ? 'in {n} transfer' : 'in {n} transfers', { n: r.transfers })}</li>)}
          </ul>
        </div>
      )}
      {transfers.error && <p className="error notice">{transfers.error}</p>}
      {transfers.data && cat.ready ? (
        <ListView
          title={tr('Stock transfers')}
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          rowHref={(t) => `/inventory/transfers/${t.id}`}
          empty={tr('No transfers yet. A transfer moves stock from one warehouse to another; a manager approves it first.')}
          emptyAction={canCreate ? <Button onClick={() => navigate('/inventory/transfers/new')}>{tr('Move between warehouses')}</Button> : undefined}
          toolbar={
            <>
              <select className="narrow-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={tr('Filter')}>
                <option value="all">{tr('All transfers')}</option>
                <option value="submitted">{tr('Waiting for approval')}</option>
                <option value="dispatched">{tr('In transit')}</option>
              </select>
              {canCreate && <Button type="submit" onClick={() => navigate('/inventory/transfers/new')}>{tr('Move between warehouses')}</Button>}
            </>
          }
        />
      ) : (
        !transfers.error && <Loading />
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

  if (!cat.ready || !stock.data) return <section className="page"><Loading /></section>;
  const same = fromId === toId;

  return (
    <section className="page">
      <Link to="/inventory/transfers" className="back-link">{tr('← Stock transfers')}</Link>
      <h1>{tr('Move between warehouses')}</h1>
      <p className="muted">{tr('Your manager will be asked to approve this. The quantities are reserved at the first warehouse until then; the stock arrives at the second one when it is received there.')}</p>
      {error && <p className="error notice">{error}</p>}
      <form className="form-card stack" onSubmit={submit}>
        <div className="form-row">
          <label>{tr('From warehouse')}<select required value={fromId} onChange={(e) => setFrom(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>{tr('To warehouse')}<select required value={toId} onChange={(e) => setTo(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        </div>
        {same && <p className="error small">{tr('Choose two different warehouses.')}</p>}
        <strong>{tr('Items')}</strong>
        {lines.map((l, i) => (
          <div className="form-row" key={i}>
            <label>{tr('Item')}<select required value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}><option value="">{tr('Choose an item…')}</option>{cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}</select></label>
            <label>{tr('Quantity')}<input required type="number" min="0.001" step="0.001" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />{l.itemId && <span className="muted small">{tr('Available here:')} {available(l.itemId)}</span>}</label>
            {lines.length > 1 && <Button variant="outline" type="button" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>{tr('Remove')}</Button>}
          </div>
        ))}
        <div><Button variant="outline" type="button" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>{tr('Add another item')}</Button></div>
        <label>{tr('Reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={tr('Restock the branch, move to the cold room…')} /></label>
        <div className="form-actions"><Button type="submit" disabled={busy || same}>{busy ? tr('Submitting…') : tr('Submit transfer')}</Button></div>
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
    }
  }

  if (transfer.error) return <section className="page"><p className="error">{transfer.error}</p></section>;
  if (!t || !cat.ready) return <section className="page"><Loading /></section>;

  const open = t.status === 'submitted' || t.status === 'approved';
  const mine = t.requesterId === session.userId;

  return (
    <section className="page">
      <Link to="/inventory/transfers" className="back-link">{tr('← Stock transfers')}</Link>
      <div className="page-head">
        <h1 className="mono">{t.number}</h1>
        <StatusPill status={t.status} />
      </div>
      <Steps status={t.status} />
      <dl className="facts">
        <div><dt>{tr('From warehouse')}</dt><dd>{cat.warehouseName(t.fromWarehouseId)}</dd></div>
        <div><dt>{tr('To warehouse')}</dt><dd>{cat.warehouseName(t.toWarehouseId)}</dd></div>
        <div><dt>{tr('Requested by')}</dt><dd>{who(t.requesterId)}</dd></div>
        <div><dt>{tr('Requested')}</dt><dd>{formatDateTime(t.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Reason')}</dt><dd>{t.reason || <span className="muted">{tr('none given')}</span>}</dd></div>
        {t.decidedBy && <div><dt>{tr('Decision by')}</dt><dd>{who(t.decidedBy)}{t.decisionComment ? <span className="muted"> · “{t.decisionComment}”</span> : ''}</dd></div>}
        {t.dispatchedBy && <div><dt>{tr('Dispatched by')}</dt><dd>{who(t.dispatchedBy)}</dd></div>}
        {t.receivedBy && <div><dt>{tr('Received by')}</dt><dd>{who(t.receivedBy)}</dd></div>}
      </dl>

      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th></tr></thead>
          <tbody>{t.lines.map((l, i) => <tr key={i}><td>{cat.itemName(l.itemId)}</td><td className="right">{l.qty}</td></tr>)}</tbody>
        </table>
      </div>

      {t.batches.length > 0 && (
        <>
          <h2 className="related">{tr('Batches moved')}</h2>
          <p className="muted small">{tr('The first batches to expire go first. The destination receives the same batches with the same expiry dates.')}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{tr('Item')}</th><th scope="col">{tr('Batch')}</th><th scope="col">{tr('Expires')}</th><th scope="col" className="right">{tr('Quantity')}</th></tr></thead>
              <tbody>{t.batches.map((b) => <tr key={b.batchId}><td>{cat.itemName(b.itemId)}</td><td><code>{b.batchNo}</code></td><td>{b.expiryDate ?? tr('No expiry')}</td><td className="right">{b.qty}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {t.approvals.length > 0 && (
        <>
          <h2 className="related">{tr('Approvals')}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{tr('User')}</th><th scope="col">{tr('Decision')}</th><th scope="col">{tr('Via')}</th><th scope="col">{tr('When')}</th><th scope="col">{tr('Comment')}</th></tr></thead>
              <tbody>{t.approvals.map((a, i) => <tr key={i}><td>{who(a.approverId)}</td><td>{a.decision}</td><td>{a.channel}</td><td className="nowrap">{formatDateTime(a.decidedAt, session.org)}</td><td>{a.comment ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {t.status === 'submitted' && can('inventory.transfers.approve') && (
        <div className="form-card stack">
          <strong>{tr('Manager decision')}</strong>
          <label>{tr('Comment (optional)')}<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-actions">
            <Button type="submit" disabled={busy} onClick={() => act('approve', 'Approval recorded.')}>{tr('Approve')}</Button>
            <Button variant="outline" type="submit" disabled={busy} onClick={() => act('reject', 'Rejected. The reserved stock was released.')}>{tr('Reject')}</Button>
          </div>
          {demoMode && <p className="hint muted small">{tr('Try approving a transfer you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else.')}</p>}
        </div>
      )}
      {t.status === 'submitted' && !can('inventory.transfers.approve') && <p className="notice">{tr('Waiting for a manager to approve.')}{demoMode && tr(' Switch to Layla Hassan or Karim Adel in the yellow bar to approve it.')}</p>}

      <div className="form-actions">
        {t.status === 'approved' && can('inventory.transfers.dispatch') && <Button type="submit" disabled={busy} onClick={() => act('dispatch', 'Dispatched. The stock left the source and is now in transit.')}>{tr('Dispatch')}</Button>}
        {t.status === 'dispatched' && can('inventory.transfers.receive') && <Button type="submit" disabled={busy} onClick={() => act('receive', 'Received. The stock is now in the destination warehouse.')}>{tr('Receive at destination')}</Button>}
        {open && (mine || can('inventory.transfers.approve')) && can('inventory.transfers.create') && (
          <Button variant="outline" type="submit" disabled={busy} onClick={() => act('cancel', 'Transfer cancelled. The reserved stock was released.')}>{tr('Cancel transfer')}</Button>
        )}
      </div>
      {t.status === 'approved' && !can('inventory.transfers.dispatch') && <p className="notice">{tr('Approved. Awaiting dispatch from the source warehouse.')}</p>}
      {t.status === 'dispatched' && !can('inventory.transfers.receive') && <p className="notice">{tr('In transit. Awaiting receipt at the destination warehouse.')}</p>}

      <RecordHistory key={`${t.id}:${t.status}`} id={t.id} />
    </section>
  );
}
