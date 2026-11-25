import { useEffect, useState, type FormEvent } from 'react';
import { Attachments } from '../../components/Attachments';
import { Notes } from '../../components/Notes';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { readOrderLink } from '../../lib/orderLink';
import { unitLabel } from '../../lib/names';
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
import { BackLink, Link, navigate } from '../../lib/router';
import { parseAmount, toMinor } from '../../lib/numbers';
import { SearchSelect } from '../../components/SearchSelect';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { formatMoney, hasPermission, vatLine, vatLineInclusive } from '@erp/shared';

import { tr, trf } from '../../lib/i18n';
import { usePartyCodes } from '../inventory/PartyCodes';
import { toBaseLine } from '../../lib/lineUnits';
import { useItemUnits } from '../../lib/useItemUnits';
// DEMO ONLY: shared pieces for the sample purchasing and sales screens (lib/demoTrade.ts).

export function useCatalog() {
  const items = useLoad(() => api<DemoItem[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<DemoWarehouse[]>('/v1/inventory/warehouses'));
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? id;
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  const uomOf = (id: string) => unitLabel(items.data?.find((i) => i.id === id)?.uom);
  return { items, warehouses, itemName, warehouseName, uomOf, ready: Boolean(items.data && warehouses.data) };
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

// Supplier and customer business details (sql/076, sql/081), edited in the same dialog.
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
      // Only the lists that show the details (suppliers, customers) send them; the sample-data demo does not.
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
    // UX audit 20 Nov: 11 columns ran off the screen and names wrapped to three lines. The list shows code, name, city and terms;
    // contact, phone, email, tax number and currency are still searched and exported, and are seen and changed under Edit.
    { key: 'name', label: tr('Name'), value: (p) => p.name, render: (p) => <strong>{p.name}</strong> },
    { key: 'contact', label: tr('Contact'), value: (p) => p.contact, hidden: true },
    { key: 'city', label: tr('City'), value: (p) => p.city },
    { key: 'phone', label: tr('Phone'), value: (p) => p.phone, hidden: true },
    ...(withDetails
      ? [
          { key: 'email', label: tr('Email'), value: (p: Party) => p.email ?? '', hidden: true },
          { key: 'tax', label: tr('Tax registration no.'), value: (p: Party) => p.taxNumber ?? '', hidden: true },
          { key: 'currency', label: tr('Currency'), value: (p: Party) => p.defaultCurrency ?? '', hidden: true },
        ]
      : []),
    {
      key: 'terms',
      label: tr('Payment terms'),
      value: (p) => p.paymentTermsDays ?? -1,
      render: (p) => (p.paymentTermsDays == null ? <span className="muted">{tr('Company default')}</span> : trf('{n} days', { n: p.paymentTermsDays })),
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
            {editing && canSetTerms ? (
              // Saved on its own as soon as it changes (owners and admins; the database checks again), as before in the list.
              <label>{tr('Payment terms')} <span className="muted small">{tr('(days; empty = company default)')}</span>
                <TermsCell party={editing} endpoint={endpoint} onSaved={parties.reload} />
              </label>
            ) : null}
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
          {editing && !demoMode ? <Attachments entityType={endpoint.includes('/suppliers') ? 'supplier' : 'customer'} entityId={editing.id} /> : null}
          {editing && !demoMode ? <Notes entityType={endpoint.includes('/suppliers') ? 'supplier' : 'customer'} entityId={editing.id} /> : null}
        </Modal>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ new order form (purchase and sales)

/** `suggested`: the price was filled in from the price lookup and not typed (it is replaced when the party or item changes). */
/** `unit`: the unit quantity and price are typed in ('' = the item's base unit; slice D, sql/101). `suggestedBase`: the looked-up price
 *  per base unit, so a suggested price follows a change of unit (a box suggests the piece price x 12). */
type Line = { itemId: string; qty: string; price: string; suggested?: boolean; unit: string; suggestedBase?: number };
const emptyLine = (): Line => ({ itemId: '', qty: '1', price: '', unit: '' });

/** Under a sales order line: what the typed price means once VAT applies (walkthrough 18 Nov: a price typed with "prices include VAT"
 *  on was silently read as including VAT). The item's own rate, else the company default; shown only when quantity and price are set. */
function LineVatPreview({ itemId, qty, priceMinor, vat, items, currency }: {
  itemId: string;
  /** In the base unit, as saved (slice D: a box line is previewed as the pieces the database will see). */
  qty: number;
  priceMinor: number;
  vat: NonNullable<Parameters<typeof NewOrderForm>[0]['vat']>;
  items: DemoItem[];
  currency: string;
}) {
  if (!itemId || !Number.isFinite(qty) || qty <= 0 || priceMinor <= 0) return null;
  const item = items.find((it) => it.id === itemId);
  const rateId = item?.vatRateId ?? vat.defaultVatRateId;
  const rate = vat.rates.find((r) => r.id === rateId)?.rate ?? 0;
  const split = (vat.pricesIncludeVat ? vatLineInclusive : vatLine)(qty, priceMinor, rate);
  const m = (minor: number) => formatMoney({ amountMinor: minor, currency });
  return (
    <p className="hint muted small" aria-live="polite">
      {trf('Before VAT {net} · VAT {rate}% {tax} · Total {gross}', { net: m(split.netMinor), rate, tax: m(split.taxMinor), gross: m(split.grossMinor) })}
    </p>
  );
}

/** Under a line typed in another unit: what is saved in the base unit, and the rounding when the price per unit does not split. */
function LineUnitHint({ b, unit, base, money }: { b: ReturnType<typeof toBaseLine>; unit: string; base: string; money: (minor: number) => string }) {
  if (!Number.isFinite(b.baseQty) || b.baseQty <= 0) return null;
  if (!b.whole) return <p className="hint error small" aria-live="polite">{trf('Not a whole number of {base}: {qty} {base}.', { base, qty: b.baseQty })}</p>;
  return (
    <p className="hint muted small" aria-live="polite">
      {trf('= {qty} {base} at {price} each', { qty: b.baseQty, base, price: money(b.baseMinor) })}
      {b.lineMinor !== b.typedLineMinor
        ? ` · ${trf('the price per {unit} does not split evenly: the line is saved as {saved}', { unit, saved: money(b.lineMinor) })}`
        : ''}
    </p>
  );
}

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
  /** sql/097: the price to suggest per item for the chosen party (customer price or supplier's last cost), in minor units. Editable. */
  priceLookup?: (partyId: string, itemIds: string[]) => Promise<Record<string, number | null>>;
  /** Sales only (walkthrough 18 Nov): the company's VAT basis, so the price label says "before VAT" or "including VAT" and each line
   *  shows its before-VAT / VAT / total split as it is typed (the same maths the database uses, packages/shared/src/vat.ts). */
  vat?: { registered: boolean; pricesIncludeVat: boolean; defaultVatRateId: string | null; rates: { id: string; rate: number }[] } | null;
}) {
  const session = useSession();
  const cat = useCatalog();
  const parties = useLoad(() => api<Party[]>(props.partyEndpoint));
  // Filled from a link (the low stock pop-up, sql/106): ?item=&qty=&supplier=. Nothing is saved until the person places the order.
  const [link] = useState(() => readOrderLink(window.location.search));
  const [partyId, setPartyId] = useState(link.partyId);
  const [quickAdd, setQuickAdd] = useState(false);
  const canQuickAdd = Boolean(props.partyAddPermission && hasPermission(session.permissions, props.partyAddPermission));
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [link.itemId ? { ...emptyLine(), itemId: link.itemId, qty: link.qty || '1' } : emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  // Start on the first real warehouse (UX audit: it started on a placeholder, so an order for the first warehouse could not be saved).
  const warehouses = cat.warehouses.data;
  useEffect(() => {
    if (warehouses?.length && !warehouses.some((w) => w.id === warehouseId)) setWarehouseId(warehouses[0]?.id ?? '');
  }, [warehouses, warehouseId]);
  const currency = session.org?.defaultCurrency ?? 'EGP';
  // The chosen party's own codes for our items (sql/099): searchable and shown beside ours.
  const partyCodes = usePartyCodes(props.partyField === 'customerId' ? 'customer' : 'supplier', partyId);
  const vatOn = props.vat?.registered === true;
  // Units (slice D): each item's base unit plus the units set up for this side (selling or buying), and the unit a new line starts in.
  const side = props.partyField === 'customerId' ? 'sale' : 'purchase';
  const itemUnits = useItemUnits();
  const baseUnitOf = (itemId: string) => (cat.items.data ?? []).find((it) => it.id === itemId)?.uom ?? '';
  const unitsOf = (itemId: string) =>
    (itemUnits.data?.units ?? []).filter((u) => u.itemId === itemId && (side === 'sale' ? u.forSale : u.forPurchase));
  const factorOf = (itemId: string, unit: string) => (unit ? (unitsOf(itemId).find((u) => u.unit === unit)?.factor ?? 1) : 1);
  const defaultUnitOf = (itemId: string) => {
    const d = (itemUnits.data?.defaults ?? []).find((x) => x.itemId === itemId);
    const unit = (side === 'sale' ? d?.saleUnit : d?.purchaseUnit) ?? '';
    return unit && unitsOf(itemId).some((u) => u.unit === unit) ? unit : '';
  };
  /** A line as it will be saved: pieces and price per piece. */
  const saved = (l: Line) => toBaseLine(parseAmount(l.qty), toMinor(l.price), factorOf(l.itemId, l.unit), baseUnitOf(l.itemId));
  const money2 = (minor: number) => formatMoney({ amountMinor: minor, currency });

  // Fill empty (or still suggested) prices once a party and items are chosen; a typed price is never replaced.
  const { priceLookup } = props;
  const itemKey = lines.map((l) => l.itemId).filter(Boolean).join(',');
  useEffect(() => {
    if (!priceLookup || !partyId || !itemKey) return;
    let live = true;
    priceLookup(partyId, [...new Set(itemKey.split(','))])
      .then((prices) => {
        if (!live) return;
        setLines((ls) =>
          ls.map((l) => {
            if (!l.itemId || (l.price !== '' && !l.suggested)) return l;
            const minor = prices[l.itemId];
            if (minor === null || minor === undefined) return l.suggested ? { ...l, price: '', suggested: false, suggestedBase: undefined } : l;
            return { ...l, price: ((minor * factorOf(l.itemId, l.unit)) / 100).toFixed(2), suggested: true, suggestedBase: minor };
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [priceLookup, partyId, itemKey]);

  // Scanning step 2: a scanned barcode adds the item, or 1 more if it is already on a line in its base unit. The item list already
  // carries barcodes; an item made since the page opened is asked for (sql/108). Nothing is saved until the order is placed.
  async function addScanned(code: string) {
    setScanning(false);
    setScanned(null);
    let item = (cat.items.data ?? []).find((it) => it.barcode === code);
    if (!item) {
      try {
        item = await api<DemoItem>(`/v1/inventory/items/by-barcode/${encodeURIComponent(code)}`);
      } catch (err) {
        const status = (err as { status?: number }).status;
        return setError(status === 404 ? trf('No item has the barcode {code}.', { code }) : (err as Error).message);
      }
    }
    const found = item;
    setLines((ls) => {
      const same = ls.findIndex((l) => l.itemId === found.id && !l.unit);
      if (same >= 0) return ls.map((l, n) => (n === same ? { ...l, qty: String((parseAmount(l.qty) || 0) + 1) } : l));
      const blank = ls.findIndex((l) => !l.itemId);
      const line = { ...emptyLine(), itemId: found.id, unit: defaultUnitOf(found.id) };
      return blank >= 0 ? ls.map((l, n) => (n === blank ? line : l)) : [...ls, line];
    });
    setScanned(trf('Added {item}.', { item: `${found.sku} · ${found.name}` }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const chosen = lines.filter((l) => l.itemId);
    // Say what is wrong instead of saving a free order or sending a bad quantity (UX audit).
    if (!chosen.length) return setError(tr('Add at least one item.'));
    if (chosen.some((l) => !(parseAmount(l.qty) > 0))) return setError(tr('Each item needs a quantity above zero.'));
    if (chosen.some((l) => !Number.isFinite(parseAmount(l.price)))) return setError(tr('Each item needs a price. Type 0 if it is free.'));
    const notWhole = chosen.find((l) => !saved(l).whole);
    if (notWhole)
      return setError(trf('{qty} {unit} is not a whole number of {base}. Change the quantity.', { qty: notWhole.qty, unit: notWhole.unit, base: baseUnitOf(notWhole.itemId) }));
    setBusy(true);
    setError(null);
    try {
      const order = await api<{ id: string }>(props.orderEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          [props.partyField]: partyId,
          warehouseId,
          lines: chosen.map((l) => {
            const b = saved(l);
            return { itemId: l.itemId, qty: b.baseQty, [props.priceField]: b.baseMinor, ...(l.unit ? { unit: l.unit } : {}) };
          }),
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
      <BackLink to={props.backTo} label={`← ${props.backLabel}`} backLabel={tr('← Back')} />
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
            {/* Dead-ends audit, 25 Nov: with no customers or suppliers yet the picker only said "Nothing matches". */}
            {parties.data.length === 0 && !canQuickAdd ? <span className="muted small">{props.partyLabel === 'Customer' ? tr('No customers yet.') : tr('No suppliers yet.')} <Link to={props.partyLabel === 'Customer' ? '/sales/customers' : '/purchasing/suppliers'}>{props.partyLabel === 'Customer' ? tr('Customers') : tr('Suppliers')}</Link></span> : null}
            {/* Ben, 23 Nov: an item with no supplier yet opens the order and asks for one. */}
            {link.itemId && !partyId ? <span className="notice small" role="status">{trf('Choose a {party}.', { party: tr(props.partyLabel).toLowerCase() })}</span> : null}
          </label>
          <label>
            {tr('Warehouse')}
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {(cat.warehouses.data ?? []).length === 0 ? <span className="error small">{tr('Add a warehouse first.')} <Link to="/inventory/stock">{tr('Stock on hand')}</Link></span> : null}
          </label>
        </div>
        <strong>{tr('Items')}</strong>
        {(cat.items.data ?? []).length === 0 ? <p className="muted small">{tr('No items yet.')} <Link to="/inventory/stock">{tr('Stock on hand')}</Link></p> : null}
        {lines.map((l, i) => (
          <div className="form-row three" key={i}>
            <label>
              {tr('Item')}
              <SearchSelect
                value={l.itemId}
                onChange={(v) => setLine(i, { itemId: v, unit: defaultUnitOf(v) })}
                label={tr('Item')}
                placeholder={tr('Choose an item…')}
                options={(cat.items.data ?? []).map((it) => {
                  const theirs = partyCodes.get(it.id);
                  return { value: it.id, label: theirs ? `${it.sku} · ${it.name} · (${theirs})` : `${it.sku} · ${it.name}`, keywords: `${it.nameAr ?? ''} ${theirs ?? ''}` };
                })}
              />
            </label>
            <label>
              {tr('Quantity')}
              <span className="flex items-center gap-2">
                <input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                {l.itemId && unitsOf(l.itemId).length ? (
                  <select
                    aria-label={tr('Unit')}
                    className="unit-select"
                    value={l.unit}
                    onChange={(e) => {
                      const unit = e.target.value;
                      const price = l.suggested && l.suggestedBase !== undefined ? ((l.suggestedBase * factorOf(l.itemId, unit)) / 100).toFixed(2) : l.price;
                      setLine(i, { unit, price });
                    }}
                  >
                    <option value="">{tr(baseUnitOf(l.itemId))}</option>
                    {unitsOf(l.itemId).map((u) => (
                      <option key={u.unit} value={u.unit}>{trf('{unit} ({factor} {base})', { unit: tr(u.unit), factor: u.factor, base: tr(baseUnitOf(l.itemId)) })}</option>
                    ))}
                  </select>
                ) : null}
              </span>
            </label>
            <label>
              {vatOn ? (props.vat?.pricesIncludeVat ? trf('{label} including VAT', { label: props.priceLabel }) : trf('{label} before VAT', { label: props.priceLabel })) : props.priceLabel} ({currency})
              <input inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => setLine(i, { price: e.target.value, suggested: false })} />
              {l.suggested ? <span className="hint muted">{tr('Suggested price; you can change it.')}</span> : null}
            </label>
            {l.itemId && l.unit ? <LineUnitHint b={saved(l)} unit={tr(l.unit)} base={tr(baseUnitOf(l.itemId))} money={money2} /> : null}
            {vatOn ? (
              <LineVatPreview itemId={l.itemId} qty={saved(l).baseQty} priceMinor={saved(l).baseMinor} vat={props.vat!} items={cat.items.data ?? []} currency={currency} />
            ) : null}
          </div>
        ))}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])}>{tr('Add another item')}</Button>
          {demoMode ? null : <Button variant="outline" type="button" onClick={() => setScanning(true)}>{tr('Scan a barcode')}</Button>}
        </div>
        {scanned ? <p className="notice small" role="status">{scanned}</p> : null}
        {scanning ? <BarcodeScanner onCode={(code) => void addScanned(code)} onClose={() => setScanning(false)} /> : null}
        <ErrorToast message={error} onClose={() => setError(null)} />
        <div className="form-actions"><Button type="submit" disabled={busy || (cat.warehouses.data ?? []).length === 0}>{busy ? tr('Saving…') : props.submitLabel}</Button></div>
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
