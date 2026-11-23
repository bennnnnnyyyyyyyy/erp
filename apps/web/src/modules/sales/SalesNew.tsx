import { useEffect, useMemo, useState } from 'react';
import { formatMoney, hasPermission } from '@erp/shared';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { RecordHistory } from '../../components/RecordHistory';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { Party, SalesOrder, SOStatus } from '../../lib/demoTrade';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { unitText } from '../../lib/lineUnits';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { usePaged } from '../../lib/usePaged';
import { useSession } from '../../session';
import { Pill, useCatalog } from '../trade/common';
import { Shipments } from './Shipments';
import './pagekit.css';

// New UI (plan of 23 Nov 2026, Dynamics 365 way of working): the list page and the document page in versions, shown on Sales orders.
// Ben and Grant pick one of each; the winner becomes the page kit for every list and document in the app. Same API and same actions as
// the old screens (GET /v1/sales/orders, POST .../request-stock and .../cancel); only the layout differs.
//   List  A  Dynamics list: action bar, a view picker as the title, search, a side panel with the selected row's facts.
//         B  List and detail side by side: pick a row, its order shows beside the list.
//         C  Grouped by status: one list, a heading row per status (no cards).
//   Order A  Dynamics document: action bar, General section, lines, totals under the lines, a side panel with the customer.
//         B  Paper: the order drawn like the printed document, the actions in a column beside it.
//         C  Next step first: the progress and one big "what to do now" card, then the lines.
const money = (minor: number, currency = 'EGP') => formatMoney({ amountMinor: minor, currency });
const STATUS: Record<SOStatus, string> = { open: 'New order', stock_requested: 'Waiting for approval', approved: 'Approved, ready to ship', delivered: 'Delivered', cancelled: 'Cancelled' };
const ORDER: SOStatus[] = ['open', 'stock_requested', 'approved', 'delivered', 'cancelled'];
const VERSIONS = ['A', 'B', 'C'] as const;
type View = 'all' | 'active' | 'waiting' | 'delivered';
const VIEWS: { key: View; label: string; test: (s: SOStatus) => boolean }[] = [
  { key: 'all', label: 'All orders', test: () => true },
  { key: 'active', label: 'Open orders', test: (s) => s === 'open' || s === 'approved' },
  { key: 'waiting', label: 'Waiting for approval', test: (s) => s === 'stock_requested' },
  { key: 'delivered', label: 'Delivered', test: (s) => s === 'delivered' },
];

