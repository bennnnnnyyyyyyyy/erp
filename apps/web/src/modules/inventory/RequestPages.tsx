import { useState, type FormEvent } from 'react';
import { RecordHistory } from '../../components/RecordHistory';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { ErrorToast } from '../../components/Toast';
import { hasPermission } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { DemoRequest, StockRow } from '../../lib/demoInventory';
import { usePeople } from '../../lib/people';
import { formatDateTime, ltrIsolate, qtyLine } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { parseAmount } from '../../lib/numbers';
import { ConfirmButton } from '../../components/FormToggle';
import { tr, trf } from '../../lib/i18n';
import { qty, StatusPill, Steps, useCatalog } from './inventoryShared';

// ------------------------------------------------------------------ requests

export function RequestsList() {
  const cat = useCatalog();
  const who = usePeople();
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const session = useSession();
  const [filter, setFilter] = useState<'all' | 'submitted'>('all');
  const rows = (requests.data ?? []).filter((r) => filter === 'all' || r.status === 'submitted');

  const columns: Column<DemoRequest>[] = [
    { key: 'number', label: tr('Request'), value: (r) => r.number, render: (r) => <Link to={`/inventory/requests/${r.id}`}><code>{r.number}</code></Link> },
    { key: 'by', label: tr('Requested by'), value: (r) => who(r.requesterId) },
    { key: 'wh', label: tr('Warehouse'), value: (r) => cat.warehouseName(r.warehouseId) },
    // A request can carry 20+ lines (a production issue of raw materials). The list shows the first three and a count; the full list is
    // still searched, exported and shown on hover, and the request's own page has every line.
    { key: 'items', label: tr('Items'), value: (r) => r.lines.map((l) => qtyLine(l.qty, cat.itemName(l.itemId))).join(', '), render: (r) => {
      const all = r.lines.map((l) => qtyLine(l.qty, cat.itemName(l.itemId)));
      return <span title={all.join(', ')}>{all.slice(0, 3).map(ltrIsolate).join(', ')}{all.length > 3 && <span className="muted"> {trf('+ {count} more', { count: all.length - 3 })}</span>}</span>;
    } },
    { key: 'status', label: tr('Status'), value: (r) => r.status, render: (r) => <StatusPill status={r.status} /> },
    { key: 'when', label: tr('Requested'), value: (r) => r.createdAt, render: (r) => <span className="nowrap">{formatDateTime(r.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>{tr('Stock requests')}</h1>
      <p className="muted">{tr('Goods are issued only against an approved request.')}</p>
      {requests.data && cat.ready ? (
        <ListView
          title={tr('Stock requests')}
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/inventory/requests/${r.id}`}
          empty={tr('No requests yet.')}
          toolbar={
            <>
              <select className="narrow-select" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'submitted')} aria-label={tr('Filter')}>
                <option value="all">{tr('All requests')}</option>
                <option value="submitted">{tr('Waiting for approval')}</option>
              </select>
              {hasPermission(session.permissions, 'inventory.request.create') && <Button type="submit" onClick={() => navigate('/inventory/requests/new')}>{tr('New request')}</Button>}
            </>
          }
        />
      ) : (
        <Loading />
      )}
    </section>
  );
}

function defaultWarehouse(warehouses: { id: string }[], stock: StockRow[], requests: { warehouseId: string }[], lastKey: string): string {
  let last: string | null = null;
  try { last = localStorage.getItem(lastKey); } catch { /* storage blocked */ }
  if (last && warehouses.some((w) => w.id === last)) return last;
  // The warehouse people request from most often (finished goods in a factory). Counting units instead picked the packaging store:
  // thousands of bottles and caps outweigh a few hundred finished products.
  const used = new Map<string, number>();
  for (const r of requests) used.set(r.warehouseId, (used.get(r.warehouseId) ?? 0) + 1);
  const busiest = warehouses.reduce<{ id: string; n: number } | null>((b, w) => ((used.get(w.id) ?? 0) > (b?.n ?? 0) ? { id: w.id, n: used.get(w.id) ?? 0 } : b), null);
  if (busiest) return busiest.id;
  const held = new Map<string, number>();
  for (const s of stock) held.set(s.warehouseId, (held.get(s.warehouseId) ?? 0) + Math.max(0, s.available));
  let best = warehouses[0]?.id ?? '';
  for (const w of warehouses) if ((held.get(w.id) ?? 0) > (held.get(best) ?? 0)) best = w.id;
  return best;
}

export function NewRequest() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const session = useSession();
  const [chosenWarehouse, setWarehouseId] = useState('');
  // Until the person picks one: the warehouse they last requested from (this browser, this company), else the one most requests come
  // from, else the one holding the most stock. The first in the list was often a side store (a cold room) and the request started wrong.
  const past = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests').catch(() => [] as DemoRequest[]));
  const lastKey = `erp.request.warehouse.${session.org?.id ?? ''}`;
  const warehouseId = chosenWarehouse || defaultWarehouse(cat.warehouses.data ?? [], stock.data ?? [], past.data ?? [], lastKey);
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
        body: JSON.stringify({ warehouseId, reason, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: parseAmount(l.qty) })) }),
      });
      try { localStorage.setItem(lastKey, warehouseId); } catch { /* storage blocked: next time falls back to the fullest warehouse */ }
      navigate(`/inventory/requests/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!cat.ready || !stock.data || !past.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page">
      <Link to="/inventory/requests" className="back-link">{tr('← Stock requests')}</Link>
      <h1>{tr('New stock request')}</h1>
      <p className="muted">{tr('Requested quantities are reserved until a manager decides.')}</p>
      <form className="form-card stack" onSubmit={submit}>
        <div className="form-row">
          <label>
            {tr('Issue from warehouse')}
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>{tr('Reason')}<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Customer order, internal use…')} /></label>
        </div>
        <strong>{tr('Items')}</strong>
        {lines.map((l, i) => (
          <div className="form-row" key={i}>
            <label>
              {tr('Item')}
              <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                <option value="">{tr('Choose an item…')}</option>
                {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
              </select>
            </label>
            <label>
              {tr('Quantity')} {l.itemId && <span className="muted small">{trf('({n} available)', { n: available(l.itemId) })}</span>}
              <input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            </label>
          </div>
        ))}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>{tr('Add another item')}</Button>
        </div>
        <ErrorToast message={error} onClose={() => setError(null)} />
        <div className="form-actions">
          <Button type="submit" disabled={busy}>{busy ? tr('Submitting…') : tr('Submit for approval')}</Button>
        </div>
      </form>
    </section>
  );
}

export function RequestPage() {
  const who = usePeople();
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const request = useLoad(() => api<DemoRequest>(`/v1/inventory/requests/${id}`));
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const r = request.data;
  // Buttons follow the same permissions as the server, so nobody fills in a form only to be refused (UX audit).
  const isManager = hasPermission(session.permissions, 'inventory.request.approve');
  const mine = r?.requesterId === session.userId;
  const canIssue = hasPermission(session.permissions, 'inventory.stock.issue');
  const canCancel = mine || isManager;

  async function act(action: 'approve' | 'reject' | 'issue' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/inventory/requests/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) });
      setResult({ ok: true, text: tr(done) });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      request.reload();
    }
  }

  if (request.error) return <section className="page"><p className="error">{request.error}</p></section>;
  if (!r || !cat.ready) return <section className="page"><Loading /></section>;

  const open = r.status === 'submitted' || r.status === 'approved';

  return (
    <section className="page">
      <Link to="/inventory/requests" className="back-link">{tr('← Stock requests')}</Link>
      <div className="page-head">
        <h1 className="mono">{r.number}</h1>
        <StatusPill status={r.status} />
      </div>
      <Steps status={r.status} />
      {/* The key facts as a labelled block, like the invoice and payment pages (was one long sentence). */}
      <dl className="facts">
        <div><dt>{tr('Requested by')}</dt><dd>{who(r.requesterId)}</dd></div>
        <div><dt>{tr('Requested')}</dt><dd>{formatDateTime(r.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Warehouse')}</dt><dd>{cat.warehouseName(r.warehouseId)}</dd></div>
        <div><dt>{tr('Reason')}</dt><dd>{r.reason || <span className="muted">{tr('none given')}</span>}</dd></div>
        {r.source && <div><dt>{tr('Sales order')}</dt><dd><Link to={`/sales/orders/${r.source.id}`}><code>{r.source.number}</code></Link></dd></div>}
        {r.decidedBy && <div><dt>{tr('Decision by')}</dt><dd>{who(r.decidedBy)}{r.decisionComment ? <span className="muted"> · “{r.decisionComment}”</span> : ''}</dd></div>}
      </dl>

      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th></tr></thead>
          <tbody>
            {r.lines.map((l, i) => <tr key={i}><td>{cat.itemName(l.itemId)}</td><td className="right">{l.qty}</td></tr>)}
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {/* Decision D1 (sql/063): your own request can be approved only when the company has no other active owner or manager. The
          database decides; Approve is offered and refused with a clear message when someone else must approve it. */}
      {r.status === 'submitted' && isManager && (
        <div className="form-card stack">
          <strong>{tr('Manager decision')}</strong>
          {mine && !demoMode && (
            <p className="muted small">{tr('You made this request. If you are the only owner or manager, you can approve it yourself and the history marks it as self-approved. Otherwise another owner or manager must approve it.')}</p>
          )}
          <label>{tr('Comment (optional)')}<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-actions">
            <Button type="submit" disabled={busy} onClick={() => act('approve', 'Approved. The stock can now be issued.')}>{tr('Approve')}</Button>
            <Button variant="outline" type="submit" disabled={busy} onClick={() => act('reject', 'Rejected. The reserved stock was released.')}>{tr('Reject')}</Button>
          </div>
          {demoMode && <p className="hint muted small">{tr('Try approving a request you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else.')}</p>}
        </div>
      )}
      {r.status === 'submitted' && !isManager && <p className="notice">{tr('Waiting for a manager to approve.')}{demoMode && tr(' Switch to Layla Hassan or Karim Adel in the yellow bar to approve it.')}</p>}

      {open && (canIssue || canCancel) && (
        <div className="form-actions">
          {r.status === 'approved' && canIssue && (
            <ConfirmButton label={tr('Issue stock')} confirmLabel={tr('Yes, issue')} disabled={busy}
              question={tr('Issue this stock now? It leaves the warehouse and is recorded in the ledger.')}
              onConfirm={() => act('issue', 'Stock issued and recorded in the ledger.')} />
          )}
          {canCancel && (
            <ConfirmButton label={tr('Cancel request')} confirmLabel={tr('Yes, cancel it')} disabled={busy}
              question={tr('Cancel this request? The reserved stock is released.')}
              onConfirm={() => act('cancel', 'Request cancelled. The reserved stock was released.')} />
          )}
        </div>
      )}

      <RecordHistory key={`${r.id}:${r.status}`} id={r.id} />
    </section>
  );
}

