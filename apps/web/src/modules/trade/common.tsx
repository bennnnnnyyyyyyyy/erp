import { useEffect, useState, type FormEvent } from 'react';
import { demoMode } from '../../lib/demo';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { ErrorToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/ui/badge';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { DemoItem, DemoWarehouse } from '../../lib/demoInventory';
import type { Party } from '../../lib/demoTrade';
import { Link, navigate } from '../../lib/router';
import { parseAmount, toMinor } from '../../lib/numbers';
import { SearchSelect } from '../../components/SearchSelect';
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

/** "18.50", "1,500" or Arabic digits typed by a person become minor units (lib/numbers.ts). */
export { toMinor } from '../../lib/numbers';

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

// Supplier business details (sql/076), edited in the same dialog. Customers do not have them yet.
const DETAIL_BLANK = { taxNumber: '', commercialRegistry: '', email: '', address: '', bankName: '', bankAccount: '', defaultCurrency: '', notes: '' };
const detailsOf = (p: Party) => ({
  taxNumber: p.taxNumber ?? '', commercialRegistry: p.commercialRegistry ?? '', email: p.email ?? '', address: p.address ?? '',
  bankName: p.bankName ?? '', bankAccount: p.bankAccount ?? '', defaultCurrency: p.defaultCurrency ?? '', notes: p.notes ?? '',
});

export function PartyList({ title, endpoint, noun, addPermission, detailed }: { title: string; endpoint: string; noun: string; addPermission?: string; detailed?: boolean }) {
  const parties = useLoad(() => api<Party[]>(endpoint));
  const session = useSession();
  // Terms are set by owners and admins (the database checks again). Not in the sample-data demo build, which has no such route.
  const canSetTerms = !demoMode && (session.role === 'owner' || session.role === 'admin');
  const [adding, setAdding] = useState(false);
  // Decision D4 (sql/062): fix a name, contact, city or phone later. The code never changes here; the change is in the history.
  const [editing, setEditing] = useState<Party | null>(null);
  const canManage = !addPermission || hasPermission(session.permissions, addPermission);
  const canEdit = canManage && !demoMode;
  const blank = { name: '', contact: '', city: '', phone: '', code: '', ...DETAIL_BLANK };
  const withDetails = detailed && !demoMode;
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const close = () => {
    setAdding(false);
    setEditing(null);
    setError(null);
    setForm(blank);
  };
  const startEdit = (p: Party) => {
    setError(null);
    setForm({ name: p.name, contact: p.contact ?? '', city: p.city ?? '', phone: p.phone ?? '', code: p.code ?? '', ...detailsOf(p) });
    setEditing(p);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Customers have no business details yet: send them for suppliers only.
      const { taxNumber, commercialRegistry, email, address, bankName, bankAccount, defaultCurrency, notes, ...core } = form;
      const body = withDetails ? { ...core, taxNumber, commercialRegistry, email, address, bankName, bankAccount, defaultCurrency, notes } : core;
      if (editing) {
        const { code: _code, ...changes } = body;
        await api(`${endpoint}/${editing.id}`, { method: 'PUT', body: JSON.stringify(changes) });
      } else {
        await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      }
      close();
      parties.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const columns: Column<Party>[] = [
    // sql/050: the code is searchable like every column (ListView searches all of them).
    ...(demoMode ? [] : [{ key: 'code', label: tr('Code'), value: (p: Party) => p.code ?? '', render: (p: Party) => <code>{p.code}</code> }]),
    { key: 'name', label: tr('Name'), value: (p) => p.name, render: (p) => <strong>{p.name}</strong> },
    { key: 'contact', label: tr('Contact'), value: (p) => p.contact },
    { key: 'city', label: tr('City'), value: (p) => p.city },
    { key: 'phone', label: tr('Phone'), value: (p) => p.phone, render: (p) => <code>{p.phone}</code> },
    ...(withDetails
      ? [
          { key: 'email', label: tr('Email'), value: (p: Party) => p.email ?? '' },
          { key: 'tax', label: tr('Tax registration no.'), value: (p: Party) => p.taxNumber ?? '', render: (p: Party) => <code>{p.taxNumber}</code> },
          { key: 'currency', label: tr('Currency'), value: (p: Party) => p.defaultCurrency ?? '' },
        ]
      : []),
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
    ...(canEdit
      ? [
          {
            key: 'edit',
            label: tr('Actions'),
            value: () => '',
            render: (p: Party) => (
              <Button variant="outline" size="sm" onClick={() => startEdit(p)} aria-label={trf('Edit {name}', { name: p.name })}>
                {tr('Edit')}
              </Button>
            ),
          },
        ]
      : []),
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
          toolbar={canManage ? <Button type="submit" onClick={() => setAdding(true)}>{tr('Add')} {noun}</Button> : undefined}
        />
      ) : (
        <Loading />
      )}
      {(adding || editing) && (
        <Modal title={editing ? trf('Edit {name}', { name: editing.name }) : trf('Add {noun}', { noun: tr(noun) })} onClose={close}>
          <form className="stack" onSubmit={submit}>
            {editing && (
              <p className="muted">
                {tr('The code stays the same, because it is printed on documents. Every change is kept in the history.')}
                {editing.code ? <> <code>{editing.code}</code></> : null}
              </p>
            )}
            <label>{tr('Name')}<input required value={form.name} onChange={set('name')} /></label>
            <div className="form-row">
              <label>{tr('Contact person (optional)')}<input value={form.contact} onChange={set('contact')} /></label>
              <label>{tr('City (optional)')}<input value={form.city} onChange={set('city')} /></label>
            </div>
            <label>{tr('Phone (optional)')}<input value={form.phone} onChange={set('phone')} placeholder="+20 …" /></label>
            {withDetails ? (
              <>
                <div className="form-row">
                  <label>{tr('Tax registration number (optional)')}<input maxLength={40} value={form.taxNumber} onChange={set('taxNumber')} /></label>
                  <label>{tr('Commercial registry number (optional)')}<input maxLength={40} value={form.commercialRegistry} onChange={set('commercialRegistry')} /></label>
                </div>
                <div className="form-row">
                  <label>{tr('Email (optional)')}<input type="email" maxLength={200} value={form.email} onChange={set('email')} /></label>
                  <label>{tr('Default currency (optional)')}<input maxLength={3} placeholder="EGP" value={form.defaultCurrency} onChange={(e) => setForm((f) => ({ ...f, defaultCurrency: e.target.value.toUpperCase() }))} /></label>
                </div>
                <label>{tr('Address (optional)')}<input maxLength={500} value={form.address} onChange={set('address')} /></label>
                <div className="form-row">
                  <label>{tr('Bank name (optional)')}<input maxLength={120} value={form.bankName} onChange={set('bankName')} /></label>
                  <label>{tr('Bank account or IBAN (optional)')}<input maxLength={60} dir="ltr" value={form.bankAccount} onChange={set('bankAccount')} /></label>
                </div>
                <label>{tr('Notes (optional)')}<textarea rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} /></label>
              </>
            ) : null}
            {demoMode || editing ? null : (
              <label>{tr('Code (optional)')}<input value={form.code} onChange={set('code')} placeholder={tr('Automatic if empty')} /></label>
            )}
            {error && <p className="error">{error}</p>}
            <div className="form-actions"><Button type="submit">{editing ? tr('Save changes') : <>{tr('Add')} {noun}</>}</Button></div>
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
  /** Who may add a new customer or supplier from inside the order (decision D5). Omit to hide the quick-add. */
  partyAddPermission?: string;
}) {
  const session = useSession();
  const cat = useCatalog();
  const parties = useLoad(() => api<Party[]>(props.partyEndpoint));
  const [partyId, setPartyId] = useState('');
  const [quickAdd, setQuickAdd] = useState(false);
  const canQuickAdd = Boolean(props.partyAddPermission && hasPermission(session.permissions, props.partyAddPermission));
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qty: '1', price: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  // Start on the first real warehouse (UX audit: it started on a placeholder, so an order for the first warehouse could not be saved).
  const warehouses = cat.warehouses.data;
  useEffect(() => {
    if (warehouses?.length && !warehouses.some((w) => w.id === warehouseId)) setWarehouseId(warehouses[0]?.id ?? '');
  }, [warehouses, warehouseId]);
  const currency = session.org?.defaultCurrency ?? 'EGP';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const chosen = lines.filter((l) => l.itemId);
    // Say what is wrong instead of saving a free order or sending a bad quantity (UX audit).
    if (!chosen.length) return setError(tr('Add at least one item.'));
    if (chosen.some((l) => !(parseAmount(l.qty) > 0))) return setError(tr('Each item needs a quantity above zero.'));
    if (chosen.some((l) => !Number.isFinite(parseAmount(l.price)))) return setError(tr('Each item needs a price. Type 0 if it is free.'));
    setBusy(true);
    setError(null);
    try {
      const order = await api<{ id: string }>(props.orderEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          [props.partyField]: partyId,
          warehouseId,
          lines: chosen.map((l) => ({ itemId: l.itemId, qty: parseAmount(l.qty), [props.priceField]: toMinor(l.price) })),
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
            {tr(props.partyLabel)}
            <span className="flex items-center gap-2">
              <SearchSelect
                required
                value={partyId}
                onChange={setPartyId}
                label={tr(props.partyLabel)}
                options={parties.data.map((p) => ({ value: p.id, label: p.code ? `${p.code} · ${p.name}` : p.name, keywords: `${p.phone ?? ''} ${p.city ?? ''} ${p.contact ?? ''}` }))}
              />
              {canQuickAdd ? <Button type="button" variant="outline" size="sm" onClick={() => setQuickAdd(true)}>{tr('+ New')}</Button> : null}
            </span>
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
              <SearchSelect
                value={l.itemId}
                onChange={(v) => setLine(i, { itemId: v })}
                label={tr('Item')}
                placeholder={tr('Choose an item…')}
                options={(cat.items.data ?? []).map((it) => ({ value: it.id, label: `${it.sku} · ${it.name}`, keywords: it.nameAr ?? '' }))}
              />
            </label>
            <label>{tr('Quantity')}<input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
            <label>{props.priceLabel} ({currency})<input inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></label>
          </div>
        ))}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1', price: '' }])}>{tr('Add another item')}</Button>
        </div>
        <ErrorToast message={error} onClose={() => setError(null)} />
        <div className="form-actions"><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : props.submitLabel}</Button></div>
      </form>
      {quickAdd ? (
        <QuickAddParty
          title={props.partyField === 'customerId' ? tr('New customer') : tr('New supplier')}
          endpoint={props.partyEndpoint}
          onClose={() => setQuickAdd(false)}
          onAdded={(id) => { setQuickAdd(false); setPartyId(id); parties.reload(); }}
        />
      ) : null}
    </section>
  );
}

/**
 * Adds a customer or supplier without leaving the order, so nothing typed is lost (decision D5, 9 Nov 2026): name and phone only; the
 * rest can be filled in later. The new one is chosen in the order straight away. Outside the order's <form>, so Enter here does not
 * submit the order.
 */
function QuickAddParty({ title, endpoint, onClose, onAdded }: { title: string; endpoint: string; onClose: () => void; onAdded: (id: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api<{ id: string }>(endpoint, { method: 'POST', body: JSON.stringify({ name: name.trim(), phone: phone.trim() }) });
      onAdded(made.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={add}>
        <label>{tr('Name')}<input required autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{tr('Phone')}<input inputMode="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        {error ? <p className="error">{error}</p> : null}
        <div className="form-actions">
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? tr('Saving…') : tr('Add and use')}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
        </div>
      </form>
    </Modal>
  );
}