/* ======================= LIST ======================= */
export function SalesOrdersNew() {
  const version = useLabChoice('list', VERSIONS, 'A');
  const cat = useCatalog();
  const orders = usePaged<SalesOrder>('/v1/sales/orders', 200);
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers'));
  const session = useSession();
  const canCreate = hasPermission(session.permissions, 'sales.orders.create');
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const customer = (id: string) => customers.data?.find((c) => c.id === id);
  const rows = useMemo(() => {
    const v = VIEWS.find((x) => x.key === view)!;
    const s = q.trim().toLowerCase();
    return (orders.data ?? []).filter((o) => v.test(o.status) && (!s || o.number.toLowerCase().includes(s) || (customer(o.customerId)?.name ?? '').toLowerCase().includes(s)));
    // biome-ignore lint/correctness/useExhaustiveDependencies: customer() reads customers.data, listed
  }, [orders.data, customers.data, view, q]);
  useEffect(() => {
    if (version === 'B' && !sel && rows[0]) setSel(rows[0].id);
  }, [version, rows, sel]);
  if (!orders.data || !customers.data || !cat.ready) return <section className="page"><Loading /></section>;
  const picked = rows.find((o) => o.id === sel) ?? null;

  const actionBar = (
    <div className="pk-bar" role="toolbar" aria-label={tr('Actions')}>
      {canCreate && <button type="button" className="pk-act pk-act-main" onClick={() => navigate('/sales/orders/new')}>+ {tr('New')}</button>}
      <button type="button" className="pk-act" onClick={() => orders.reload?.()}>↻ {tr('Refresh')}</button>
      {picked && <button type="button" className="pk-act" onClick={() => navigate(`/sales/orders/${picked.id}`)}>{tr('Open')}</button>}
      <span className="pk-bar-gap" />
      <input className="pk-search" type="search" aria-label={tr('Search')} placeholder={tr('Search number or customer')} value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
  );
  const viewPicker = (
    <label className="pk-view">
      <span className="pk-visually-hidden">{tr('View')}</span>
      <select value={view} onChange={(e) => setView(e.target.value as View)}>
        {VIEWS.map((v) => <option key={v.key} value={v.key}>{tr(v.label)} ({(orders.data ?? []).filter((o) => v.test(o.status)).length})</option>)}
      </select>
    </label>
  );
  const table = (compact: boolean) => (
    <div className="pk-table-wrap">
      <table className="pk-table">
        <thead>
          <tr>
            <th scope="col">{tr('Order')}</th>
            <th scope="col">{tr('Customer')}</th>
            {!compact && <th scope="col">{tr('Ships from')}</th>}
            <th scope="col">{tr('Status')}</th>
            <th scope="col" className="pk-num">{tr('Total')}</th>
            {!compact && <th scope="col">{tr('Ordered')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={o.id === sel ? 'pk-sel' : undefined} onClick={() => (compact || version === 'A' ? setSel(o.id) : navigate(`/sales/orders/${o.id}`))}
              onDoubleClick={() => navigate(`/sales/orders/${o.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/sales/orders/${o.id}`)} aria-selected={o.id === sel}>
              <td><Link to={`/sales/orders/${o.id}`} onClick={(e) => e.stopPropagation()}><code>{o.number}</code></Link></td>
              <td>{customer(o.customerId)?.name}</td>
              {!compact && <td>{cat.warehouseName(o.warehouseId)}</td>}
              <td><Pill status={o.status} label={tr(STATUS[o.status])} /></td>
              <td className="pk-num">{money(o.totalMinor, o.currency)}</td>
              {!compact && <td className="nowrap">{formatDateTime(o.createdAt, session.org)}</td>}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="pk-empty">{tr('No orders in this view.')}</td></tr>}
        </tbody>
      </table>
      <p className="pk-count">{trf('{n} of {total}', { n: rows.length, total: orders.data?.length ?? 0 })}{orders.hasMore && <button type="button" className="pk-more" onClick={orders.more}>{tr('Show more')}</button>}</p>
    </div>
  );
  const facts = (o: SalesOrder) => {
    const c = customer(o.customerId);
    return (
      <>
        <p className="pk-side-title"><code>{o.number}</code> <Pill status={o.status} label={tr(STATUS[o.status])} /></p>
        <dl className="pk-dl">
          <div><dt>{tr('Customer')}</dt><dd>{c?.name}</dd></div>
          {c?.city && <div><dt>{tr('City')}</dt><dd>{c.city}</dd></div>}
          {c?.phone && <div><dt>{tr('Phone')}</dt><dd dir="ltr">{c.phone}</dd></div>}
          <div><dt>{tr('Total')}</dt><dd className="pk-num">{money(o.totalMinor, o.currency)}</dd></div>
          <div><dt>{tr('Lines')}</dt><dd>{o.lines.length}</dd></div>
          <div><dt>{tr('Ordered')}</dt><dd>{formatDateTime(o.createdAt, session.org)}</dd></div>
        </dl>
        <ul className="pk-lines-mini">
          {o.lines.slice(0, 4).map((l, i) => <li key={i}><span>{cat.itemName(l.itemId)}</span><span className="pk-num">{l.qty}</span></li>)}
        </ul>
        <Link to={`/sales/orders/${o.id}`} className="pk-open">{tr('Open the order')} →</Link>
      </>
    );
  };

  if (version === 'C') {
    return (
      <section className="page pk pk-wide">
        <div className="pk-head"><h1>{tr('Sales orders')}</h1></div>
        {actionBar}
        <div className="pk-table-wrap">
          <table className="pk-table pk-grouped">
            {ORDER.map((s) => {
              const group = rows.filter((o) => o.status === s);
              if (!group.length) return null;
              return (
                <tbody key={s}>
                  <tr className="pk-group-row"><th colSpan={4} scope="colgroup">{tr(STATUS[s])} <span className="pk-group-n">{group.length}</span></th></tr>
                  {group.map((o) => (
                    <tr key={o.id} onClick={() => navigate(`/sales/orders/${o.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/sales/orders/${o.id}`)}>
                      <td><Link to={`/sales/orders/${o.id}`} onClick={(e) => e.stopPropagation()}><code>{o.number}</code></Link></td>
                      <td>{customer(o.customerId)?.name}</td>
                      <td className="pk-muted-cell">{cat.warehouseName(o.warehouseId)} · {formatDateTime(o.createdAt, session.org)}</td>
                      <td className="pk-num">{money(o.totalMinor, o.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
          {rows.length === 0 && <p className="pk-empty">{tr('No orders in this view.')}</p>}
        </div>
      </section>
    );
  }
  if (version === 'B') {
    return (
      <section className="page pk pk-wide">
        <div className="pk-head">{viewPicker}<h1 className="pk-visually-hidden">{tr('Sales orders')}</h1></div>
        {actionBar}
        <div className="pk-split">
          {table(true)}
          <aside className="pk-preview" aria-label={tr('Selected order')}>{picked ? facts(picked) : <p className="pk-empty">{tr('Pick an order to see it here.')}</p>}</aside>
        </div>
      </section>
    );
  }
  return (
    <section className="page pk pk-wide">
      <div className="pk-head">{viewPicker}<h1 className="pk-visually-hidden">{tr('Sales orders')}</h1></div>
      {actionBar}
      <div className={picked ? 'pk-with-side' : ''}>
        {table(false)}
        {picked && (
          <aside className="pk-side" aria-label={tr('Details')}>
            <button type="button" className="pk-side-close" aria-label={tr('Close')} onClick={() => setSel(null)}>✕</button>
            {facts(picked)}
          </aside>
        )}
      </div>
    </section>
  );
}

/* ======================= DOCUMENT ======================= */
const STEPS: { key: SOStatus[]; label: string }[] = [
  { key: ['open'], label: 'Order taken' },
  { key: ['stock_requested'], label: 'Stock requested' },
  { key: ['approved'], label: 'Approved' },
  { key: ['delivered'], label: 'Delivered' },
];

export function SalesOrderNew() {
  const version = useLabChoice('doc', VERSIONS, 'A');
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const order = useLoad(() => api<SalesOrder>(`/v1/sales/orders/${id}`));
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers'));
  const vat = useLoad(() => (demoMode ? Promise.resolve(null) : api<{ vatRegistered: boolean; pricesIncludeVat: boolean }>('/v1/core/org/vat').catch(() => null)));
  const vatLabel = vat.data?.vatRegistered ? (vat.data.pricesIncludeVat ? 'including VAT' : 'before VAT') : null;
  const totalLabel = vatLabel === 'including VAT' ? tr('Total including VAT') : vatLabel === 'before VAT' ? tr('Total before VAT') : tr('Total');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const o = order.data;
  const canFulfil = hasPermission(session.permissions, 'sales.orders.fulfill');
  const canManage = hasPermission(session.permissions, 'sales.orders.manage');
  const canInvoice = hasPermission(session.permissions, 'sales.invoices.manage');

  async function act(action: 'request-stock' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/sales/orders/${id}/${action}`, { method: 'POST' });
      setResult({ ok: true, text: tr(done) });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      order.reload();
    }
  }

  if (order.error) return <section className="page"><p className="error">{order.error}</p></section>;
  if (!o || !cat.ready || !customers.data) return <section className="page"><Loading /></section>;
  const c = customers.data.find((x) => x.id === o.customerId);
  const at = STEPS.findIndex((s) => s.key.includes(o.status));

  // The same actions in every version; only where they sit differs.
  const actions = (
    <>
      {o.status === 'open' && canFulfil && <button type="button" className="pk-act pk-act-main" disabled={busy} onClick={() => act('request-stock', 'Stock requested. A manager now has to approve it.')}>{tr('Request stock from warehouse')}</button>}
      {o.status === 'delivered' && canInvoice && <button type="button" className="pk-act pk-act-main" onClick={() => navigate(`/sales/invoices?order=${o.id}`)}>{tr('Create invoice')}</button>}
      {o.requestId && <button type="button" className="pk-act" onClick={() => navigate(`/inventory/requests/${o.requestId}`)}>{tr('Open stock request')}</button>}
      {o.status === 'open' && canManage && (
        <ConfirmButton label={tr('Cancel order')} confirmLabel={tr('Yes, cancel it')} disabled={busy} question={tr('Cancel this order?')} onConfirm={() => act('cancel', 'Order cancelled.')} />
      )}
    </>
  );
  const nextStep =
    o.status === 'open' ? tr('Ask the warehouse for the stock. A manager approves before anything ships.')
      : o.status === 'stock_requested' ? tr('Waiting for a manager to approve the stock request.')
      : o.status === 'approved' ? tr('Approved. The warehouse sends the goods out.')
      : o.status === 'delivered' ? tr('Delivered. Invoice the customer.')
      : tr('This order was cancelled.');
  const lines = (
    <div className="pk-table-wrap">
      <table className="pk-table">
        <thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="pk-num">{tr('Quantity')}</th><th scope="col" className="pk-num">{tr('Unit price')}</th><th scope="col" className="pk-num">{tr('Line total')}</th></tr></thead>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i}>
              <td>{cat.itemName(l.itemId)}</td>
              <td className="pk-num">{unitText(l.qty, cat.uomOf(l.itemId), l.unit, l.unitFactor, tr)}</td>
              <td className="pk-num">{l.unit && l.unitFactor ? trf('{price} per {unit}', { price: money(Math.round(l.unitPriceMinor * l.unitFactor), o.currency), unit: tr(l.unit) }) : money(l.unitPriceMinor, o.currency)}</td>
              <td className="pk-num">{money(l.qty * l.unitPriceMinor, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pk-totals"><span>{totalLabel}</span><strong className="pk-num">{money(o.totalMinor, o.currency)}</strong></div>
    </div>
  );
  const steps = (
    <ol className="pk-steps" aria-label={tr('Order progress')}>
      {STEPS.map((s, i) => (
        <li key={s.label} className={o.status === 'cancelled' ? '' : i < at || o.status === 'delivered' ? 'done' : i === at ? 'current' : ''}>{tr(s.label)}</li>
      ))}
    </ol>
  );
  const message = result && <p className={result.ok ? 'notice' : 'error notice'} role="status">{result.text}</p>;
  const tail = (
    <>
      {o.status !== 'cancelled' && <Shipments orderId={o.id} customerName={c?.name ?? ''} customerPhone={c?.phone ?? ''} customerCity={c?.city ?? ''} />}
      <RecordHistory key={`${o.id}:${o.status}`} id={o.id} />
    </>
  );

  if (version === 'B') {
    return (
      <section className="page pk pk-wide">
        <Link to="/sales" className="back-link">← {tr('Sales orders')}</Link>
        <div className="pk-paper-wrap">
          <article className="pk-paper">
            <header className="pk-paper-head">
              <div><p className="pk-paper-kind">{tr('Sales order')}</p><h1><code>{o.number}</code></h1></div>
              <Pill status={o.status} label={tr(STATUS[o.status])} />
            </header>
            <div className="pk-paper-parties">
              <div><p className="pk-label">{tr('Customer')}</p><p className="pk-strong">{c?.name}</p><p className="pk-muted">{c?.city}{c?.phone ? ` · ${c.phone}` : ''}</p></div>
              <div><p className="pk-label">{tr('Ships from')}</p><p className="pk-strong">{cat.warehouseName(o.warehouseId)}</p><p className="pk-muted">{formatDateTime(o.createdAt, session.org)}</p></div>
            </div>
            {lines}
          </article>
          <aside className="pk-paper-side">
            <p className="pk-label">{tr('Next step')}</p>
            <p>{nextStep}</p>
            <div className="pk-stack">{actions}</div>
            {message}
            {steps}
          </aside>
        </div>
        {tail}
      </section>
    );
  }
  if (version === 'C') {
    return (
      <section className="page pk">
        <Link to="/sales" className="back-link">← {tr('Sales orders')}</Link>
        <div className="pk-head"><h1><code>{o.number}</code> · {c?.name}</h1><Pill status={o.status} label={tr(STATUS[o.status])} /></div>
        {steps}
        <div className="pk-next">
          <div><p className="pk-label">{tr('What to do now')}</p><p className="pk-next-text">{nextStep}</p></div>
          <div className="pk-next-actions">{actions}</div>
        </div>
        {message}
        <details className="pk-fold" open>
          <summary>{trf('{n} lines · {total}', { n: o.lines.length, total: money(o.totalMinor, o.currency) })}</summary>
          {lines}
        </details>
        {tail}
      </section>
    );
  }
  return (
    <section className="page pk pk-wide">
      <div className="pk-head">
        <div><p className="pk-kind">{tr('Sales order')}</p><h1><code>{o.number}</code> · {c?.name}</h1></div>
        <Pill status={o.status} label={tr(STATUS[o.status])} />
      </div>
      <div className="pk-bar" role="toolbar" aria-label={tr('Actions')}>
        <button type="button" className="pk-act" onClick={() => navigate('/sales')}>← {tr('Back')}</button>
        {actions}
      </div>
      {message}
      <div className="pk-with-side">
        <div className="pk-doc">
          <section className="pk-section">
            <h2>{tr('General')}<button type="button" className="pk-link" onClick={() => setMore((m) => !m)}>{more ? tr('Show less') : tr('Show more')}</button></h2>
            <dl className="pk-grid">
              <div><dt>{tr('Customer')}</dt><dd>{c?.name}</dd></div>
              <div><dt>{tr('Ships from')}</dt><dd>{cat.warehouseName(o.warehouseId)}</dd></div>
              <div><dt>{tr('Ordered')}</dt><dd>{formatDateTime(o.createdAt, session.org)}</dd></div>
              <div><dt>{totalLabel}</dt><dd className="pk-num">{money(o.totalMinor, o.currency)}</dd></div>
              {more && <div><dt>{tr('Stock request')}</dt><dd>{o.requestNumber ?? '—'}</dd></div>}
              {more && <div><dt>{tr('Currency')}</dt><dd>{o.currency}</dd></div>}
            </dl>
          </section>
          <section className="pk-section"><h2>{tr('Lines')}</h2>{lines}</section>
          {steps}
        </div>
        <aside className="pk-side">
          <p className="pk-side-title">{tr('Customer')}</p>
          <dl className="pk-dl">
            <div><dt>{tr('Name')}</dt><dd>{c?.name}</dd></div>
            {c?.city && <div><dt>{tr('City')}</dt><dd>{c.city}</dd></div>}
            {c?.phone && <div><dt>{tr('Phone')}</dt><dd dir="ltr">{c.phone}</dd></div>}
            {c?.contact && <div><dt>{tr('Contact')}</dt><dd>{c.contact}</dd></div>}
          </dl>
        </aside>
      </div>
      {tail}
    </section>
  );
}

/* ======================= RECORD (shown on a customer) ======================= */
// A record page in three versions (Design Lab "Record page"). Reads the existing endpoints only (the customer list and the orders).
//   A  Dynamics card: folding sections with the important fields first ("Show more"), a statistics side panel, previous / next.
//   B  Overview with tabs: Overview (figures and recent orders), Orders, Details.
//   C  Sheet with related lists: the details as one sheet; the customer's orders beside it.
export function CustomerNew() {
  const version = useLabChoice('record', VERSIONS, 'A');
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers'));
  const orders = usePaged<SalesOrder>('/v1/sales/orders', 200);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<'overview' | 'orders' | 'details'>('overview');
  if (customers.error) return <section className="page"><p className="error">{customers.error}</p></section>;
  if (!customers.data || !orders.data || !cat.ready) return <section className="page"><Loading /></section>;
  const list = customers.data;
  const at = list.findIndex((c) => c.id === id);
  const c = list[at];
  if (!c) return <section className="page"><p className="muted">{tr('This customer was not found.')}</p></section>;
  const prev = list[at - 1];
  const next = list[at + 1];
  const mine = orders.data.filter((o) => o.customerId === c.id);
  const currency = mine[0]?.currency ?? session.org?.defaultCurrency ?? 'EGP';
  const totalOrdered = mine.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.totalMinor, 0);
  const open = mine.filter((o) => o.status === 'open' || o.status === 'stock_requested' || o.status === 'approved');
  const last = mine[0];
  const terms = c.paymentTermsDays === null || c.paymentTermsDays === undefined ? tr('Company default') : trf('{n} days', { n: c.paymentTermsDays });
  const title = c.code ? `${c.code} · ${c.name}` : c.name;
  const field = (label: string, value: string | undefined | null) => (value ? <div key={label}><dt>{label}</dt><dd>{value}</dd></div> : null);
  const orderRows = (rows: SalesOrder[]) =>
    rows.length ? (
      <table className="pk-table">
        <thead><tr><th scope="col">{tr('Order')}</th><th scope="col">{tr('Status')}</th><th scope="col">{tr('Ordered')}</th><th scope="col" className="pk-num">{tr('Total')}</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} onClick={() => navigate(`/sales/orders/${o.id}`)}>
              <td><Link to={`/sales/orders/${o.id}`} onClick={(e) => e.stopPropagation()}><code>{o.number}</code></Link></td>
              <td><Pill status={o.status} label={tr(STATUS[o.status])} /></td>
              <td className="nowrap">{formatDateTime(o.createdAt, session.org)}</td>
              <td className="pk-num">{money(o.totalMinor, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : <p className="pk-empty">{tr('No orders from this customer yet.')}</p>;
  const stats = (
    <dl className="pk-dl">
      <div><dt>{tr('Orders')}</dt><dd>{mine.length}</dd></div>
      <div><dt>{tr('Open orders')}</dt><dd>{open.length}</dd></div>
      <div><dt>{tr('Total ordered')}</dt><dd className="pk-num">{money(totalOrdered, currency)}</dd></div>
      <div><dt>{tr('Last order')}</dt><dd>{last ? formatDateTime(last.createdAt, session.org) : '—'}</dd></div>
    </dl>
  );
  const details = (
    <dl className="pk-grid">
      {field(tr('Name'), c.name)}
      {field(tr('Code'), c.code)}
      {field(tr('Contact'), c.contact)}
      {field(tr('Phone'), c.phone)}
      {field(tr('City'), c.city)}
      {field(tr('Payment terms'), terms)}
      {field(tr('Email'), c.email)}
      {field(tr('Address'), c.address)}
      {field(tr('Tax registration no.'), c.taxNumber)}
      {field(tr('Commercial registry'), c.commercialRegistry)}
      {field(tr('Notes'), c.notes)}
    </dl>
  );
  const newOrder = hasPermission(session.permissions, 'sales.orders.create') && (
    <button type="button" className="pk-act pk-act-main" onClick={() => navigate('/sales/orders/new')}>+ {tr('New sales order')}</button>
  );
  const prevNext = (
    <span className="pk-prevnext">
      <button type="button" className="pk-act" disabled={!prev} onClick={() => prev && navigate(`/sales/customers/${prev.id}`)} aria-label={tr('Previous')}>‹</button>
      <span className="pk-muted">{trf('{n} of {total}', { n: at + 1, total: list.length })}</span>
      <button type="button" className="pk-act" disabled={!next} onClick={() => next && navigate(`/sales/customers/${next.id}`)} aria-label={tr('Next')}>›</button>
    </span>
  );

  if (version === 'B') {
    return (
      <section className="page pk pk-wide">
        <Link to="/sales/customers" className="back-link">← {tr('Customers')}</Link>
        <div className="pk-head"><div><p className="pk-kind">{tr('Customer')}</p><h1>{title}</h1><p className="pk-muted">{[c.city, c.phone, c.contact].filter(Boolean).join(' · ')}</p></div>{newOrder}</div>
        <div className="pk-tabs" role="tablist">
          {(['overview', 'orders', 'details'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'pk-tab active' : 'pk-tab'} onClick={() => setTab(t)}>
              {t === 'overview' ? tr('Overview') : t === 'orders' ? `${tr('Orders')} (${mine.length})` : tr('Details')}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <>
            <div className="pk-strip">
              <div><span>{tr('Total ordered')}</span><strong>{money(totalOrdered, currency)}</strong></div>
              <div><span>{tr('Open orders')}</span><strong>{open.length}</strong></div>
              <div><span>{tr('Payment terms')}</span><strong>{terms}</strong></div>
              <div><span>{tr('Last order')}</span><strong>{last ? formatDateTime(last.createdAt, session.org) : '—'}</strong></div>
            </div>
            <h2 className="pk-h2">{tr('Recent orders')}</h2>
            {orderRows(mine.slice(0, 5))}
          </>
        )}
        {tab === 'orders' && orderRows(mine)}
        {tab === 'details' && details}
      </section>
    );
  }
  if (version === 'C') {
    return (
      <section className="page pk pk-wide">
        <Link to="/sales/customers" className="back-link">← {tr('Customers')}</Link>
        <div className="pk-head"><h1>{title}</h1>{newOrder}</div>
        <div className="pk-sheet">
          <div className="pk-sheet-main"><dl className="pk-rows">
            {[[tr('Code'), c.code], [tr('Contact'), c.contact], [tr('Phone'), c.phone], [tr('City'), c.city], [tr('Address'), c.address], [tr('Email'), c.email], [tr('Payment terms'), terms], [tr('Tax registration no.'), c.taxNumber], [tr('Notes'), c.notes]]
              .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
          </dl></div>
          <div className="pk-sheet-side">
            <h2 className="pk-h2">{trf('Open orders ({n})', { n: open.length })}</h2>
            {orderRows(open)}
            <h2 className="pk-h2">{trf('All orders ({n})', { n: mine.length })}</h2>
            {orderRows(mine.slice(0, 8))}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="page pk pk-wide">
      <div className="pk-head">
        <div><p className="pk-kind">{tr('Customer')}</p><h1>{title}</h1></div>
        {prevNext}
      </div>
      <div className="pk-bar" role="toolbar" aria-label={tr('Actions')}>
        <button type="button" className="pk-act" onClick={() => navigate('/sales/customers')}>← {tr('Back')}</button>
        {newOrder}
      </div>
      <div className="pk-with-side">
        <div className="pk-doc">
          <section className="pk-section">
            <h2>{tr('General')}<button type="button" className="pk-link" onClick={() => setMore((m) => !m)}>{more ? tr('Show less') : tr('Show more')}</button></h2>
            <dl className="pk-grid">
              {field(tr('Name'), c.name)}
              {field(tr('Phone'), c.phone)}
              {field(tr('City'), c.city)}
              {field(tr('Payment terms'), terms)}
              {more && field(tr('Contact'), c.contact)}
              {more && field(tr('Email'), c.email)}
              {more && field(tr('Address'), c.address)}
              {more && field(tr('Tax registration no.'), c.taxNumber)}
              {more && field(tr('Notes'), c.notes)}
            </dl>
          </section>
          <section className="pk-section"><h2>{tr('Orders')}</h2>{orderRows(mine.slice(0, 10))}</section>
        </div>
        <aside className="pk-side"><p className="pk-side-title">{tr('Statistics')}</p>{stats}</aside>
      </div>
    </section>
  );
}
