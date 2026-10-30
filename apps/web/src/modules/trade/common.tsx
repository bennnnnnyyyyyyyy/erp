import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { DemoItem, DemoWarehouse } from '../../lib/demoInventory';
import type { Party } from '../../lib/demoTrade';
import { Link, navigate } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { hasPermission } from '@erp/shared';

// DEMO ONLY: shared pieces for the sample purchasing and sales screens (lib/demoTrade.ts).

export function useCatalog() {
  const items = useLoad(() => api<DemoItem[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<DemoWarehouse[]>('/v1/inventory/warehouses'));
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? id;
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  return { items, warehouses, itemName, warehouseName, ready: Boolean(items.data && warehouses.data) };
}

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill st-${status}`}>{label ?? status.replace('_', ' ')}</span>;
}

/** "18.50" typed by a person becomes 1850 minor units. */
export const toMinor = (text: string) => Math.round((Number(text) || 0) * 100);

// ------------------------------------------------------------------ suppliers and customers

export function PartyList({ title, endpoint, noun, addPermission }: { title: string; endpoint: string; noun: string; addPermission?: string }) {
  const parties = useLoad(() => api<Party[]>(endpoint));
  const session = useSession();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', contact: '', city: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(form) });
      setAdding(false);
      setForm({ name: '', contact: '', city: '', phone: '' });
      parties.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const columns: Column<Party>[] = [
    { key: 'name', label: 'Name', value: (p) => p.name, render: (p) => <strong>{p.name}</strong> },
    { key: 'contact', label: 'Contact', value: (p) => p.contact },
    { key: 'city', label: 'City', value: (p) => p.city },
    { key: 'phone', label: 'Phone', value: (p) => p.phone, render: (p) => <code>{p.phone}</code> },
  ];

  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">One record per {noun}, shared by every order.</p>
      {parties.data ? (
        <ListView
          title={title}
          rows={parties.data}
          columns={columns}
          rowKey={(p) => p.id}
          toolbar={(!addPermission || hasPermission(session.permissions, addPermission)) ? <button onClick={() => setAdding(true)}>Add {noun}</button> : undefined}
        />
      ) : (
        <p className="muted">Loading…</p>
      )}
      {adding && (
        <Modal title={`Add ${noun}`} onClose={() => setAdding(false)}>
          <form className="stack" onSubmit={submit}>
            <label>Name<input required value={form.name} onChange={set('name')} /></label>
            <div className="form-row">
              <label>Contact person<input value={form.contact} onChange={set('contact')} /></label>
              <label>City<input value={form.city} onChange={set('city')} /></label>
            </div>
            <label>Phone<input value={form.phone} onChange={set('phone')} placeholder="+20 …" /></label>
            {error && <p className="error">{error}</p>}
            <div className="form-actions"><button type="submit">Add {noun}</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ new order form (purchase and sales)

type Line = { itemId: string; qty: string; price: string };

export function NewOrderForm(props: {
  title: string;
  intro: string;
  partyLabel: string;
  partyEndpoint: string;
  orderEndpoint: string;
  partyField: 'supplierId' | 'customerId';
  priceField: 'unitCostMinor' | 'unitPriceMinor';
  priceLabel: string;
  backTo: string;
  backLabel: string;
  submitLabel: string;
}) {
  const cat = useCatalog();
  const parties = useLoad(() => api<Party[]>(props.partyEndpoint));
  const [partyId, setPartyId] = useState('');
  const [warehouseId, setWarehouseId] = useState('w1');
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qty: '1', price: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const order = await api<{ id: string }>(props.orderEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          [props.partyField]: partyId,
          warehouseId,
          lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), [props.priceField]: toMinor(l.price) })),
        }),
      });
      navigate(`${props.backTo}/${order.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!cat.ready || !parties.data) return <section className="page"><p className="muted">Loading…</p></section>;

  return (
    <section className="page">
      <Link to={props.backTo} className="back-link">← {props.backLabel}</Link>
      <h1>{props.title}</h1>
      <p className="muted">{props.intro}</p>
      <form className="form-card stack" onSubmit={submit}>
        <div className="form-row">
          <label>
            {props.partyLabel}
            <select required value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">Choose…</option>
              {parties.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            Warehouse
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <strong>Items</strong>
        {lines.map((l, i) => (
          <div className="form-row three" key={i}>
            <label>
              Item
              <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                <option value="">Choose an item…</option>
                {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
              </select>
            </label>
            <label>Quantity<input type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
            <label>{props.priceLabel} (EGP)<input type="number" min="0" step="0.01" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></label>
          </div>
        ))}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1', price: '' }])}>Add another item</button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : props.submitLabel}</button></div>
      </form>
    </section>
  );
}
