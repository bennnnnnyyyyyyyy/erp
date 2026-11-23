import { DateInput } from '../../components/DateInput';
import { useState, type FormEvent } from 'react';
import { formatMoney, hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { parseAmount } from '../../lib/numbers';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { useCatalog } from '../trade/common';

// Prices (sql/097, documentation/plans/MASTER_DATA_PLAN.md slice C): customer groups, the group each customer is in, price lists per
// group with a validity period, and the markup used for suggested prices. A new purchase price never changes a sales price; it is
// shown as a suggestion on the item page. Owners and admins change prices (the database checks again); everyone can read them.

export type CustomerGroup = { id: string; name: string; nameAr: string };
type PriceList = { id: string; name: string; customerGroupId: string; currency: string; validFrom: string; validTo: string | null; includesVat: boolean };
type Customer = { id: string; name: string; code?: string; customerGroupId?: string | null };

const toMinor = (s: string) => Math.round(parseAmount(s) * 100);
const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });
export const groupLabel = (g: CustomerGroup) => (currentLanguage() === 'ar' && g.nameAr ? g.nameAr : g.name);

export function PricesPage() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'sales.prices.manage');
  const groups = useLoad(() => api<CustomerGroup[]>('/v1/sales/customer-groups'));
  const lists = useLoad(() => api<PriceList[]>('/v1/sales/price-lists'));
  const customers = useLoad(() => api<Customer[]>('/v1/sales/customers'));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openList, setOpenList] = useState<string | null>(null);
  // UX audit 20 Nov: three tasks on one page. Each now has its own tab; price lists first, as the most used.
  const [tab, setTab] = useState<'lists' | 'groups' | 'markup'>('lists');

  if (groups.loading || lists.loading || customers.loading) return <section className="page"><Loading /></section>;
  if (groups.error) return <section className="page"><h1>{tr('Prices')}</h1><p className="error">{groups.error}</p></section>;
  const groupList = groups.data ?? [];
  const nameOf = (id: string) => {
    const g = groupList.find((x) => x.id === id);
    return g ? groupLabel(g) : '—';
  };

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      groups.reload();
      lists.reload();
      customers.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="page">
      <h1>{tr('Prices')}</h1>
      <p className="muted">{tr('A customer gets the price list of their group; otherwise the item’s own sales price. You can still change the price on an order.')}</p>
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="tabs" role="tablist" aria-label={tr('Prices')}>
        {([['lists', tr('Price lists')], ['groups', tr('Customer groups')], ...(canManage ? [['markup', tr('Markup')]] : [])] as [typeof tab, string][]).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
      {tab === 'groups' && <>

      {/* UX audit 20 Nov: the forms ran into the next heading (h2 has no margin). Each task now sits in its own card. */}
      <div className="form-card stack">
      <h2>{tr('Customer groups')}</h2>
      {groupList.length === 0 ? <p className="muted">{tr('No customer groups yet.')}</p> : (
        <ul className="stack">
          {groupList.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <span>{groupLabel(g)}</span>
              <span className="muted small">{trf('{count} customers', { count: (customers.data ?? []).filter((c) => c.customerGroupId === g.id).length })}</span>
              {canManage ? <Button type="button" variant="ghost" size="sm" onClick={() => void run(() => api(`/v1/sales/customer-groups/${g.id}`, { method: 'DELETE' }), tr('Customer group removed.'))}>{tr('Remove')}</Button> : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? <AddGroupForm onSave={(body) => run(() => api('/v1/sales/customer-groups', { method: 'POST', body: JSON.stringify(body) }), tr('Customer group added.'))} /> : null}
      </div>
      {canManage && groupList.length ? (
        <div className="form-card stack">
          <h2>{tr('Put a customer in a group')}</h2>
          <AssignCustomerForm customers={customers.data ?? []} groups={groupList}
            onSave={(customerId, groupId) => run(() => api(`/v1/sales/customers/${customerId}/group`, { method: 'PUT', body: JSON.stringify({ groupId: groupId || null }) }), tr('Customer group saved.'))} />
        </div>
      ) : null}

      </>}
      {tab === 'lists' && <>
      {(lists.data ?? []).length === 0 ? <p className="muted">{tr('No price lists yet.')}</p> : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{tr('Name')}</th>
              <th scope="col">{tr('Customer group')}</th>
              <th scope="col">{tr('From')}</th>
              <th scope="col">{tr('To')}</th>
              <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {(lists.data ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.name}{l.includesVat ? <span className="muted small"> · {tr('includes VAT')}</span> : null}</td>
                <td>{nameOf(l.customerGroupId)}</td>
                <td className="nowrap">{l.validFrom}</td>
                <td className="nowrap">{l.validTo ?? tr('No end')}</td>
                <td className="actions">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setOpenList(openList === l.id ? null : l.id)}>{openList === l.id ? tr('Close') : tr('Prices')}</Button>
                  {canManage ? <Button type="button" variant="ghost" size="sm" onClick={() => void run(() => api(`/v1/sales/price-lists/${l.id}`, { method: 'DELETE' }), tr('Price list removed.'))}>{tr('Remove')}</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {openList ? <PriceListItems list={(lists.data ?? []).find((l) => l.id === openList)} canManage={canManage} /> : null}
      {canManage && groupList.length ? (
        <AddListForm groups={groupList} onSave={(body) => run(() => api('/v1/sales/price-lists', { method: 'POST', body: JSON.stringify(body) }), tr('Price list added.'))} />
      ) : null}
      {canManage && !groupList.length ? <p className="muted small">{tr('Add a customer group first; each price list belongs to one.')}</p> : null}
      </>}

      {tab === 'markup' && canManage ? <MarkupForm onSave={(markupPercent) => run(() => api('/v1/sales/price-settings', { method: 'PUT', body: JSON.stringify({ markupPercent }) }), tr('Markup saved.'))} /> : null}
      </div>
    </section>
  );
}

function AddGroupForm({ onSave }: { onSave: (body: { name: string; nameAr: string }) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', nameAr: '' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await onSave(form);
    setForm({ name: '', nameAr: '' });
  }
  return (
    <form className="form-row" onSubmit={submit} aria-label={tr('Add customer group')}>
      <label>{tr('Name')}<input required maxLength={120} placeholder={tr('Wholesale')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label>{tr('Name in Arabic (optional)')}<input dir="rtl" maxLength={120} value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
      <div className="form-actions"><Button type="submit">{tr('Add customer group')}</Button></div>
    </form>
  );
}

function AssignCustomerForm({ customers, groups, onSave }: { customers: Customer[]; groups: CustomerGroup[]; onSave: (customerId: string, groupId: string) => Promise<void> }) {
  const [customerId, setCustomerId] = useState('');
  const [groupId, setGroupId] = useState('');
  return (
    <div className="form-row" role="group" aria-label={tr('Put a customer in a group')}>
      <label>
        {tr('Customer')}
        <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setGroupId(customers.find((c) => c.id === e.target.value)?.customerGroupId ?? ''); }}>
          <option value="">{tr('Choose a customer')}</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>)}
        </select>
      </label>
      <label>
        {tr('Customer group')}
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{tr('No group')}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
        </select>
      </label>
      <div className="form-actions">
        <Button type="button" disabled={!customerId} onClick={() => void onSave(customerId, groupId)}>{tr('Save group')}</Button>
        {!customerId ? <span className="muted small">{tr('Choose a customer first.')}</span> : null}
      </div>
    </div>
  );
}

function AddListForm({ groups, onSave }: { groups: CustomerGroup[]; onSave: (body: Record<string, string | null>) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', customerGroupId: groups[0]?.id ?? '', validFrom: new Date().toISOString().slice(0, 10), validTo: '' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await onSave({ ...form, validTo: form.validTo || null });
  }
  return (
    <form className="form-card stack" onSubmit={submit} aria-label={tr('Add price list')}>
      <div className="form-row">
        <label>{tr('Name')}<input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>
          {tr('Customer group')}
          <select value={form.customerGroupId} onChange={(e) => setForm({ ...form, customerGroupId: e.target.value })}>
            {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>{tr('From')}<DateInput required value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></label>
        <label>{tr('To (optional)')}<DateInput value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></label>
      </div>
      <p className="muted small">{tr('One price list per customer group at a time: the dates of two lists for the same group cannot overlap.')}</p>
      <div className="form-actions"><Button type="submit">{tr('Add price list')}</Button></div>
    </form>
  );
}

function PriceListItems({ list, canManage }: { list: PriceList | undefined; canManage: boolean }) {
  const cat = useCatalog();
  const rows = useLoad(() => (list ? api<{ itemId: string; priceMinor: number }[]>(`/v1/sales/price-lists/${list.id}/items`) : Promise.resolve([])));
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!list) return null;
  const itemName = (id: string) => {
    const it = cat.items.data?.find((x) => x.id === id);
    return it ? `${it.sku} · ${it.name}` : id;
  };
  async function save(target: string, priceMinor: number | null) {
    setError(null);
    try {
      await api(`/v1/sales/price-lists/${list?.id}/items/${target}`, { method: 'PUT', body: JSON.stringify({ priceMinor }) });
      setItemId('');
      setPrice('');
      rows.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="form-card stack" role="group" aria-label={trf('Prices on {name}', { name: list.name })}>
      <strong>{trf('Prices on {name}', { name: list.name })}</strong>
      {rows.loading ? <Loading /> : (rows.data ?? []).length === 0 ? <p className="muted">{tr('No items on this list yet.')}</p> : (
        <table className="table">
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.itemId}>
                <td>{itemName(r.itemId)}</td>
                <td className="right">{money(r.priceMinor, list.currency)}</td>
                {canManage ? <td className="actions"><Button type="button" variant="ghost" size="sm" onClick={() => void save(r.itemId, null)}>{tr('Remove')}</Button></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage ? (
        <div className="form-row">
          <label>
            {tr('Item')}
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{tr('Choose an item…')}</option>
              {(cat.items.data ?? []).map((it) => <option key={it.id} value={it.id}>{`${it.sku} · ${it.name}`}</option>)}
            </select>
          </label>
          <label>{trf('Price ({currency})', { currency: list.currency })}<input inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <div className="form-actions">
            <Button type="button" disabled={!itemId || !Number.isFinite(parseAmount(price))} onClick={() => void save(itemId, toMinor(price))}>{tr('Save price')}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function MarkupForm({ onSave }: { onSave: (markup: number | null) => Promise<void> }) {
  const [value, setValue] = useState('');
  return (
    <div className="form-card stack" role="group" aria-label={tr('Markup for suggested prices')}>
      <strong>{tr('Markup for suggested prices')}</strong>
      <p className="muted small">{tr('The item page suggests a sales price: the latest purchase cost plus this markup. Nothing changes until you save a price yourself.')}</p>
      <div className="form-row">
        <label>{tr('Markup (%)')}<input inputMode="decimal" placeholder="20" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <div className="form-actions">
          <Button type="button" onClick={() => void onSave(value.trim() === '' ? null : parseAmount(value))}>{tr('Save markup')}</Button>
        </div>
      </div>
    </div>
  );
}
