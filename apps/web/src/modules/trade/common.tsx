import { useEffect, useState, type FormEvent } from 'react';
import { demoMode } from '../../lib/demo';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/ui/badge';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { DemoItem, DemoWarehouse } from '../../lib/demoInventory';
import type { Party } from '../../lib/demoTrade';
import { Link, navigate } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { hasPermission } from '@erp/shared';

import { tr, trf } from '../../lib/i18n';
// DEMO ONLY: shared pieces for the sample purchasing and sales screens (lib/demoTrade.ts).

export function useCatalog() {
  const items = useLoad(() => api<DemoItem[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<DemoWarehouse[]>('/v1/inventory/warehouses'));
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? id;
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  return { items, warehouses, itemName, warehouseName, ready: Boolean(items.data && warehouses.data) };
}

const PILL_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  issued: 'success', received: 'success', delivered: 'success', active: 'success',
  submitted: 'warning', ordered: 'warning', stock_requested: 'warning', open: 'warning', invited: 'warning',
  approved: 'info', rejected: 'danger',
};

/** Status chip. Unknown or finished-and-quiet statuses (cancelled, void, disabled) are neutral. */
export function Pill({ status, label }: { status: string; label?: string }) {
  return <Badge variant={PILL_VARIANT[status] ?? 'neutral'} className={label ? undefined : 'capitalize'}>{label ?? status.replace('_', ' ')}</Badge>;
}

/** "18.50" typed by a person becomes 1850 minor units. */
export const toMinor = (text: string) => Math.round((Number(text) || 0) * 100);

// ------------------------------------------------------------------ suppliers and customers

/** A party's payment terms in days, edited in place (owners and admins; sql/041). Empty = the company default. Saves on Enter or on leaving. */
function TermsCell({ party, endpoint, onSaved }: { party: Party; endpoint: string; onSaved: () => void }) {
  const initial = party.paymentTermsDays == null ? '' : String(party.paymentTermsDays);
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  useEffect(() => setValue(initial), [initial]);
  const save = async () => {
    if (value === initial) return;
    const days = value.trim() === '' ? null : Number(value);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) return setState('error');
    setState('saving');
    try {
      await api(`${endpoint}/${party.id}/terms`, { method: 'PUT', body: JSON.stringify({ days }) });
      setState('idle');
      onSaved();
    } catch {
      setState('error');
    }
  };
  return (
    <input
      type="number"
      min={0}
      max={365}
      step={1}
      className="w-24"
      aria-label={trf('Payment terms for {name}', { name: party.name })}
      aria-invalid={state === 'error' || undefined}
      placeholder={tr('Company default')}
      value={value}
      disabled={state === 'saving'}
      onChange={(e) => {
        setValue(e.target.value);
        setState('idle');
      }}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function PartyList({ title, endpoint, noun, addPermission }: { title: string; endpoint: string; noun: string; addPermission?: string }) {
  const parties = useLoad(() => api<Party[]>(endpoint));
  const session = useSession();
  // Terms are set by owners and admins (the database checks again). Not in the sample-data demo build, which has no such route.
  const canSetTerms = !demoMode && (session.role === 'owner' || session.role === 'admin');
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
    { key: 'name', label: tr('Name'), value: (p) => p.name, render: (p) => <strong>{p.name}</strong> },
    { key: 'contact', label: tr('Contact'), value: (p) => p.contact },
    { key: 'city', label: tr('City'), value: (p) => p.city },
    { key: 'phone', label: tr('Phone'), value: (p) => p.phone, render: (p) => <code>{p.phone}</code> },
    {
      key: 'terms',
      label: tr('Payment terms'),
      value: (p) => p.paymentTermsDays ?? -1,
      render: (p) =>
        canSetTerms ? (
          <TermsCell party={p} endpoint={endpoint} onSaved={parties.reload} />
        ) : p.paymentTermsDays == null ? (
          <span className="muted">{tr('Company default')}</span>
        ) : (
          trf('{n} days', { n: p.paymentTermsDays })
        ),
    },
  ];

  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">{trf('One record per {noun}, shared by every order.', { noun: tr(noun) })}</p>
      {parties.data ? (
        <ListView
          title={title}
          rows={parties.data}
          columns={columns}
          rowKey={(p) => p.id}
          toolbar={(!addPermission || hasPermission(session.permissions, addPermission)) ? <Button type="submit" onClick={() => setAdding(true)}>{tr('Add')} {noun}</Button> : undefined}
        />
      ) : (
        <Loading />
      )}
      {adding && (
        <Modal title={trf('Add {noun}', { noun: tr(noun) })} onClose={() => setAdding(false)}>
          <form className="stack" onSubmit={submit}>
            <label>{tr('Name')}<input required value={form.name} onChange={set('name')} /></label>
            <div className="form-row">
              <label>{tr('Contact person')}<input value={form.contact} onChange={set('contact')} /></label>
              <label>{tr('City')}<input value={form.city} onChange={set('city')} /></label>
            </div>
            <label>{tr('Phone')}<input value={form.phone} onChange={set('phone')} placeholder="+20 …" /></label>
            {error && <p className="error">{error}</p>}
            <div className="form-actions"><Button type="submit">{tr('Add')} {noun}</Button></div>
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

  if (!cat.ready || !parties.data) return <section className="page"><Loading /></section>;

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
              <option value="">{tr('Choose…')}</option>
              {parties.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            {tr('Warehouse')}
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <strong>{tr('Items')}</strong>
        {lines.map((l, i) => (
          <div className="form-row three" key={i}>
            <label>
              {tr('Item')}
              <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                <option value="">{tr('Choose an item…')}</option>
                {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
              </select>
            </label>
            <label>{tr('Quantity')}<input type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
            <label>{props.priceLabel} {tr('(EGP)')}<input type="number" min="0" step="0.01" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></label>
          </div>
        ))}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1', price: '' }])}>{tr('Add another item')}</Button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : props.submitLabel}</Button></div>
      </form>
    </section>
  );
}
